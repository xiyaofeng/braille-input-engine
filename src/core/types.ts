/** Public, DOM-independent types for the Braille Input Engine. */

declare const braillePatternBrand: unique symbol;
declare const extensionIdBrand: unique symbol;

export type BraillePattern = string & {
  readonly [braillePatternBrand]: true;
};

export type BrailleDot = 1 | 2 | 3 | 4 | 5 | 6;
export type ExtensionId = string & { readonly [extensionIdBrand]: true };

export type BuiltInInputMode = "sequential" | "chord";
export type InputMode = BuiltInInputMode | ExtensionId;
export type SpaceMode = "braille" | "ascii" | "event";
export type BuiltInInputSource = "keyboard" | "numpad" | "pointer" | "api";
export type InputSource = BuiltInInputSource | ExtensionId;
export type OutputSource = InputSource | "mixed";
export type OutputSinkState = "empty" | "ready" | "faulted";

export interface BrailleStateSnapshot {
  readonly inputMode: InputMode;
  readonly pendingDots: readonly BrailleDot[];
  readonly pendingSources: readonly InputSource[];
  readonly previewChar: BraillePattern | null;
  readonly pressedInputIds: readonly string[];
  readonly chordInProgress: boolean;
  readonly awaitingRetry: boolean;
  readonly outputSinkState: OutputSinkState;
  readonly enabled: boolean;
  readonly destroyed: boolean;
}

export type ControllerCommand = "cancelPending";
export type BuiltInEditorCommand = "deleteBackward" | "lineBreak";
export type EditorCommand = BuiltInEditorCommand | ExtensionId;
export type BrailleCommand = ControllerCommand | EditorCommand;

export type BrailleInputAction =
  | {
      readonly type: "dot-down";
      readonly dot: BrailleDot;
      readonly inputId: string;
      readonly source: InputSource;
    }
  | {
      readonly type: "dot-up";
      readonly dot: BrailleDot;
      readonly inputId: string;
      readonly source: InputSource;
    }
  | {
      readonly type: "input-cancel";
      readonly inputId: string;
      readonly source: InputSource;
    }
  | { readonly type: "commit-request"; readonly source: InputSource }
  | { readonly type: "space-request"; readonly source: InputSource }
  | {
      readonly type: "command";
      readonly command: BrailleCommand;
      readonly source: InputSource;
    };

export type StrategyDeactivateReason = "mode-switch" | "destroy";
export type StrategyResetReason =
  | "cancel-pending"
  | "activation-lost"
  | "hidden"
  | "disable"
  | "configuration-change"
  | "controller-reset";

export interface PendingDotContribution {
  readonly id: string;
  readonly dot: BrailleDot;
  readonly source: InputSource;
}

export interface BrailleInputDiagnostic {
  readonly severity: "warning" | "error";
  readonly code: BrailleDiagnosticCode;
  readonly message: string;
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

export interface StrategyLifecycleContext {
  readonly getState: () => BrailleStateSnapshot;
  reportDiagnostic(diagnostic: BrailleInputDiagnostic): void;
}

export interface StrategyResetContext extends StrategyLifecycleContext {
  getPendingContributions(): readonly PendingDotContribution[];
  setPendingContributions(entries: Iterable<PendingDotContribution>): void;
}

export interface StrategyContext extends StrategyLifecycleContext {
  getPendingContributions(): readonly PendingDotContribution[];
  setPendingContributions(entries: Iterable<PendingDotContribution>): void;
  requestCommit(triggerSource: InputSource): void;
  requestSpace(source: InputSource): void;
  requestCommand(command: EditorCommand, source: InputSource): void;
}

export interface BrailleInputStrategy {
  readonly id: InputMode;
  activate(context: StrategyLifecycleContext): void;
  handle(action: BrailleInputAction, context: StrategyContext): void;
  deactivate(
    reason: StrategyDeactivateReason,
    context: StrategyLifecycleContext,
  ): void;
  reset(reason: StrategyResetReason, context: StrategyResetContext): void;
  destroy(context: StrategyLifecycleContext): void;
}

export type BrailleInputStrategyFactory = () => BrailleInputStrategy;

export type BuiltInDiagnosticCode =
  | "INVALID_CONFIG"
  | "INVALID_ACTION"
  | "INVALID_ATTRIBUTE"
  | "KEY_BINDING_CONFLICT"
  | "DOUBLE_WRITE_RISK"
  | "OUTPUT_SINK_CONFLICT"
  | "OUTPUT_SINK_ERROR"
  | "OUTPUT_REJECTED"
  | "SINK_PROTOCOL_VIOLATION"
  | "STRATEGY_ERROR"
  | "STRATEGY_ALREADY_REGISTERED"
  | "TARGET_ALREADY_ATTACHED"
  | "TARGET_NOT_FOUND"
  | "UNSUPPORTED_TARGET"
  | "UI_HOST_CONFLICT"
  | "UNKNOWN_STRATEGY"
  | "CONTROLLER_DESTROYED";
export type BrailleDiagnosticCode = BuiltInDiagnosticCode | ExtensionId;

export class BrailleInputException extends Error {
  readonly code: BuiltInDiagnosticCode;

