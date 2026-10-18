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
import {
  applyActivationLosses,
  observeDocumentLifecycle,
  observeInputTermination,
  leavesScope,
  retainFocusRoot,
} from "./lifecycle.js";
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
  const ownerDocument =
    scope.nodeType === 9 ? (scope as Document) : scope.ownerDocument;
  if (!ownerDocument)
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "Keyboard scope has no owner document.",
    );
  return ownerDocument;
}

function isUIControl(target: Node | null): boolean {
  return Boolean(
    target?.nodeType === 1 &&
    (target as Element).closest("[data-braille-ui-control]"),
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
  const tracked = new Map<string, [inputId: string, observed: boolean]>();
  let round = 0;
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
      return prepareLoss();
    });
  }

  const subscribers = new Set<
    (map: Readonly<Record<string, BrailleDot>>) => void
  >();
  let effective = effectiveMap(config);

  const report = (diagnostic: BrailleInputDiagnostic) =>
    reportControllerDiagnostic(controller, diagnostic);

  function clearTracked(): void {
    applyActivationLosses([prepareLoss()]);
  }

  function isActive(target: Node | null): boolean {
    if (detached || !asInternalController(controller).getState()["enabled"])
      return false;
    if (!active) return false;
    if (config.a === "manual") return active;
    if (config.a === "always") return true;
    // Called only by this scope's listener: delivery already establishes scope.
    return !group || group.isMember(target);
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
    // Admission and UI exclusion must see the same visible source, including
    // controls retargeted to their shadow host at a Document listener.
    const target = (keyboardEvent.composedPath()[0] ??
      keyboardEvent.target) as Node | null;
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
    if (isUIControl(target)) return;
    if (!isActive(target) || !safeFilter(keyboardEvent)) return;
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
      const inputId =
        tracked.get(code)?.[0] ?? `keyboard:${attachmentId}:${++round}:${code}`;
      if (keyboardEvent.repeat) {
        // A repeat without the original down is stale input. In particular,
        // do not create a controller pressed entry that the later keyup can
        // never release.
        if (!tracked.has(code)) {
          if (shouldPrevent(candidate, handled)) keyboardEvent.preventDefault();
          return;
        }
      } else {
        tracked.set(code, [inputId, false]);
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

  const disposeKeyUp = observeInputTermination(
    controller,
    scope,
    ["keyup"],
    (event) => {
      const keyboardEvent = event as KeyboardEvent;
      const input = tracked.get(keyboardEvent.code);
      if (!input) return;
      const dot = effective[keyboardEvent.code] as BrailleDot;
      const source: InputSource = isNumpadCode(keyboardEvent.code)
        ? "numpad"
        : "keyboard";
      return () => {
        if (tracked.get(keyboardEvent.code) === input)
          tracked.delete(keyboardEvent.code);
        return safeFilter(keyboardEvent)
          ? { type: "dot-up", dot, inputId: input[0], source }
          : { type: "input-cancel", inputId: input[0], source };
      };
    },
  );

  scope.addEventListener("keydown", onKeyDown);

  function prepareLoss() {
    const inputIds = [...tracked.values()].map(([id]) => id);
    tracked.clear();
    return [controller, inputIds] as const;
  }
  const releaseFocusRoot = retainFocusRoot(scope);
  const disposeLifecycle = observeDocumentLifecycle(
    controller,
    ownerDocument,
    (value) => {
      if (value !== undefined) composing = value;
      if (value !== false) return prepareLoss();
    },
    (from, to) => {
      if (config.a === "focus" && leavesScope(from, to, scope, group))
        return prepareLoss();
    },
  );

  const disposeState = controller.subscribeState((state) => {
    for (const [code, input] of tracked) {
      if (state.pressedInputIds.includes(input[0])) input[1] = true;
      else if (input[1]) tracked.delete(code);
    }
  });

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
      clearTracked();
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
      const nextEffective = effectiveMap(config);
      const mapChanged = !sameRecord(effective, nextEffective);
      effective = nextEffective;
      const activationChanged = previous.a !== next.a;
      if (activationChanged) active = next.a !== "manual";
      if (
        previous.k !== next.k ||
        previous.n !== next.n ||
        !sameRecord(previous.m, next.m) ||
        previous.s !== next.s ||
        !sameArray(previous.c, next.c) ||
        !sameRecord(previous.q, next.q) ||
        activationChanged
      ) {
        clearTracked();
      }
      if (mapChanged) {
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
      clearTracked();
      scope.removeEventListener("keydown", onKeyDown);
      disposeKeyUp();
      disposeLifecycle();
      releaseFocusRoot();
      disposeState();
      groupToken?.();
      groupDestroyDisposer?.();
      subscribers.clear();
    },
    getEffectiveKeyMap(): Readonly<Record<string, BrailleDot>> {
      return effective;
    },
    subscribeEffectiveKeyMap(listener): () => void {
      if (detached) return () => {};
      const registration = (map: Readonly<Record<string, BrailleDot>>) => {
        try {
          listener(map);
        } catch {
          /* Notifications cannot block later subscribers. */
        }
      };
      subscribers.add(registration);
      registration(effective);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        subscribers.delete(registration);
      };
    },
  };
  return attachment;
}

export type { KeyboardAttachment, KeyboardBindingSource };
