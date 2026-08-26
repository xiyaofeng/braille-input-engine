import { attachPointer } from "../adapters/pointer.js";
import { BrailleInputException } from "../core/types.js";
import {
  type ActivationGroup,
  type BrailleAttachment,
  type BrailleInputController,
  type BrailleInputDiagnostic,
  type BrailleStateSnapshot,
  type KeyboardBindingSource,
} from "../core/types.js";
import {
  createChordTest,
  type ChordTestAttachment,
  type ChordTestOptions,
} from "./chord-test.js";
import enMessages from "../i18n/en.js";
import zhMessages from "../i18n/zh-CN.js";

export type DefaultMessageKey =
  | "title"
  | "mode"
  | "sequential"
  | "chord"
  | "dot"
  | "enabled"
  | "disabled"
  | "currentDots"
  | "preview"
  | "commit"
  | "clear"
  | "backspace"
  | "retry"
  | "discard"
  | "chordTestStart"
  | "chordTestInstruction"
  | "chordTestCodes"
  | "chordNoMapping"
  | "chordSupported"
  | "chordUnsupported"
  | "outputRejected"
  | "outputConflicted"
  | "doubleWriteRisk";

export interface DefaultUIOptions {
  readonly debug?: boolean;
  readonly lang?: string;
  readonly messages?: Partial<Record<DefaultMessageKey, string>>;
  readonly liveMode?: "quiet" | "polite";
  readonly eventComposed?: boolean;
  readonly activationGroup?: ActivationGroup;
  readonly keyboardBindings?: KeyboardBindingSource | undefined;
  readonly actionGuard?: () => boolean;
  readonly chordTestCodes?:
    readonly [string, string, string, string, string, string] | undefined;
  readonly chordTestTimeoutMs?: number;
}

interface RenderOptions extends DefaultUIOptions {
  readonly shadow?: boolean;
}

interface RenderResult extends BrailleAttachment<DefaultUIOptions> {
  readonly root: HTMLElement;
}

function button(
  document: Document,
  label: string,
  part: string,
  control = true,
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.setAttribute("part", part);
  if (control) element.setAttribute("data-braille-ui-control", "");
  return element;
}

function emitUIEvent(
  target: HTMLElement,
  type: string,
  detail: unknown,
  composed: boolean,
): void {
  const safeDetail =
    detail && typeof detail === "object"
      ? Object.freeze({ ...(detail as Record<string, unknown>) })
      : detail;
  target.dispatchEvent(
    new CustomEvent(type, {
      bubbles: true,
      composed,
      cancelable: false,
      detail: safeDetail,
    }),
  );
}

function localeMessages(
  lang: string | undefined,
): Record<DefaultMessageKey, string> {
  const selected = (lang ?? "en").toLowerCase();
  return { ...(selected.startsWith("zh") ? zhMessages : enMessages) };
}

function codePointLabel(state: BrailleStateSnapshot): string {
  return state.previewChar
    ? `U+${state.previewChar.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`
    : "—";
}

function validateRenderOptions(options: RenderOptions): void {
  const timeout = options.chordTestTimeoutMs ?? 10_000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 60_000)
    throw new RangeError("chordTestTimeoutMs must be between 1000 and 60000.");
  if (
    options.liveMode &&
    options.liveMode !== "quiet" &&
    options.liveMode !== "polite"
  )
    throw new RangeError("Invalid liveMode.");
  if (options.chordTestCodes && options.chordTestCodes.length !== 6)
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "chordTestCodes must contain exactly six codes.",
    );
}

