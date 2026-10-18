import { expect, it } from "vitest";
import { createBrailleController } from "../../src/core/controller.js";
import { asInternalController } from "../../src/core/internal.js";
import { extensionId } from "../../src/core/types.js";

it("terminates a frozen retry on strategy reset failure, with no duplicate accepted output", () => {
  const id = extensionId("test:retry-fault");
  let fault = false,
    accepts = false;
  const attempts: string[] = [],
    deliveries: string[] = [],
    diagnostics: string[] = [];
  const c = createBrailleController({
    inputMode: id,
    strategies: [
      () => ({
        id,
        activate() {},
        deactivate() {},
        destroy() {},
        reset(_reason, ctx) {
          ctx.setPendingContributions([]);
          if (fault) throw new Error("reset");
        },
        handle(a, ctx) {
          if (a.type === "dot-down")
            ctx.setPendingContributions([
              { id: a.inputId, dot: a.dot, source: a.source },
            ]);
          if (a.type === "commit-request") ctx.requestCommit(a.source);
        },
      }),
    ],
    outputSink: {
      write(a) {
        if (a.kind === "braille") attempts.push(a.char);
        return accepts ? "accepted" : "rejected";
      },
    },
    onOutput: (_a, d) => deliveries.push(d),
    onDiagnostic: (d) => diagnostics.push(d.code),
  });
  c.dispatch({ type: "dot-down", dot: 1, inputId: "one", source: "api" });
  c.commitPending();
  asInternalController(c).__handleActivationLost("hidden");
  expect(c.getState().pendingDots).toEqual([1]);
  expect(c.getState().awaitingRetry).toBe(true);
  fault = true;
  asInternalController(c).__handleActivationLost("activation-lost");
  expect(c.getState().inputMode).toBe("sequential");
  expect(c.getState().pendingDots).toEqual([]);
  expect(c.getState().awaitingRetry).toBe(false);
  expect(diagnostics).toEqual(["STRATEGY_ERROR"]);
  accepts = true;
  c.commitPending();
  expect(attempts).toEqual(["⠁"]);
  c.dispatch({ type: "dot-down", dot: 2, inputId: "two", source: "api" });
  c.commitPending();
  c.commitPending();
  expect(attempts).toEqual(["⠁", "⠂"]);
  expect(deliveries).toEqual(["rejected", "accepted"]);
  c.destroy();
});

it.each(["discard", "reset", "disable-discard", "mode", "destroy"] as const)(
  "explicit %s abandons the frozen Cell",
  (operation) => {
    const c = createBrailleController({
      inputMode: "chord",
      outputSink: { write: () => "rejected" },
    });
    c.dispatch({ type: "dot-down", dot: 1, inputId: "one", source: "api" });
    c.dispatch({ type: "dot-up", dot: 1, inputId: "one", source: "api" });
    expect(c.getState().awaitingRetry).toBe(true);
    if (operation === "discard") c.cancelPending();
    else if (operation === "disable-discard")
      c.disable({ cancelPending: true });
    else if (operation === "mode") c.setInputMode("sequential");
    else c[operation]();
    expect(c.getState().awaitingRetry).toBe(false);
    expect(c.getState().pendingDots).toEqual([]);
    c.destroy();
  },
);
