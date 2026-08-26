import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { measureScenario } from "../../scripts/size-graph.mjs";
import { describe, expect, it } from "vitest";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "braille-size-"));
  await mkdir(join(root, "chunks"));
  const noisy = randomBytes(24_000);
  await writeFile(join(root, "entry.js"), 'import "./chunks/shared.js";\n');
  await writeFile(join(root, "other.js"), 'import "./chunks/shared.js";\n');
  await writeFile(join(root, "chunks/shared.js"), noisy);
  return { root };
}

describe("bundle size graph", () => {
  it("counts a large shared chunk reached from a tiny entry", async () => {
    const { root } = await fixture();
    try {
      const result = await measureScenario({
        root,
        entries: ["entry.js"],
        budget: 1024,
        name: "fixture",
      });
      expect(result.files.map((file) => file.path)).toEqual([
        "chunks/shared.js",
        "entry.js",
      ]);
      expect(result.gzipBytes).toBeGreaterThan(1024);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("counts a shared chunk once across multiple canonical entries", async () => {
    const { root } = await fixture();
    try {
      const one = await measureScenario({
        root,
        entries: ["entry.js"],
        budget: 1_000_000,
        name: "one",
      });
      const two = await measureScenario({
        root,
        entries: ["entry.js", "other.js"],
        budget: 1_000_000,
        name: "two",
      });
      expect(
        two.files.filter((file) => file.path === "chunks/shared.js"),
      ).toHaveLength(1);
      expect(two.gzipBytes).toBe(
        one.gzipBytes +
          (
            await measureScenario({
              root,
              entries: ["other.js"],
              budget: 1_000_000,
              name: "other",
            })
          ).files.find((file) => file.path === "other.js")?.gzipBytes,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("produces deterministic gzip measurements", async () => {
    const { root } = await fixture();
    try {
      const first = await measureScenario({
        root,
        entries: ["entry.js"],
        budget: 1_000_000,
        name: "fixture",
      });
      const second = await measureScenario({
        root,
        entries: ["entry.js"],
        budget: 1_000_000,
        name: "fixture",
      });
      expect(second).toEqual(first);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