export function renderDefaultBrailleUI(
  controller: BrailleInputController,
  host: HTMLElement,
  options: RenderOptions = {},
  root: Node = host,
): RenderResult {
  validateRenderOptions(options);
  const document = host.ownerDocument;
  let messages: Record<DefaultMessageKey, string> = {
    ...localeMessages(options.lang),
    ...(options.messages ?? {}),
  };
  let currentLang = options.lang;
  let messageOverrides = { ...(options.messages ?? {}) };
  let debugEnabled = options.debug ?? false;
  let eventComposed = options.eventComposed ?? true;
  let liveMode = options.liveMode ?? "polite";
  let keyboardBindings = options.keyboardBindings;
  let chordTestCodes = options.chordTestCodes;
  let chordTestTimeoutMs = options.chordTestTimeoutMs ?? 10_000;
  let feedbackKey:
    "outputRejected" | "outputConflicted" | "doubleWriteRisk" | null = null;
  const container = document.createElement("section");
  container.setAttribute("part", "container");
  container.setAttribute("data-braille-ui-root", "");
  container.setAttribute("aria-label", messages.title);

  const heading = document.createElement("h2");
  heading.textContent = messages.title;
  container.appendChild(heading);

  const status = document.createElement("p");
  status.setAttribute("part", "preview");
  status.setAttribute("aria-live", liveMode === "quiet" ? "off" : "polite");
  container.appendChild(status);

  const modeLabel = document.createElement("label");
  modeLabel.textContent = messages.mode;
  const mode = document.createElement("select");
  mode.setAttribute("part", "mode-selector");
  mode.setAttribute("data-braille-ui-control", "");
  modeLabel.appendChild(mode);
  container.appendChild(modeLabel);

  const cell = document.createElement("div");
  cell.setAttribute("part", "cell");
  cell.setAttribute("role", "group");
  cell.setAttribute("aria-label", messages.currentDots);
  const dots: HTMLButtonElement[] = [];
  for (let dot = 1; dot <= 6; dot += 1) {
    const dotButton = button(document, String(dot), "dot");
    dotButton.dataset.brailleDot = String(dot);
    dotButton.setAttribute("aria-label", `${messages.dot} ${dot}`);
    dotButton.setAttribute("aria-pressed", "false");
    dots.push(dotButton);
    cell.appendChild(dotButton);
  }
  container.appendChild(cell);

  const current = document.createElement("p");
  const preview = document.createElement("p");
  preview.setAttribute("part", "preview");
  container.append(current, preview);

  const actions = document.createElement("div");
  actions.setAttribute("part", "toolbar actions");
  const commit = button(document, messages.commit, "commit-button");
  const clear = button(document, messages.clear, "clear-button");
  const backspace = button(document, messages.backspace, "actions");
  const retry = button(document, messages.retry, "retry-button");
  const discard = button(document, messages.discard, "discard-button");
  actions.append(commit, clear, backspace, retry, discard);
  container.appendChild(actions);

  const feedback = document.createElement("p");
  feedback.setAttribute("aria-live", liveMode === "quiet" ? "off" : "polite");
  container.appendChild(feedback);

  let chordTest: ChordTestAttachment | undefined;
  let chordTestSection: HTMLElement | undefined;
  type ChordTestView = {
    readonly section: HTMLElement;
    readonly attachment: ChordTestAttachment;
  };
  const buildChordTestUI = (
    bindings: KeyboardBindingSource,
    config: {
      readonly timeoutMs: number;
      readonly eventComposed: boolean;
      readonly codes: DefaultUIOptions["chordTestCodes"];
      readonly messages: Record<DefaultMessageKey, string>;
    },
  ): ChordTestView => {
    if (
      !bindings ||
      typeof bindings.getEffectiveKeyMap !== "function" ||
      typeof bindings.subscribeEffectiveKeyMap !== "function"
    )
      throw new BrailleInputException(
        "INVALID_CONFIG",
        "keyboardBindings must provide the KeyboardBindingSource contract.",
      );
    const test = document.createElement("section");
    test.setAttribute("part", "chord-test");
    const instruction = document.createElement("p");
    instruction.textContent = messages.chordTestInstruction;
    const start = button(document, messages.chordTestStart, "actions");
    const result = document.createElement("p");
    result.setAttribute("part", "chord-test-result");
    result.setAttribute("aria-live", "polite");
    test.append(instruction, start, result);
    const chordOptions: ChordTestOptions = {
      timeoutMs: config.timeoutMs,
      eventComposed: config.eventComposed,
      ...(options.shadow === true ? { scope: root } : {}),
      messages: () => ({
        noMapping: config.messages.chordNoMapping,
        codes: config.messages.chordTestCodes,
        supported: config.messages.chordSupported,
        unsupported: config.messages.chordUnsupported,
      }),
      ...(config.codes ? { codes: config.codes } : {}),
    };
    const attachment = createChordTest(
      host,
      bindings,
      start,
      result,
      instruction,
      chordOptions,
    );
    return { section: test, attachment };
  };
  const mountChordTestUI = (view: ChordTestView): void => {
    container.appendChild(view.section);
    chordTestSection = view.section;
    chordTest = view.attachment;
  };
  const createChordTestUI = (bindings: KeyboardBindingSource): void => {
    mountChordTestUI(
      buildChordTestUI(bindings, {
        timeoutMs: chordTestTimeoutMs,
        eventComposed,
        codes: chordTestCodes,
        messages,
      }),
    );
  };
  if (keyboardBindings) createChordTestUI(keyboardBindings);

  const mount =
    root instanceof ShadowRoot || root.nodeType === 11 ? root : root;
  mount.appendChild(container);
  const groupToken = options.activationGroup?.add(host);
  const pointerOptions = options.activationGroup
    ? {
        activation: "always" as const,
        activationGroup: options.activationGroup,
        ...(options.actionGuard ? { actionGuard: options.actionGuard } : {}),
      }
    : {
        activation: "always" as const,
        ...(options.actionGuard ? { actionGuard: options.actionGuard } : {}),
      };
  const pointer = attachPointer(controller, cell, pointerOptions);
  const cleanup: Array<() => void> = [];
  const stateDisposer = controller.subscribeState((state) =>
    renderState(state),
  );
  cleanup.push(stateDisposer);
  const outputDisposer = controller.subscribeOutput((action, delivery) => {
    emitUIEvent(
      host,
      action.kind === "braille"
        ? "braille-input"
        : action.kind === "command"
          ? "braille-command"
          : "braille-space",
      { action, delivery },
      eventComposed,
    );
    if (delivery === "rejected") {
      feedbackKey = "outputRejected";
      feedback.textContent = messages.outputRejected;
    }
    if (delivery === "conflicted") {
      feedbackKey = "outputConflicted";
      feedback.textContent = messages.outputConflicted;
    }
    if (delivery === "accepted" || delivery === "unhandled") {
      feedbackKey = null;
      feedback.textContent = "";
    }
    if (debugEnabled) {
      const line = document.createElement("span");
      line.textContent =
        action.kind === "braille"
          ? action.char
          : action.kind === "text"
            ? action.text
            : action.kind;
      line.dataset.brailleDebug = "";
      container.appendChild(line);
    }
  });
  cleanup.push(outputDisposer);
  const diagnosticDisposer = controller.subscribeDiagnostic((diagnostic) => {
    emitUIEvent(host, "braille-error", { diagnostic }, eventComposed);
    if (diagnostic.code === "DOUBLE_WRITE_RISK") {
      feedbackKey = "doubleWriteRisk";
      feedback.textContent = messages.doubleWriteRisk;
    }
  });
  cleanup.push(diagnosticDisposer);

  const actionAllowed = (): boolean => {
    if (!options.actionGuard) return true;
    try {
      return options.actionGuard();
    } catch {
      return false;
    }
  };
  const onModeChange = (): void => {
    if (!actionAllowed()) return;
    try {
      controller.setInputMode(mode.value as "sequential" | "chord");
    } catch {
      renderState(controller.getState());
    }
  };
  const onCommit = (): void => {
    if (actionAllowed()) controller.commitPending("pointer");
  };
  const onClear = (): void => {
    if (actionAllowed()) controller.cancelPending();
  };
  const onBackspace = (): void => {
    if (actionAllowed())
      controller.dispatch({
        type: "command",
        command: "deleteBackward",
        source: "pointer",
      });
  };
  const onRetry = (): void => {
    if (actionAllowed()) controller.commitPending("pointer");
  };
  const onDiscard = (): void => {
    if (actionAllowed()) controller.cancelPending();
  };
  mode.addEventListener("change", onModeChange);
  commit.addEventListener("click", onCommit);
  clear.addEventListener("click", onClear);
  backspace.addEventListener("click", onBackspace);
  retry.addEventListener("click", onRetry);
  discard.addEventListener("click", onDiscard);

  const standalone = options.shadow !== true;
  const hadMarker = standalone && host.hasAttribute("data-braille-ui-root");
  if (standalone) host.setAttribute("data-braille-ui-root", "");
  function renderState(state: BrailleStateSnapshot): void {
    const values = new Set(state.pendingDots);
    for (let index = 0; index < dots.length; index += 1) {
      const dot = index + 1;
      const isActive = values.has(dot as 1 | 2 | 3 | 4 | 5 | 6);
      const dotButton = dots[index];
      if (!dotButton) continue;
      dotButton.setAttribute("aria-pressed", String(isActive));
      dotButton.setAttribute("part", isActive ? "dot dot-active" : "dot");
    }
    current.textContent = `${messages.currentDots}: ${state.pendingDots.length ? state.pendingDots.join(", ") : "—"}`;
    preview.textContent = `${messages.preview}: ${state.previewChar ?? "—"} (${codePointLabel(state)})`;
    const modeText =
      state.inputMode === "chord"
        ? messages.chord
        : state.inputMode === "sequential"
          ? messages.sequential
          : state.inputMode;
    status.textContent = `${modeText} · ${state["enabled"] ? messages.enabled : messages.disabled}`;
    retry.hidden = !state["awaitingRetry"];
    discard.hidden = !state["awaitingRetry"];
    commit.disabled = state["awaitingRetry"] || state.pendingDots.length === 0;
    clear.disabled = state.pendingDots.length === 0 && !state["awaitingRetry"];
    backspace.disabled = state["awaitingRetry"];
    if (mode.options.length === 0) {
      for (const value of ["sequential", "chord"] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent =
          value === "chord" ? messages.chord : messages.sequential;
        mode.appendChild(option);
      }
    }
    for (const option of [...mode.options]) {
      if (option.value === "sequential")
        option.textContent = messages.sequential;
      if (option.value === "chord") option.textContent = messages.chord;
    }
    if ([...mode.options].some((option) => option.value === state.inputMode))
      mode.value = state.inputMode;
    emitUIEvent(host, "braille-statechange", { state }, eventComposed);
  }

  return {
    root: container,
    activate(): void {},
    deactivate(): void {},
    updateOptions(patch): void {
      if ("activationGroup" in (patch as object))
        throw new BrailleInputException(
          "INVALID_CONFIG",
          "activationGroup is construction-only for the default UI.",
        );
      const nextDebug = patch.debug ?? debugEnabled;
      const nextEventComposed = patch.eventComposed ?? eventComposed;
      const nextLiveMode = patch.liveMode ?? liveMode;
      if (nextLiveMode !== "quiet" && nextLiveMode !== "polite")
        throw new BrailleInputException("INVALID_CONFIG", "Invalid liveMode.");
      const nextTimeout = patch.chordTestTimeoutMs ?? chordTestTimeoutMs;
      const nextCodes =
        "chordTestCodes" in patch ? patch.chordTestCodes : chordTestCodes;
      const nextBindings =
        "keyboardBindings" in patch ? patch.keyboardBindings : keyboardBindings;
      const nextLang = patch.lang ?? currentLang;
      const nextMessageOverrides =
        patch.messages === undefined
          ? messageOverrides
          : { ...messageOverrides, ...patch.messages };
      const nextMessages = {
        ...localeMessages(nextLang),
        ...nextMessageOverrides,
      };
      validateRenderOptions({
        chordTestTimeoutMs: nextTimeout,
        ...(nextCodes ? { chordTestCodes: nextCodes } : {}),
      });
      if (nextBindings) {
        if (
          typeof nextBindings.getEffectiveKeyMap !== "function" ||
          typeof nextBindings.subscribeEffectiveKeyMap !== "function"
        )
          throw new BrailleInputException(
            "INVALID_CONFIG",
            "keyboardBindings must provide the KeyboardBindingSource contract.",
          );
      }

      const rebuildChordTest =
        Boolean(nextBindings) &&
        ("keyboardBindings" in patch ||
          "chordTestCodes" in patch ||
          "chordTestTimeoutMs" in patch ||
          "eventComposed" in patch ||
          "lang" in patch ||
          "messages" in patch);
      const stagedChordTest = rebuildChordTest
        ? buildChordTestUI(nextBindings as KeyboardBindingSource, {
            timeoutMs: nextTimeout,
            eventComposed: nextEventComposed,
            codes: nextCodes,
            messages: nextMessages,
          })
        : undefined;

      debugEnabled = nextDebug;
      eventComposed = nextEventComposed;
      liveMode = nextLiveMode;
      chordTestTimeoutMs = nextTimeout;
      chordTestCodes = nextCodes;
      keyboardBindings = nextBindings;
      currentLang = nextLang;
      messageOverrides = nextMessageOverrides;
      messages = nextMessages;
      status.setAttribute(
        "aria-live",
        nextLiveMode === "quiet" ? "off" : "polite",
      );
      feedback.setAttribute(
        "aria-live",
        nextLiveMode === "quiet" ? "off" : "polite",
      );

      if (stagedChordTest) {
        const previousTest = chordTest;
        const previousSection = chordTestSection;
        mountChordTestUI(stagedChordTest);
        previousTest?.detach();
        previousSection?.remove();
      } else if ("keyboardBindings" in patch && !nextBindings) {
        chordTest?.detach();
        chordTestSection?.remove();
        chordTest = undefined;
        chordTestSection = undefined;
      } else {
        if (patch.eventComposed !== undefined)
          chordTest?.update({ eventComposed: nextEventComposed });
        if (patch.chordTestTimeoutMs !== undefined)
          chordTest?.update({ timeoutMs: nextTimeout });
        if ("chordTestCodes" in patch) chordTest?.update({ codes: nextCodes });
      }
      if (patch.lang !== undefined || patch.messages !== undefined) {
        heading.textContent = messages.title;
        modeLabel.textContent = messages.mode;
        container.setAttribute("aria-label", messages.title);
        cell.setAttribute("aria-label", messages.currentDots);
        for (let index = 0; index < dots.length; index += 1) {
          const dotButton = dots[index];
          if (dotButton)
            dotButton.setAttribute(
              "aria-label",
              `${messages.dot} ${index + 1}`,
            );
        }
        commit.textContent = messages.commit;
        clear.textContent = messages.clear;
        backspace.textContent = messages.backspace;
        retry.textContent = messages.retry;
        discard.textContent = messages.discard;
        feedback.textContent = feedbackKey ? messages[feedbackKey] : "";
        if (!stagedChordTest) chordTest?.update();
        renderState(controller.getState());
      }
    },
    detach(): void {
      pointer.detach();
      chordTest?.detach();
      for (const dispose of cleanup.splice(0)) dispose();
      mode.removeEventListener("change", onModeChange);
      commit.removeEventListener("click", onCommit);
      clear.removeEventListener("click", onClear);
      backspace.removeEventListener("click", onBackspace);
      retry.removeEventListener("click", onRetry);
      discard.removeEventListener("click", onDiscard);
      groupToken?.();
      container.remove();
      if (standalone && !hadMarker)
        host.removeAttribute("data-braille-ui-root");
    },
  };
}

export function createDefaultBrailleUI(
  controller: BrailleInputController,
  host: HTMLElement,
  options: DefaultUIOptions = {},
): BrailleAttachment<DefaultUIOptions> {
  if (controller.getState()["destroyed"])
    throw new BrailleInputException(
      "CONTROLLER_DESTROYED",
      "The controller has been destroyed.",
    );
  if (
    !host ||
    host.nodeType !== 1 ||
    host.childNodes.length > 0 ||
    host.shadowRoot
  ) {
    throw new BrailleInputException(
      "UI_HOST_CONFLICT",
      "Default UI host must be an empty light-DOM element without a Shadow Root.",
    );
  }
  return renderDefaultBrailleUI(controller, host, {
    ...options,
    shadow: false,
  });
}

export type { BrailleInputDiagnostic };
