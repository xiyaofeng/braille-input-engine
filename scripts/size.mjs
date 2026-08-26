import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measureScenario } from "./size-graph.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const scenarios = [
  {
    name: "core",
    entries: ["dist/index.js", "dist/adapters.js"],
    budget: 10 * 1024,
  },
  {
    name: "ui",
    entries: ["dist/default-ui.js"],
    extraFiles: ["dist/default-ui.css"],
    budget: 20 * 1024,
  },
  {
    name: "iife",
    entries: ["dist/braille-input.iife.min.js"],
    budget: 30 * 1024,
  },
];

const result = [];
const failures = [];
for (const scenario of scenarios) {
  const measured = await measureScenario({ root, ...scenario });
  result.push(measured);
  if (measured.gzipBytes > measured.budget)
    failures.push(
      `${measured.name} bundle exceeds ${measured.budget} byte gzip budget: ${measured.gzipBytes}`,
    );
}
console.log(JSON.stringify({ scenarios: result }, null, 2));
if (failures.length > 0) throw new Error(failures.join("\n"));
