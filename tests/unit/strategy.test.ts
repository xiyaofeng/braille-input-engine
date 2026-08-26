import { describe, expect, it } from "vitest";
import { createBrailleController } from "../../src/core/controller.js";
import { extensionId, type ExtensionId } from "../../src/core/types.js";

describe("strategy extension contract", () => {
  it("does not deactivate a custom strategy that failed initial activation", () => {
    const id = extensionId("test:initial-activate-failure");
    let deactivations = 0;
    const controller = createBrailleController({
      inputMode: id,
      strategies: [
        () => ({
          id,
          activate: () => {
            throw new Error("activate");
          },
          handle: () => {},
          deactivate: () => {
            deactivations += 1;
          },
          reset: () => {},
          destroy: () => {},
        }),
      ],
    });
    expect(controller.getState().inputMode).toBe("sequential");
    expect(deactivations).toBe(0);
    controller.destroy();
  });

  it("does not deactivate a custom strategy that failed mode-switch activation", () => {
    const id = extensionId("test:switch-activate-failure");
    let deactivations = 0;
    const controller = createBrailleController({
      strategies: [
        () => ({
          id,
          activate: () => {
            throw new Error("activate");
          },
          handle: () => {},
          deactivate: () => {
            deactivations += 1;
          },
          reset: () => {},
          destroy: () => {},
        }),
      ],
    });
    controller.setInputMode(id);
    expect(controller.getState().inputMode).toBe("sequential");
    expect(deactivations).toBe(0);
    controller.destroy();
  });

  it("accepts a custom strategy factory and rejects invalid ids", () => {
    const id = extensionId("test:sample");
    const controller = createBrailleController({
      strategies: [
        () => ({
          id,
          activate: () => {},
          handle: (_action, context) => {
            if (context.getPendingContributions().length > 0)
              context.requestCommit("api");
          },
          deactivate: () => {},
          reset: () => {},
          destroy: () => {},
        }),
      ],
    });
    controller.setInputMode(id);
    expect(controller.getState().inputMode).toBe(id);
    expect(() => extensionId("Bad:ID")).toThrow();
    controller.destroy();
  });

  it("resets every instantiated strategy in registration order", () => {
    const firstId = extensionId("test:first-reset");
    const secondId = extensionId("test:second-reset");
    const resetCalls: string[] = [];
    const make = (id: ExtensionId) => () => ({
      id,
      activate: () => {},
      handle: () => {},
      deactivate: () => {},
      reset: () => resetCalls.push(id),
      destroy: () => {},
    });
    const controller = createBrailleController({
      inputMode: firstId,
      strategies: [make(firstId), make(secondId)],
    });
    controller.reset();
    expect(resetCalls).toEqual([firstId, secondId]);
    controller.destroy();
  });

  it("deactivates a failing custom strategy before sequential fallback", () => {
    const id = extensionId("test:throw-handle");
    let deactivations = 0;
    const controller = createBrailleController({
      inputMode: id,
      strategies: [
        () => ({
          id,
          activate: () => {},
          handle: () => {
            throw new Error("handle failure");
          },
          deactivate: () => {
            deactivations += 1;
          },
          reset: () => {},
          destroy: () => {},
        }),
      ],
    });
    controller.setInputMode(id);
    controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "throw-handle:1",
      source: "api",
    });
    expect(deactivations).toBe(1);
    expect(controller.getState().inputMode).toBe("sequential");
    controller.destroy();
  });

  it("continues resetting other strategies when the active reset fails", () => {
    const failingId = extensionId("test:throw-reset");
    const healthyId = extensionId("test:healthy-reset");
    let deactivations = 0;
    let healthyResets = 0;
    const controller = createBrailleController({
      inputMode: failingId,
      strategies: [
        () => ({
          id: failingId,
          activate: () => {},
          handle: () => {},
          deactivate: () => {
            deactivations += 1;
          },
          reset: () => {
            throw new Error("reset failure");
          },
          destroy: () => {},
        }),
        () => ({
          id: healthyId,
          activate: () => {},
          handle: () => {},
          deactivate: () => {},
          reset: () => {
            healthyResets += 1;
          },
          destroy: () => {},
        }),
      ],
    });
    controller.reset();
    expect(healthyResets).toBe(1);
    expect(deactivations).toBe(1);
    expect(controller.getState().inputMode).toBe("sequential");
    controller.destroy();
  });
});
