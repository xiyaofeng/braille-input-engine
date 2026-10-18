import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type * as Boundaries from "../fixtures/lifecycle-boundaries.js";
import type * as Core from "../../src/index.js";
import type * as Adapters from "../../src/entries/adapters.js";

type Api = typeof Core & typeof Adapters;
declare global {
  interface Window {
    Boundaries: typeof Boundaries;
    BrailleInput: Api;
    boundaryApi: Api;
    terminal: ReturnType<typeof Boundaries.setupTerminal>;
    trusted: {
      type: string;
      trusted: boolean;
      capture?: boolean;
      pointerId?: number;
    }[];
    focusProbe: {
      c: Core.BrailleInputController;
      a: Core.KeyboardAttachment;
      stop: () => void;
      outputs: string[];
      button: HTMLElement;
      target: HTMLElement;
      outside: HTMLElement;
      fresh: boolean;
    };
  }
}
const suite = buildSync({
  entryPoints: ["tests/fixtures/lifecycle-boundaries.ts"],
  bundle: true,
  format: "iife",
  globalName: "Boundaries",
  write: false,
}).outputFiles[0]!.text;
const source = buildSync({
  stdin: {
    contents:
      'export * from "./src/index.ts"; export * from "./src/entries/adapters.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  write: false,
}).outputFiles[0]!.text;
async function load(page: Page, format: string) {
  await page.route("http://boundaries.test/**", (route) => {
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
  await page.goto("http://boundaries.test/");
  await page.addScriptTag({ url: "/suite.js" });
  if (format === "iife")
    await page.addScriptTag({ url: "/dist/braille-input.iife.min.js" });
  await page.evaluate(async (format) => {
    window.boundaryApi =
      format === "source"
        ? ((await import("/source.js" as string)) as Api)
        : format === "iife"
          ? window.BrailleInput
          : format === "browser"
            ? ((await import("/dist/browser.js" as string)) as Api)
            : {
                ...((await import("/dist/core.js" as string)) as typeof Core),
                ...((await import(
                  "/dist/adapters.js" as string
                )) as typeof Adapters),
              };
  }, format);
}
for (const format of ["source", "esm", "browser", "iife"]) {
  test(`terminal branches and focus roots: ${format}`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await load(page, format);
    const result = await page.evaluate(() => ({
      terminal: window.Boundaries.terminalBoundaryCases(window.boundaryApi),
      focus: window.Boundaries.focusBoundaryCases(window.boundaryApi),
    }));
    expect(result.terminal.failures).toEqual([]);
    expect(result.focus.failures).toEqual([]);
    expect(errors).toEqual([]);
  });
  test(`trusted terminal input and focus transitions: ${format}`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await load(page, format);
    for (const shape of ["single", "shared", "nested"] as const)
      for (const shadow of [false, true]) {
        await page.evaluate(
          ({ shape, shadow }) => {
            window.terminal = window.Boundaries.setupTerminal(
              window.boundaryApi,
              {
                shape,
                shadow,
                kind: "keyboard",
                terminal: "keyup",
                guards: "deny",
                mode: "chord",
                reentry: "state",
              },
            );
            window.trusted = [];
            for (const type of ["keydown", "keyup"])
              window.terminal.button.addEventListener(type, (e) =>
                window.trusted.push({ type, trusted: e.isTrusted }),
              );
            window.terminal.button.focus();
          },
          { shape, shadow },
        );
        await page.keyboard.down("f");
        await page.evaluate(() => window.terminal.arm());
        await page.keyboard.up("f");
        const trusted = await page.evaluate(() => {
          const events = [...window.trusted];
          window.terminal.verify();
          return events;
        });
        expect(trusted).toEqual([
          { type: "keydown", trusted: true },
          { type: "keyup", trusted: true },
        ]);
        await page.evaluate(() => window.terminal.dispose());
      }
    for (const shape of ["single", "shared", "nested"] as const)
      for (const guards of ["allow", "deny", "mixed", "throw"] as const)
        for (const shadow of [false, true]) {
          await page.evaluate(
            ({ shape, guards, shadow }) => {
              window.terminal = window.Boundaries.setupTerminal(
                window.boundaryApi,
                {
                  shape,
                  guards,
                  shadow,
                  kind: "pointer",
                  terminal: "pointerup",
                  mode: "chord",
                  reentry: "state",
                },
              );
              window.trusted = [];
              for (const type of [
                "pointerdown",
                "pointerup",
                "gotpointercapture",
                "lostpointercapture",
              ])
                window.terminal.button.addEventListener(type, (event) => {
                  const e = event as PointerEvent;
                  window.trusted.push({
                    type,
                    trusted: e.isTrusted,
                    pointerId: e.pointerId,
                    capture: window.terminal.button.hasPointerCapture(
                      e.pointerId,
                    ),
                  });
                });
            },
            {
              shape,
              guards:
                shape === "single" && guards === "mixed" ? "deny" : guards,
              shadow,
            },
          );
          const rect = await page.evaluate(() => {
            const r = window.terminal.button.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          });
          await page.mouse.move(rect.x, rect.y);
          await page.mouse.down();
          expect(
            await page.evaluate(() =>
              window.terminal.button.hasPointerCapture(
                window.trusted.find((e) => e.type === "pointerdown")!
                  .pointerId!,
              ),
            ),
          ).toBe(true);
          await page.evaluate(() => window.terminal.arm());
          await page.mouse.up();
          const trusted = await page.evaluate(() => {
            const trusted = [...window.trusted];
            window.terminal.verify();
            return trusted;
          });
          expect(trusted.filter((e) => e.type === "pointerdown")).toHaveLength(
            1,
          );
          expect(trusted.filter((e) => e.type === "pointerup")).toHaveLength(1);
          expect(
            trusted.filter((e) => e.type === "gotpointercapture"),
          ).toHaveLength(1);
          expect(
            trusted.filter((e) => e.type === "lostpointercapture"),
          ).toHaveLength(1);
          expect(trusted.every((e) => e.trusted)).toBe(true);
          await page.evaluate(() => window.terminal.dispose());
        }
    for (const shadow of [false, true])
      for (const destination of [
        "same-root-outside",
        "outside",
        "member",
        "other-root-outside",
      ] as const) {
        await page.evaluate(
          ({ shadow, destination }) => {
            document.body.innerHTML =
              '<div id="host"></div><div id="peer"></div><button id="outside">out</button>';
            const host = document.querySelector<HTMLElement>("#host")!,
              root = shadow ? host.attachShadow({ mode: "open" }) : host;
            root.innerHTML =
              "<section><button>start</button></section><button>same root</button>";
            const scope = root.firstElementChild as HTMLElement,
              button = scope.firstElementChild as HTMLElement;
            const peer = document
              .querySelector("#peer")!
              .attachShadow({ mode: "open" });
            peer.innerHTML =
              "<section><button>member</button></section><button>nonmember</button>";
            const api = window.boundaryApi,
              group = api.createActivationGroup(document);
            const token = group.add(peer.firstElementChild as HTMLElement);
            const c = api.createBrailleController({ inputMode: "chord" }),
              a = api.attachKeyboard(c, scope, { activationGroup: group }),
              outputs: string[] = [];
            let armed = false,
              fresh = false;
            c.subscribeOutput((x) => {
              if (x.kind === "braille") outputs.push(x.char);
            });
            c.subscribeState((s) => {
              if (armed && !fresh && !s.pressedInputIds.length) {
                fresh = true;
                c.dispatch({
                  type: "dot-down",
                  dot: 2,
                  inputId: "fresh",
                  source: "api",
                });
              }
            });
            const outside = document.querySelector<HTMLElement>("#outside")!,
              target =
                destination === "same-root-outside"
                  ? (root.lastElementChild as HTMLElement)
                  : destination === "outside"
                    ? outside
                    : destination === "member"
                      ? peer.querySelector("button")!
                      : (peer.lastElementChild as HTMLElement);
            window.trusted = [];
            const removers: (() => void)[] = [];
            for (const node of [document, root, peer])
              for (const type of ["keydown", "keyup", "focusout", "focusin"]) {
                const listener = (e: Event) => {
                  window.trusted.push({ type, trusted: e.isTrusted });
                };
                node.addEventListener(type, listener, true);
                removers.push(() =>
                  node.removeEventListener(type, listener, true),
                );
              }
            button.focus();
            armed = true;
            window.focusProbe = {
              c,
              a,
              outputs,
              button,
              target,
              outside,
              fresh,
              stop: () => {
                armed = false;
                removers.forEach((remove) => remove());
                a.detach();
                token();
                group.destroy();
                c.destroy();
              },
            };
          },
          { shadow, destination },
        );
        await page.keyboard.down("f");
        await page.evaluate(() => window.focusProbe.target.focus());
        if (destination === "member") {
          expect(
            await page.evaluate(
              () => window.focusProbe.c.getState().pendingDots,
            ),
          ).toEqual([1]);
          await page.evaluate(() => window.focusProbe.outside.focus());
        }
        await page.keyboard.up("f");
        const result = await page.evaluate(() => {
          const p = window.focusProbe,
            after = p.c.getState();
          p.c.dispatch({
            type: "dot-up",
            dot: 2,
            inputId: "fresh",
            source: "api",
          });
          return { after, outputs: p.outputs, trusted: window.trusted };
        });
        expect(result.after.pressedInputIds).toEqual(["fresh"]);
        expect(result.after.pendingDots).toEqual([2]);
        expect(result.outputs).toEqual(["⠂"]);
        expect(result.trusted.some((e) => e.type === "keydown")).toBe(true);
        expect(result.trusted.some((e) => e.type === "focusout")).toBe(true);
        expect(result.trusted.every((e) => e.trusted)).toBe(true);
        await page.evaluate(() => window.focusProbe.stop());
      }
    expect(errors).toEqual([]);
  });
}
