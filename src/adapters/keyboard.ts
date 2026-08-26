import {
  BrailleInputException,
  defaultKeyboardOptions,
  isBrailleDot,
  type BrailleCommand,
  type BrailleDot,
  type BrailleInputAction,
  type BrailleInputController,
  type BrailleInputDiagnostic,
  type KeyboardAdapterOptions,
  type KeyboardAttachment,
  type KeyboardBindingSource,
  type KeyboardScope,
  type InputSource,
} from "../core/types.js";
import {
  asInternalController,
  reportControllerDiagnostic,
} from "../core/internal.js";
import { sameArray } from "../core/utils.js";
import { getInternalActivationGroup } from "./activation.js";

let attachmentCounter = 0;

interface NormalizedKeyboardOptions {
  k: boolean;
  n: boolean;
  m: Record<string, BrailleDot | null>;
  s: string | null;
  c: string[];
  q: Record<string, BrailleCommand | null>;
  r: boolean;
  p: "handled" | "always" | "never";
  a: "focus" | "manual" | "always";
  g: KeyboardAdapterOptions["activationGroup"] | undefined;
  f: ((event: KeyboardEvent) => boolean) | undefined;
}

function isNumpadCode(code: string): boolean {
  return code.startsWith("Numpad");
}

function copyRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return { ...record };
}

function effectiveMap(
  options: NormalizedKeyboardOptions,
): Readonly<Record<string, BrailleDot>> {
  const map: Record<string, BrailleDot> = {};
  for (const [code, dot] of Object.entries(options.m)) {
    if (dot === null) continue;
    if (isNumpadCode(code) ? options.n : options.k) map[code] = dot;
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(map).sort(([a], [b]) => a.localeCompare(b)),
    ) as Record<string, BrailleDot>,
  );
}

function validateBindings(options: NormalizedKeyboardOptions): void {
  if (typeof options.k !== "boolean" || typeof options.n !== "boolean") {
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "keyboard and numpad must be boolean.",
    );
  }
  const used = new Map<string, string>();
  const add = (code: string | null | undefined, owner: string) => {
    if (!code) return;
    if (used.has(code))
      throw new BrailleInputException(
        "KEY_BINDING_CONFLICT",
        `${code} is bound to ${used.get(code)} and ${owner}.`,
      );
    used.set(code, owner);
  };
  for (const [code, dot] of Object.entries(options.m)) {
    if (!code || (dot !== null && !isBrailleDot(dot)))
      throw new BrailleInputException(
        "INVALID_CONFIG",
        `Invalid key map entry: ${code}`,
      );
    if (dot !== null && (isNumpadCode(code) ? options.n : options.k))
      add(code, "dot");
  }
  add(options.s, "space");
  const seenCommit = new Set<string>();
  for (const code of options.c) {
    if (!code || seenCommit.has(code))
      throw new BrailleInputException(
        "INVALID_CONFIG",
        "commitKeys must contain unique non-empty codes.",
      );
    seenCommit.add(code);
    if (isNumpadCode(code) ? options.n : options.k) add(code, "commit");
  }
  for (const [code, command] of Object.entries(options.q)) {
    if (!code || (command !== null && !isCommand(command)))
      throw new BrailleInputException(
        "INVALID_CONFIG",
        `Invalid command mapping: ${code}`,
      );
    if (command !== null && (isNumpadCode(code) ? options.n : options.k))
      add(code, "command");
  }
}

function isCommand(command: BrailleCommand): boolean {
  return (
    command === "cancelPending" ||
    command === "deleteBackward" ||
    command === "lineBreak" ||
    (typeof command === "string" &&
      /^[a-z][a-z0-9._-]{0,63}:[a-z][a-z0-9._-]{0,63}$/.test(command))
  );
}

