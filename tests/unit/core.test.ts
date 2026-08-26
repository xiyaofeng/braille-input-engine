import { describe, expect, it } from "vitest";
import { createBrailleController } from "../../src/core/controller.js";
import {
  brailleToCodePoint,
  brailleToDots,
  dotsToBraille,
  dotsToMask,
} from "../../src/core/unicode.js";
import type { BrailleStateSnapshot } from "../../src/core/types.js";

describe("Unicode six-dot encoder", () => {
  it("encodes all 64 masks into the Braille block", () => {
    for (let mask = 0; mask < 64; mask += 1) {
      const dots = [];
      for (let bit = 0; bit < 6; bit += 1)
        if (mask & (1 << bit)) dots.push(bit + 1);
      const pattern = dotsToBraille(dots);
      expect(pattern.codePointAt(0)).toBe(0x2800 | mask);
      expect(dotsToMask(dots)).toBe(mask);
      expect(brailleToCodePoint(pattern)).toBe(0x2800 | mask);
      expect(brailleToDots(pattern)).toEqual(dots);
    }
  });

  it("deduplicates points and rejects invalid points", () => {
    expect(dotsToBraille([4, 1, 4, 2])).toBe("⠋");
    expect(() => dotsToBraille([0])).toThrow(RangeError);
    expect(() => dotsToBraille([7])).toThrow(RangeError);
    expect(() => brailleToCodePoint("not braille" as never)).toThrow(
      RangeError,
    );
  });
});

describe("Sequential controller", () => {
  it("accepts unordered points, toggles, previews, and commits", () => {
    const outputs: string[] = [];
    const controller = createBrailleController({
      onOutput: (action) =>
        action.kind === "braille" && outputs.push(action.char),
    });
    const stateSnapshots: BrailleStateSnapshot[] = [];
    controller.subscribeState((state) => stateSnapshots.push(state));
    controller.dispatch({
      type: "dot-down",
      dot: 4,
      inputId: "api:a",
      source: "api",
    });
    controller.dispatch({
      type: "dot-up",
      dot: 4,
      inputId: "api:a",
      source: "api",
    });
    controller.dispatch({
      type: "dot-down",
      dot: 1,
      inputId: "api:b",
      source: "api",
    });
    controller.dispatch({
      type: "dot-up",
      dot: 1,
      inputId: "api:b",
      source: "api",
    });
    controller.dispatch({
      type: "dot-down",
      dot: 2,
      inputId: "api:c",
      source: "api",
    });
    controller.dispatch({
      type: "dot-up",
      dot: 2,
      inputId: "api:c",
      source: "api",
    });
    expect(controller.getState().pendingDots).toEqual([1, 2, 4]);
    expect(controller.getState().previewChar).toBe("⠋");
    controller.dispatch({ type: "space-request", source: "api" });
    expect(outputs).toEqual(["⠋"]);
    expect(controller.getState().pendingDots).toEqual([]);
    expect(stateSnapshots.some((state) => state.previewChar === "⠋")).toBe(
      true,
    );
    controller.destroy();
  });

  it("commits the blank Braille Cell only for empty Space", () => {
    const outputs: string[] = [];
    const controller = createBrailleController({
      onOutput: (action) =>
        action.kind === "braille" && outputs.push(action.char),
    });
    controller.dispatch({ type: "space-request", source: "api" });
    expect(outputs).toEqual(["⠀"]);
    controller.dispatch({ type: "commit-request", source: "api" });
    expect(outputs).toEqual(["⠀"]);
    controller.destroy();
  });
});
