import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { PointerAdapterOptions } from "../../src/adapters/pointer.js";
import type {
  ActivationGroup,
  BrailleAttachment,
  BrailleInputController,
  BrailleInputStrategyFactory,
  BrailleOutputAction,
  InputMode,
} from "../../src/core/types.js";

import { activationLossCases } from "../fixtures/activation-loss.js";

interface PointerApi {
  createBrailleController(options: {
    inputMode: InputMode;
    strategies?: readonly BrailleInputStrategyFactory[];
  }): BrailleInputController;
  createActivationGroup(ownerDocument: Document): ActivationGroup;
  attachPointer(
    controller: BrailleInputController,
    scope: HTMLElement,
    options: PointerAdapterOptions,
  ): BrailleAttachment<PointerAdapterOptions>;
  attachBrailleEditable(
    controller: BrailleInputController,
    target: HTMLTextAreaElement,
    options: { activation: "always" },
  ): BrailleAttachment<unknown>;
}

interface Harness {
  controller: BrailleInputController;
  attachment: BrailleAttachment<PointerAdapterOptions>;
  editable: BrailleAttachment<unknown>;
  inputCount: number;
  outputs: { action: BrailleOutputAction; delivery: string }[];
  events: {
    type: string;
    trusted: boolean;
    time: number;
    detail: number;
    pointerType: string | null;
    pointerId: number | null;
  }[];
  oldValues: string[];
  rebuild(replaceController: boolean): void;
}

type TestWindow = Window & typeof globalThis & { pointerHarness: Harness };

async function servePointerPage(page: Page): Promise<void> {
  const root = resolve(process.cwd());
  await page.route("http://pointer.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") {
      await route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><section id="scope"><button type="button" data-braille-dot="1"><span>dot 1</span></button><button type="button" data-braille-dot="2">dot 2</button></section><textarea id="target"></textarea>',
      });
    } else if (pathname.startsWith("/dist/") && !pathname.includes("..")) {
      await route.fulfill({
        contentType: "text/javascript",
        body: readFileSync(resolve(root, pathname.slice(1))),
      });
    } else await route.abort();
  });
  await page.goto("http://pointer.test/");
}

async function prepare(
  page: Page,
  mode: InputMode,
  nestedDownBeforePointerAdapter = false,
): Promise<void> {
  await servePointerPage(page);
  await page.evaluate(
    async ({ inputMode, nestedDownBeforePointerAdapter }) => {
      // @ts-expect-error Browser-served distribution URLs are not source modules.
      const core = (await import("/dist/core.js")) as PointerApi;
      // @ts-expect-error Browser-served distribution URLs are not source modules.
      const adapters = (await import("/dist/adapters.js")) as PointerApi;
      const scope = document.querySelector("#scope") as HTMLElement;
      const target = document.querySelector("#target") as HTMLTextAreaElement;
      const makeController = () => core.createBrailleController({ inputMode });
      const controller = makeController();
      if (nestedDownBeforePointerAdapter) {
        let nested = false;
        controller.subscribeState((state) => {
          if (!nested && state.pressedInputIds.length === 1) {
            nested = true;
            const dot2 = scope.querySelector(
              '[data-braille-dot="2"]',
            ) as HTMLElement;
            dot2.dispatchEvent(
              new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                pointerId: 42,
                pointerType: "touch",
                button: 0,
              }),
            );
          }
        });
      }
      const attach = (next: BrailleInputController) =>
        adapters.attachPointer(next, scope, { activation: "manual" });
      const harness: Harness = {
        controller,
        attachment: attach(controller),
        editable: adapters.attachBrailleEditable(controller, target, {
          activation: "always",
        }),
        inputCount: 0,
        outputs: [],
        events: [],
        oldValues: [],
        rebuild(replaceController) {
          harness.attachment.detach();
          if (replaceController) {
            harness.oldValues.push(target.value);
            harness.editable.detach();
            harness.controller.destroy();
            const nextTarget = document.createElement("textarea");
            nextTarget.id = "target";
            target.id = "old-target";
            target.after(nextTarget);
            harness.controller = makeController();
            harness.editable = adapters.attachBrailleEditable(
              harness.controller,
              nextTarget,
              { activation: "always" },
            );
            observe(harness.controller, nextTarget);
          }
          harness.attachment = attach(harness.controller);
          harness.attachment.activate();
        },
      };
      function observe(
        next: BrailleInputController,
        nextTarget: HTMLTextAreaElement,
      ) {
        nextTarget.addEventListener("input", () => harness.inputCount++);
        next.subscribeOutput((action, delivery) =>
          harness.outputs.push({ action, delivery }),
        );
      }
      observe(controller, target);
      harness.attachment.activate();
      for (const type of [
        "pointerdown",
        "pointerup",
        "click",
        "lostpointercapture",
      ]) {
        scope.addEventListener(type, (event) => {
          const pointer = event as PointerEvent;
          harness.events.push({
            type,
            trusted: event.isTrusted,
            time: performance.now(),
            detail: pointer.detail,
            pointerType: pointer.pointerType ?? null,
            pointerId: pointer.pointerId ?? null,
          });
        });
      }
      (window as TestWindow).pointerHarness = harness;
    },
    { inputMode: mode, nestedDownBeforePointerAdapter },
  );
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const h = (window as TestWindow).pointerHarness;
    return {
      state: h.controller.getState(),
      value: (document.querySelector("#target") as HTMLTextAreaElement).value,
      oldValue: (
        document.querySelector("#old-target") as HTMLTextAreaElement | null
      )?.value,
      inputCount: h.inputCount,
      outputs: h.outputs,
      events: h.events,
    };
  });
}

