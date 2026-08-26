import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("demo fixture has no automated axe violations", async ({ page }) => {
  await page.goto("about:blank");
  await page.setContent(
    '<html lang="zh-CN"><head><title>Braille Input Engine Demo</title></head><body><main><h1>Braille Input Engine</h1><label for="demo-output">输出目标</label><textarea id="demo-output"></textarea><div id="braille-ui"></div></main></body></html>',
  );
  await page.addScriptTag({ path: "dist/braille-input.iife.min.js" });
  await page.evaluate(() => {
    const api = (
      globalThis as typeof globalThis & {
        BrailleInput?: {
          createBrailleController: () => unknown;
          attachBrailleEditable: (
            controller: unknown,
            target: Element,
          ) => {
            detach(): void;
          };
          attachKeyboard: (
            controller: unknown,
            scope: Document,
            options: { activation: "always" },
          ) => { detach(): void };
          createDefaultBrailleUI: (
            controller: unknown,
            host: HTMLElement,
            options: { keyboardBindings: unknown },
          ) => { detach(): void };
        };
      }
    ).BrailleInput;
    const target = document.querySelector("#demo-output");
    const host = document.querySelector("#braille-ui");
    if (
      !api ||
      !(target instanceof HTMLTextAreaElement) ||
      !(host instanceof HTMLElement)
    )
      throw new Error("Accessibility fixture setup failed.");
    const controller = api.createBrailleController();
    const editable = api.attachBrailleEditable(controller, target);
    const keyboard = api.attachKeyboard(controller, document, {
      activation: "always",
    });
    const ui = api.createDefaultBrailleUI(controller, host, {
      keyboardBindings: keyboard,
    });
    Object.assign(globalThis, {
      __brailleAccessibilityCleanup: () => {
        ui.detach();
        keyboard.detach();
        editable.detach();
        (controller as { destroy(): void }).destroy();
      },
    });
  });
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __brailleAccessibilityCleanup?: () => void;
      }
    ).__brailleAccessibilityCleanup?.();
  });
});
