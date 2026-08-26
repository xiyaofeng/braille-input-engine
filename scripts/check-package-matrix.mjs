import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PACKAGE_CONSUMER_MATRIX,
  PACKAGE_CONSUMER_NODE_VERSIONS,
  PACKAGE_CONSUMER_TYPESCRIPT_VERSIONS,
} from "./package-consumer-matrix.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const workflow = await readFile(
  resolve(root, ".github/workflows/ci.yml"),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const packageScript = await readFile(
  resolve(root, "scripts/test-package.mjs"),
  "utf8",
);
const matrixJob = workflow.match(
  /  packed-consumer-matrix:\n([\s\S]*?)(?=\n  automated-m3-gate:)/,
)?.[1];
const compactMatrixJob = matrixJob?.replace(/\s+/g, "");
if (!matrixJob || !compactMatrixJob)
  throw new Error("The required packed consumer matrix job is missing.");

const requiredNodeList = `node:[${PACKAGE_CONSUMER_NODE_VERSIONS.map((value) => JSON.stringify(value)).join(",")}]`;
const requiredTypeScriptList = `typescript:[${PACKAGE_CONSUMER_TYPESCRIPT_VERSIONS.map((value) => JSON.stringify(value)).join(",")}]`;
for (const [value, label] of [
  [requiredNodeList, "Node versions"],
  [requiredTypeScriptList, "TypeScript versions"],
]) {
  if (!compactMatrixJob.includes(value))
    throw new Error(`Workflow packed consumer matrix is missing ${label}.`);
}
if (!/strategy:\n\s+fail-fast:\s+false\n\s+matrix:/.test(matrixJob))
  throw new Error("Packed consumer matrix must run all combinations.");
if (/\n\s+exclude:/.test(matrixJob))
  throw new Error(
    "Packed consumer matrix must not exclude a required combination.",
  );
for (const token of [
  "BRAILLE_PACKAGE_TARBALL",
  "BRAILLE_PACKAGE_EXPECTED_NODE_VERSION",
  "BRAILLE_PACKAGE_TYPESCRIPT_VERSION",
  "npm run test:package:case",
]) {
  if (!matrixJob.includes(token))
    throw new Error(`Workflow matrix is missing ${token}.`);
}

const aggregator = workflow.slice(workflow.indexOf("  automated-m3-gate:"));
if (
  !/needs:\n\s+- ci-auto\n\s+- packed-consumer-matrix/.test(aggregator) ||
  !/if:\s+\$\{\{\s*always\(\)\s*\}\}/.test(aggregator)
)
  throw new Error(
    "automated-m3-gate must always aggregate both ci-auto and the complete packed matrix.",
  );

if (
  packageJson.scripts?.["test:package:case"] !== "node scripts/test-package.mjs"
)
  throw new Error(
    "The workflow matrix must invoke the reusable package consumer test.",
  );
for (const token of [
  "npm pack",
  "BRAILLE_PACKAGE_TARBALL",
  "BRAILLE_PACKAGE_EXPECTED_NODE_VERSION",
  "BRAILLE_PACKAGE_TYPESCRIPT_VERSION",
]) {
  if (!packageScript.includes(token))
    throw new Error(`Packed consumer test is missing ${token}.`);
}
if (
  PACKAGE_CONSUMER_MATRIX.length !==
  PACKAGE_CONSUMER_NODE_VERSIONS.length *
    PACKAGE_CONSUMER_TYPESCRIPT_VERSIONS.length
)
  throw new Error("The local matrix definition is incomplete.");

console.log(
  `Packed consumer matrix wiring passed: ${PACKAGE_CONSUMER_MATRIX.length} required combinations and a fail-closed aggregator.`,
);
