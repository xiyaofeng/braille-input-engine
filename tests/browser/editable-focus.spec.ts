import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type * as Fixture from "../fixtures/editable-focus.js";
import { editableLayouts } from "../fixtures/editable-focus.js";
import type { UIApi } from "../fixtures/keyboard-ui-boundaries.js";

declare global {
  interface Window {
    EditableFocus: typeof Fixture;
    editableFocusApi: UIApi;
    editableFocusProbe: ReturnType<typeof Fixture.setupEditableFocus>;
  }
}
const suite = buildSync({
  entryPoints: ["tests/fixtures/editable-focus.ts"],
  bundle: true,
  format: "iife",
  globalName: "EditableFocus",
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
    window.editableFocusApi =
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
  test(`real editable scope and transaction matrix: ${format}`, async ({
    page,
  }) => {
    await load(page, format);
    const result = await page.evaluate(() =>
      window.EditableFocus.editableFocusCases(window.editableFocusApi),
    );
    expect(result.count).toBe(100);
    expect(result.failures).toEqual([]);
  });
  test(`trusted keyboard to editable commit and UI retry: ${format}`, async ({
    page,
  }) => {
    await load(page, format);
    for (const layout of editableLayouts)
      for (const activation of ["focus", "manual", "always"] as const)
        for (const trigger of ["keyboard", "commit", "retry"]) {
          await page.evaluate(
            ({ layout, activation }) => {
              const p = window.EditableFocus.setupEditableFocus(
                window.editableFocusApi,
                layout,
                activation,
              );
              window.editableFocusProbe = p;
              const keyboard = window.editableFocusApi.attachKeyboard(
                p.c,
                document,
                { activationGroup: p.group },
              );
              const dispose = p.dispose.bind(p);
              p.dispose = () => {
                keyboard.detach();
                dispose();
              };
              const events: boolean[] = [];
              document.addEventListener(
                "keydown",
                (e) => events.push(e.isTrusted),
                { once: true },
              );
              Object.assign(p, { events });
            },
            { layout, activation },
          );
          await page.keyboard.press("f");
          if (trigger === "retry") {
            await page.evaluate(() => {
              const p = window.editableFocusProbe;
              p.target.readOnly = true;
              p.c.commitPending();
              p.target.readOnly = false;
              p.button("retry").focus();
            });
          } else if (trigger === "commit")
            await page.evaluate(() =>
              window.editableFocusProbe.button("commit").focus(),
            );
          await page.keyboard.press("Space");
          const result = await page.evaluate(() =>
            window.editableFocusProbe.snapshot(),
          );
          expect(result).toEqual({
            text: "L⠁R",
            deliveries:
              trigger === "retry" ? ["rejected", "accepted"] : ["accepted"],
            edits: ["beforeinput", "input"],
            pending: [],
            retry: false,
          });
          expect(
            await page.evaluate(
              () =>
                (window.editableFocusProbe as unknown as { events: boolean[] })
                  .events,
            ),
          ).toEqual([true]);
          await page.evaluate(() => window.editableFocusProbe.dispose());
        }
  });
}