for (const mode of ["sequential", "chord"] as const) {
  for (const delay of [50, 650, 1500]) {
    test(`${mode}: native ${delay}ms press yields one cell`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await prepare(page, mode);
      await page.locator("[data-braille-dot='1'] span").click({ delay });
      const beforeCommit = await snapshot(page);
      expect(beforeCommit.state.pendingDots).toEqual(
        mode === "sequential" ? [1] : [],
      );
      expect(beforeCommit.state.pressedInputIds).toEqual([]);
      const gesture = beforeCommit.events.filter(
        (event) => event.type !== "lostpointercapture",
      );
      expect(gesture.map((event) => event.type)).toEqual([
        "pointerdown",
        "pointerup",
        "click",
      ]);
      expect(gesture.every((event) => event.trusted)).toBe(true);
      expect(
        (gesture[1]?.time ?? 0) - (gesture[0]?.time ?? 0),
      ).toBeGreaterThanOrEqual(delay - 10);
      await page.evaluate(() =>
        (window as TestWindow).pointerHarness.controller.commitPending(),
      );
      const result = await snapshot(page);
      expect(result.value).toBe("⠁");
      expect(result.inputCount).toBe(1);
      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]?.delivery).toBe("accepted");
      expect(errors).toEqual([]);
    });
  }

  for (const key of ["Enter", "Space"]) {
    test(`${mode}: native ${key} works immediately after pointer input`, async ({
      page,
    }) => {
      await prepare(page, mode);
      const dot = page.locator("[data-braille-dot='1']");
      await dot.click({ delay: 50 });
      await dot.focus();
      await dot.press(key);
      const result = await snapshot(page);
      const clicks = result.events.filter((event) => event.type === "click");
      expect(clicks).toHaveLength(2);
      expect(clicks[1]?.trusted).toBe(true);
      expect(clicks[1]?.detail).toBe(0);
      // Establish that the old 500ms window would have swallowed this activation.
      expect((clicks[1]?.time ?? 0) - (clicks[0]?.time ?? 0)).toBeLessThan(500);
      expect(result.state.pendingDots).toEqual([]);
      expect(result.value).toBe(mode === "chord" ? "⠁⠁" : "");
      expect(result.inputCount).toBe(mode === "chord" ? 2 : 0);
      expect(result.outputs).toHaveLength(mode === "chord" ? 2 : 0);
    });
  }

  test(`${mode}: standalone and programmatic clicks work without down`, async ({
    page,
  }) => {
    await prepare(page, mode);
    const dot = page.locator("[data-braille-dot='1']");
    await dot.focus();
    await dot.press("Enter");
    await dot.evaluate((element) => (element as HTMLElement).click());
    await dot.press("Space");
    await page.evaluate(() =>
      (window as TestWindow).pointerHarness.controller.commitPending(),
    );
    const result = await snapshot(page);
    expect(
      result.events.filter((event) => event.type === "pointerdown"),
    ).toEqual([]);
    expect(result.value).toBe(mode === "chord" ? "⠁⠁⠁" : "⠁");
    expect(result.inputCount).toBe(mode === "chord" ? 3 : 1);
  });

  test(`${mode}: a queued nested pointer down survives the earlier stale snapshot`, async ({
    page,
  }) => {
    await prepare(page, mode, true);
    await page.locator('[data-braille-dot="1"]').click();
    const whileSecondPointerIsDown = await snapshot(page);
    expect(whileSecondPointerIsDown.state.pressedInputIds).toHaveLength(1);
    expect(whileSecondPointerIsDown.state.pendingDots).toEqual(
      mode === "chord" ? [1, 2] : [1, 2],
    );
    await page.locator('[data-braille-dot="2"]').evaluate((element) => {
      element.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 42,
          pointerType: "touch",
          button: 0,
        }),
      );
    });
    if (mode === "sequential")
      await page.evaluate(() =>
        (window as TestWindow).pointerHarness.controller.commitPending(),
      );
    const result = await snapshot(page);
    expect(result.state.pressedInputIds).toEqual([]);
    expect(result.value).toBe("⠃");
    expect(result.inputCount).toBe(1);
    expect(result.outputs).toHaveLength(1);
  });

  for (const phase of ["pointerdown", "pointerup"] as const) {
    for (const replaceController of [false, true]) {
      test(`${mode}: rebuild after ${phase}, replace controller=${replaceController}`, async ({
        page,
      }) => {
        await prepare(page, mode);
        await page.evaluate(
          ({ phase, replaceController }) => {
            document
              .querySelector("#scope")
              ?.addEventListener(
                phase,
                () =>
                  (window as TestWindow).pointerHarness.rebuild(
                    replaceController,
                  ),
                { once: true },
              );
          },
          { phase, replaceController },
        );
        await page.locator("[data-braille-dot='1'] span").click({ delay: 650 });
        const result = await snapshot(page);
        expect(result.state.pressedInputIds).toEqual([]);
        if (replaceController) {
          expect(result.state.pendingDots).toEqual([]);
          expect(result.value).toBe("");
          expect(result.oldValue).toBe(
            mode === "chord" && phase === "pointerup" ? "⠁" : "",
          );
        } else {
          expect(result.state.pendingDots).toEqual(
            mode === "sequential" ? [1] : [],
          );
          expect(result.value).toBe(
            mode === "chord" && phase === "pointerup" ? "⠁" : "",
          );
        }
        expect(result.inputCount).toBe(
          mode === "chord" && phase === "pointerup" ? 1 : 0,
        );
        // Ensure the fresh attachment continues to support keyboard activation.
        await page.locator("[data-braille-dot='1']").press("Enter");
        const afterKey = await snapshot(page);
        expect(afterKey.state.pressedInputIds).toEqual([]);
        expect(afterKey.state.pendingDots).toEqual(
          mode === "sequential" && replaceController ? [1] : [],
        );
        expect(afterKey.value).toBe(mode === "chord" ? `${result.value}⠁` : "");
        expect(afterKey.inputCount).toBe(
          result.inputCount + (mode === "chord" ? 1 : 0),
        );
      });
    }
  }
}