function normalizeOptions(
  options: KeyboardAdapterOptions = {},
  previous?: NormalizedKeyboardOptions,
): NormalizedKeyboardOptions {
  const base = previous ?? {
    k: defaultKeyboardOptions.keyboard,
    n: defaultKeyboardOptions.numpad,
    m: copyRecord(defaultKeyboardOptions.keyMap),
    s: defaultKeyboardOptions.spaceKey,
    c: [...defaultKeyboardOptions.commitKeys],
    q: copyRecord(defaultKeyboardOptions.commandMap),
    r: defaultKeyboardOptions.repeatDeleteBackward,
    p: defaultKeyboardOptions.preventDefault,
    a: "focus" as const,
    g: undefined,
    f: undefined,
  };
  const next: NormalizedKeyboardOptions = {
    k: options.keyboard ?? base.k,
    n: options.numpad ?? base.n,
    m: { ...base.m, ...(options.keyMap ?? {}) },
    s: options.spaceKey === undefined ? base.s : options.spaceKey,
    c: options.commitKeys === undefined ? [...base.c] : [...options.commitKeys],
    q: { ...base.q, ...(options.commandMap ?? {}) },
    r: options.repeatDeleteBackward ?? base.r,
    p: options.preventDefault ?? base.p,
    a: options.activation ?? base.a,
    g: previous ? base.g : options.activationGroup,
    f: options.keyboardFilter ?? base.f,
  };
  if (!["focus", "manual", "always"].includes(next.a))
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "Invalid activation mode.",
    );
  if (!["handled", "always", "never"].includes(next.p))
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "Invalid preventDefault mode.",
    );
  if (typeof next.r !== "boolean")
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "repeatDeleteBackward must be boolean.",
    );
  validateBindings(next);
  return next;
}

function sameRecord<T>(
  a: Readonly<Record<string, T>>,
  b: Readonly<Record<string, T>>,
): boolean {
  const aKeys = Object.keys(a);
  return (
    aKeys.length === Object.keys(b).length &&
    aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key],
    )
  );
}

function scopeOwnerDocument(scope: KeyboardScope): Document {
  if (scope.nodeType === 9) return scope as Document;
  if (scope.nodeType === 11) {
    const ownerDocument = (scope as ShadowRoot).ownerDocument;
    if (!ownerDocument)
      throw new BrailleInputException(
        "INVALID_CONFIG",
        "Keyboard scope has no owner document.",
      );
    return ownerDocument;
  }
  const ownerDocument = (scope as HTMLElement).ownerDocument;
  if (!ownerDocument)
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "Keyboard scope has no owner document.",
    );
  return ownerDocument;
}

function eventInScope(
  event: KeyboardEvent,
  scope: KeyboardScope,
  group: ReturnType<typeof getInternalActivationGroup>,
): boolean {
  const target = event.target as Node | null;
  if (group) return group.isMember(target);
  if (scope.nodeType === 9) return true;
  if (scope.nodeType === 11) return event.composedPath().includes(scope);
  return (
    event.composedPath().includes(scope) ||
    Boolean(target && (scope as HTMLElement).contains(target))
  );
}

function isUIControl(event: KeyboardEvent): boolean {
  const target = event.target;
  return Boolean(
    target &&
    target instanceof Element &&
    target.closest("[data-braille-ui-control]"),
  );
}

