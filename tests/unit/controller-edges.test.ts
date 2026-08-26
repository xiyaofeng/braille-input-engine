import { describe, expect, it } from "vitest";
import {
  BrailleController,
  asInternalController,
  createBrailleController,
  reportControllerDiagnostic,
} from "../../src/core/controller.js";
import {
  BrailleInputException,
  extensionId,
  isBrailleDot,
  isInputMode,
  isInputSource,
  type BrailleInputStrategy,
  type ExtensionId,
  type InputSource,
  type BrailleOutputSink,
} from "../../src/core/types.js";

function dotDown(
  controller: ReturnType<typeof createBrailleController>,
  dot: 1 | 2 | 3 | 4 | 5 | 6,
  inputId: string,
  source: InputSource = "api",
): void {
  controller.dispatch({ type: "dot-down", dot, inputId, source });
}

function dotUp(
  controller: ReturnType<typeof createBrailleController>,
  dot: 1 | 2 | 3 | 4 | 5 | 6,
  inputId: string,
  source: InputSource = "api",
): void {
  controller.dispatch({ type: "dot-up", dot, inputId, source });
}

function basicStrategy(
  id: string,
  overrides: Partial<BrailleInputStrategy> = {},
): BrailleInputStrategy {
  return {
    id: extensionId(id),
    activate: () => {},
    handle: () => {},
    deactivate: () => {},
    reset: () => {},
    destroy: () => {},
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(BrailleInputException);
    expect((error as BrailleInputException).code).toBe(code);
  }
}

