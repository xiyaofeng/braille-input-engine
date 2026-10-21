import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceTreeHash } from "../../scripts/source-tree-hash.mjs";

async function fixture(bytes) {
  const root = await mkdtemp(join(tmpdir(), "braille-source-hash-"));
  try {
    execFileSync("git", ["init", "-q", root]);
    await writeFile(join(root, "source.bin"), Buffer.alloc(bytes, 0x61));
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: root },
    );
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

describe("release source archive hash", () => {
  it.each([128, 3 * 1024 * 1024])(
    "matches an independently archived complete tree with %i source bytes",
    async (bytes) => {
      const root = await fixture(bytes);
      try {
        const archive = join(root, "expected.tar");
        execFileSync(
          "git",
          ["archive", "--format=tar", `--output=${archive}`, "HEAD"],
          { cwd: root },
        );
        const data = await readFile(archive);
        if (bytes > 1024 * 1024)
          expect(data.length).toBeGreaterThan(1024 * 1024);
        expect(await sourceTreeHash(root, "HEAD")).toBe(
          createHash("sha256").update(data).digest("hex"),
        );
        await writeFile(join(root, "source.bin"), "working-tree-only change");
        expect(await sourceTreeHash(root, "HEAD")).toBe(
          createHash("sha256").update(data).digest("hex"),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects Git failure instead of returning a hash of empty output", async () => {
    const root = await fixture(128);
    try {
      await expect(sourceTreeHash(root, "does-not-exist")).rejects.toThrow(
        "git archive failed",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["#!/bin/sh\nprintf partial-archive\nexit 7\n", "git archive failed"],
    [
      "#!/bin/sh\nprintf partial-archive\nkill -TERM $$\n",
      "git archive failed",
    ],
    [null, "ENOENT"],
  ])(
    "rejects incomplete output or spawn errors (%#)",
    async (script, message) => {
      const root = await mkdtemp(
        join(tmpdir(), "braille-source-hash-failure-"),
      );
      try {
        if (script !== null)
          await writeFile(join(root, "git"), script, { mode: 0o755 });
        const helper = new URL(
          "../../scripts/source-tree-hash.mjs",
          import.meta.url,
        ).href;
        const runner = join(root, "runner.mjs");
        await writeFile(
          runner,
          `import { sourceTreeHash } from ${JSON.stringify(helper)};
try { await sourceTreeHash(${JSON.stringify(root)}, "HEAD"); process.exitCode = 1; }
catch (error) { console.log(error.message); }
`,
        );
        const output = execFileSync(process.execPath, [runner], {
          cwd: resolve(root),
          encoding: "utf8",
          env: { ...process.env, PATH: root },
        });
        expect(output).toContain(message);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
