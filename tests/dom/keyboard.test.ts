// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { attachKeyboard } from "../../src/adapters/keyboard.js";
import { createBrailleController } from "../../src/core/controller.js";

describe("keyboard adapter", () => {
  it("drains controller reentry after a top-level adapter diagnostic", () => {
    const outputs: string[] = [];
    const controller = createBrailleController({
      onDiagnostic: (diagnostic) => {
        if (diagnostic.code !== "DOUBLE_WRITE_RISK") return;
        controller.dispatch({
          type: "dot-down",
          dot: 1,
          inputId: "diagnostic-reentry:1",
          source: "api",
        });
        controller.dispatch({
          type: "dot-up",
          dot: 1,
          inputId: "diagnostic-reentry:1",
          source: "api",
        });
        controller.commitPending();
      },
      onOutput: (action) => {
        if (action.kind === "braille") outputs.push(action.char);
      },
    });
    const attachment = attachKeyboard(controller, document, {
      activation: "always",
      preventDefault: "never",
    });
    expect(outputs).toEqual(["⠁"]);
    attachment.detach();
    controller.destroy();
  });

  it("uses physical codes, ignores repeats, and distinguishes NumpadEnter", () => {
    const controller = createBrailleController();
    const attachment = attachKeyboard(controller, document, {
      activation: "always",
    });
    const event = new KeyboardEvent("keydown", {
      code: "KeyF",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyF",
        repeat: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
    );
    expect(controller.getState().pressedInputIds).toEqual([]);
    expect(controller.getState().pendingDots).toEqual([1]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(controller.getState().pendingDots).toEqual([1]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "NumpadEnter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(controller.getState().pendingDots).toEqual([]);
    attachment.detach();
    controller.destroy();
  });

  it("ignores a repeat-only dot key and does not leave a pressed id", () => {
    const controller = createBrailleController();
    const attachment = attachKeyboard(controller, document, {
      activation: "always",
    });
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyF",
        repeat: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
    );
    expect(controller.getState().pendingDots).toEqual([]);
    expect(controller.getState().pressedInputIds).toEqual([]);
    attachment.detach();
    controller.destroy();
  });

  it("recomputes activation transitions and treats an empty patch as a no-op", () => {
    const controller = createBrailleController();
    const attachment = attachKeyboard(controller, document, {
      activation: "manual",
    });
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
    );
    expect(controller.getState().pendingDots).toEqual([]);
    attachment.updateOptions({ activation: "always" });
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
    );
    attachment.updateOptions({});
    expect(controller.getState().pressedInputIds).toEqual([
      expect.stringContaining("KeyF"),
    ]);
    document.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
    );
    expect(controller.getState().pendingDots).toEqual([1]);
    attachment.updateOptions({ activation: "manual" });
    controller.cancelPending();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }),
    );
    expect(controller.getState().pendingDots).toEqual([]);
    attachment.activate();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyD", bubbles: true }),
    );
    expect(controller.getState().pendingDots).toEqual([2]);
    attachment.detach();
    controller.destroy();
  });

  it("keeps a chord pressed across a semantically empty options update", () => {
    const controller = createBrailleController({ inputMode: "chord" });
    const attachment = attachKeyboard(controller, document, {
      activation: "always",
    });
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
    );
    attachment.updateOptions({});
    expect(controller.getState().pressedInputIds).toHaveLength(1);
    document.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
    );
    expect(controller.getState().pendingDots).toEqual([]);
    attachment.detach();
    controller.destroy();
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
    ["Alt", { altKey: true }],
    ["composing event", { isComposing: true }],
  ])("cancels a tracked keyup filtered by %s", (_label, init) => {
    for (const inputMode of ["sequential", "chord"] as const) {
      const outputs: string[] = [];
      const controller = createBrailleController({
        inputMode,
        onOutput: (action) => outputs.push(action.kind),
      });
      const attachment = attachKeyboard(controller, document, {
        activation: "always",
      });
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keyup", {
          code: "KeyF",
          bubbles: true,
          ...init,
        }),
      );
      expect(controller.getState().pressedInputIds).toEqual([]);
      expect(controller.getState().chordInProgress).toBe(false);
      expect(controller.getState().pendingDots).toEqual(
        inputMode === "sequential" ? [1] : [],
      );
      expect(outputs).toEqual([]);
      attachment.detach();
      controller.destroy();
    }
  });

  it.each(["AltGraph", "filter false", "filter throw"])(
    "cancels a tracked keyup after %s",
    (scenario) => {
      const controller = createBrailleController({ inputMode: "chord" });
      const attachment = attachKeyboard(controller, document, {
        activation: "always",
        ...(scenario === "filter false"
          ? {
              keyboardFilter: (event: KeyboardEvent) =>
                event.type === "keydown",
            }
          : scenario === "filter throw"
            ? {
                keyboardFilter: (event: KeyboardEvent) => {
                  if (event.type === "keyup") throw new Error("filter");
                  return true;
                },
              }
            : {}),
      });
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
      );
      const keyup = new KeyboardEvent("keyup", {
        code: "KeyF",
        bubbles: true,
      });
      if (scenario === "AltGraph")
        Object.defineProperty(keyup, "getModifierState", {
          value: (name: string) => name === "AltGraph",
        });
      document.dispatchEvent(keyup);
      expect(controller.getState().pressedInputIds).toEqual([]);
      expect(controller.getState().chordInProgress).toBe(false);
      expect(controller.getState().pendingDots).toEqual([]);
      attachment.detach();
      controller.destroy();
    },
  );

  it("clears tracked input when composition starts after keydown", () => {
    const controller = createBrailleController({ inputMode: "chord" });
    const attachment = attachKeyboard(controller, document, {
      activation: "always",
    });
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
    );
    document.dispatchEvent(new CompositionEvent("compositionstart"));
    document.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
    );
    expect(controller.getState().pressedInputIds).toEqual([]);
    expect(controller.getState().chordInProgress).toBe(false);
    expect(controller.getState().pendingDots).toEqual([]);
    attachment.detach();
    controller.destroy();
  });
});