describe("controller validation and state transitions", () => {
  it("validates construction, actions, options, enablement, and destruction", () => {
    expect(() =>
      createBrailleController({ toggleDots: "yes" as never }),
    ).toThrow("toggleDots");
    expect(() =>
      createBrailleController({ spaceMode: "bad" as never }),
    ).toThrow("spaceMode");
    expect(() =>
      createBrailleController({ inputMode: "test:missing" as never }),
    ).toThrow("Unknown input strategy");
    expect(() =>
      createBrailleController({ outputSink: null as never }),
    ).toThrow("output sink");
    expect(isBrailleDot(1)).toBe(true);
    expect(isBrailleDot(1.5)).toBe(false);
    expect(isInputSource("x:source")).toBe(true);
    expect(isInputSource("not a source")).toBe(false);
    expect(isInputMode("x:mode")).toBe(true);
    expect(isInputMode("not a mode")).toBe(false);

    const controller = createBrailleController({
      inputMode: "sequential",
      toggleDots: true,
      spaceMode: "braille",
    });
    expectCode(
      () => controller.commitPending("invalid" as never),
      "INVALID_ACTION",
    );
    expectCode(() => controller.dispatch(null as never), "INVALID_ACTION");
    expectCode(
      () =>
        controller.dispatch({
          type: "dot-down",
          dot: 7,
          inputId: "bad",
          source: "api",
        } as never),
      "INVALID_ACTION",
    );
    expectCode(
      () =>
        controller.dispatch({
          type: "dot-up",
          dot: 1,
          inputId: "",
          source: "api",
        } as never),
      "INVALID_ACTION",
    );
    expectCode(
      () =>
        controller.dispatch({
          type: "input-cancel",
          inputId: "",
          source: "api",
        } as never),
      "INVALID_ACTION",
    );
    expectCode(
      () =>
        controller.dispatch({
          type: "command",
          command: "invalid",
          source: "api",
        } as never),
      "INVALID_ACTION",
    );
    expectCode(
      () => controller.dispatch({ type: "unknown", source: "api" } as never),
      "INVALID_ACTION",
    );

    controller.disable();
    controller.disable();
    controller.disable({ cancelPending: true });
    controller.enable();
    controller.enable();
    controller.updateOptions({});
    controller.updateOptions({ toggleDots: false, spaceMode: "ascii" });
    controller.updateOptions({ toggleDots: true, spaceMode: "event" });
    controller.updateOptions({ inputMode: "chord" });
    controller.updateOptions({ inputMode: "sequential" });
    controller.disable();
    controller.commitPending();
    controller.dispatch({ type: "space-request", source: "api" });
    dotDown(controller, 1, "disabled:1");
    dotUp(controller, 1, "unknown:1");
    controller.enable();
    controller.dispatch({
      type: "command",
      command: "cancelPending",
      source: "api",
    });
    controller.dispatch({ type: "space-request", source: "api" });
    controller.setInputMode("chord");
    dotDown(controller, 1, "busy:1");
    controller.commitPending();
    controller.dispatch({
      type: "input-cancel",
      inputId: "busy:1",
      source: "api",
    });
    controller.setInputMode("chord");
    expectCode(
      () => controller.setInputMode("unknown" as never),
      "UNKNOWN_STRATEGY",
    );
    controller.setInputMode("sequential");
    controller.reset();
    controller.destroy();
    controller.destroy();
    expect(controller.getState().destroyed).toBe(true);
    expectCode(() => controller.enable(), "CONTROLLER_DESTROYED");
    expectCode(
      () => controller.dispatch({ type: "space-request", source: "api" }),
      "CONTROLLER_DESTROYED",
    );
  });

  it("orders sources and input ids while preserving duplicate-input diagnostics", () => {
    const diagnostics: string[] = [];
    const outputs: Array<{ source: string; delivery: string }> = [];
    const controller = createBrailleController({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
      onOutput: (action, delivery) => {
        if (action.kind === "braille")
          outputs.push({ source: action.source, delivery });
      },
    });
    dotDown(controller, 1, "z", "keyboard");
    dotDown(controller, 2, "a", "api");
    dotDown(controller, 4, "😀", extensionId("x:source"));
    expect(controller.getState().pressedInputIds).toEqual(["a", "z", "😀"]);
    expect(controller.getState().pendingSources).toEqual([
      "keyboard",
      "api",
      "x:source",
    ]);
    controller.dispatch({
      type: "dot-down",
      dot: 6,
      inputId: "z",
      source: "keyboard",
    });
    expect(diagnostics).toContain("INVALID_ACTION");
    dotUp(controller, 1, "z", "keyboard");
    dotUp(controller, 2, "a", "api");
    dotUp(controller, 4, "😀", extensionId("x:source"));
    controller.commitPending("pointer");
    expect(outputs).toEqual([{ source: "mixed", delivery: "unhandled" }]);
    controller.destroy();
  });

  it("isolates initial and subscribed listener failures and diagnostic context", () => {
    const stateCalls: string[] = [];
    const diagnosticCalls: string[] = [];
    const controller = new BrailleController({
      onStateChange: () => {
        stateCalls.push("initial");
        throw new Error("listener");
      },
      onDiagnostic: (diagnostic) => diagnosticCalls.push(diagnostic.message),
    });
    controller.subscribeState(() => {
      stateCalls.push("first");
      throw new Error("listener");
    });
    controller.subscribeState(() => stateCalls.push("second"));
    const dispose = controller.subscribeDiagnostic(() => {
      diagnosticCalls.push("subscribed");
      throw new Error("diagnostic listener");
    });
    reportControllerDiagnostic(controller, {
      severity: "warning",
      code: "INVALID_ACTION",
      message: "context",
      context: { ok: true, ignored: {} as never, count: 1 },
    });
    expect(stateCalls).toContain("second");
    expect(diagnosticCalls).toContain("context");
    expect(diagnosticCalls).toContain("subscribed");
    dispose();
    dispose();
    controller.destroy();
  });
});

