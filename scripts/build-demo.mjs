import { build } from "vite";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
await build({
  root: resolve(root, "demo"),
  base: "./",
  build: {
    outDir: resolve(root, "dist/demo"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: { input: resolve(root, "demo/index.html") },
  },
});
await mkdir(resolve(root, "dist/demo"), { recursive: true });
await copyFile(
  resolve(root, "src/ui/default-ui.css"),
  resolve(root, "dist/demo/default-ui.css"),
);
