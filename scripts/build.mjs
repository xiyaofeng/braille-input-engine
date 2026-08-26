import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { build as vite } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const entries = {
  index: "src/index.ts",
  core: "src/index.ts",
  browser: "src/entries/browser.ts",
  adapters: "src/entries/adapters.ts",
  "default-ui": "src/ui/default-ui.ts",
  "web-component": "src/web-component/braille-input.ts",
  "auto-register": "src/entries/auto-register.ts",
};

for (const format of ["es", "cjs"]) {
  const extension = format === "es" ? "js" : "cjs";
  await vite({
    configFile: false,
    root,
    build: {
      outDir: "dist",
      emptyOutDir: format === "es",
      sourcemap: true,
      minify: false,
      lib: {
        entry: entries,
        formats: [format],
        fileName: () => `[name].${extension}`,
      },
      rollupOptions: {
        output: {
          entryFileNames: `[name].${extension}`,
          chunkFileNames: `chunks/[name]-[hash].${extension}`,
          assetFileNames: "[name][extname]",
          manualChunks(id) {
            if (id.includes("/src/adapters/")) return "adapters-runtime";
          },
        },
      },
    },
  });
}

await vite({
  configFile: false,
  root,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    minify: "esbuild",
    lib: {
      entry: "src/entries/browser.ts",
      name: "BrailleInput",
      formats: ["iife"],
      fileName: () => "braille-input.iife.min.js",
    },
  },
});

for (const format of ["es", "cjs"]) {
  const extension = format === "es" ? "js" : "cjs";
  const moduleFormat = format === "es" ? "esm" : "cjs";
  await esbuild({
    entryPoints: ["src/entries/core-adapters.ts"],
    bundle: true,
    format: moduleFormat,
    platform: "browser",
    target: "es2022",
    minify: false,
    sourcemap: "external",
    outfile: `dist/c.${extension}`,
    logLevel: "silent",
  });

  const coreExports = {
    BrailleController: "a",
    BrailleInputException: "b",
    brailleToCodePoint: "c",
    brailleToDots: "d",
    createBrailleController: "e",
    defaultControllerOptions: "f",
    defaultKeyboardOptions: "g",
    dotsToBraille: "h",
    dotsToMask: "i",
    extensionId: "j",
    isBrailleDot: "k",
    isExtensionId: "l",
    isInputMode: "m",
    isInputSource: "n",
  };
  const adapterExports = {
    attachBrailleEditable: "o",
    attachKeyboard: "p",
    attachPointer: "q",
    createActivationGroup: "r",
    getActivationGroup: "s",
    isEditableTargetAttached: "t",
    validateBrailleEditableTarget: "u",
  };
  const target = `./c.${extension}`;
  const wrappers = {
    index: coreExports,
    core: coreExports,
    adapters: adapterExports,
  };
  for (const [entry, exports] of Object.entries(wrappers)) {
    const names = Object.keys(exports);
    const source =
      format === "es"
        ? `export { ${names.map((name) => `${exports[name]} as ${name}`).join(", ")} } from ${JSON.stringify(target)};\n`
        : `const runtime = require(${JSON.stringify(target)});\nmodule.exports = { ${names.map((name) => `${name}: runtime.${exports[name]}`).join(", ")} };\n`;
    await writeFile(`dist/${entry}.${extension}`, source);
  }
}