describe("controller output and retry contract", () => {
  it("covers no sink, all Space modes, sink conflict, and sink disposal", () => {
    const deliveries: string[] = [];
    const noSink = createBrailleController({
      onOutput: (_action, delivery) => deliveries.push(delivery),
    });
    noSink.dispatch({ type: "space-request", source: "api" });
    expect(deliveries).toEqual(["unhandled"]);
    noSink.clearOutputSink();
    noSink.destroy();

    const asciiActions: string[] = [];
    const ascii = createBrailleController({
      spaceMode: "ascii",
      outputSink: {
        write: (action) => {
          asciiActions.push(action.kind);
          return "accepted";
        },
      },
    });
    ascii.dispatch({ type: "space-request", source: "api" });
    expect(asciiActions).toEqual(["text"]);
    ascii.destroy();

    const eventActions: string[] = [];
    const event = createBrailleController({
      spaceMode: "event",
      outputSink: {
        write: (action) => {
          eventActions.push(action.kind);
          return "accepted";
        },
      },
    });
    event.dispatch({ type: "space-request", source: "api" });
    expect(eventActions).toEqual(["space-intent"]);
    event.destroy();

    let sink: BrailleOutputSink = { write: () => "accepted" };
    const controller = createBrailleController();
    const dispose = controller.setOutputSink(sink);
    expectCode(() => controller.setOutputSink({} as never), "INVALID_CONFIG");
    expectCode(
      () => controller.setOutputSink({ write: () => "accepted" }),
      "OUTPUT_SINK_CONFLICT",
    );
    expectCode(
      () => controller.clearOutputSink({ write: () => "accepted" }),
      "OUTPUT_SINK_CONFLICT",
    );
    dispose();
    dispose();
    controller.clearOutputSink();
    sink = { write: () => "accepted" };
    const disposeAgain = controller.setOutputSink(sink);
    disposeAgain();
    controller.destroy();
    disposeAgain();
  });

  it("faults invalid and asynchronous sinks and distinguishes deliveries", () => {
    const deliveries: string[] = [];
    let result: unknown = "unhandled";
    const sink = { write: () => result as never };
    const controller = createBrailleController({
      outputSink: sink,
      onOutput: (_action, delivery) => deliveries.push(delivery),
    });
    controller.dispatch({ type: "space-request", source: "api" });
    result = "conflicted";
    controller.dispatch({ type: "space-request", source: "api" });
    result = "invalid";
    controller.dispatch({ type: "space-request", source: "api" });
    expect(controller.getState().outputSinkState).toBe("faulted");
    controller.dispatch({ type: "space-request", source: "api" });
    expect(deliveries).toEqual([
      "unhandled",
      "conflicted",
      "conflicted",
      "rejected",
    ]);
    controller.clearOutputSink(sink);
    const promiseSink = { write: () => Promise.resolve("accepted") as never };
    const dispose = controller.setOutputSink(promiseSink);
    controller.dispatch({ type: "space-request", source: "api" });
    expect(controller.getState().outputSinkState).toBe("faulted");
    dispose();
    controller.destroy();
  });

  it("drains rejected retry releases, retries, and discards", () => {
    let attempt = 0;
    const retry = createBrailleController({
      outputSink: {
        write: () => (++attempt === 1 ? "rejected" : "accepted"),
      },
    });
    dotDown(retry, 1, "retry:1");
    retry.commitPending();
    retry.dispatch({
      type: "dot-up",
      dot: 1,
      inputId: "retry:1",
      source: "api",
    });
    retry.commitPending();
    expect(retry.getState().awaitingRetry).toBe(false);
    retry.destroy();

    const discard = createBrailleController({
      outputSink: { write: () => "rejected" },
    });
    dotDown(discard, 1, "discard:1");
    discard.commitPending();
    discard.dispatch({
      type: "command",
      command: "cancelPending",
      source: "api",
    });
    expect(discard.getState().awaitingRetry).toBe(false);
    discard.destroy();
  });
});