test("pointer cancellation reports activation loss to custom strategies", async ({
  page,
}) => {
  await servePointerPage(page);
  const results = await page.evaluate(async () => {
    // @ts-expect-error Browser-served distribution URLs are not source modules.
    const core = (await import("/dist/core.js")) as PointerApi;
    // @ts-expect-error Browser-served distribution URLs are not source modules.
    const adapters = (await import("/dist/adapters.js")) as PointerApi;
    const transitions = [
      "deactivate",
      "detach",
      "pointercancel",
      "lostpointercapture",
      "group-destroy",
    ] as const;
    const results = [];
    for (const transition of transitions) {
      const mode = "test:pointer-latch" as InputMode;
      const resets: string[] = [];
      const outputs: string[] = [];
      const strategy: BrailleInputStrategyFactory = () => ({
        id: mode,
        activate: () => {},
        deactivate: () => {},
        destroy: () => {},
        reset: (reason, context) => {
          resets.push(reason);
          if (reason === "activation-lost") context.setPendingContributions([]);
        },
        handle: (action, context) => {
          if (action.type === "dot-down")
            context.setPendingContributions([
              ...context.getPendingContributions(),
              {
                id: action.inputId,
                dot: action.dot,
                source: action.source,
              },
            ]);
          if (
            action.type === "commit-request" &&
            context.getPendingContributions().length > 0
          )
            context.requestCommit(action.source);
        },
      });
      const controller = core.createBrailleController({
        inputMode: mode,
        strategies: [strategy],
      });
      controller.subscribeOutput((action) => {
        if (action.kind === "braille") outputs.push(action.char);
      });
      const scope = document.createElement("section");
      scope.innerHTML = '<button data-braille-dot="1">dot 1</button>';
      document.body.append(scope);
      const dot = scope.firstElementChild as HTMLElement;
      const group =
        transition === "group-destroy"
          ? adapters.createActivationGroup(document)
          : undefined;
      const attachment = adapters.attachPointer(controller, scope, {
        activation: "manual",
        ...(group ? { activationGroup: group } : {}),
      });
      attachment.activate();
      dot.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 42,
          pointerType: "touch",
          button: 0,
        }),
      );
      if (transition === "deactivate" || transition === "detach")
        attachment[transition]();
      else if (transition === "group-destroy") group?.destroy();
      else
        dot.dispatchEvent(
          new PointerEvent(transition, {
            bubbles: true,
            cancelable: true,
            pointerId: 42,
            pointerType: "touch",
            button: 0,
          }),
        );
      const afterCancel = controller.getState();
      controller.commitPending();
      results.push({
        transition,
        resets: [...resets],
        pendingDots: [...afterCancel.pendingDots],
        pressedInputIds: [...afterCancel.pressedInputIds],
        outputs: [...outputs],
      });
      attachment.detach();
      controller.destroy();
      scope.remove();
    }
    return results;
  });
  expect(results).toHaveLength(5);
  for (const result of results) {
    expect(result.resets).toEqual(["activation-lost"]);
    expect(result.pendingDots).toEqual([]);
    expect(result.pressedInputIds).toEqual([]);
    expect(result.outputs).toEqual([]);
  }
});