  constructor(
    code: BuiltInDiagnosticCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message || code, options);
    this.name = "BrailleInputException";
    this.code = code;
  }
}

export interface BrailleCommit {
  readonly kind: "braille";
  readonly reason: "cell" | "space";
  readonly char: BraillePattern;
  readonly codePoint: number;
  readonly dots: readonly BrailleDot[];
  readonly mask: number;
  readonly sources: readonly InputSource[];
  readonly source: OutputSource;
  readonly triggerSource: InputSource;
  readonly inputMode: InputMode;
}

export interface TextOutput {
  readonly kind: "text";
  readonly reason: "space";
  readonly text: " ";
  readonly source: InputSource;
}

export interface SpaceIntent {
  readonly kind: "space-intent";
  readonly source: InputSource;
}

export interface CommandOutput {
  readonly kind: "command";
  readonly command: EditorCommand;
  readonly source: InputSource;
}

export type BrailleOutputAction =
  BrailleCommit | TextOutput | SpaceIntent | CommandOutput;
export type OutputDelivery =
  "accepted" | "rejected" | "unhandled" | "conflicted";

export interface BrailleOutputSink {
  write(action: BrailleOutputAction): OutputDelivery;
}

export interface BrailleInputOptions {
  readonly inputMode?: InputMode;
  readonly toggleDots?: boolean;
  readonly spaceMode?: SpaceMode;
  readonly strategies?: readonly BrailleInputStrategyFactory[];
  readonly outputSink?: BrailleOutputSink;
  readonly onStateChange?: (state: BrailleStateSnapshot) => void;
  readonly onOutput?: (
    action: BrailleOutputAction,
    delivery: OutputDelivery,
  ) => void;
  readonly onDiagnostic?: (diagnostic: BrailleInputDiagnostic) => void;
}

export type BrailleInputOptionPatch = Partial<
  Pick<BrailleInputOptions, "inputMode" | "toggleDots" | "spaceMode">
>;

export type ActivationMode = "focus" | "manual" | "always";
export type KeyboardScope = Document | ShadowRoot | HTMLElement;

export interface ActivationGroup {
  add(element: HTMLElement): () => void;
  destroy(): void;
}

export interface KeyboardAdapterOptions {
  readonly keyboard?: boolean;
  readonly numpad?: boolean;
  readonly keyMap?: Readonly<Record<string, BrailleDot | null>>;
  readonly spaceKey?: string | null;
  readonly commitKeys?: readonly string[];
  readonly commandMap?: Readonly<Record<string, BrailleCommand | null>>;
  readonly repeatDeleteBackward?: boolean;
  readonly preventDefault?: "handled" | "always" | "never";
  readonly activation?: ActivationMode;
  readonly activationGroup?: ActivationGroup;
  readonly keyboardFilter?: (event: KeyboardEvent) => boolean;
}

