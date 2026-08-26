import { describe, expect, it } from "vitest";
import { createBrailleController } from "../../src/core/controller.js";

describe("lifecycle model", () => {
  it("preserves Sequential pending across disable and clears on reset", () => {
    const controller = createBrailleController();
    controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "api:1",
      source: "api",
    });
    controller.disable();
    expect(controller.getState().pendingDots).toEqual([1]);
    controller.enable();
    controller.reset();
    expect(controller.getState().pendingDots).toEqual([]);
    controller.destroy();
    expect(controller.getState().destroyed).toBe(true);
  });
});
