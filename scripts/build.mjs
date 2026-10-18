import { fileURLToPath } from "node:url";
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
          hoistTransitiveImports: false,
          entryFileNames: `[name].${extension}`,
          chunkFileNames: `chunks/[name]-[hash].${extension}`,
          assetFileNames: "[name][extname]",
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
