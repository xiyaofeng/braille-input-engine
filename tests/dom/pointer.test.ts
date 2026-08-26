// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { attachPointer } from "../../src/adapters/pointer.js";
import { createBrailleController } from "../../src/core/controller.js";

function pointerEvent(
  type: string,
  pointerId: number,
  pointerType = "touch",
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    pointerType: { configurable: true, value: pointerType },
    button: { configurable: true, value: 0 },
  });
  return event;
}

describe("pointer adapter", () => {
  it("cancels every pointer when one pointer loses capture", () => {
    const controller = createBrailleController({ inputMode: "chord" });
    const scope = document.createElement("div");
    const dot = document.createElement("button");
    dot.dataset.brailleDot = "1";
    scope.append(dot);
    document.body.append(scope);
    const attachment = attachPointer(controller, scope, {
      activation: "always",
    });
    dot.dispatchEvent(pointerEvent("pointerdown", 1));
    dot.dispatchEvent(pointerEvent("pointerdown", 2));
    expect(controller.getState().pressedInputIds).toHaveLength(2);
    scope.dispatchEvent(pointerEvent("lostpointercapture", 1));
    expect(controller.getState().pressedInputIds).toEqual([]);
    expect(controller.getState().pendingDots).toEqual([]);
    attachment.detach();
    controller.destroy();
    scope.remove();
  });
});
