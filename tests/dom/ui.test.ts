// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDefaultBrailleUI } from "../../src/ui/default-ui.js";
import { createBrailleController } from "../../src/core/controller.js";
import { attachKeyboard } from "../../src/adapters/keyboard.js";
import { BrailleInputException } from "../../src/core/types.js";

describe("default UI", () => {
  it("renders accessible dot buttons and toggles through click", () => {
    const controller = createBrailleController();
    const host = document.createElement("div");
    document.body.append(host);
    const ui = createDefaultBrailleUI(controller, host, { lang: "zh-CN" });
    const dot = host.querySelector<HTMLButtonElement>('[data-braille-dot="1"]');
    expect(dot?.getAttribute("aria-pressed")).toBe("false");
    dot?.click();
    expect(controller.getState().pendingDots).toEqual([1]);
    expect(dot?.getAttribute("aria-pressed")).toBe("true");
    ui.detach();
    controller.destroy();
  });

  it("clears a conflicted Cell and does not expose retry", () => {
    const controller = createBrailleController({
      outputSink: { write: () => "conflicted" },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const ui = createDefaultBrailleUI(controller, host, { lang: "zh-CN" });
    host.querySelector<HTMLButtonElement>('[data-braille-dot="1"]')?.click();
    host.querySelector<HTMLButtonElement>('[part~="commit-button"]')?.click();
    expect(controller.getState().pendingDots).toEqual([]);
    expect(controller.getState().awaitingRetry).toBe(false);
    expect(
      host.querySelector<HTMLButtonElement>('[part~="retry-button"]')?.hidden,
    ).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>('[part~="discard-button"]')?.hidden,
    ).toBe(true);
    expect([...host.querySelectorAll("p")].at(-1)?.textContent).toContain(
      "检查目标",
    );
    ui.detach();
    controller.destroy();
  });

  it("only reports rollover when all six test keys overlap in time", () => {
    const controller = createBrailleController();
    const keyboard = attachKeyboard(controller, document, {
      activation: "always",
    });
    const host = document.createElement("div");
    document.body.append(host);
    const ui = createDefaultBrailleUI(controller, host, {
      keyboardBindings: keyboard,
      chordTestTimeoutMs: 1000,
    });
    const start = host.querySelector<HTMLButtonElement>(
      '[part~="chord-test"] button',
    );
    const result = host.querySelector<HTMLElement>(
      '[part~="chord-test-result"]',
    );
    expect(start).not.toBeNull();
    start?.click();
    for (const code of ["KeyF", "KeyD", "KeyS", "KeyJ", "KeyK", "KeyL"]) {
      document.dispatchEvent(new KeyboardEvent("keydown", { code }));
      document.dispatchEvent(new KeyboardEvent("keyup", { code }));
    }
    expect(result?.textContent).toContain("Not reliably supported");

    start?.click();
    const codes = ["KeyF", "KeyD", "KeyS", "KeyJ", "KeyK", "KeyL"];
    for (const code of codes)
      document.dispatchEvent(new KeyboardEvent("keydown", { code }));
    for (const code of codes)
      document.dispatchEvent(new KeyboardEvent("keyup", { code }));
    expect(result?.textContent).toContain("Supported");
    ui.detach();
    keyboard.detach();
    controller.destroy();
  });

  it("applies live mode, chord test, and binding updates without leaked tests", () => {
    const controller = createBrailleController();
    const keyboard = attachKeyboard(controller, document, {
      activation: "always",
    });
    const replacement = attachKeyboard(controller, document, {
      activation: "always",
      keyboard: false,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const ui = createDefaultBrailleUI(controller, host, {
      keyboardBindings: keyboard,
    });
    ui.updateOptions({ liveMode: "quiet", chordTestTimeoutMs: 2000 });
    expect(host.querySelector('[aria-live="off"]')).not.toBeNull();
    ui.updateOptions({ keyboardBindings: replacement });
    expect(host.querySelectorAll('[part~="chord-test"]').length).toBe(1);
    ui.updateOptions({ keyboardBindings: undefined });
    expect(host.querySelector('[part~="chord-test"]')).toBeNull();
    ui.detach();
    keyboard.detach();
    replacement.detach();
    controller.destroy();
  });

  it("rolls back every field when a staged binding update is invalid", () => {
    const controller = createBrailleController();
    const keyboard = attachKeyboard(controller, document, {
      activation: "always",
    });
    const replacement = attachKeyboard(controller, document, {
      activation: "always",
      keyboard: false,
      numpad: false,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const ui = createDefaultBrailleUI(controller, host, {
      keyboardBindings: keyboard,
    });
    const invalidCodes = [
      "KeyF",
      "KeyD",
      "KeyS",
      "KeyJ",
      "KeyK",
      "KeyL",
    ] as const;
    expect(() =>
      ui.updateOptions({
        eventComposed: false,
        keyboardBindings: replacement,
        chordTestCodes: invalidCodes,
      }),
    ).toThrow(BrailleInputException);
    expect(host.querySelectorAll('[part~="chord-test"]').length).toBe(1);
    const events: Event[] = [];
    host.addEventListener("braille-input", (event) => events.push(event));
    const dot = host.querySelector<HTMLButtonElement>('[data-braille-dot="1"]');
    dot?.click();
    controller.commitPending();
    expect(events.at(-1)?.composed).toBe(true);
    ui.detach();
    keyboard.detach();
    replacement.detach();
    controller.destroy();
  });
});