describe("controller strategy registration and lifecycle failures", () => {
  it("rejects malformed factories, duplicate ids, and active disposal", () => {
    expect(() =>
      createBrailleController({ strategies: [null as never] }),
    ).toThrow("factory");
    expect(() =>
      createBrailleController({
        strategies: [
          () => {
            throw new Error("factory");
          },
        ],
      }),
    ).toThrow("factory threw");
    expect(() =>
      createBrailleController({
        strategies: [
          () => ({ ...basicStrategy("test:built-in"), id: "sequential" }),
        ],
      }),
    ).toThrow("non-built-in");
    expect(() =>
      createBrailleController({
        strategies: [
          () => ({ ...basicStrategy("bad:id"), id: "Bad:ID" as never }),
        ],
      }),
    ).toThrow("non-built-in");

    const id = extensionId("test:registered");
    const controller = createBrailleController();
    const dispose = controller.registerStrategy(() => basicStrategy(id));
    expect(() => controller.registerStrategy(() => basicStrategy(id))).toThrow(
      "already registered",
    );
    controller.setInputMode(id);
    expectCode(dispose, "INVALID_ACTION");
    controller.setInputMode("sequential");
    dispose();
    dispose();
    controller.destroy();

    const destroyedController = createBrailleController();
    const lateDispose = destroyedController.registerStrategy(() =>
      basicStrategy("test:late-dispose"),
    );
    destroyedController.destroy();
    lateDispose();
  });

  it("falls back after activation, handle, reset, deactivate, and destroy faults", () => {
    const activationId = extensionId("test:activation");
    const activation = createBrailleController({
      inputMode: activationId,
      strategies: [
        () =>
          basicStrategy(activationId, {
            activate: () => {
              throw new Error("activate");
            },
          }),
      ],
    });
    expect(activation.getState().inputMode).toBe("sequential");
    expectCode(() => activation.setInputMode(activationId), "UNKNOWN_STRATEGY");
    activation.destroy();

    const handleId = extensionId("test:handle");
    const handle = createBrailleController({
      strategies: [
        () =>
          basicStrategy(handleId, {
            handle: () => {
              throw new Error("handle");
            },
          }),
      ],
    });
    handle.setInputMode(handleId);
    dotDown(handle, 1, "handle:1");
    expect(handle.getState().inputMode).toBe("sequential");
    handle.destroy();

    const deactivateId = extensionId("test:deactivate");
    let deactivated = 0;
    const deactivate = createBrailleController({
      strategies: [
        () =>
          basicStrategy(deactivateId, {
            deactivate: () => {
              deactivated += 1;
              throw new Error("deactivate");
            },
          }),
      ],
    });
    deactivate.setInputMode(deactivateId);
    deactivate.setInputMode("sequential");
    expect(deactivated).toBe(1);
    deactivate.destroy();

    const destroyId = extensionId("test:destroy");
    const destroy = createBrailleController({
      strategies: [
        () =>
          basicStrategy(destroyId, {
            destroy: () => {
              throw new Error("destroy");
            },
          }),
      ],
    });
    destroy.setInputMode(destroyId);
    destroy.setInputMode("sequential");
    destroy.destroy();
  });

  it("validates strategy requests and contribution iterables", () => {
    const cases: Array<{
      name: string;
      handle: BrailleInputStrategy["handle"];
    }> = [
      {
        name: "commit source",
        handle: (_action, context) => context.requestCommit("bad" as never),
      },
      {
        name: "space source",
        handle: (_action, context) => context.requestSpace("bad" as never),
      },
      {
        name: "command",
        handle: (_action, context) =>
          context.requestCommand("bad" as never, "api"),
      },
      {
        name: "commit twice",
        handle: (_action, context) => {
          context.setPendingContributions([
            { id: "request", dot: 1, source: "api" },
          ]);
          context.requestCommit("api");
          context.requestCommit("api");
        },
      },
      {
        name: "space twice",
        handle: (_action, context) => {
          context.requestSpace("api");
          context.requestSpace("api");
        },
      },
      {
        name: "command twice",
        handle: (_action, context) => {
          context.requestCommand("lineBreak", "api");
          context.requestCommand("lineBreak", "api");
        },
      },
      {
        name: "mutate after request",
        handle: (_action, context) => {
          context.requestSpace("api");
          context.setPendingContributions([]);
        },
      },
      {
        name: "invalid contribution",
        handle: (_action, context) =>
          context.setPendingContributions([{ id: "", dot: 1, source: "api" }]),
      },
      {
        name: "non iterable",
        handle: (_action, context) =>
          context.setPendingContributions({
            [Symbol.iterator]() {
              throw new Error("not iterable");
            },
          } as never),
      },
    ];
    for (const [index, entry] of cases.entries()) {
      const id: ExtensionId = extensionId(`test:request-${index}`);
      const controller = createBrailleController({
        strategies: [() => basicStrategy(id, { handle: entry.handle })],
      });
      controller.setInputMode(id);
      expect(() =>
        dotDown(controller, 1, `${entry.name}:${index}`),
      ).not.toThrow();
      expect(controller.getState().inputMode).toBe("sequential");
      controller.destroy();
    }

    const emptyRequestId = extensionId("test:empty-request");
    const emptyRequest = createBrailleController({
      strategies: [
        () =>
          basicStrategy(emptyRequestId, {
            handle: (_action, context) => context.requestCommit("api"),
          }),
      ],
    });
    emptyRequest.setInputMode(emptyRequestId);
    dotDown(emptyRequest, 1, "empty-request:1");
    expect(emptyRequest.getState().inputMode).toBe(emptyRequestId);
    emptyRequest.destroy();
  });
});

