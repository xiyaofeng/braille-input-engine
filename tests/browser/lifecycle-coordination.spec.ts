import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { expect, test } from "@playwright/test";
import type * as Suite from "../fixtures/lifecycle-suite.js";
import type * as Core from "../../src/index.js";
import type * as Adapters from "../../src/entries/adapters.js";

type Api = typeof Core & typeof Adapters;
const suite = buildSync({
  entryPoints: ["tests/fixtures/lifecycle-suite.ts"],
  bundle: true,
  external: ["/dist/*"],
  format: "iife",
  globalName: "LifecycleTests",
  write: false,
}).outputFiles[0]!.text;
for (const format of ["esm", "browser", "iife"] as const) {
  test(`lifecycle and subscription rules in ${format}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://lifecycle.test/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        contentType: path === "/" ? "text/html" : "text/javascript",
        body:
          path === "/"
            ? "<!doctype html><body></body>"
            : path === "/suite.js"
              ? suite
              : readFileSync(resolve(`.${path}`)),
      });
    });
    await page.goto("http://lifecycle.test/");
    await page.addScriptTag({ url: "/suite.js" });
    if (format === "iife")
      await page.addScriptTag({ url: "/dist/braille-input.iife.min.js" });
    const result = await page.evaluate(async (format) => {
      const w = window as typeof window & {
        LifecycleTests: typeof Suite;
        BrailleInput: Api;
      };
      let api: Api;
      if (format === "iife") api = w.BrailleInput;
      else if (format === "browser")
        api = (await import("/dist/browser.js" as string)) as Api;
      else
        api = {
          ...((await import("/dist/core.js" as string)) as typeof Core),
          ...((await import("/dist/adapters.js" as string)) as typeof Adapters),
        };
      return {
        lifecycle: await w.LifecycleTests.lifecycleCoordinationCases(api),
        notifications: w.LifecycleTests.notificationIdentityCases(api),
      };
    }, format);
    expect(result.lifecycle.count).toBe(576);
    expect(result.lifecycle.failures).toEqual([]);
    expect(result.notifications).toEqual([]);
    expect(errors).toEqual([]);
  });
}
