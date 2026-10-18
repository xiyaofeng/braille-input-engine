// @vitest-environment jsdom
import { expect, it } from "vitest";
import * as core from "../../src/index.js";
import * as adapters from "../../src/entries/adapters.js";
import { activationLossCases } from "../fixtures/activation-loss.js";
import { assertActivationLossResults } from "../fixtures/activation-loss-assertions.js";

it("preserves group callback input and frozen retries across lifecycle operations", async () => {
  // JSDOM does not supply PointerEvent; retain real Event propagation.
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
    }
  }
  const previous = globalThis.PointerEvent;
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    writable: true,
    value: TestPointerEvent,
  });
  try {
    assertActivationLossResults(
      await activationLossCases({ ...core, ...adapters }),
      expect,
    );
  } finally {
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      writable: true,
      value: previous,
    });
  }
});
