import { execFileSync } from "node:child_process";
import { sourceTreeHash as hashSourceTree } from "./source-tree-hash.mjs";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { verifyReleaseDemo } from "./verify-release-demo.mjs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const releaseDir = resolve(root, "release");
const engineName = `braille-input-engine-v${pkg.version}.tgz`;
const demoName = `braille-input-demo-v${pkg.version}.zip`;
const spdxName = `braille-input-engine-v${pkg.version}.spdx.json`;
const manifestName = `braille-input-engine-v${pkg.version}.manifest.json`;
const assetNames = [engineName, demoName, spdxName, manifestName];
const manifestPath = resolve(releaseDir, manifestName);
try {
  await access(manifestPath);
} catch {
  throw new Error(
    "Release assets are stale or unbound: the exact-commit manifest is missing.",
  );
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const commit = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const status = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { cwd: root, encoding: "utf8" },
).trim();
if (status)
  throw new Error(
    "Release verification requires the same clean worktree used to build the manifest.",
  );
const sourceTreeHash = await hashSourceTree(root, commit);
const lockfileHash = createHash("sha256")
  .update(await readFile(resolve(root, "package-lock.json")))
  .digest("hex");
if (
  manifest.commit !== commit ||
  manifest.sourceTreeHash !== sourceTreeHash ||
  manifest.lockfileHash !== lockfileHash
)
  throw new Error(
    "Release manifest does not match the current exact commit and source tree.",
  );
const sums = await readFile(resolve(releaseDir, "SHA256SUMS"), "utf8");
const sumMap = new Map(
  sums
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^(\S+)\s+\*?(\S+)$/.exec(line);
      if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
      return [match[2], match[1]];
    }),
);
for (const name of assetNames) {
  const asset = await readFile(resolve(releaseDir, name));
  const digest = createHash("sha256").update(asset).digest("hex");
  if (sumMap.get(name) !== digest)
    throw new Error(`SHA-256 mismatch for ${name}.`);
}
for (const asset of manifest.assets ?? []) {
  if (sumMap.get(asset.name) !== asset.sha256)
    throw new Error(`Manifest hash mismatch for ${asset.name}.`);
}

const temp = await mkdtemp(join(tmpdir(), "braille-release-verify-"));
try {
  const packageArchive = resolve(releaseDir, engineName);
  execFileSync("tar", ["-xzf", packageArchive, "-C", temp]);
  const packageRoot = join(temp, "package");
  const packedPackage = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const expectedFiles = [
    "LICENSE",
    "README.md",
    "DEPLOYMENT.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "docs/third-party-licenses.md",
    "dist/index.js",
    "dist/index.cjs",
    "dist/types/index.d.ts",
    "dist/browser.js",
    "dist/browser.cjs",
    "dist/adapters.js",
    "dist/adapters.cjs",
    "dist/default-ui.css",
    "dist/default-ui.js",
    "dist/default-ui.cjs",
    "dist/web-component.js",
    "dist/web-component.cjs",
    "dist/auto-register.js",
    "dist/auto-register.cjs",
    "dist/braille-input.iife.min.js",
  ];
  for (const relative of expectedFiles)
    await readFile(join(packageRoot, relative));
  function exportTargets(value) {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object") return [];
    return Object.values(value).flatMap(exportTargets);
  }
  for (const target of Object.values(packedPackage.exports)) {
    const targets = exportTargets(target);
    if (!targets.length)
      throw new Error("Release package has an empty export.");
    for (const target of targets) await readFile(join(packageRoot, target));
  }

  // Exercise this exact release archive, never a new npm pack or workspace dist.
  execFileSync(process.execPath, [resolve(root, "scripts/test-package.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      BRAILLE_PACKAGE_TARBALL: packageArchive,
      BRAILLE_PACKAGE_EXPECTED_NODE_VERSION: process.versions.node,
      BRAILLE_PACKAGE_TYPESCRIPT_VERSION: pkg.devDependencies.typescript,
      BRAILLE_PACKAGE_TYPESCRIPT_BIN: resolve(
        root,
        "node_modules/typescript/bin/tsc",
      ),
      BRAILLE_PACKAGE_MATRIX_ID: "exact-release-asset",
    },
  });

  const esm = await import(join(packageRoot, "dist/index.js"));
  if (esm.dotsToBraille([1, 2, 4]) !== "⠋")
    throw new Error("Release ESM smoke failed.");
  const cjs = await import(join(packageRoot, "dist/index.cjs"));
  if (cjs.dotsToBraille([1]) !== "⠁")
    throw new Error("Release CommonJS smoke failed.");
  const ssr = await import(join(packageRoot, "dist/core.js"));
  let received = null;
  const controller = ssr.createBrailleController({
    outputSink: {
      write(action) {
        received = action;
        return "accepted";
      },
    },
  });
  controller.dispatch({
    type: "dot-down",
    dot: 1,
    inputId: "release-verify",
    source: "api",
  });
  controller.commitPending();
  if (received?.kind !== "braille" || received.char !== "⠁")
    throw new Error("Release SSR smoke failed.");
  controller.destroy();

  await verifyReleaseDemo(resolve(releaseDir, demoName));
} finally {
  await rm(temp, { recursive: true, force: true });
}
console.log(
  "Release asset hashes, exact-tgz consumers, SSR, exports, and static demo input passed.",
);
