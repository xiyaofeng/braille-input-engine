import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measureScenario } from "./size-graph.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const baseline = JSON.parse(
  await readFile(resolve(root, "docs/size-baseline.json"), "utf8"),
);
const scenarios = [
  {
    name: "core",
    entries: ["dist/index.js", "dist/adapters.js"],
    budget: 16 * 1024,
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
  const reviewed = baseline.scenarios[scenario.name];
  if (
    !Number.isInteger(reviewed) ||
    !Number.isInteger(baseline.maxUnreviewedGrowthBytes)
  )
    throw new Error("Missing or invalid reviewed size baseline.");
  measured.reviewedGzipBytes = reviewed;
  measured.deltaGzipBytes = measured.gzipBytes - reviewed;
  result.push(measured);
  if (measured.deltaGzipBytes > baseline.maxUnreviewedGrowthBytes)
    failures.push(
      `${measured.name} grew ${measured.deltaGzipBytes} bytes; review the change and update docs/size-baseline.json with evidence`,
    );
  if (measured.gzipBytes > measured.budget)
    failures.push(
      `${measured.name} bundle exceeds ${measured.budget} byte gzip budget: ${measured.gzipBytes}`,
    );
}
console.log(JSON.stringify({ scenarios: result }, null, 2));
if (failures.length > 0) throw new Error(failures.join("\n"));
