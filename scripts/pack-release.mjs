import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const releaseDir = resolve(root, "release");
const status = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { cwd: root, encoding: "utf8" },
).trim();
if (status)
  throw new Error(
    "pack:release requires a clean worktree with no staged, unstaged, or untracked files.",
  );
const commit = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (!/^[0-9a-f]{40}$/.test(commit))
  throw new Error("pack:release requires an exact commit.");
const sourceTreeHash = createHash("sha256")
  .update(
    execFileSync("git", ["archive", "--format=tar", commit], { cwd: root }),
  )
  .digest("hex");
const lockfileHash = createHash("sha256")
  .update(await readFile(resolve(root, "package-lock.json")))
  .digest("hex");
const nodeVersion = execFileSync("node", ["--version"], {
  encoding: "utf8",
}).trim();
const npmVersion = execFileSync("npm", ["--version"], {
  encoding: "utf8",
}).trim();
const frozenNode = (
  await readFile(resolve(root, ".node-version"), "utf8")
).trim();
const frozenNpm = String(pkg.packageManager).replace(/^npm@/, "");
if (nodeVersion !== `v${frozenNode}` || npmVersion !== frozenNpm)
  throw new Error(
    `pack:release requires Node ${frozenNode}/npm ${frozenNpm}; found ${nodeVersion}/${npmVersion}.`,
  );
await mkdir(releaseDir, { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), "braille-release-"));
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
execFileSync("npm", ["run", "build:demo"], { cwd: root, stdio: "inherit" });
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: resolve(temp, "npm-cache") },
  }),
)[0].filename;
const engineName = `braille-input-engine-v${pkg.version}.tgz`;
const demoName = `braille-input-demo-v${pkg.version}.zip`;
const spdxName = `braille-input-engine-v${pkg.version}.spdx.json`;
const manifestName = `braille-input-engine-v${pkg.version}.manifest.json`;
await copyFile(resolve(root, packed), resolve(releaseDir, engineName));
execFileSync("zip", ["-qr", resolve(releaseDir, demoName), "."], {
  cwd: resolve(root, "dist/demo"),
});
await writeFile(
  resolve(releaseDir, spdxName),
  JSON.stringify(
    {
      SPDXID: "SPDXRef-DOCUMENT",
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      name: "braille-input-engine",
      documentNamespace: `https://github.com/xiyaofeng/braille-input-engine/releases/${pkg.version}`,
      creationInfo: {
        creators: ["Tool: braille-input-engine pack:release"],
        created: new Date().toISOString(),
      },
      packages: [
        {
          SPDXID: "SPDXRef-Package-braille-input-engine",
          name: pkg.name,
          versionInfo: pkg.version,
          downloadLocation: "NOASSERTION",
          licenseConcluded: "MIT",
          licenseDeclared: "MIT",
          filesAnalyzed: false,
        },
      ],
    },
    null,
    2,
  ),
);
const hashes = [];
const assetNames = [engineName, demoName, spdxName];
const assetHashes = {};
for (const name of assetNames) {
  const digest = createHash("sha256")
    .update(await readFile(resolve(releaseDir, name)))
    .digest("hex");
  assetHashes[name] = digest;
  hashes.push(`${digest}  ${name}`);
}
await writeFile(
  resolve(releaseDir, manifestName),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      commit,
      sourceTreeHash,
      lockfileHash,
      toolchain: { node: nodeVersion, npm: npmVersion },
      buildCommand: "npm run build && npm run build:demo",
      assets: assetNames.map((name) => ({ name, sha256: assetHashes[name] })),
    },
    null,
    2,
  )}\n`,
);
hashes.push(
  `${createHash("sha256")
    .update(await readFile(resolve(releaseDir, manifestName)))
    .digest("hex")}  ${manifestName}`,
);
await writeFile(resolve(releaseDir, "SHA256SUMS"), `${hashes.join("\n")}\n`);
await rm(resolve(root, packed), { force: true });
await rm(temp, { recursive: true, force: true });
