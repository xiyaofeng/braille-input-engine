import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const allowedLicenses = [
  "(MIT AND CC-BY-3.0)",
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-3.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
];
const lockfile = JSON.parse(
  await readFile(resolve(root, "package-lock.json"), "utf8"),
);
const inventoryEntries = [];
for (const [packagePath, metadata] of Object.entries(lockfile.packages ?? {})) {
  if (!packagePath.startsWith("node_modules/")) continue;
  try {
    await access(resolve(root, packagePath));
  } catch {
    continue;
  }
  inventoryEntries.push([
    packagePath,
    { ...metadata, path: resolve(root, packagePath) },
  ]);
}
const inventory = Object.fromEntries(inventoryEntries);
const missing = [];
const disallowed = [];
for (const [packageName, metadata] of Object.entries(inventory)) {
  if (!metadata || typeof metadata.license !== "string")
    missing.push(`${packageName}: license`);
  else if (!allowedLicenses.includes(metadata.license))
    disallowed.push(`${packageName}: ${metadata.license}`);
  if (typeof metadata?.path !== "string") missing.push(`${packageName}: path`);
}
if (missing.length > 0 || disallowed.length > 0) {
  const details = [...missing.map((item) => `missing ${item}`), ...disallowed];
  throw new Error(
    `License inventory is incomplete or disallowed:\n${details.join("\n")}`,
  );
}
if (packageJson.license !== "MIT")
  throw new Error("The project license must be MIT.");
const documentation = await readFile(
  resolve(root, "docs/third-party-licenses.md"),
  "utf8",
);
for (const phrase of [
  "package-lock.json",
  "allowed license",
  "tooling dependencies",
]) {
  if (!documentation.toLowerCase().includes(phrase.toLowerCase()))
    throw new Error(`Third-party license documentation is missing: ${phrase}`);
}
console.log(
  `License inventory passed: ${Object.keys(inventory).length} packages; allowed set ${allowedLicenses.length} licenses.`,
);