export interface BrailleAttachment<TOptions> {
  activate(): void;
  deactivate(): void;
  updateOptions(patch: Partial<Omit<TOptions, "activationGroup">>): void;
  detach(): void;
}

export interface KeyboardBindingSource {
  getEffectiveKeyMap(): Readonly<Record<string, BrailleDot>>;
  subscribeEffectiveKeyMap(
    listener: (keyMap: Readonly<Record<string, BrailleDot>>) => void,
  ): () => void;
}

export interface KeyboardAttachment
  extends BrailleAttachment<KeyboardAdapterOptions>, KeyboardBindingSource {}

export interface BrailleInputController {
  enable(): void;
  disable(options?: { cancelPending?: boolean }): void;
  reset(): void;
  updateOptions(patch: BrailleInputOptionPatch): void;
  setInputMode(mode: InputMode): void;
  commitPending(source?: InputSource): void;
  cancelPending(): void;
  registerStrategy(factory: BrailleInputStrategyFactory): () => void;
  dispatch(action: BrailleInputAction): void;
  setOutputSink(sink: BrailleOutputSink): () => void;
  getState(): BrailleStateSnapshot;
  subscribeState(listener: (state: BrailleStateSnapshot) => void): () => void;
  subscribeOutput(
    listener: (action: BrailleOutputAction, delivery: OutputDelivery) => void,
  ): () => void;
  subscribeDiagnostic(
    listener: (diagnostic: BrailleInputDiagnostic) => void,
  ): () => void;
  clearOutputSink(expected?: BrailleOutputSink): void;
  destroy(): void;
}

export interface EditableAdapterOptions {
  readonly activation?: ActivationMode;
  readonly activationGroup?: ActivationGroup;
}

export function isExtensionId(value: string): boolean {
  const parts = value.split(":");
  return (
    parts.length === 2 &&
    parts.every((part) => /^[a-z][a-z0-9._-]{0,63}$/.test(part)) &&
    parts[0] !== "braille"
  );
}

export function extensionId(value: string): ExtensionId {
  if (!isExtensionId(value)) {
    throw new BrailleInputException(
      "INVALID_CONFIG",
      `Invalid extension id: ${value}`,
    );
  }
  return value as ExtensionId;
}

export const defaultControllerOptions = Object.freeze({
  inputMode: "sequential" as const,
  toggleDots: true,
  spaceMode: "braille" as const,
});

export const defaultKeyboardOptions = Object.freeze({
  keyboard: true,
  numpad: true,
  keyMap: Object.freeze(
    Object.fromEntries(
      Array.from("FDSJKL741852", (code, index) => [
        (index < 6 ? "Key" : "Numpad") + code,
        (index % 6) + 1,
      ]),
    ) as {
      KeyF: BrailleDot;
      KeyD: BrailleDot;
      KeyS: BrailleDot;
      KeyJ: BrailleDot;
      KeyK: BrailleDot;
      KeyL: BrailleDot;
      Numpad7: BrailleDot;
      Numpad4: BrailleDot;
      Numpad1: BrailleDot;
      Numpad8: BrailleDot;
      Numpad5: BrailleDot;
      Numpad2: BrailleDot;
    },
  ),
  spaceKey: "Space",
  commitKeys: Object.freeze(["NumpadEnter"]),
  commandMap: Object.freeze({
    Backspace: "deleteBackward" as const,
    Escape: "cancelPending" as const,
  }),
  repeatDeleteBackward: false,
  preventDefault: "handled" as const,
});

export function isBrailleDot(value: unknown): value is BrailleDot {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 6
  );
}

export function isInputSource(value: unknown): value is InputSource {
  return (
    value === "keyboard" ||
    value === "numpad" ||
    value === "pointer" ||
    value === "api" ||
    (typeof value === "string" && isExtensionId(value))
  );
}

export function isInputMode(value: unknown): value is InputMode {
  return (
    value === "sequential" ||
    value === "chord" ||
    (typeof value === "string" && isExtensionId(value))
  );
}
