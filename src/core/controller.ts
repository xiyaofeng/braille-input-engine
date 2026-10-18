import { dotsToBraille, dotsToMask } from "./unicode.js";
import {
  BrailleInputException,
  defaultControllerOptions,
  isExtensionId,
  isBrailleDot,
  isInputMode,
  isInputSource,
  type BrailleCommit,
  type BrailleDot,
  type BrailleInputAction,
  type BrailleInputController,
  type BrailleInputDiagnostic,
  type BrailleInputOptionPatch,
  type BrailleInputOptions,
  type BrailleInputStrategy,
  type BrailleInputStrategyFactory,
  type BrailleOutputAction,
  type BrailleOutputSink,
  type BrailleStateSnapshot,
  type BrailleCommand,
  type CommandOutput,
  type EditorCommand,
  type InputMode,
  type InputSource,
  type OutputDelivery,
  type OutputSinkState,
  type PendingDotContribution,
  type SpaceIntent,
  type StrategyContext,
  type StrategyDeactivateReason,
  type StrategyLifecycleContext,
  type StrategyResetContext,
  type StrategyResetReason,
  type TextOutput,
} from "./types.js";
import { ChordStrategy } from "./strategies/chord.js";
import { SequentialStrategy } from "./strategies/sequential.js";
import type { InternalController } from "./internal.js";
import { sameArray } from "./utils.js";

interface InternalContribution extends PendingDotContribution {
  readonly ordinal: number;
}

interface PressedInput {
  readonly dot: BrailleDot;
  readonly source: InputSource;
}

interface StrategyRegistration {
  readonly strategy: BrailleInputStrategy;
  readonly builtIn: boolean;
  _destroyed: boolean;
  unavailable: boolean;
}

type OutputRequest =
  | {
      readonly kind: "commit";
      readonly triggerSource: InputSource;
      readonly contributions: InternalContribution[];
    }
  | {
      readonly kind: "space";
      readonly source: InputSource;
      readonly contributions: InternalContribution[];
    }
  | {
      readonly kind: "command";
      readonly command: EditorCommand;
      readonly source: InputSource;
      readonly contributions: InternalContribution[];
    };

const sourceOrder: readonly InputSource[] = [
  "keyboard",
  "numpad",
  "pointer",
  "api",
];

function compareStrings(a: string, b: string): number {
  const left = [...a],
    right = [...b];
  for (let index = 0; index < left.length && index < right.length; index += 1) {
    const difference =
      (left[index]?.codePointAt(0) ?? 0) - (right[index]?.codePointAt(0) ?? 0);
    if (difference) return difference;
  }
  return left.length - right.length;
}

function compareSources(a: InputSource, b: InputSource): number {
  const aIndex = sourceOrder.indexOf(a);
  const bIndex = sourceOrder.indexOf(b);
  if (aIndex < 0) return bIndex < 0 ? compareStrings(a, b) : 1;
  return bIndex < 0 ? -1 : aIndex - bIndex;
}

function contributionDots(
  entries: readonly InternalContribution[],
): BrailleDot[] {
  return [...new Set(entries.map((entry) => entry.dot))].sort((a, b) => a - b);
}
function contributionSources(
  entries: readonly InternalContribution[],
): InputSource[] {
  return [...new Set(entries.map((entry) => entry.source))].sort(
    compareSources,
  );
}

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function freezeContribution(
  entry: PendingDotContribution,
): PendingDotContribution {
  return Object.freeze({ id: entry.id, dot: entry.dot, source: entry.source });
}

function freezeDiagnostic(
  diagnostic: BrailleInputDiagnostic,
): BrailleInputDiagnostic {
  const context = diagnostic.context
    ? Object.freeze(
        Object.fromEntries(
          Object.entries(diagnostic.context).filter(([, value]) => {
            return (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
            );
          }),
        ) as Record<string, string | number | boolean>,
      )
    : undefined;
  return Object.freeze({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: String(diagnostic.message || diagnostic.code),
    ...(context ? { context } : {}),
  });
}

function freezeAction(action: BrailleOutputAction): BrailleOutputAction {
  if (action.kind === "braille") {
    return Object.freeze({
      ...action,
      dots: freezeArray(action.dots),
      sources: freezeArray(action.sources),
    });
  }
  return Object.freeze({ ...action });
}

function isOutputDelivery(value: unknown): value is OutputDelivery {
  return (
    value === "accepted" ||
    value === "rejected" ||
    value === "unhandled" ||
    value === "conflicted"
  );
}

function isThenable(value: unknown): boolean {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value,
  );
}

