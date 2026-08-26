import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const declarations = [
  "index",
  "entries/browser",
  "entries/adapters",
  "entries/auto-register",
  "ui/default-ui",
  "web-component/braille-input",
];
for (const declaration of declarations) {
  const source = resolve(root, `dist/types/${declaration}.d.ts`);
  await copyFile(source, source.replace(/\.d\.ts$/, ".d.mts"));
  await copyFile(source, source.replace(/\.d\.ts$/, ".d.cts"));
}