describe("controller structural operations", () => {
  it("bounds diagnostic-listener reentry during a structural hook", () => {
    const id = extensionId("test:diagnostic-hook");
    const controller = createBrailleController({
      strategies: [
        () => ({
          id,
          activate: (context) => {
            context.reportDiagnostic({
              severity: "warning",
              code: id,
              message: "hook diagnostic",
            });
          },
          handle: () => {},
          deactivate: () => {},
          reset: () => {},
          destroy: () => {},
        }),
      ],
    });
    const diagnostics: string[] = [];
    controller.subscribeDiagnostic((diagnostic) => {
      diagnostics.push(String(diagnostic.code));
      try {
        controller.dispatch({ type: "space-request", source: "api" });
      } catch (error) {
        expect(error).toBeInstanceOf(BrailleInputException);
      }
    });
    controller.setInputMode(id);
    expect(diagnostics).toEqual([id, "INVALID_ACTION"]);
    controller.destroy();
  });

  it("handles activation loss, queued operations, and structural-hook mutation", () => {
    const controller = createBrailleController({ inputMode: "chord" });
    dotDown(controller, 1, "chord:1");
    asInternalController(controller).__handleActivationLost("hidden");
    expect(controller.getState().pendingDots).toEqual([]);
    asInternalController(controller).__handleActivationLost("activation-lost");
    controller.destroy();
    asInternalController(controller).__handleActivationLost("hidden");

    let callbackTransaction = false;
    let mutationRejected = false;
    const observed = createBrailleController({
      onStateChange: () => {
        callbackTransaction =
          asInternalController(observed).__isInTransaction();
        try {
          observed.enable();
        } catch (error) {
          mutationRejected = error instanceof BrailleInputException;
        }
      },
    });
    observed.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "observed:1",
      source: "api",
    });
    expect(callbackTransaction).toBe(true);
    expect(mutationRejected).toBe(true);
    observed.destroy();

    const hookId = extensionId("test:hook");
    const hooked = createBrailleController({
      strategies: [
        () =>
          basicStrategy(hookId, {
            activate: () =>
              hooked.dispatch({ type: "space-request", source: "api" }),
          }),
      ],
    });
    hooked.setInputMode(hookId);
    expect(hooked.getState().inputMode).toBe("sequential");
    hooked.destroy();
  });
});
