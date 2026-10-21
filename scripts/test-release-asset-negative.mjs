import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const release = join(root, "release");
const engine = `braille-input-engine-v${pkg.version}.tgz`;
const demo = `braille-input-demo-v${pkg.version}.zip`;
const manifestName = `braille-input-engine-v${pkg.version}.manifest.json`;
const manifest = JSON.parse(
  await readFile(join(release, manifestName), "utf8"),
);
const names = [
  ...manifest.assets.map((asset) => asset.name),
  manifestName,
  "SHA256SUMS",
];
const originals = new Map(
  await Promise.all(
    names.map(async (name) => [name, await readFile(join(release, name))]),
  ),
);
async function restore() {
  for (const [name, contents] of originals)
    await writeFile(join(release, name), contents);
}
const digest = async (name) =>
  createHash("sha256")
    .update(await readFile(join(release, name)))
    .digest("hex");
async function resign() {
  const updated = structuredClone(manifest);
  for (const asset of updated.assets) asset.sha256 = await digest(asset.name);
  await writeFile(
    join(release, manifestName),
    JSON.stringify(updated, null, 2) + "\n",
  );
  const sums = [];
  for (const name of names.filter((name) => name !== "SHA256SUMS"))
    sums.push(`${await digest(name)}  ${name}`);
  await writeFile(join(release, "SHA256SUMS"), sums.join("\n") + "\n");
}
function verify() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-release-asset.mjs")],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error || result.signal)
    throw result.error ?? new Error(`Verifier terminated: ${result.signal}`);
  return { status: result.status, output: result.stdout + result.stderr };
}
async function removeJavaScript(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await removeJavaScript(path);
    else if (entry.name.endsWith(".js")) await rm(path);
  }
}

try {
  const normal = verify();
  assert.equal(normal.status, 0, normal.output);
  for (const [name, target, contents, expected] of [
    [
      "missing ESM conditional types",
      "dist/types/entries/browser.d.mts",
      null,
      /browser\.d\.mts/,
    ],
    [
      "missing CJS conditional types",
      "dist/types/entries/browser.d.cts",
      null,
      /browser\.d\.cts/,
    ],
    [
      "broken browser ESM",
      "dist/browser.js",
      'throw new Error("controlled broken browser");',
      /controlled broken browser/,
    ],
    [
      "broken browser CJS",
      "dist/browser.cjs",
      'throw new Error("controlled broken browser CJS");',
      /controlled broken browser CJS/,
    ],
    [
      "broken IIFE",
      "dist/braille-input.iife.min.js",
      'throw new Error("controlled broken IIFE");',
      /controlled broken IIFE|BrailleInput|undefined/,
    ],
    [
      "broken auto-register ESM",
      "dist/auto-register.js",
      'throw new Error("controlled broken auto-register ESM");',
      /controlled broken auto-register ESM/,
    ],
    [
      "broken auto-register CJS",
      "dist/auto-register.cjs",
      'throw new Error("controlled broken auto-register CJS");',
      /controlled broken auto-register CJS/,
    ],
    [
      "auto-register ESM without registration",
      "dist/auto-register.js",
      'export { defineBrailleInput } from "./web-component.js";',
      /Packed esm auto-register did not register braille-input/,
    ],
    [
      "auto-register CJS without registration",
      "dist/auto-register.cjs",
      'exports.defineBrailleInput = require("./web-component.cjs").defineBrailleInput;',
      /Packed cjs auto-register did not register braille-input/,
    ],
    ["missing package CSS", "dist/default-ui.css", null, /default-ui\.css/],
    ["demo without JavaScript", null, null, /Release demo/],
    ["demo without CSS", "default-ui.css", null, /default-ui\.css/],
  ]) {
    await restore();
    const temp = await mkdtemp(join(tmpdir(), "braille-release-negative-"));
    try {
      if (name.startsWith("demo")) {
        execFileSync("unzip", ["-q", join(release, demo), "-d", temp]);
        if (target) await rm(join(temp, target));
        else await removeJavaScript(temp);
        await rm(join(release, demo));
        execFileSync("zip", ["-qr", join(release, demo), "."], { cwd: temp });
      } else {
        execFileSync("tar", ["-xzf", join(release, engine), "-C", temp]);
        const path = join(temp, "package", target);
        await readFile(path); // Ensure the mutation actually changes a present asset.
        if (contents === null) await rm(path);
        else await writeFile(path, contents);
        execFileSync(
          "tar",
          ["-czf", join(release, engine), "-C", temp, "package"],
          {
            // macOS metadata entries can break third-party tar readers before the
            // intended semantic defect is reached. Keep fixtures npm-like.
            env: { ...process.env, COPYFILE_DISABLE: "1" },
          },
        );
      }
      await resign();
      const result = verify();
      assert.notEqual(result.status, 0, `Verifier accepted ${name}`);
      assert.doesNotMatch(
        result.output,
        /SHA-256 mismatch|Manifest hash mismatch|exact commit and source tree/,
      );
      assert.match(result.output, expected, `${name}: ${result.output}`);
      console.log(`Rejected self-consistent asset: ${name}`);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
} finally {
  await restore();
}
const restored = verify();
assert.equal(restored.status, 0, restored.output);
console.log(
  "Release semantic negative controls and restored normal asset passed.",
);
