import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const milestone = JSON.parse(
  await readFile(resolve(root, "docs/milestones.json"), "utf8"),
);

const commands = [
  ["check:toolchain"],
  ["check:package-matrix"],
  ["format:check"],
  ["lint"],
  ["typecheck"],
  ["test:unit"],
  ["test:dom"],
  ["test:types"],
  ["build"],
  ["build:demo"],
  ["test:ssr"],
  ["test:browser"],
  ["test:a11y"],
  ["test:package"],
  ["test:performance"],
  ["test:performance:negative"],
  ["size"],
  ["check:api"],
  ["test:security-policy"],
  ["check:security"],
  ["check:licenses"],
  ["check:links"],
];
const commandNames = new Set(commands.map(([name]) => name));
const suiteCommands = {
  format: "format:check",
  lint: "lint",
  type: "typecheck",
  unit: "test:unit",
  dom: "test:dom",
  model: "test:unit",
  contract: "test:types",
  coverage: "test:unit",
  build: "build",
  ssr: "test:ssr",
  browser: "test:browser",
  a11y: "test:a11y",
  package: "test:package",
  size: "size",
  performance: "test:performance",
  api: "check:api",
  security: "check:security",
  license: "check:licenses",
  links: "check:links",
};
if (milestone.milestone !== "M3")
  throw new Error(`Expected the M3 manifest, found ${milestone.milestone}.`);
for (const suite of milestone.enabledSuites ?? []) {
  const command = suiteCommands[suite];
  if (!command || !commandNames.has(command))
    throw new Error(`M3 manifest suite is not covered by ci:auto: ${suite}`);
}
console.log(
  `Executing ${milestone.milestone} suites from docs/milestones.json: ${milestone.enabledSuites.join(", ")}`,
);
for (const args of commands) {
  console.log(`\n> npm run ${args[0]}`);
  execFileSync("npm", ["run", ...args], { stdio: "inherit" });
}
console.log(
  "\nAutomated M3 gate passed. Brand-browser, assistive-technology, physical-rollover, and target-user evidence remain M4 pending.",
);