export class BrailleController
  implements BrailleInputController, InternalController
{
  private _inputMode: InputMode;
  private _t: boolean;
  private _s: BrailleInputOptions["spaceMode"];
  private _enabled = true;
  private _destroyed = false;
  private _awaitingRetry = false;
  private sink: BrailleOutputSink | undefined;
  private sinkState: OutputSinkState = "empty";
  private contributions: InternalContribution[] = [];
  private pressed = new Map<string, PressedInput>();
  private nextOrdinal = 0;
  private readonly stateListeners: Array<
    (state: BrailleStateSnapshot) => void
  > = [];
  private readonly outputListeners: Array<
    (action: BrailleOutputAction, delivery: OutputDelivery) => void
  > = [];
  private readonly diagnosticListeners: Array<
    (diagnostic: BrailleInputDiagnostic) => void
  > = [];
  private readonly registrations = new Map<string, StrategyRegistration>();
  private activeStrategy: BrailleInputStrategy;
  private activeRegistration: StrategyRegistration;
  private currentState: BrailleStateSnapshot;
  private transactionDepth = 0;
  private queue: Array<() => void> = [];
  private processingQueue = false;
  private structuralOperationDepth = 0;
  private structuralPhase = false;
  private structuralDiagnosticReentry = false;

  constructor(options: BrailleInputOptions = {}) {
    this._inputMode =
      options.inputMode === undefined
        ? defaultControllerOptions.inputMode
        : options.inputMode;
    this._t =
      options.toggleDots === undefined
        ? defaultControllerOptions.toggleDots
        : options.toggleDots;
    this._s =
      options.spaceMode === undefined
        ? defaultControllerOptions.spaceMode
        : options.spaceMode;
    this.validateOptions({
      inputMode: this._inputMode,
      toggleDots: this._t,
      spaceMode: this._s,
    });
    if (
      options.outputSink !== undefined &&
      (!options.outputSink || typeof options.outputSink.write !== "function")
    )
      throw new BrailleInputException(
        "INVALID_CONFIG",
        "An output sink must provide a synchronous write(action) function.",
      );
    if (options.onStateChange) this.stateListeners.push(options.onStateChange);
    if (options.onOutput) this.outputListeners.push(options.onOutput);
    if (options.onDiagnostic)
      this.diagnosticListeners.push(options.onDiagnostic);

    this.installBuiltIn("sequential", () => new SequentialStrategy());
    this.installBuiltIn("chord", () => new ChordStrategy());
    for (const factory of options.strategies ?? [])
      this.registerFactory(factory, true);

    const registration = this.registrations.get(this._inputMode);
    if (!registration || registration.unavailable) {
      throw new BrailleInputException(
        "UNKNOWN_STRATEGY",
        `Unknown input strategy: ${String(this._inputMode)}`,
      );
    }
    this.activeRegistration = registration;
    this.activeStrategy = registration.strategy;
    let activated = false;
    try {
      this.structuralPhase = true;
      this.activeStrategy.activate(this.lifecycleContext());
      activated = true;
    } catch {
      this.reportStrategyFault(registration, "activate");
      if (!registration.builtIn) this.fallbackToSequential(activated);
    } finally {
      this.structuralPhase = false;
    }

    if (options.outputSink !== undefined) {
      this.sink = options.outputSink;
      this.sinkState = "ready";
    }
    this.currentState = this.buildState();
  }

  enable(): void {
    this.mutate(() => {
      if (this._enabled) return;
      this._enabled = true;
      this.publishState();
    });
  }

  disable(options: { cancelPending?: boolean } = {}): void {
    this.mutate(() => {
      if (!this._enabled && !options.cancelPending) return;
      this.resetStrategy("disable");
      this.pressed.clear();
      if (options.cancelPending) {
        this.contributions = [];
        this._awaitingRetry = false;
      }
      this._enabled = false;
      this.publishState();
    });
  }

  reset(): void {
    this.mutate(() => {
      this.resetStrategy("controller-reset");
      this.pressed.clear();
      this.contributions = [];
      this._awaitingRetry = false;
      this.publishState();
    });
  }

  updateOptions(patch: BrailleInputOptionPatch): void {
    this.mutate(() => {
      const nextMode =
        patch.inputMode === undefined ? this._inputMode : patch.inputMode;
      const nextToggleDots =
        patch.toggleDots === undefined ? this._t : patch.toggleDots;
      const nextSpaceMode =
        patch.spaceMode === undefined ? this._s : patch.spaceMode;
      this.validateOptions({
        inputMode: nextMode,
        toggleDots: nextToggleDots,
        spaceMode: nextSpaceMode,
      });
      if (nextMode !== this._inputMode) this.setInputMode(nextMode);
      const changed = nextToggleDots !== this._t || nextSpaceMode !== this._s;
      this._t = nextToggleDots;
      this._s = nextSpaceMode;
      if (changed) {
        this.pressed.clear();
        this.resetStrategy("configuration-change");
        this.publishState();
      }
    });
  }

  setInputMode(mode: InputMode): void {
    this.mutate(() => {
      if (!isInputMode(mode))
        throw new BrailleInputException(
          "UNKNOWN_STRATEGY",
          `Unknown input strategy: ${String(mode)}`,
        );
      if (mode === this._inputMode) return;
      const next = this.registrations.get(mode);
      if (!next || next.unavailable)
        throw new BrailleInputException(
          "UNKNOWN_STRATEGY",
          `Unknown input strategy: ${String(mode)}`,
        );

      this.pressed.clear();
      this.resetStrategy("configuration-change");
      this.contributions = [];
      this._awaitingRetry = false;
      this.safeLifecycle(this.activeStrategy, "deactivate", "mode-switch");
      this._inputMode = mode;
      this.activeRegistration = next;
      this.activeStrategy = next.strategy;
      let activated = false;
      try {
        this.structuralPhase = true;
        this.activeStrategy.activate(this.lifecycleContext());
        activated = true;
      } catch {
        this.reportStrategyFault(next, "activate");
        this.fallbackToSequential(activated);
      } finally {
        this.structuralPhase = false;
      }
      this.publishState();
    });
  }

  commitPending(source: InputSource = "api"): void {
    this.assertAlive();
    this.enqueueOrRun(() => {
      if (!isInputSource(source))
        throw new BrailleInputException(
          "INVALID_ACTION",
          `Invalid output source: ${String(source)}`,
        );
      if (!this._enabled && !this._awaitingRetry) return;
      if (!this._awaitingRetry && this.contributions.length === 0) return;
      if (this._awaitingRetry) {
        this.attemptCommit(source);
        return;
      }
      if (this._inputMode === "chord" && this.pressed.size > 0) {
        this.emitDiagnostic({
          severity: "error",
          code: "INVALID_ACTION",
          message: "Cannot commit while a chord is in progress.",
        });
        return;
      }
      this.attemptCommit(source);
    });
  }

  cancelPending(): void {
    this.assertAlive();
    this.enqueueOrRun(() => this.cancelPendingInternal());
  }

  registerStrategy(factory: BrailleInputStrategyFactory): () => void {
    const registration = this.mutate(() => this.registerFactory(factory, true));
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this._destroyed) return;
      this.mutate(() => {
        if (this.activeRegistration === registration) {
          disposed = false;
          throw new BrailleInputException(
            "INVALID_ACTION",
            "The active strategy must be changed before disposal.",
          );
        }
        if (!registration._destroyed) {
          this.safeDestroy(registration.strategy);
          registration._destroyed = true;
        }
        this.registrations.delete(registration.strategy.id as string);
      });
    };
  }

  dispatch(action: BrailleInputAction): void {
    this.assertAlive();
    this.enqueueOrRun(() => this.dispatchInternal(action));
  }

  setOutputSink(sink: BrailleOutputSink): () => void {
    this.mutate(() => {
      if (!sink || typeof sink.write !== "function") {
        throw new BrailleInputException(
          "INVALID_CONFIG",
          "An output sink must provide a synchronous write(action) function.",
        );
      }
      if (this.sink) {
        throw new BrailleInputException(
          "OUTPUT_SINK_CONFLICT",
          "Only one output sink may be attached to a controller.",
        );
      }
      this.sink = sink;
      this.sinkState = "ready";
      this.publishState();
    });
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this._destroyed) return;
      this.mutate(() => {
        if (this.sink === sink) {
          this.sink = undefined;
          this.sinkState = "empty";
          this.publishState();
        }
      });
    };
  }

  getState(): BrailleStateSnapshot {
    return this.currentState;
  }

  subscribeState(listener: (state: BrailleStateSnapshot) => void): () => void {
    this.assertAlive();
    const registration = (state: BrailleStateSnapshot) => listener(state);
    this.stateListeners.push(registration);
    this.transactionDepth += 1;
    try {
      listener(this.currentState);
    } catch {
      // A notification listener cannot roll back core state or stop later listeners.
    } finally {
      this.transactionDepth -= 1;
    }
    this.drainQueue();
    return this.makeDisposer(this.stateListeners, registration);
  }

  subscribeOutput(
    listener: (action: BrailleOutputAction, delivery: OutputDelivery) => void,
  ): () => void {
    this.assertAlive();
    const registration = (
      action: BrailleOutputAction,
      delivery: OutputDelivery,
    ) => listener(action, delivery);
    this.outputListeners.push(registration);
    return this.makeDisposer(this.outputListeners, registration);
  }

  subscribeDiagnostic(
    listener: (diagnostic: BrailleInputDiagnostic) => void,
  ): () => void {
    this.assertAlive();
    const registration = (diagnostic: BrailleInputDiagnostic) =>
      listener(diagnostic);
    this.diagnosticListeners.push(registration);
    return this.makeDisposer(this.diagnosticListeners, registration);
  }

  clearOutputSink(expected?: BrailleOutputSink): void {
    this.mutate(() => {
      if (expected && this.sink !== expected) {
        throw new BrailleInputException(
          "OUTPUT_SINK_CONFLICT",
          "The expected output sink is not installed.",
        );
      }
      if (!this.sink && this.sinkState === "empty") return;
      this.sink = undefined;
      this.sinkState = "empty";
      this.publishState();
    });
  }

  destroy(): void {
    if (this._destroyed) return;
    this.mutate(() => {
      this.safeLifecycle(this.activeStrategy, "deactivate", "destroy");
      for (const registration of this.registrations.values()) {
        if (!registration._destroyed) {
          this.safeDestroy(registration.strategy);
          registration._destroyed = true;
        }
      }
      this.pressed.clear();
      this.contributions = [];
      this._awaitingRetry = false;
      this._enabled = false;
      this.sink = undefined;
      this.sinkState = "empty";
      this._destroyed = true;
      this.publishState();
      this.stateListeners.length = 0;
      this.outputListeners.length = 0;
      this.diagnosticListeners.length = 0;
      this.queue.length = 0;
    });
  }

  __reportDiagnostic(diagnostic: BrailleInputDiagnostic): void {
    const topLevel =
      this.transactionDepth === 0 &&
      this.structuralOperationDepth === 0 &&
      !this.processingQueue;
    try {
      this.emitDiagnostic(diagnostic);
    } finally {
      if (topLevel) this.drainQueue();
    }
  }

  __handleActivationLost(
    reason: "activation-lost" | "hidden",
    inputIds?: readonly string[] | (() => import("./internal.js").AdapterBatch),
  ): void {
    if (this._destroyed) return;
    // Reserve this event's FIFO position before calling guards. Guard/notification
    // reentry belongs after the old event, including when it arrives in a callback.
    if (this.structuralPhase) this.enqueueOrRun(() => {});
    let batch: import("./internal.js").AdapterBatch | undefined;
    this.queue.push(() => {
      if (!batch) return;
      const [ids, actions, release] = batch;
      this.transactionDepth++;
      try {
        if (ids !== undefined) {
          for (const inputId of ids ?? [])
            this.dispatchInternal({
              type: "input-cancel",
              inputId,
              source: this.pressed.get(inputId)?.source ?? "pointer",
            });
          this.resetStrategy(reason);
          if (!ids) this.pressed.clear();
          if (this._inputMode === "chord" && !this._awaitingRetry)
            this.contributions = [];
          this.publishState();
        }
        for (const action of actions) this.dispatchInternal(action);
      } finally {
        release?.();
        this.transactionDepth--;
      }
    });
    this.transactionDepth++;
    try {
      batch =
        typeof inputIds === "function" ? inputIds() : [inputIds ?? null, []];
    } finally {
      this.transactionDepth--;
      this.drainQueue();
    }
  }

  private installBuiltIn(
    id: "sequential" | "chord",
    factory: BrailleInputStrategyFactory,
  ): void {
    const strategy = factory();
    this.registrations.set(id, {
      strategy,
      builtIn: true,
      _destroyed: false,
      unavailable: false,
    });
  }

  private registerFactory(
    factory: BrailleInputStrategyFactory,
    throwOnError: boolean,
  ): StrategyRegistration {
    if (typeof factory !== "function")
      throw new BrailleInputException(
        "INVALID_CONFIG",
        "Strategy registration requires a factory.",
      );
    let strategy: BrailleInputStrategy;
    try {
      strategy = factory();
    } catch (error) {
      if (throwOnError)
        throw new BrailleInputException(
          "STRATEGY_ERROR",
          "Strategy factory threw while registering.",
          { cause: error },
        );
      throw error;
    }
    if (
      !strategy ||
      !isInputMode(strategy.id) ||
      strategy.id === "sequential" ||
      strategy.id === "chord"
    ) {
      throw new BrailleInputException(
        "STRATEGY_ERROR",
        "A custom strategy must return a valid non-built-in strategy id.",
      );
    }
    if (this.registrations.has(strategy.id)) {
      throw new BrailleInputException(
        "STRATEGY_ALREADY_REGISTERED",
        `Strategy already registered: ${strategy.id}`,
      );
    }
    const registration: StrategyRegistration = {
      strategy,
      builtIn: false,
      _destroyed: false,
      unavailable: false,
    };
    this.registrations.set(strategy.id, registration);
    return registration;
  }

  private validateOptions(options: {
    inputMode: InputMode;
    toggleDots: boolean;
    spaceMode: BrailleInputOptions["spaceMode"];
  }): void {
    if (!isInputMode(options.inputMode))
      throw new BrailleInputException(
        "UNKNOWN_STRATEGY",
        `Unknown input strategy: ${String(options.inputMode)}`,
      );
    if (typeof options.toggleDots !== "boolean")
      throw new BrailleInputException(
        "INVALID_CONFIG",
        "toggleDots must be boolean.",
      );
    if (
      options.spaceMode !== "braille" &&
      options.spaceMode !== "ascii" &&
      options.spaceMode !== "event"
    ) {
      throw new BrailleInputException(
        "INVALID_CONFIG",
        `Invalid spaceMode: ${String(options.spaceMode)}`,
      );
    }
  }

  private buildState(): BrailleStateSnapshot {
    const dots = contributionDots(this.contributions);
    const sources = contributionSources(this.contributions);
    const pressedInputIds = [...this.pressed.keys()].sort(compareStrings);
    const previewChar = dots.length > 0 ? dotsToBraille(dots) : null;
    return Object.freeze({
      inputMode: this._inputMode,
      pendingDots: freezeArray(dots),
      pendingSources: freezeArray(sources),
      previewChar,
      pressedInputIds: freezeArray(pressedInputIds),
      chordInProgress: this._inputMode === "chord" && this.pressed.size > 0,
      awaitingRetry: this._awaitingRetry,
      outputSinkState: this.sinkState,
      enabled: this._enabled,
      destroyed: this._destroyed,
    });
  }

  private publishState(): void {
    const next = this.buildState();
    const previous = this.currentState;
    if (
      previous &&
      Object.entries(next).every(([key, value]) => {
        const old = previous[key as keyof BrailleStateSnapshot];
        return Array.isArray(value)
          ? sameArray(value, old as readonly unknown[])
          : old === value;
      })
    ) {
      return;
    }
    this.currentState = next;
    this.notifyListeners(this.stateListeners, next);
  }

  private notifyListeners<T extends readonly unknown[]>(
    listeners: readonly ((...values: T) => void)[],
    ...values: T
  ): void {
    this.transactionDepth += 1;
    try {
      for (const listener of [...listeners]) {
        try {
          listener(...values);
        } catch {
          // Notification errors cannot stop later listeners or roll back state.
        }
      }
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private emitOutput(
    action: BrailleOutputAction,
    delivery: OutputDelivery,
  ): void {
    const frozenAction = Object.isFrozen(action)
      ? action
      : freezeAction(action);
    this.notifyListeners(this.outputListeners, frozenAction, delivery);
  }

  private emitDiagnostic(diagnostic: BrailleInputDiagnostic): void {
    const safe = freezeDiagnostic(diagnostic);
    this.notifyListeners(this.diagnosticListeners, safe);
  }

  private dispatchInternal(action: BrailleInputAction): void {
    this.validateAction(action);
    if (this._awaitingRetry) {
      this.handleRetryGate(action);
      return;
    }

    if (action.type === "dot-down") {
      if (!this._enabled) return;
      const existing = this.pressed.get(action.inputId);
      if (existing) {
        if (existing.dot !== action.dot || existing.source !== action.source) {
          this.emitDiagnostic({
            severity: "error",
            code: "INVALID_ACTION",
            message: "An inputId was reused with a different dot or source.",
          });
        }
        return;
      }
      this.pressed.set(action.inputId, {
        dot: action.dot,
        source: action.source,
      });
    } else if (action.type === "dot-up" || action.type === "input-cancel") {
      if (!this.pressed.has(action.inputId)) return;
      this.pressed.delete(action.inputId);
    } else if (!this._enabled) {
      return;
    }

    if (action.type === "command" && action.command === "cancelPending") {
      this.cancelPendingInternal();
      return;
    }
    this.runStrategyAction(action);
  }

  private handleRetryGate(action: BrailleInputAction): void {
    if (action.type === "dot-up" || action.type === "input-cancel") {
      if (this.pressed.delete(action.inputId)) this.publishState();
      return;
    }
    if (action.type === "commit-request") {
      this.attemptCommit(action.source);
      return;
    }
    if (action.type === "command" && action.command === "cancelPending") {
      this.cancelPendingInternal();
    }
  }

  private runStrategyAction(action: BrailleInputAction): void {
    // Strategy getters expose frozen projections; setters replace the whole
    // normalized array. Retaining the old array is sufficient for rollback.
    const original = this.contributions;
    let draft = original;
    let request: OutputRequest | undefined;
    let sealed = false;
    const context: StrategyContext & { __toggleDots: boolean } = {
      __toggleDots: this._t,
      getState: () => this.buildState(),
      reportDiagnostic: (diagnostic) => this.emitDiagnostic(diagnostic),
      getPendingContributions: () => freezeArray(draft.map(freezeContribution)),
      setPendingContributions: (entries) => {
        if (sealed)
          throw new BrailleInputException(
            "INVALID_ACTION",
            "A strategy cannot mutate its draft after requesting output.",
          );
        draft = this.normalizeContributions(entries, draft);
      },
      requestCommit: (triggerSource) => {
        if (!isInputSource(triggerSource))
          throw new BrailleInputException(
            "INVALID_ACTION",
            "A strategy must request output with a valid source.",
          );
        if (sealed || request)
          throw new BrailleInputException(
            "INVALID_ACTION",
            "A strategy action may request at most one output.",
          );
        if (draft.length === 0) return;
        sealed = true;
        request = {
          kind: "commit",
          triggerSource,
          contributions: draft,
        };
      },
      requestSpace: (source) => {
        if (!isInputSource(source))
          throw new BrailleInputException(
            "INVALID_ACTION",
            "A strategy must request output with a valid source.",
          );
        if (sealed || request)
          throw new BrailleInputException(
            "INVALID_ACTION",
            "A strategy action may request at most one output.",
          );
        sealed = true;
        request = {
          kind: "space",
          source,
          contributions: draft,
        };
      },
      requestCommand: (command, source) => {
        if (!this.isEditorCommand(command) || !isInputSource(source))
          throw new BrailleInputException(
            "INVALID_ACTION",
            "A strategy must request a valid editor command and source.",
          );
        if (sealed || request)
          throw new BrailleInputException(
            "INVALID_ACTION",
            "A strategy action may request at most one output.",
          );
        sealed = true;
        request = {
          kind: "command",
          command,
          source,
          contributions: draft,
        };
      },
    };

    try {
      this.transactionDepth += 1;
      this.activeStrategy.handle(action, context);
    } catch {
      this.transactionDepth -= 1;
      this.contributions = original;
      this.reportStrategyFault(this.activeRegistration, "handle");
      if (!this.activeRegistration.builtIn) this.fallbackToSequential();
      else this.publishState();
      return;
    }
    this.transactionDepth -= 1;

    if (!request) {
      this.contributions = draft;
      this.publishState();
      return;
    }
    this.contributions = request.contributions;
    this.executeRequest(request);
  }

  private executeRequest(request: OutputRequest): void {
    switch (request.kind) {
      case "commit":
        this.attemptCommit(request.triggerSource, request.contributions);
        break;
      case "space":
        this.executeSpace(request.source);
        break;
      case "command":
        this.executeCommand(request.command, request.source);
        break;
    }
  }

  private attemptCommit(
    triggerSource: InputSource,
    contributions: readonly InternalContribution[] = this.contributions,
  ): void {
    if (contributions.length === 0) return;
    const dots = contributionDots(contributions);
    const sources = contributionSources(contributions);
    const mask = dotsToMask(dots);
    const action: BrailleCommit = {
      kind: "braille",
      reason: "cell",
      char: dotsToBraille(dots),
      codePoint: 0x2800 | mask,
      dots: freezeArray(dots),
      mask,
      sources: freezeArray(sources),
      source: sources.length === 1 ? (sources[0] ?? triggerSource) : "mixed",
      triggerSource,
      inputMode: this._inputMode,
    };
    const safeAction = freezeAction(action) as BrailleCommit;
    const delivery = this.performOutput(safeAction);
    this._awaitingRetry = delivery === "rejected";
    if (!this._awaitingRetry) {
      if (delivery === "conflicted") this.pressed.clear();
      this.contributions = [];
    }
    this.publishState();
    this.emitOutput(safeAction, delivery);
  }

  private executeSpace(source: InputSource): void {
    let action: BrailleOutputAction;
    if (this._s === "braille") {
      action = {
        kind: "braille",
        reason: "space",
        char: dotsToBraille([]),
        codePoint: 0x2800,
        dots: freezeArray([]),
        mask: 0,
        sources: freezeArray([source]),
        source,
        triggerSource: source,
        inputMode: this._inputMode,
      };
    } else if (this._s === "ascii") {
      const text: TextOutput = {
        kind: "text",
        reason: "space",
        text: " ",
        source,
      };
      action = text;
    } else {
      const intent: SpaceIntent = { kind: "space-intent", source };
      action = intent;
    }
    const safeAction = freezeAction(action);
    const delivery = this.performOutput(safeAction);
    this.publishState();
    this.emitOutput(safeAction, delivery);
  }

  private executeCommand(command: EditorCommand, source: InputSource): void {
    const action: CommandOutput = { kind: "command", command, source };
    const safeAction = freezeAction(action);
    const delivery = this.performOutput(safeAction);
    this.publishState();
    this.emitOutput(safeAction, delivery);
  }

  private performOutput(action: BrailleOutputAction): OutputDelivery {
    if (!this.sink) return "unhandled";
    if (this.sinkState === "faulted") {
      this.emitDiagnostic({
        severity: "error",
        code: "OUTPUT_REJECTED",
        message: "The output sink is faulted and must be cleared or replaced.",
      });
      return "rejected";
    }
    let result: unknown;
    this.transactionDepth += 1;
    try {
      result = this.sink.write(action);
    } catch (error) {
      this.transactionDepth -= 1;
      this.sinkState = "faulted";
      this.emitDiagnostic({
        severity: "error",
        code: "OUTPUT_SINK_ERROR",
        message: "The output sink threw; the sink is now faulted.",
      });
      void error;
      return "conflicted";
    }
    this.transactionDepth -= 1;
    if (isThenable(result) || !isOutputDelivery(result)) {
      this.sinkState = "faulted";
      this.emitDiagnostic({
        severity: "error",
        code: "SINK_PROTOCOL_VIOLATION",
        message: "Output sinks must synchronously return a valid delivery.",
      });
      return "conflicted";
    }
    return result;
  }

  private resetStrategy(reason: StrategyResetReason): void {
    const original = this.contributions;
    let activeDraft = original;
    let activeFailed = false;
    const registrations =
      reason === "controller-reset"
        ? [...this.registrations.values()]
        : [this.activeRegistration];
    for (const registration of registrations) {
      if (registration._destroyed) continue;
      let draft =
        registration === this.activeRegistration ? activeDraft : original;
      const context: StrategyResetContext = {
        getState: () => this.buildState(),
        reportDiagnostic: (diagnostic) => this.emitDiagnostic(diagnostic),
        getPendingContributions: () =>
          freezeArray(draft.map(freezeContribution)),
        setPendingContributions: (entries) => {
          draft = this.normalizeContributions(entries, original);
        },
      };
      let succeeded = false;
      this.runHook(
        () => {
          registration.strategy.reset(reason, context);
          succeeded = true;
        },
        () => {
          this.reportStrategyFault(registration, "reset");
          if (registration === this.activeRegistration) activeFailed = true;
        },
      );
      if (registration === this.activeRegistration && succeeded)
        activeDraft = draft;
    }
    // A rejected Cell is frozen; a successful lifecycle reset may only alter
    // the live round. Strategy faults still use the documented discard/fallback.
    const preserveRetry =
      this._awaitingRetry &&
      reason !== "cancel-pending" &&
      reason !== "controller-reset";
    this.contributions =
      preserveRetry && !activeFailed ? original : activeDraft;
    if (activeFailed && !this.activeRegistration.builtIn)
      this.fallbackToSequential();
    if (
      this._inputMode === "chord" &&
      !this._awaitingRetry &&
      (reason === "disable" || reason === "configuration-change")
    )
      this.contributions = [];
  }

  private cancelPendingInternal(): void {
    this.assertAlive();
    this.resetStrategy("cancel-pending");
    this.contributions = [];
    this.pressed.clear();
    this._awaitingRetry = false;
    this.publishState();
  }

  private normalizeContributions(
    entries: Iterable<PendingDotContribution>,
    previous: readonly InternalContribution[],
  ): InternalContribution[] {
    let incoming: PendingDotContribution[];
    try {
      incoming = [...entries];
    } catch {
      throw new BrailleInputException(
        "INVALID_ACTION",
        "Strategy contributions must be iterable.",
      );
    }
    const seen = new Set<string>();
    const previousById = new Map(previous.map((entry) => [entry.id, entry]));
    const normalized: InternalContribution[] = [];
    for (const entry of incoming) {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        entry.id.length === 0 ||
        seen.has(entry.id) ||
        !isBrailleDot(entry.dot) ||
        !isInputSource(entry.source)
      ) {
        throw new BrailleInputException(
          "INVALID_ACTION",
          "Invalid or duplicate strategy contribution.",
        );
      }
      seen.add(entry.id);
      const old = previousById.get(entry.id);
      normalized.push({
        id: entry.id,
        dot: entry.dot,
        source: entry.source,
        ordinal: old?.ordinal ?? this.nextOrdinal++,
      });
    }
    normalized.sort((a, b) => a.ordinal - b.ordinal);
    return normalized;
  }

  private fallbackToSequential(deactivateCurrent = true): void {
    const sequential = this.registrations.get("sequential");
    if (!sequential) return;
    if (deactivateCurrent && this.activeRegistration !== sequential)
      this.safeLifecycle(this.activeStrategy, "deactivate", "mode-switch");
    this.pressed.clear();
    this.contributions = [];
    this._awaitingRetry = false;
    this._inputMode = "sequential";
    this.activeRegistration = sequential;
    this.activeStrategy = sequential.strategy;
    try {
      this.structuralPhase = true;
      this.activeStrategy.activate(this.lifecycleContext());
    } catch {
      // Built-in activation is an invariant; keep the controller inert if a custom test double breaks it.
    } finally {
      this.structuralPhase = false;
    }
    this.publishState();
  }

  private reportStrategyFault(
    registration: StrategyRegistration,
    phase: string,
  ): void {
    registration.unavailable = !registration.builtIn;
    this.emitDiagnostic({
      severity: "error",
      code: "STRATEGY_ERROR",
      message: `Strategy ${phase} failed.`,
    });
  }

  private runHook(
    operation: () => void,
    onError: (error: unknown) => void,
  ): void {
    try {
      this.structuralPhase = true;
      this.transactionDepth += 1;
      operation();
    } catch (error) {
      onError(error);
    } finally {
      this.transactionDepth = Math.max(0, this.transactionDepth - 1);
      this.structuralPhase = false;
    }
  }

  private safeLifecycle(
    strategy: BrailleInputStrategy,
    method: "deactivate",
    reason: StrategyDeactivateReason,
  ): void {
    this.runHook(
      () => strategy[method](reason, this.lifecycleContext()),
      () => {
        const registration = this.registrations.get(strategy.id as string);
        if (registration) this.reportStrategyFault(registration, method);
      },
    );
  }

  private safeDestroy(strategy: BrailleInputStrategy): void {
    this.runHook(
      () => strategy.destroy(this.lifecycleContext()),
      (error) => {
        this.emitDiagnostic({
          severity: "error",
          code: "STRATEGY_ERROR",
          message: "Strategy destroy failed.",
        });
        void error;
      },
    );
  }

  private lifecycleContext(): StrategyLifecycleContext {
    return {
      getState: () => this.buildState(),
      reportDiagnostic: (diagnostic) => this.emitDiagnostic(diagnostic),
    };
  }

  private validateAction(action: BrailleInputAction): void {
    if (
      !action ||
      typeof action !== "object" ||
      typeof action.type !== "string" ||
      !isInputSource(action.source)
    ) {
      throw new BrailleInputException(
        "INVALID_ACTION",
        "Invalid Braille input action.",
      );
    }
    if (action.type === "dot-down" || action.type === "dot-up") {
      if (
        !isBrailleDot(action.dot) ||
        typeof action.inputId !== "string" ||
        action.inputId.length === 0
      ) {
        throw new BrailleInputException(
          "INVALID_ACTION",
          "Dot actions require a valid dot and inputId.",
        );
      }
    } else if (action.type === "input-cancel") {
      if (typeof action.inputId !== "string" || action.inputId.length === 0) {
        throw new BrailleInputException(
          "INVALID_ACTION",
          "input-cancel requires an inputId.",
        );
      }
    } else if (action.type === "command") {
      if (!this.isCommand(action.command))
        throw new BrailleInputException(
          "INVALID_ACTION",
          "Unknown Braille command.",
        );
    } else if (
      action.type !== "commit-request" &&
      action.type !== "space-request"
    ) {
      throw new BrailleInputException(
        "INVALID_ACTION",
        "Unknown Braille input action type.",
      );
    }
  }

  private isCommand(command: BrailleCommand): boolean {
    return command === "cancelPending" || this.isEditorCommand(command);
  }

  private isEditorCommand(command: unknown): command is EditorCommand {
    return (
      command === "deleteBackward" ||
      command === "lineBreak" ||
      (typeof command === "string" && isExtensionId(command))
    );
  }

  private mutate<T>(operation: () => T): T {
    this.assertAlive();
    this.assertStructuralMutation();
    return this.runStructuralOperation(operation);
  }

  private runStructuralOperation<T>(operation: () => T): T {
    this.structuralOperationDepth += 1;
    try {
      return operation();
    } finally {
      this.structuralOperationDepth -= 1;
      if (this.structuralOperationDepth === 0) this.drainQueue();
    }
  }

  private enqueueOrRun(operation: () => void): void {
    if (this.structuralPhase) {
      if (!this.structuralDiagnosticReentry) {
        this.structuralDiagnosticReentry = true;
        try {
          this.emitDiagnostic({
            severity: "error",
            code: "INVALID_ACTION",
            message:
              "Controller mutation is not allowed during a strategy lifecycle hook.",
          });
        } finally {
          this.structuralDiagnosticReentry = false;
        }
      }
      throw new BrailleInputException(
        "INVALID_ACTION",
        "Controller mutation is not allowed during a strategy lifecycle hook.",
      );
    }
    if (this.transactionDepth > 0) {
      this.queue.push(operation);
      return;
    }
    operation();
    this.drainQueue();
  }

  private drainQueue(): void {
    if (this.processingQueue || this.transactionDepth > 0) return;
    this.processingQueue = true;
    try {
      while (this.queue.length > 0 && !this._destroyed) {
        const operation = this.queue.shift();
        operation?.();
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private assertAlive(): void {
    if (this._destroyed)
      throw new BrailleInputException(
        "CONTROLLER_DESTROYED",
        "The controller has been destroyed.",
      );
  }

  private assertStructuralMutation(): void {
    if (this.transactionDepth > 0 || this.structuralPhase)
      throw new BrailleInputException(
        "INVALID_ACTION",
        "Structural mutation is not allowed during a transaction.",
      );
  }

  private makeDisposer<T>(list: T[], value: T): () => void {
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const index = list.indexOf(value);
      if (index >= 0) list.splice(index, 1);
    };
  }
}

export function createBrailleController(
  options?: BrailleInputOptions,
): BrailleInputController {
  return new BrailleController(options);
}

export {
  asInternalController,
  reportControllerDiagnostic,
} from "./internal.js";
