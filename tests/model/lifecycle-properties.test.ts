import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import fc from "fast-check";
import * as core from "../../src/index.js";
import {
  runLifecycleModel,
  type ModelAction,
} from "../fixtures/lifecycle-model.js";

const actions = fc.array(
  fc.record({
    kind: fc.constantFrom<ModelAction["kind"]>(
      "down",
      "up",
      "cancel",
      "loss",
      "global-loss",
      "commit",
      "discard",
      "disable",
      "disable-discard",
      "enable",
      "reset",
      "config",
      "mode",
      "destroy",
      "rebuild",
    ),
    slot: fc.constantFrom<1 | 2 | 3>(1, 2, 3),
    delivery: fc.constantFrom<ModelAction["delivery"]>(
      "accepted",
      "rejected",
      "unhandled",
      "conflicted",
    ),
  }),
  { minLength: 1, maxLength: 100 },
);

for (const mode of ["chord", "sequential", "custom"] as const) {
  it(`checks generated ${mode} lifecycle sequences against an independent set model`, () => {
    for (const seed of [20261007, 730145, 619423]) {
      const result = fc.check(
        fc.property(actions, (sequence) =>
          runLifecycleModel(core, mode, sequence),
        ),
        { seed, numRuns: 200, verbose: true },
      );
      if (result.failed) {
        const directory = resolve(
          process.env.BRAILLE_PROPERTY_EVIDENCE ?? ".local/property-failures",
        );
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          resolve(directory, `${mode}-${seed}.json`),
          JSON.stringify(
            {
              seed: result.seed,
              path: result.counterexamplePath,
              numShrinks: result.numShrinks,
              counterexample: result.counterexample,
              error: String(result.errorInstance),
            },
            null,
            2,
          ),
        );
      }
      expect(
        result.failed,
        JSON.stringify({
          seed,
          mode,
          counterexample: result.counterexample,
          error: String(result.errorInstance),
        }),
      ).toBe(false);
    }
  });
}

it.each(["disable", "config"] as const)(
  "does not resurrect a Chord after %s",
  (kind) => {
    runLifecycleModel(core, "chord", [
      { kind: "down", slot: 1, delivery: "accepted" },
      { kind, slot: 1, delivery: "accepted" },
      { kind: "enable", slot: 1, delivery: "accepted" },
      { kind: "commit", slot: 1, delivery: "accepted" },
    ]);
  },
);
