import { build } from "esbuild";
import { gzipSize } from "gzip-size";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import vm from "node:vm";
import { measureScenario } from "./size-graph.mjs";

// Supplementary bundler consumers. The hard gate continues to count every
// reachable distribution file independently with size-graph.mjs.
export async function measureConsumers(dist = resolve("dist")) {
  const scenarios = {
    unicode: `export { dotsToBraille } from '${dist}/core.js';`,
    controller: `import { createBrailleController } from '${dist}/core.js'; export const c=createBrailleController(); c.dispatch({type:'dot-down',dot:1,inputId:'consumer',source:'api'}); c.commitPending(); c.destroy();`,
    keyboard: `export { createBrailleController } from '${dist}/core.js'; export { attachKeyboard } from '${dist}/adapters.js';`,
    pointer: `export { createBrailleController } from '${dist}/core.js'; export { attachPointer } from '${dist}/adapters.js';`,
    adapters: `export * from '${dist}/core.js'; export * from '${dist}/adapters.js';`,
    ui: `export { createBrailleController } from '${dist}/core.js'; export * from '${dist}/default-ui.js';`,
  };
  const result = [];
  for (const [name, contents] of Object.entries(scenarios)) {
    const built = await build({
      stdin: { contents, resolveDir: process.cwd() },
      bundle: true,
      treeShaking: true,
      minify: true,
      format: "cjs",
      platform: "browser",
      write: false,
    });
    const code = built.outputFiles[0].text;
    const compile = [],
      execute = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const script = new vm.Script(`${code}\n// compile sample ${i}`);
      const compiled = performance.now();
      script.runInNewContext({ module: { exports: {} }, exports: {} });
      const done = performance.now();
      if (i >= 5) {
        compile.push(compiled - start);
        execute.push(done - compiled);
      }
    }
    const median = (values) =>
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const css =
      name === "ui"
        ? await readFile(resolve(dist, "default-ui.css"))
        : Buffer.alloc(0);
    result.push({
      name,
      jsBytes: Buffer.byteLength(code),
      gzipBytes:
        (await gzipSize(code, { level: 9, mtime: 0 })) +
        (css.length ? await gzipSize(css, { level: 9, mtime: 0 }) : 0),
      compileMedianMs: median(compile),
      executeMedianMs: median(execute),
      containsDOM: /addEventListener|HTMLElement|document/.test(code),
    });
  }
  const iife = await readFile(resolve(dist, "braille-input.iife.min.js"));
  result.push({
    name: "iife",
    jsBytes: iife.length,
    gzipBytes: await gzipSize(iife, { level: 9, mtime: 0 }),
  });
  const graphs = [];
  for (const [name, entries, extraFiles] of [
    ["unicode", ["core.js"], []],
    ["controller", ["core.js"], []],
    ["keyboard", ["core.js", "adapters.js"], []],
    ["pointer", ["core.js", "adapters.js"], []],
    ["adapters", ["index.js", "adapters.js"], []],
    ["ui-with-controller", ["core.js", "default-ui.js"], ["default-ui.css"]],
    ["iife", ["braille-input.iife.min.js"], []],
  ])
    graphs.push(
      await measureScenario({ root: dist, name, entries, extraFiles }),
    );
  return {
    graphs,
    method:
      "esbuild bundled retained exports, gzip level 9 mtime 0, UI includes CSS; Node vm 5 warmup + 25 samples, new context per run; no network/browser loading claim",
    scenarios: result,
  };
}
if (process.argv[1]?.endsWith("measure-consumers.mjs"))
  console.log(
    JSON.stringify(
      await measureConsumers(resolve(process.argv[2] ?? "dist")),
      null,
      2,
    ),
  );
