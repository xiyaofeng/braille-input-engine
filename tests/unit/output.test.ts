import { describe, expect, it } from "vitest";
import { createBrailleController } from "../../src/core/controller.js";

function dot(
  controller: ReturnType<typeof createBrailleController>,
  dotValue: 1 | 2 | 3 | 4 | 5 | 6,
): void {
  const id = `api:${dotValue}`;
  controller.dispatch({
    type: "dot-down",
    dot: dotValue,
    inputId: id,
    source: "api",
  });
  controller.dispatch({
    type: "dot-up",
    dot: dotValue,
    inputId: id,
    source: "api",
  });
}

describe("output transaction delivery", () => {
  it("freezes a rejected Cell and retries only through commit", () => {
    let attempts = 0;
    const controller = createBrailleController({
      outputSink: { write: () => (++attempts === 1 ? "rejected" : "accepted") },
    });
    dot(controller, 1);
    controller.commitPending();
    expect(controller.getState().awaitingRetry).toBe(true);
    dot(controller, 2);
    expect(controller.getState().pendingDots).toEqual([1]);
    controller.commitPending();
    expect(attempts).toBe(2);
    expect(controller.getState().pendingDots).toEqual([]);
    controller.destroy();
  });

  it("faults a sink that throws and does not call it again", () => {
    let attempts = 0;
    const diagnostics: string[] = [];
    const sink = {
      write: () => {
        attempts += 1;
        throw new Error("boom");
      },
    };
    const controller = createBrailleController({
      outputSink: sink,
      onDiagnostic: (diagnostic) => diagnostics.push(String(diagnostic.code)),
    });
    dot(controller, 1);
    controller.commitPending();
    expect(controller.getState().outputSinkState).toBe("faulted");
    expect(controller.getState().pendingDots).toEqual([]);
    expect(controller.getState().pressedInputIds).toEqual([]);
    expect(controller.getState().awaitingRetry).toBe(false);
    dot(controller, 2);
    controller.commitPending();
    expect(attempts).toBe(1);
    expect(diagnostics).toContain("OUTPUT_SINK_ERROR");
    expect(diagnostics).toContain("OUTPUT_REJECTED");
    controller.clearOutputSink(sink);
    controller.destroy();
  });

  it.each([
    ["explicit conflict", () => "conflicted" as const],
    ["thenable", () => Promise.resolve("accepted") as never],
    ["invalid return", () => "invalid" as never],
  ])("clears a Cell after %s", (_label, write) => {
    const controller = createBrailleController({ outputSink: { write } });
    controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "conflict:1",
      source: "api",
    });
    controller.commitPending();
    expect(controller.getState().pendingDots).toEqual([]);
    expect(controller.getState().pressedInputIds).toEqual([]);
    expect(controller.getState().awaitingRetry).toBe(false);
    controller.destroy();
  });

  it("keeps Space outputs out of the Cell retry gate", () => {
    const deliveries: string[] = [];
    const controller = createBrailleController({
      outputSink: { write: () => "rejected" },
      onOutput: (_action, delivery) => deliveries.push(delivery),
    });
    controller.dispatch({ type: "space-request", source: "api" });
    expect(deliveries).toEqual(["rejected"]);
    expect(controller.getState().awaitingRetry).toBe(false);
    controller.destroy();
  });

  it("queues output-listener reentry in FIFO order", () => {
    const outputs: string[] = [];
    let reentered = false;
    const controller = createBrailleController({
      onOutput: (action) => {
        if (action.kind !== "braille") return;
        outputs.push(action.char);
        if (reentered) return;
        reentered = true;
        controller.dispatch({
          type: "dot-down",
          dot: 2,
          inputId: "reentry:2",
          source: "api",
        });
        controller.dispatch({
          type: "dot-up",
          dot: 2,
          inputId: "reentry:2",
          source: "api",
        });
        controller.commitPending();
      },
    });
    controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "reentry:1",
      source: "api",
    });
    controller.dispatch({
      type: "dot-up",
      dot: 1,
      inputId: "reentry:1",
      source: "api",
    });
    controller.commitPending();
    expect(outputs).toEqual(["⠁", "⠂"]);
    controller.destroy();
  });

  it("drains state-listener reentry before setOutputSink returns", () => {
    const outputs: string[] = [];
    const controller = createBrailleController();
    let armed = false;
    controller.subscribeState((state) => {
      if (!armed || state.outputSinkState !== "ready") return;
      controller.dispatch({
        type: "dot-down",
        dot: 1,
        inputId: "sink-reentry:1",
        source: "api",
      });
      controller.dispatch({
        type: "dot-up",
        dot: 1,
        inputId: "sink-reentry:1",
        source: "api",
      });
      controller.commitPending();
      armed = false;
    });
    armed = true;
    const dispose = controller.setOutputSink({
      write: (action) => {
        if (action.kind === "braille") outputs.push(action.char);
        return "accepted";
      },
    });
    expect(outputs).toEqual(["⠁"]);
    expect(controller.getState().pendingDots).toEqual([]);
    dispose();
    controller.destroy();
  });
});
