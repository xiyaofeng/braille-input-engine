import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PACKAGE_CONSUMER_MATRIX,
  PACKAGE_CONSUMER_NODE_VERSIONS,
  PACKAGE_CONSUMER_TYPESCRIPT_VERSIONS,
} from "./package-consumer-matrix.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const frozenNode = (
  await readFile(resolve(root, ".node-version"), "utf8")
).trim();
if (process.versions.node !== frozenNode)
  throw new Error(
    `The local packed consumer matrix must start on frozen Node ${frozenNode}; found ${process.versions.node}.`,
  );
if (
  PACKAGE_CONSUMER_MATRIX.length !==
  PACKAGE_CONSUMER_NODE_VERSIONS.length *
    PACKAGE_CONSUMER_TYPESCRIPT_VERSIONS.length
)
  throw new Error(
    "The packed consumer matrix is missing a required combination.",
  );

const temp = await mkdtemp(join(tmpdir(), "braille-package-matrix-"));
let tarballPath;
try {
  execFileSync("mise", ["--version"], { stdio: "ignore" });
  const output = execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", temp],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: join(temp, "npm-cache") },
    },
  );
  const filename = JSON.parse(output)[0]?.filename;
  if (!filename) throw new Error("npm pack did not produce a matrix tarball.");
  tarballPath = resolve(temp, filename);
  await access(tarballPath);
  console.log(
    `Packed consumer matrix artifact: ${packageJson.name} ${packageJson.version}.`,
  );

  for (const { node, typescript } of PACKAGE_CONSUMER_MATRIX) {
    const matrixId = `node-${node}-typescript-${typescript}`;
    console.log(`\n> ${matrixId}`);
    execFileSync(
      "mise",
      [
        "exec",
        `node@${node}`,
        "--",
        "node",
        resolve(root, "scripts/test-package.mjs"),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          BRAILLE_PACKAGE_TARBALL: tarballPath,
          BRAILLE_PACKAGE_EXPECTED_NODE_VERSION: node,
          BRAILLE_PACKAGE_TYPESCRIPT_VERSION: typescript,
          BRAILLE_PACKAGE_MATRIX_ID: matrixId,
        },
        stdio: "inherit",
      },
    );
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log(
  `Packed consumer matrix passed: Node ${PACKAGE_CONSUMER_NODE_VERSIONS.join(", ")} × TypeScript ${PACKAGE_CONSUMER_TYPESCRIPT_VERSIONS.join(", ")}.`,
);
