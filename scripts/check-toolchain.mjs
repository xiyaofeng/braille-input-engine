import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const expectedNode = (
  await readFile(resolve(root, ".node-version"), "utf8")
).trim();
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const expectedNpm = String(packageJson.packageManager).replace(/^npm@/, "");
const actualNode = process.versions.node;
const actualNpm = execFileSync("npm", ["--version"], {
  encoding: "utf8",
}).trim();
if (actualNode !== expectedNode || actualNpm !== expectedNpm) {
  throw new Error(
    `Frozen toolchain required: Node ${expectedNode}/npm ${expectedNpm}; found Node ${actualNode}/npm ${actualNpm}.`,
  );
}
console.log(`Frozen toolchain: Node ${actualNode}, npm ${actualNpm}`);
