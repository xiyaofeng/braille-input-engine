import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { expect, test, type Locator } from "@playwright/test";
import type * as BrowserAPI from "../../src/entries/browser.js";

declare global {
  interface Window {
    pointerOutput: {
      target: HTMLTextAreaElement;
      outside: HTMLInputElement;
      c: BrowserAPI.BrailleInputController;
      deliveries: string[];
      edits: string[];
    };
  }
}
const source = buildSync({
  entryPoints: ["src/entries/browser.ts"],
  bundle: true,
  format: "esm",
  write: false,
}).outputFiles[0]!.text;

for (const gesture of ["mouse", "touch"] as const) {
  test.describe(`output activation: ${gesture}`, () => {
    test.use({ hasTouch: gesture === "touch" });
    const activate = (control: Locator) =>
      gesture === "touch" ? control.tap() : control.click();
    for (const entry of ["source", "standalone", "browser", "auto", "iife"]) {
      test(`native output clicks preserve focus and enforce write guards: ${entry}`, async ({
        page,
        browserName,
      }) => {
        test.skip(
          gesture === "touch" && browserName === "firefox",
          "Firefox does not support touch emulation.",
        );
        await page.route("http://pointer-output.test/**", (route) => {
          const path = new URL(route.request().url()).pathname;
          return route.fulfill({
            contentType: path === "/" ? "text/html" : "text/javascript",
            body:
              path === "/"
                ? '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body></body>'
                : path === "/source.js"
                  ? source
                  : readFileSync(resolve(`.${path}`)),
          });
        });
        for (const scenario of [
          "commit",
          "retry",
          "backspace",
          "clear",
          "discard",
          "outside",
          "blur",
          "cancel",
        ]) {
          // Every scenario starts in a fresh document/custom-elements registry.
          await page.goto("http://pointer-output.test/");
          if (entry === "iife")
            await page.addScriptTag({ url: "/dist/braille-input.iife.min.js" });
          await page.evaluate(
            async ({ entry }) => {
              if (entry === "auto")
                await import("/dist/auto-register.js" as string);
              const api = (
                entry === "iife"
                  ? window.BrailleInput
                  : await import(
                      (entry === "source"
                        ? "/source.js"
                        : "/dist/browser.js") as string
                    )
              ) as typeof BrowserAPI;
              const target = document.createElement("textarea");
              const outside = document.createElement("input");
              target.value = "AB";
              outside.id = "outside";
              document.body.append(target, outside);
              let c: BrowserAPI.BrailleInputController;
              if (entry === "standalone") {
                c = api.createBrailleController();
                const group = api.createActivationGroup(document);
                api.attachBrailleEditable(c, target, {
                  activationGroup: group,
                });
                const mount = document.createElement("section");
                document.body.append(mount);
                api.createDefaultBrailleUI(c, mount, {
                  activationGroup: group,
                });
              } else {
                if (entry !== "auto") api.defineBrailleInput();
                const element = document.createElement(
                  "braille-input",
                ) as InstanceType<typeof api.BrailleInputElement>;
                element.target = target;
                document.body.append(element);
                c = element.controller;
              }
              const deliveries: string[] = [],
                edits: string[] = [];
              c.subscribeOutput((_a, delivery) => deliveries.push(delivery));
              for (const type of ["beforeinput", "input"])
                target.addEventListener(type, () => edits.push(type));
              window.pointerOutput = { target, outside, c, deliveries, edits };
              target.focus();
              target.setSelectionRange(1, 1);
            },
            { entry },
          );
          if (scenario !== "backspace")
            await activate(page.locator('[part~="dot"]').first());
          if (scenario === "retry" || scenario === "discard") {
            await page.evaluate(() => {
              window.pointerOutput.target.addEventListener(
                "beforeinput",
                (e) => e.preventDefault(),
                { once: true },
              );
            });
            await activate(page.locator('[part~="commit-button"]'));
            expect(
              await page.evaluate(() => ({
                text: window.pointerOutput.target.value,
                retry: window.pointerOutput.c.getState().awaitingRetry,
                deliveries: window.pointerOutput.deliveries,
              })),
            ).toEqual({ text: "AB", retry: true, deliveries: ["rejected"] });
          }
          if (scenario === "outside") await activate(page.locator("#outside"));
          if (scenario === "blur" || scenario === "cancel")
            await page.evaluate((scenario) => {
              window.pointerOutput.target.addEventListener(
                "beforeinput",
                (e) => {
                  if (scenario === "blur") window.pointerOutput.outside.focus();
                  else e.preventDefault();
                },
                { once: true },
              );
            }, scenario);
          const action = ["retry", "backspace", "clear", "discard"].includes(
            scenario,
          )
            ? scenario
            : "commit";
          if (action === "backspace")
            await activate(
              page.getByRole("button", { name: "Backspace", exact: true }),
            );
          else await activate(page.locator(`[part~="${action}-button"]`));
          const accepted = ["commit", "retry", "backspace"].includes(scenario);
          const result = await page.evaluate(() => {
            const p = window.pointerOutput;
            return {
              text: p.target.value,
              deliveries: p.deliveries,
              edits: p.edits,
              pending: p.c.getState().pendingDots,
              retry: p.c.getState().awaitingRetry,
              targetFocused: document.activeElement === p.target,
              outsideFocused: document.activeElement === p.outside,
            };
          });
          expect(result, scenario).toEqual({
            text: scenario === "backspace" ? "B" : accepted ? "A⠁B" : "AB",
            deliveries:
              scenario === "retry"
                ? ["rejected", "accepted"]
                : scenario === "discard"
                  ? ["rejected"]
                  : scenario === "clear"
                    ? []
                    : [
                        accepted
                          ? "accepted"
                          : scenario === "blur"
                            ? "conflicted"
                            : "rejected",
                      ],
            edits:
              scenario === "retry"
                ? ["beforeinput", "beforeinput", "input"]
                : scenario === "discard"
                  ? ["beforeinput"]
                  : accepted
                    ? ["beforeinput", "input"]
                    : ["blur", "cancel"].includes(scenario)
                      ? ["beforeinput"]
                      : [],
            pending: ["outside", "cancel"].includes(scenario) ? [1] : [],
            retry: ["outside", "cancel"].includes(scenario),
            targetFocused: !["outside", "blur"].includes(scenario),
            outsideFocused: ["outside", "blur"].includes(scenario),
          });
        }
      });
    }
  });
}
