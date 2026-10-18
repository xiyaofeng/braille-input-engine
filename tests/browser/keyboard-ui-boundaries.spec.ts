import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type * as Fixture from "../fixtures/keyboard-ui-boundaries.js";
import {
  uiShapes,
  uiControls,
  type UIApi,
} from "../fixtures/keyboard-ui-boundaries.js";

declare global {
  interface Window {
    KeyboardUI: typeof Fixture;
    keyboardUIApi: UIApi;
    keyboardUIProbe: ReturnType<typeof Fixture.setupKeyboardUI>;
  }
}
const suite = buildSync({
  entryPoints: ["tests/fixtures/keyboard-ui-boundaries.ts"],
  bundle: true,
  format: "iife",
  globalName: "KeyboardUI",
  write: false,
}).outputFiles[0]!.text;
const source = buildSync({
  stdin: {
    contents:
      'export * from "./src/index.ts"; export * from "./src/entries/adapters.ts"; export * from "./src/ui/default-ui.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  write: false,
}).outputFiles[0]!.text;
async function load(page: Page, format: string) {
  await page.route("http://keyboard-ui.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: path === "/" ? "text/html" : "text/javascript",
      body:
        path === "/"
          ? "<!doctype html><body></body>"
          : path === "/suite.js"
            ? suite
            : path === "/source.js"
              ? source
              : readFileSync(resolve(`.${path}`)),
    });
  });
  await page.goto("http://keyboard-ui.test/");
  await page.addScriptTag({ url: "/suite.js" });
  if (format === "iife")
    await page.addScriptTag({ url: "/dist/braille-input.iife.min.js" });
  await page.evaluate(async (format) => {
    window.keyboardUIApi =
      format === "source"
        ? ((await import("/source.js" as string)) as UIApi)
        : format === "iife"
          ? (window.BrailleInput as UIApi)
          : format === "browser"
            ? ((await import("/dist/browser.js" as string)) as UIApi)
            : ({
                ...(await import("/dist/core.js" as string)),
                ...(await import("/dist/adapters.js" as string)),
                ...(await import("/dist/default-ui.js" as string)),
              } as UIApi);
  }, format);
}

for (const format of ["source", "esm", "browser", "iife"]) {
  test(`UI exclusion and admission matrix: ${format}`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await load(page, format);
    const result = await page.evaluate(() =>
      window.KeyboardUI.keyboardUIBoundaryCases(window.keyboardUIApi),
    );
    expect(result.count).toBe(5760);
    expect(result.failures).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`trusted default UI keyboard actions: ${format}`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await load(page, format);
    for (const shape of uiShapes)
      for (const control of uiControls)
        for (const key of ["Space", "Enter", "d"]) {
          const label = JSON.stringify({ shape, control, key });
          await page.evaluate(
            ({ shape, control }) => {
              const p = window.KeyboardUI.setupKeyboardUI(
                window.keyboardUIApi,
                shape,
              );
              window.keyboardUIProbe = p;
              p.seed(control);
            },
            { shape, control },
          );
          await page.keyboard.press(key);
          // Native select popups differ across engines. Dismiss without
          // selecting another mode, then inspect adapter state and events.
          if (control === "mode" && (key === "Space" || key === "Enter"))
            await page.keyboard.press("Escape");
          const result = await page.evaluate(() =>
            window.keyboardUIProbe.snapshot(),
          );
          const activates =
            control !== "mode" && (key === "Space" || key === "Enter");
          expect(result.filters, label).toEqual([]);
          expect(result.diagnostics, label).toEqual([]);
          expect(result.pressed, label).toEqual([]);
          expect(result.events.length, label).toBeGreaterThan(0);
          expect(
            result.events.every((e) => e.trusted),
            label,
          ).toBe(true);
          expect(
            result.events.every((e) => !e.prevented),
            label,
          ).toBe(true);
          if (control !== "mode")
            expect(result.clicks, label).toBe(activates ? 1 : 0);
          const output =
            activates && (control === "commit" || control === "retry")
              ? ["⠁"]
              : [];
          expect(result.outputs, label).toEqual(output);
          const clears =
            activates &&
            ["clear", "commit", "retry", "discard", "backspace"].includes(
              control,
            );
          expect(result.pending, label).toEqual(
            clears ? [] : activates && control === "dot" ? [1, 2] : [1],
          );
          expect(result.retry, label).toBe(
            !activates && (control === "retry" || control === "discard"),
          );
          expect(result.mode, label).toBe("sequential");
          await page.evaluate(() => window.keyboardUIProbe.dispose());
        }
    for (const shape of uiShapes) {
      await page.evaluate((shape) => {
        const p = window.KeyboardUI.setupKeyboardUI(
          window.keyboardUIApi,
          shape,
        );
        window.keyboardUIProbe = p;
        p.ordinary.focus();
      }, shape);
      await page.keyboard.press("f");
      await page.keyboard.press("Space");
      const result = await page.evaluate(() =>
        window.keyboardUIProbe.snapshot(),
      );
      expect(result.outputs).toEqual(["⠁"]);
      expect(result.pressed).toEqual([]);
      expect(result.pending).toEqual([]);
      expect(result.filters).toEqual(["keydown", "keyup", "keydown"]);
      expect(result.events).toHaveLength(4);
      expect(result.events.every((e) => e.trusted)).toBe(true);
      expect(
        result.events
          .filter((e) => e.type === "keydown")
          .every((e) => e.prevented),
      ).toBe(true);
      await page.evaluate(() => window.keyboardUIProbe.dispose());
    }
    expect(errors).toEqual([]);
  });
}
