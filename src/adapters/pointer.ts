import {
  BrailleInputException,
  isBrailleDot,
  type BrailleDot,
  type BrailleInputController,
  type BrailleAttachment,
  type ActivationGroup,
} from "../core/types.js";
import { asInternalController } from "../core/internal.js";
import { getInternalActivationGroup } from "./activation.js";

export interface PointerAdapterOptions {
  readonly activation?: "focus" | "manual" | "always";
  readonly activationGroup?: ActivationGroup;
  readonly dotSelector?: string;
  readonly actionGuard?: () => boolean;
}

let pointerAttachmentCounter = 0;

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
  const attachmentId = String(++pointerAttachmentCounter);
  const tracked = new Map<string, { dot: BrailleDot; pointerId: number }>();
  const recentPointerClicks = new WeakMap<HTMLElement, number>();
  let groupToken: (() => void) | undefined;
  let groupDestroyDisposer: (() => void) | undefined;
  if (group) {
    groupToken = group.add(scope);
    groupDestroyDisposer = group.subscribeDestroyed(() => {
      active = false;
      cancelAll();
    });
  }

  const isActive = (event?: Event): boolean => {
    if (detached || !asInternalController(controller).getState()["enabled"])
      return false;
    if (!active) return false;
    if (activation === "manual") return active;
    if (activation === "always") return true;
    if (group) return group.isMember(event?.target as Node | null);
    return Boolean(
      event &&
      (event.composedPath?.().includes(scope) ||
        scope.contains(event.target as Node)),
    );
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

  function cancelAll(): void {
    for (const inputId of [...tracked.keys()]) {
      dispatch({ type: "input-cancel", inputId, source: "pointer" });
    }
    tracked.clear();
    try {
      asInternalController(controller).__handleActivationLost(
        "activation-lost",
      );
    } catch {
      // The controller may already be destroyed.
    }
  }

  function onPointerDown(event: Event): void {
    const pointerEvent = event as PointerEvent;
    const element = findDot(pointerEvent.target);
    if (!element || !isActive(pointerEvent) || !actionsAllowed()) return;
    if (pointerEvent.pointerType === "mouse" && pointerEvent.button !== 0)
      return;
    const dot = elementDot(element);
    if (dot === null) return;
    const inputId = `pointer:${attachmentId}:${pointerEvent.pointerId}:dot:${dot}`;
    if (tracked.has(inputId)) return;
    tracked.set(inputId, { dot, pointerId: pointerEvent.pointerId });
    recentPointerClicks.set(element, Date.now());
    element.setPointerCapture?.(pointerEvent.pointerId);
    dispatch({ type: "dot-down", dot, inputId, source: "pointer" });
    pointerEvent.preventDefault();
  }

  function onPointerUp(event: Event): void {
    const pointerEvent = event as PointerEvent;
    if (!actionsAllowed()) return;
    const trackedEntry = [...tracked.entries()].find(
      ([, value]) => value.pointerId === pointerEvent.pointerId,
    );
    if (!trackedEntry) return;
    const [inputId, trackedInput] = trackedEntry;
    tracked.delete(inputId);
    dispatch({
      type: "dot-up",
      dot: trackedInput.dot,
      inputId,
      source: "pointer",
    });
    pointerEvent.preventDefault();
  }

  function onClick(event: Event): void {
    const mouseEvent = event as MouseEvent;
    const element = findDot(mouseEvent.target);
    if (!element || !isActive(mouseEvent) || !actionsAllowed()) return;
    const lastPointer = recentPointerClicks.get(element) ?? 0;
    if (Date.now() - lastPointer < 500) return;
    const dot = elementDot(element);
    if (dot === null) return;
    const inputId = `pointer:${attachmentId}:click:${dot}`;
    dispatch({ type: "dot-down", dot, inputId, source: "pointer" });
    dispatch({ type: "dot-up", dot, inputId, source: "pointer" });
  }

  scope.addEventListener("pointerdown", onPointerDown);
  scope.addEventListener("pointerup", onPointerUp);
  scope.addEventListener("pointercancel", cancelAll);
  scope.addEventListener("lostpointercapture", cancelAll);
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
      scope.removeEventListener("pointerup", onPointerUp);
      scope.removeEventListener("pointercancel", cancelAll);
      scope.removeEventListener("lostpointercapture", cancelAll);
      scope.removeEventListener("click", onClick);
      groupToken?.();
      groupDestroyDisposer?.();
      tracked.clear();
    },
  };
}