export function attachKeyboard(
  controller: BrailleInputController,
  scope: KeyboardScope,
  options: KeyboardAdapterOptions = {},
): KeyboardAttachment {
  if (controller.getState()["destroyed"])
    throw new BrailleInputException(
      "CONTROLLER_DESTROYED",
      "The controller has been destroyed.",
    );
  if (!scope || typeof scope.addEventListener !== "function")
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "Invalid keyboard scope.",
    );
  const ownerDocument = scopeOwnerDocument(scope);
  let config = normalizeOptions(options);
  const group = getInternalActivationGroup(config.g);
  if (config.g && !group)
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "activationGroup must be created by createActivationGroup().",
    );
  if (
    config.a === "focus" &&
    (scope.nodeType === 9 || scope.nodeType === 11) &&
    !group
  ) {
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "Document and ShadowRoot focus activation requires an ActivationGroup, manual, or always.",
    );
  }
  const attachmentId = String(++attachmentCounter);
  const tracked = new Set<string>();
  let active = config.a !== "manual";
  let detached = false;
  let composing = false;
  let warnedNever = false;
  let groupToken: (() => void) | undefined;
  let groupDestroyDisposer: (() => void) | undefined;
  if (scope.nodeType === 1 && group)
    groupToken = group.add(scope as HTMLElement);
  if (group) {
    groupDestroyDisposer = group.subscribeDestroyed(() => {
      active = false;
      clearTracked("activation-lost");
    });
  }

  const subscribers = new Set<
    (map: Readonly<Record<string, BrailleDot>>) => void
  >();
  let effective = effectiveMap(config);

  const report = (diagnostic: BrailleInputDiagnostic) =>
    reportControllerDiagnostic(controller, diagnostic);

  function clearTracked(reason: "activation-lost" | "hidden"): void {
    tracked.clear();
    try {
      asInternalController(controller).__handleActivationLost(reason);
    } catch {
      // Detachment is best effort after the controller itself is destroyed.
    }
  }

  function isActive(event?: KeyboardEvent): boolean {
    if (detached || !asInternalController(controller).getState()["enabled"])
      return false;
    if (!active) return false;
    if (config.a === "manual") return active;
    if (config.a === "always") return true;
    return Boolean(event && eventInScope(event, scope, group));
  }

  function shouldPrevent(candidate: boolean, handled: boolean): boolean {
    if (!candidate || config.p === "never") return false;
    if (config.p === "always") return true;
    return handled;
  }

  function dispatch(action: BrailleInputAction): boolean {
    try {
      controller.dispatch(action);
      return true;
    } catch (error) {
      report({
        severity: "error",
        code:
          error instanceof BrailleInputException
            ? error.code
            : "INVALID_ACTION",
        message: "Keyboard action could not be dispatched.",
      });
      return false;
    }
  }

  function safeFilter(event: KeyboardEvent): boolean {
    if (
      event.isComposing ||
      composing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.getModifierState?.("AltGraph")
    )
      return false;
    if (!config.f) return true;
    try {
      return config.f(event);
    } catch {
      report({
        severity: "error",
        code: "INVALID_ACTION",
        message: "keyboardFilter threw and the event was passed through.",
      });
      return false;
    }
  }

  function onKeyDown(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    const code = keyboardEvent.code;
    const source: InputSource = isNumpadCode(code) ? "numpad" : "keyboard";
    const map = effective;
    const dot = map[code];
    const command = config.q[code];
    const isSpace = code === config.s;
    const isCommit = config.c.includes(code);
    const sourceEnabled = isNumpadCode(code) ? config.n : config.k;
    const candidate = Boolean(
      dot !== undefined ||
      (isSpace && sourceEnabled) ||
      (isCommit && sourceEnabled) ||
      (command !== undefined && command !== null && sourceEnabled),
    );
    if (isUIControl(keyboardEvent)) return;
    if (!isActive(keyboardEvent) || !safeFilter(keyboardEvent)) return;
    if (!candidate) return;
    if (config.p === "never" && !warnedNever) {
      warnedNever = true;
      report({
        severity: "warning",
        code: "DOUBLE_WRITE_RISK",
        message:
          'preventDefault="never" allows the browser to process configured keys too.',
      });
    }

    let handled = true;
    if (dot !== undefined) {
      const inputId = `keyboard:${attachmentId}:${code}`;
      if (keyboardEvent.repeat) {
        // A repeat without the original down is stale input. In particular,
        // do not create a controller pressed entry that the later keyup can
        // never release.
        if (!tracked.has(inputId)) {
          if (shouldPrevent(candidate, handled)) keyboardEvent.preventDefault();
          return;
        }
      } else {
        tracked.add(inputId);
        dispatch({ type: "dot-down", dot, inputId, source });
      }
    } else if (isSpace) {
      if (!keyboardEvent.repeat) dispatch({ type: "space-request", source });
    } else if (isCommit) {
      if (!keyboardEvent.repeat) dispatch({ type: "commit-request", source });
    } else if (command !== undefined && command !== null) {
      if (command === "deleteBackward" && keyboardEvent.repeat && !config.r)
        handled = true;
      else if (
        !keyboardEvent.repeat ||
        (command === "deleteBackward" && config.r)
      ) {
        dispatch({ type: "command", command, source });
      }
    } else {
      handled = false;
    }
    if (shouldPrevent(candidate, handled)) keyboardEvent.preventDefault();
  }

  function onKeyUp(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    const inputId = `keyboard:${attachmentId}:${keyboardEvent.code}`;
    if (!tracked.delete(inputId)) return;
    const dot = effective[keyboardEvent.code] as BrailleDot;
    const source: InputSource = isNumpadCode(keyboardEvent.code)
      ? "numpad"
      : "keyboard";
    dispatch(
      safeFilter(keyboardEvent)
        ? { type: "dot-up", dot, inputId, source }
        : { type: "input-cancel", inputId, source },
    );
  }

  function onCompositionStart(): void {
    composing = true;
    clearTracked("activation-lost");
  }

  function onCompositionEnd(): void {
    composing = false;
  }

  function onBlur(): void {
    clearTracked("activation-lost");
  }

  function onVisibilityChange(): void {
    if (ownerDocument.visibilityState === "hidden") clearTracked("hidden");
  }

  scope.addEventListener("keydown", onKeyDown);
  scope.addEventListener("keyup", onKeyUp);
  ownerDocument.addEventListener("compositionstart", onCompositionStart, true);
  ownerDocument.addEventListener("compositionend", onCompositionEnd, true);
  ownerDocument.addEventListener("visibilitychange", onVisibilityChange);
  ownerDocument.defaultView?.addEventListener("blur", onBlur);

  if (config.p === "never") {
    warnedNever = true;
    report({
      severity: "warning",
      code: "DOUBLE_WRITE_RISK",
      message:
        'preventDefault="never" allows the browser to process configured keys too.',
    });
  }

  const attachment: KeyboardAttachment = {
    activate(): void {
      if (detached || group?.isDestroyed() || config.a !== "manual") return;
      active = true;
    },
    deactivate(): void {
      if (detached || config.a !== "manual") return;
      active = false;
      clearTracked("activation-lost");
    },
    updateOptions(patch): void {
      if (detached) return;
      if ("activationGroup" in (patch as object))
        throw new BrailleInputException(
          "INVALID_CONFIG",
          "activationGroup is construction-only.",
        );
      const previous = config;
      const next = normalizeOptions(patch, config);
      if (
        next.a === "focus" &&
        (scope.nodeType === 9 || scope.nodeType === 11) &&
        !getInternalActivationGroup(next.g)
      ) {
        throw new BrailleInputException(
          "INVALID_CONFIG",
          "Document and ShadowRoot focus activation requires an ActivationGroup, manual, or always.",
        );
      }
      config = next;
      const activationChanged = previous.a !== next.a;
      if (activationChanged) {
        if (next.a === "manual") active = false;
        else if (next.a === "always") active = true;
        else active = true;
      }
      if (
        previous.k !== next.k ||
        previous.n !== next.n ||
        !sameRecord(previous.m, next.m) ||
        previous.s !== next.s ||
        !sameArray(previous.c, next.c) ||
        !sameRecord(previous.q, next.q) ||
        activationChanged
      ) {
        clearTracked("activation-lost");
      }
      const nextEffective = effectiveMap(config);
      if (!sameRecord(effective, nextEffective)) {
        effective = nextEffective;
        for (const listener of [...subscribers]) listener(effective);
      }
      if (next.p === "never" && previous.p !== "never") {
        warnedNever = true;
        report({
          severity: "warning",
          code: "DOUBLE_WRITE_RISK",
          message:
            'preventDefault="never" allows the browser to process configured keys too.',
        });
      }
    },
    detach(): void {
      if (detached) return;
      detached = true;
      tracked.clear();
      clearTracked("activation-lost");
      scope.removeEventListener("keydown", onKeyDown);
      scope.removeEventListener("keyup", onKeyUp);
      ownerDocument.removeEventListener(
        "compositionstart",
        onCompositionStart,
        true,
      );
      ownerDocument.removeEventListener(
        "compositionend",
        onCompositionEnd,
        true,
      );
      ownerDocument.removeEventListener("visibilitychange", onVisibilityChange);
      ownerDocument.defaultView?.removeEventListener("blur", onBlur);
      groupToken?.();
      groupDestroyDisposer?.();
      subscribers.clear();
    },
    getEffectiveKeyMap(): Readonly<Record<string, BrailleDot>> {
      return effective;
    },
    subscribeEffectiveKeyMap(listener): () => void {
      if (detached) return () => {};
      subscribers.add(listener);
      listener(effective);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        subscribers.delete(listener);
      };
    },
  };
  return attachment;
}

export type { KeyboardAttachment, KeyboardBindingSource };
