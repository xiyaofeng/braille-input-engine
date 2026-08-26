import {
  BrailleInputException,
  type BrailleDot,
  type KeyboardBindingSource,
} from "../core/types.js";

export interface ChordTestOptions {
  readonly codes?: readonly [string, string, string, string, string, string];
  readonly timeoutMs: number;
  readonly eventComposed: boolean;
  readonly scope?: Node;
  readonly messages?: () => ChordTestMessages;
  readonly onResult?: (supported: boolean | null) => void;
}

export interface ChordTestMessages {
  readonly noMapping: string;
  readonly codes: string;
  readonly supported: string;
  readonly unsupported: string;
}

export interface ChordTestUpdate {
  readonly codes?:
    readonly [string, string, string, string, string, string] | undefined;
  readonly timeoutMs?: number;
  readonly eventComposed?: boolean;
}

export interface ChordTestAttachment {
  start(): void;
  detach(): void;
  update(patch?: ChordTestUpdate): void;
}

function defaultCodes(bindingSource: KeyboardBindingSource): string[] | null {
  const map = bindingSource.getEffectiveKeyMap();
  const selected: string[] = [];
  for (const dot of [1, 2, 3, 4, 5, 6] as BrailleDot[]) {
    const code = Object.keys(map)
      .filter((candidate) => map[candidate] === dot)
      .sort()[0];
    if (!code) return null;
    selected.push(code);
  }
  return selected;
}

function validateExplicitCodes(
  codes: readonly string[],
  bindingSource: KeyboardBindingSource,
): void {
  if (codes.length !== 6)
    throw new BrailleInputException(
      "INVALID_CONFIG",
      "chordTestCodes must contain exactly six codes.",
    );
  const map = bindingSource.getEffectiveKeyMap();
  for (let index = 0; index < 6; index += 1) {
    const code = codes[index];
    if (!code || map[code] !== index + 1)
      throw new BrailleInputException(
        "INVALID_CONFIG",
        "chordTestCodes must map one current key to each dot in order.",
      );
  }
}

function emit(
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

function eventInScope(event: Event, scope: Node | undefined): boolean {
  if (!scope || scope.nodeType === 9) return true;
  const path = event.composedPath();
  if (path.includes(scope)) return true;
  return scope.nodeType === 1 && scope.contains(event.target as Node | null);
}

export function createChordTest(
  host: HTMLElement,
  bindingSource: KeyboardBindingSource,
  startButton: HTMLButtonElement,
  resultNode: HTMLElement,
  instructionNode: HTMLElement,
  options: ChordTestOptions,
): ChordTestAttachment {
  if (options.codes) validateExplicitCodes(options.codes, bindingSource);
  let detached = false;
  let armed = false;
  let finished = false;
  let timer: number | undefined;
  let selectedCodes: string[] | null = null;
  let configuredCodes = options.codes ? [...options.codes] : undefined;
  let timeoutMs = options.timeoutMs;
  let eventComposed = options.eventComposed;
  const held = new Set<string>();
  let observedFullChord = false;
  const defaultMessages: ChordTestMessages = {
    noMapping: "No complete six-key mapping is available.",
    codes: "Test codes",
    supported: "6-key rollover: Supported",
    unsupported:
      "6-key rollover: Not reliably supported. Recommended mode: Sequential",
  };
  const getMessages = (): ChordTestMessages =>
    options.messages?.() ?? defaultMessages;
  const unsubscribeMap = bindingSource.subscribeEffectiveKeyMap(() => {
    if (armed) finish(null);
    updateInstructions();
  });

  function updateInstructions(): void {
    selectedCodes = configuredCodes
      ? [...configuredCodes]
      : defaultCodes(bindingSource);
    if (!selectedCodes) {
      instructionNode.textContent = getMessages().noMapping;
      startButton.disabled = true;
      resultNode.textContent = "";
      return;
    }
    startButton.disabled = false;
    instructionNode.textContent = `${getMessages().codes}: ${selectedCodes.join(", ")}.`;
  }

  function finish(supported: boolean | null): void {
    if (!armed && supported !== null) return;
    armed = false;
    finished = true;
    held.clear();
    observedFullChord = false;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    if (supported === true) resultNode.textContent = getMessages().supported;
    else if (supported === false)
      resultNode.textContent = getMessages().unsupported;
    else resultNode.textContent = "";
    options.onResult?.(supported);
    if (supported !== null)
      emit(host, "braille-chord-test-result", { supported }, eventComposed);
  }

  function scheduleTimeout(): void {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(
      () => finish(selectedCodes ? observedFullChord : false),
      timeoutMs,
    );
  }

  function onKeyDown(event: Event): void {
    if (!armed || !selectedCodes) return;
    const keyboardEvent = event as KeyboardEvent;
    if (!eventInScope(keyboardEvent, options.scope)) return;
    if (
      keyboardEvent.isComposing ||
      keyboardEvent.ctrlKey ||
      keyboardEvent.metaKey ||
      keyboardEvent.altKey ||
      keyboardEvent.getModifierState?.("AltGraph")
    )
      return;
    if (!selectedCodes.includes(keyboardEvent.code)) return;
    held.add(keyboardEvent.code);
    if (selectedCodes.every((code) => held.has(code))) {
      observedFullChord = true;
      resultNode.textContent = getMessages().supported;
      finished = true;
    }
    keyboardEvent.preventDefault();
  }

  function onKeyUp(event: Event): void {
    if (!armed || !selectedCodes) return;
    const keyboardEvent = event as KeyboardEvent;
    if (!eventInScope(keyboardEvent, options.scope)) return;
    if (!selectedCodes.includes(keyboardEvent.code)) return;
    held.delete(keyboardEvent.code);
    if (held.size === 0) {
      finish(observedFullChord);
    }
    keyboardEvent.preventDefault();
  }

  function start(): void {
    if (detached || !selectedCodes) return;
    if (armed) return;
    armed = true;
    finished = false;
    held.clear();
    observedFullChord = false;
    resultNode.textContent = "";
    emit(host, "braille-chord-test-start", {}, eventComposed);
    scheduleTimeout();
  }

  startButton.addEventListener("click", start);
  const document = host.ownerDocument;
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  updateInstructions();

  return {
    start,
    update(patch: ChordTestUpdate = {}): void {
      let nextCodes = configuredCodes;
      let nextTimeout = timeoutMs;
      let nextEventComposed = eventComposed;
      if ("codes" in patch) {
        if (patch.codes) validateExplicitCodes(patch.codes, bindingSource);
        nextCodes = patch.codes ? [...patch.codes] : undefined;
      }
      if (patch.timeoutMs !== undefined) {
        if (
          !Number.isInteger(patch.timeoutMs) ||
          patch.timeoutMs < 1000 ||
          patch.timeoutMs > 60_000
        )
          throw new BrailleInputException(
            "INVALID_CONFIG",
            "chordTestTimeoutMs must be between 1000 and 60000.",
          );
        nextTimeout = patch.timeoutMs;
      }
      if (patch.eventComposed !== undefined)
        nextEventComposed = Boolean(patch.eventComposed);
      configuredCodes = nextCodes;
      timeoutMs = nextTimeout;
      eventComposed = nextEventComposed;
      updateInstructions();
      if (armed && patch.timeoutMs !== undefined) scheduleTimeout();
    },
    detach(): void {
      if (detached) return;
      detached = true;
      finish(null);
      startButton.removeEventListener("click", start);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      unsubscribeMap();
      void finished;
    },
  };
}
