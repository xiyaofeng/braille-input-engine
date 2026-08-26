import { describe, expect, it } from "vitest";
import * as core from "../../src/index.js";

describe("public API contract", () => {
  it("exports the headless encoder and controller without DOM setup", () => {
    expect(core.dotsToBraille([1, 2, 4])).toBe("⠋");
    expect(core.createBrailleController().getState().inputMode).toBe(
      "sequential",
    );
  });
});
