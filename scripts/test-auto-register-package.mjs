import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

// Each format starts in a separate process, with an empty registry and module
// cache. Resolve bare package specifiers from the exact extracted tgz consumer.
export async function testAutoRegisterPackage(consumerRoot, packageName) {
  for (const format of ["esm", "cjs"]) {
    const fixture = join(
      consumerRoot,
      `auto-register-consumer.${format === "esm" ? "mjs" : "cjs"}`,
    );
    await writeFile(
      fixture,
      `${format === "esm" ? 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' : ""}
const assert = require("node:assert/strict");
const { JSDOM } = require(${JSON.stringify(require.resolve("jsdom"))});
(async () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  for (const name of ["window", "document", "Document", "DocumentFragment", "Node", "Element", "HTMLElement", "ShadowRoot", "CustomEvent", "HTMLInputElement", "HTMLTextAreaElement", "MutationObserver", "customElements", "Event", "KeyboardEvent", "FocusEvent"])
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  const load = ${format === "esm" ? "(name) => import(name)" : "async (name) => require(name)"};
  const packageName = ${JSON.stringify(packageName)};
  let input;
  try {
    assert.equal(customElements.get("braille-input"), undefined);
    for (const subpath of ["", "/core", "/adapters", "/default-ui", "/web-component", "/browser"]) {
      await load(packageName + subpath);
      assert.equal(customElements.get("braille-input"), undefined,
        "Packed ${format} " + subpath + " must not auto-register");
    }
    const api = await load(packageName + "/auto-register");
    const constructor = customElements.get("braille-input");
    assert.equal(typeof constructor, "function", "Packed ${format} auto-register did not register braille-input");
    const component = await load(packageName + "/web-component");
    assert.equal(constructor, component.BrailleInputElement,
      "Packed ${format} auto-register constructor identity changed");
    assert.equal(api.defineBrailleInput(), constructor);
    assert.equal((await load(packageName + "/auto-register")).defineBrailleInput(), constructor);
    const target = document.createElement("textarea");
    input = document.createElement("braille-input");
    input.target = target;
    document.body.append(target, input);
    target.focus();
    const actions = [];
    input.addEventListener("braille-input", (event) => actions.push(event.detail.action));
    const dot = input.shadowRoot?.querySelector('[part~="dot"]');
    assert(dot instanceof HTMLElement, "Packed ${format} auto-register controls missing");
    dot.click();
    input.controller.commitPending("pointer");
    assert.equal(target.value, "⠁", "Packed ${format} auto-register actual input failed");
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, "braille");
    assert.equal(actions[0].char, "⠁");
    console.log("Packed ${format} auto-register registration, identity, idempotence and actual input passed.");
  } finally {
    input?.destroy?.();
    dom.window.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
`,
    );
    execFileSync(process.execPath, [fixture], {
      cwd: consumerRoot,
      stdio: "inherit",
      timeout: 30000,
    });
  }
}
