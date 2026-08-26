import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: {
        index: "src/index.ts",
        core: "src/index.ts",
        browser: "src/entries/browser.ts",
        adapters: "src/entries/adapters.ts",
        "default-ui": "src/ui/default-ui.ts",
        "web-component": "src/web-component/braille-input.ts",
        "auto-register": "src/entries/auto-register.ts",
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) =>
        `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
