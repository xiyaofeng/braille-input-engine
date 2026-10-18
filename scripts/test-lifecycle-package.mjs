import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Called with the actual extracted npm pack artifact, not workspace dist.
export async function testLifecyclePackage(packageRoot, temporaryDirectory) {
  const fixture = join(temporaryDirectory, "lifecycle-suite.mjs");
  await build({
    entryPoints: ["tests/fixtures/lifecycle-suite.ts"],
    bundle: true,
    external: ["/dist/*"],
    format: "esm",
    outfile: fixture,
  });
  const suite = await import(pathToFileURL(fixture));
  const dom = new JSDOM("<body></body>");
  const names = [
    "window",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "ShadowRoot",
    "CustomEvent",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "MutationObserver",
    "customElements",
    "Event",
    "KeyboardEvent",
    "FocusEvent",
  ];
  const previous = new Map(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  previous.set(
    "PointerEvent",
    Object.getOwnPropertyDescriptor(globalThis, "PointerEvent"),
  );
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: dom.window[name],
    });
  globalThis.PointerEvent = class extends dom.window.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
    }
  };
  try {
    const require = createRequire(import.meta.url);
    for (const format of ["esm", "cjs"]) {
      const load = (name) =>
        format === "esm"
          ? import(pathToFileURL(join(packageRoot, `dist/${name}.js`)))
          : require(join(packageRoot, `dist/${name}.cjs`));
      const [core, root, adapters, browser, ui] = await Promise.all([
        load("core"),
        load("index"),
        load("adapters"),
        load("browser"),
        load("default-ui"),
      ]);
      assert.equal(core.BrailleController, root.BrailleController);
      assert.equal(core.BrailleController, browser.BrailleController);
      assert.equal(core.BrailleInputException, browser.BrailleInputException);
      const c = core.createBrailleController();
      assert(c instanceof browser.BrailleController);
      const group = adapters.createActivationGroup(document);
      assert.equal(browser.getActivationGroup(group), group);
      const target = document.createElement("textarea");
      document.body.append(target);
      const attachment = adapters.attachBrailleEditable(c, target, {
        activation: "always",
        activationGroup: group,
      });
      assert.equal(browser.isEditableTargetAttached(target), true);
      const other = browser.createBrailleController();
      assert.throws(
        () =>
          browser.attachBrailleEditable(other, target, {
            activation: "always",
          }),
        (error) => error instanceof core.BrailleInputException,
      );
      attachment.detach();
      assert.equal(browser.isEditableTargetAttached(target), false);
      group.destroy();
      c.destroy();
      other.destroy();
      target.remove();
      const api = { ...core, ...adapters };
      const uiBoundaries = suite.keyboardUIBoundaryCases({ ...api, ...ui });
      assert.equal(uiBoundaries.count, 5760);
      assert.deepEqual(uiBoundaries.failures, []);
      console.log(
        `Packed ${format}: ${uiBoundaries.count} UI control exclusion cases and ordinary member/owned release controls passed.`,
      );
      const editableFocus = suite.editableFocusCases({ ...api, ...ui });
      assert.equal(editableFocus.count, 100);
      assert.deepEqual(editableFocus.failures, []);
      console.log(
        `Packed ${format}: 100 real editable focus/transaction cases passed.`,
      );
      const result = await suite.lifecycleCoordinationCases(api);
      assert.equal(result.count, 576);
      assert.deepEqual(result.failures, []);
      assert.deepEqual(suite.notificationIdentityCases(core), []);
      for (const run of [
        suite.terminalBoundaryCases,
        suite.focusBoundaryCases,
      ]) {
        const boundaries = run(api);
        assert.deepEqual(boundaries.failures, []);
        console.log(
          `Packed ${format}: ${boundaries.count} terminal/focus boundary cases passed.`,
        );
      }
      const retained = await suite.activationLossCases(api);
      assert.equal(retained.length, 120);
      for (const row of retained) {
        assert.deepEqual(row.diagnostics, []);
        if (row.kind === "group") {
          assert.equal(row.fired, true);
          assert.deepEqual(row.after.pendingDots, [2]);
          assert.equal(row.after.pressedInputIds.length, 1);
          assert.deepEqual(row.outputs, ["⠂"]);
        } else {
          assert.equal(row.after.awaitingRetry, true);
          assert.deepEqual(row.after.pendingDots, [1]);
          assert.equal(row.final.awaitingRetry, false);
          assert.deepEqual(row.attempts, ["⠁", "⠁", "⠂"]);
        }
      }
      // Deterministic generated public/control actions, also exercising the
      // internal lifecycle protocol shared by adapters in this module graph.
      let seed = 20261007;
      const kinds = [
        "down",
        "up",
        "cancel",
        "loss",
        "global-loss",
        "commit",
        "discard",
        "disable",
        "disable-discard",
        "enable",
        "reset",
        "config",
        "mode",
        "destroy",
        "rebuild",
      ];
      const deliveries = ["accepted", "rejected", "unhandled", "conflicted"];
      const next = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
      };
      for (const mode of ["chord", "sequential", "custom"])
        for (let run = 0; run < 100; run++) {
          const actions = Array.from({ length: 80 }, () => ({
            kind: kinds[next() % kinds.length],
            slot: 1 + (next() % 3),
            delivery: deliveries[next() % 4],
          }));
          suite.runLifecycleModel(core, mode, actions);
        }
      console.log(
        `Packed ${format}: shared class/exception/group/target identities; 576 lifecycle cases, notification identities, 300 generated sequences passed (seed 20261007).`,
      );
    }
  } finally {
    dom.window.close();
    for (const [name, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
  }
}
