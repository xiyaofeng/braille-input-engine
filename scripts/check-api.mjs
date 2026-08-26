import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const entryPoint = resolve(root, "dist/types/index.d.ts");
const report = resolve(root, "docs/api/braille-input-engine.api.md");
try {
  await access(entryPoint);
} catch {
  throw new Error("API check requires a current declaration build.");
}

execFileSync(
  resolve(root, "node_modules/.bin/api-extractor"),
  ["run", "--config", resolve(root, "api-extractor.json")],
  { cwd: root, stdio: "inherit" },
);
await access(report);

const exportedSubpaths = Object.keys(packageJson.exports ?? {});
if (!exportedSubpaths.includes(".") || !exportedSubpaths.includes("./browser"))
  throw new Error(
    "The public export map is missing the root or browser entry.",
  );
console.log(
  `API Extractor baseline verified: ${exportedSubpaths.length} exports.`,
);
