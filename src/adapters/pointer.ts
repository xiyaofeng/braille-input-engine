import {
  BrailleInputException,
  isBrailleDot,
  type BrailleDot,
  type BrailleInputController,
  type BrailleAttachment,
  type ActivationGroup,
} from "../core/types.js";
import {
  applyActivationLosses,
  observeInputTermination,
  observeDocumentLifecycle,
  leavesScope,
  retainFocusRoot,
} from "./lifecycle.js";
import { getInternalActivationGroup } from "./activation.js";

export interface PointerAdapterOptions {
  readonly activation?: "focus" | "manual" | "always";
  readonly activationGroup?: ActivationGroup;
  readonly dotSelector?: string;
  readonly actionGuard?: () => boolean;
}

let pointerAttachmentCounter = 0;
type TrackedPointer = [BrailleDot, string, HTMLElement, (0 | 1)?];

function elementDot(element: Element): BrailleDot | null {
  const value = element.getAttribute("data-braille-dot");
  const dot = value === null ? Number.NaN : Number(value);
  return isBrailleDot(dot) ? dot : null;
}

export function attachPointer(
  controller: BrailleInputController,
  scope: HTMLElement,
  options: PointerAdapterOptions = {},
): BrailleAttachment<PointerAdapterOptions> {
  if (controller.getState()["destroyed"])
    throw new BrailleInputException(
      "CONTROLLER_DESTROYED",
      "The controller has been destroyed.",
    );
  if (!scope || scope.nodeType !== 1)
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "Pointer scope must be an HTMLElement.",
    );
  const activation = options.activation ?? "focus";
  if (!(["focus", "manual", "always"] as const).includes(activation))
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "Invalid pointer activation mode.",
    );
  if (
    options.dotSelector !== undefined &&
    typeof options.dotSelector !== "string"
  )
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "dotSelector must be a string.",
    );
  const selector = options.dotSelector ?? "[data-braille-dot]";
  const actionGuard = options.actionGuard;
  const group = getInternalActivationGroup(options.activationGroup);
  if (options.activationGroup && !group)
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "activationGroup must be created by createActivationGroup().",
    );
  let active = activation !== "manual";
  let detached = false;
  const attachmentId = ++pointerAttachmentCounter;
  let tracked = new Map<number, TrackedPointer>();
  let round = 0;
  let groupToken: (() => void) | undefined;
  let groupDestroyDisposer: (() => void) | undefined;
  if (group) {
    groupToken = group.add(scope);
    groupDestroyDisposer = group.subscribeDestroyed(() => {
      active = false;
      return cancelAll(true);
    });
  }

  const isActive = (event: Event): boolean => {
    if (detached || !controller.getState()["enabled"]) return false;
    if (!active) return false;
    if (activation !== "focus") return true;
    if (group) return group.isMember(event.composedPath()[0] as Node | null);
    // Reaching this scope's listener already establishes local event ownership.
    return true;
  };

  const findDot = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const candidate = target.closest(selector);
    if (!(candidate instanceof HTMLElement) || !scope.contains(candidate))
      return null;
    const dot = elementDot(candidate);
    return dot === null ? null : candidate;
  };

  const dispatch = (
    action: Parameters<BrailleInputController["dispatch"]>[0],
  ): void => {
    try {
      controller.dispatch(action);
    } catch {
      // Pointer listeners must not leak exceptions across the browser boundary.
    }
  };

  const actionsAllowed = (): boolean => {
    if (!actionGuard) return true;
    try {
      return actionGuard();
    } catch {
      return false;
    }
  };

  function releaseCapture(element: HTMLElement, pointerId: number): void {
    try {
      element.releasePointerCapture?.(pointerId);
    } catch {
      // Capture may already have been released by the browser or host.
    }
  }

  function cancelAll(defer?: boolean, inputs = tracked) {
    if (inputs === tracked) tracked = new Map();
    else
      for (const [id, old] of inputs)
        if (tracked.get(id) === old) tracked.delete(id);
    const loss = [
      controller,
      Array.from(inputs, ([, input]) => input[1]),
      () => {
        for (const [pointerId, input] of inputs)
          releaseCapture(input[2], pointerId);
      },
    ] as const;
    if (defer) return loss;
    applyActivationLosses([loss]);
  }

  const releaseFocusRoot = retainFocusRoot(scope);
  const disposeLifecycle = observeDocumentLifecycle(
    controller,
    scope.ownerDocument,
    (composing) => {
      if (composing !== false) return cancelAll(true);
    },
    (from, to) => {
      if (activation === "focus" && leavesScope(from, to, scope, group))
        return cancelAll(true);
    },
  );

  // Keep only live inputs. Reset, disable, mode changes and destroy can release
  // controller inputs before the browser sends their terminal events.
  const disposeState = controller.subscribeState((state) => {
    for (const [pointerId, input] of tracked) {
      if (state.pressedInputIds.includes(input[1])) {
        input[3] = 1;
      } else if (input[3]) {
        tracked.delete(pointerId);
        releaseCapture(input[2], pointerId);
      }
    }
  });

  function onPointerDown(event: Event): void {
    const pointerEvent = event as PointerEvent;
    const element = findDot(pointerEvent.target);
    if (!element || !actionsAllowed() || !isActive(pointerEvent)) return;
    if (pointerEvent.pointerType === "mouse" && pointerEvent.button !== 0)
      return;
    const dot = elementDot(element);
    if (dot === null) return;
    const inputId = `pointer:${attachmentId}:${pointerEvent.pointerId}:${++round}:dot:${dot}`;
    if (tracked.has(pointerEvent.pointerId)) return;
    tracked.set(pointerEvent.pointerId, [dot, inputId, element]);
    try {
      element.setPointerCapture?.(pointerEvent.pointerId);
    } catch {
      // A host may remove the element or release the pointer before capture.
    }
    dispatch({ type: "dot-down", dot, inputId, source: "pointer" });
    pointerEvent.preventDefault();
  }

  const disposeCancellation = observeInputTermination(
    controller,
    scope,
    ["pointerup", "pointercancel", "lostpointercapture"],
    (rawEvent) => {
      const event = rawEvent as PointerEvent;
      const input = tracked.get(event.pointerId);
      if (!input) return;
      // Snapshot every participating attachment before any guard or capture call.
      const inputs = new Map(tracked);
      return () => {
        if (event.type === "pointerup" && actionsAllowed() && isActive(event)) {
          if (tracked.get(event.pointerId) === input)
            tracked.delete(event.pointerId);
          event.preventDefault();
          return {
            type: "dot-up" as const,
            dot: input[0],
            inputId: input[1],
            source: "pointer" as const,
          };
        }
        return cancelAll(true, inputs);
      };
    },
  );

  function onClick(event: Event): void {
    const mouseEvent = event as PointerEvent;
    // Physical gestures belong exclusively to down/up, including ones started
    // before this attachment existed or while inactive. Pointer Events identify
    // their clicks by pointerType; older MouseEvent clicks use detail > 0.
    // Keyboard/AT and element.click() remain independent high-level activations.
    // No elapsed-time window or retained pointer ID history is needed.
    if (mouseEvent.pointerType || mouseEvent.detail > 0) return;
    const element = findDot(mouseEvent.target);
    if (!element || !actionsAllowed() || !isActive(mouseEvent)) return;
    const dot = elementDot(element);
    if (dot === null) return;
    const inputId = `pointer:${attachmentId}:click:${dot}`;
    dispatch({ type: "dot-down", dot, inputId, source: "pointer" });
    dispatch({ type: "dot-up", dot, inputId, source: "pointer" });
  }

  scope.addEventListener("pointerdown", onPointerDown);
  scope.addEventListener("click", onClick);

  return {
    activate(): void {
      if (!detached && !group?.isDestroyed() && activation === "manual")
        active = true;
    },
    deactivate(): void {
      if (!detached && activation === "manual") {
        active = false;
        cancelAll();
      }
    },
    updateOptions(patch): void {
      if (detached) return;
      if ("activationGroup" in (patch as object))
        throw new BrailleInputException(
          "INVALID_CONFIG",
          "activationGroup is construction-only.",
        );
      if (
        patch.dotSelector !== undefined &&
        typeof patch.dotSelector !== "string"
      )
        throw new BrailleInputException(
          "INVALID_CONFIG",
          "dotSelector must be a string.",
        );
      // The DOM listener stays stable; selector updates are intentionally not
      // supported as an implicit rebind because they can change pointer identity.
      if (patch.activation && patch.activation !== activation)
        throw new BrailleInputException(
          "INVALID_CONFIG",
          "activation is construction-only for pointer attachments.",
        );
    },
    detach(): void {
      if (detached) return;
      detached = true;
      cancelAll();
      scope.removeEventListener("pointerdown", onPointerDown);
      disposeCancellation();
      disposeLifecycle();
      releaseFocusRoot();
      scope.removeEventListener("click", onClick);
      groupToken?.();
      groupDestroyDisposer?.();
      disposeState();
    },
  };
}