test("pointer cancellation keeps reentrant rounds behind the complete reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await servePointerPage(page);
  const results = await page.evaluate(async () => {
    // @ts-expect-error Browser-served distribution URLs are not source modules.
    const core = (await import("/dist/core.js")) as PointerApi;
    // @ts-expect-error Browser-served distribution URLs are not source modules.
    const adapters = (await import("/dist/adapters.js")) as PointerApi;
    const results = [];
    for (const mode of ["chord", "custom"] as const)
      for (const timing of ["direct", "queued"] as const)
        for (const order of ["before", "after"] as const)
          for (const transition of [
            "pointercancel",
            "lostpointercapture",
            "deactivate",
            "detach",
            "group-destroy",
          ] as const) {
            const id = "test:cancel-boundary" as InputMode;
            const strategy: BrailleInputStrategyFactory = () => ({
              id,
              activate() {},
              deactivate() {},
              destroy() {},
              reset(reason, context) {
                if (reason === "activation-lost")
                  context.setPendingContributions([]);
              },
              handle(action, context) {
                if (action.type === "dot-down")
                  context.setPendingContributions([
                    ...context.getPendingContributions(),
                    {
                      id: action.inputId,
                      dot: action.dot,
                      source: action.source,
                    },
                  ]);
                if (action.type === "commit-request")
                  context.requestCommit(action.source);
              },
            });
            const c = core.createBrailleController({
              inputMode: mode === "custom" ? id : mode,
              ...(mode === "custom" ? { strategies: [strategy] } : {}),
            });
            const scope = document.createElement("section"),
              other = document.createElement("section");
            scope.innerHTML =
              '<button data-braille-dot="1">1</button><button data-braille-dot="3">3</button>';
            other.innerHTML = '<button data-braille-dot="2">2</button>';
            document.body.append(scope, other);
            const dot1 = scope.firstElementChild as HTMLElement,
              dot3 = scope.lastElementChild as HTMLElement,
              dot2 = other.firstElementChild as HTMLElement;
            // Isolate controller ordering from native capture and touch synthesis.
            for (const dot of [dot1, dot2, dot3]) {
              dot.setPointerCapture = () => {};
              dot.releasePointerCapture = () => {};
            }
            const send = (dot: HTMLElement, type: string, pointerId: number) =>
              dot.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId,
                  pointerType: "touch",
                  button: 0,
                }),
              );
            let armed = false,
              fired = false;
            const listener = (state: ReturnType<typeof c.getState>) => {
              if (armed && !fired && state.pressedInputIds.length === 1) {
                fired = true;
                send(dot2, "pointerdown", 2);
              }
            };
            if (order === "before") c.subscribeState(listener);
            const group = adapters.createActivationGroup(document);
            const a = adapters.attachPointer(c, scope, {
              activation: "manual",
              activationGroup: group,
            });
            a.activate();
            const b = adapters.attachPointer(c, other, {
              activation: "always",
            });
            if (order === "after") c.subscribeState(listener);
            const outputs: string[] = [],
              diagnostics: string[] = [];
            c.subscribeOutput((action) => {
              if (action.kind === "braille") outputs.push(action.char);
            });
            c.subscribeDiagnostic((d) => diagnostics.push(d.code));
            send(dot1, "pointerdown", 1);
            send(dot3, "pointerdown", 3);
            armed = true;
            const cancel = () => {
              if (transition === "deactivate" || transition === "detach")
                a[transition]();
              else if (transition === "group-destroy") group.destroy();
              else send(dot1, transition, 1);
            };
            if (timing === "direct") cancel();
            else {
              let once = false;
              const dispose = c.subscribeState(() => {
                if (!once) {
                  once = true;
                  cancel();
                }
              });
              dispose();
            }
            const afterCancel = c.getState();
            send(dot1, "lostpointercapture", 1);
            send(dot3, "pointerup", 3);
            send(dot2, "pointerup", 2);
            if (mode === "custom") c.commitPending();
            results.push({
              mode,
              timing,
              order,
              transition,
              fired,
              afterCancel,
              final: c.getState(),
              outputs: [...outputs],
              diagnostics: [...diagnostics],
            });
            armed = false;
            a.detach();
            b.detach();
            group.destroy();
            c.destroy();
            scope.remove();
            other.remove();
          }
    return results;
  });
  expect(results).toHaveLength(40);
  for (const result of results) {
    expect(result.fired, JSON.stringify(result)).toBe(true);
    expect(result.afterCancel.pressedInputIds).toHaveLength(1);
    expect(result.afterCancel.pendingDots).toEqual([2]);
    expect(result.final.pressedInputIds).toEqual([]);
    expect(result.final.pendingDots).toEqual([]);
    expect(result.outputs).toEqual(["⠂"]);
    expect(result.diagnostics).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("shared group teardown and lifecycle loss preserve new input and frozen retry cells", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await servePointerPage(page);
  const results = await page.evaluate(activationLossCases, undefined);
  expect(results).toHaveLength(120);
  for (const result of results) {
    const label = JSON.stringify(result);
    expect(result.diagnostics, label).toEqual([]);
    if (result.kind === "group") {
      expect(result.fired, label).toBe(true);
      expect(result.after.pendingDots, label).toEqual([2]);
      expect(result.after.pressedInputIds, label).toHaveLength(1);
      expect(result.final.pendingDots, label).toEqual([]);
      expect(result.final.pressedInputIds, label).toEqual([]);
      expect(result.outputs, label).toEqual(["⠂"]);
    } else {
      expect(result.frozen?.awaitingRetry, label).toBe(true);
      expect(result.after.awaitingRetry, label).toBe(true);
      expect(result.after.pendingDots, label).toEqual([1]);
      expect(result.after.pendingSources, label).toEqual(
        result.frozen?.pendingSources,
      );
      expect(result.final.awaitingRetry, label).toBe(false);
      expect(result.final.pendingDots, label).toEqual([]);
      expect(result.attempts, label).toEqual(["⠁", "⠁", "⠂"]);
    }
  }
  expect(errors).toEqual([]);
});
