import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
await mkdir(resolve(root, "dist"), { recursive: true });
await copyFile(
  resolve(root, "src/ui/default-ui.css"),
  resolve(root, "dist/default-ui.css"),
);
