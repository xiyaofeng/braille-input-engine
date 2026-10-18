import type { activationLossCases } from "./activation-loss.js";
import { expect } from "vitest";

export function assertActivationLossResults(
  results: Awaited<ReturnType<typeof activationLossCases>>,
  check: typeof expect,
) {
  check(results).toHaveLength(120);
  for (const result of results) {
    const label = JSON.stringify(result);
    check(result.diagnostics, label).toEqual([]);
    if (result.kind === "group") {
      check(result.fired, label).toBe(true);
      check(result.after.pendingDots, label).toEqual([2]);
      check(result.after.pressedInputIds, label).toHaveLength(1);
      check(result.final.pendingDots, label).toEqual([]);
      check(result.final.pressedInputIds, label).toEqual([]);
      check(result.outputs, label).toEqual(["⠂"]);
    } else {
      check(result.frozen?.awaitingRetry, label).toBe(true);
      check(result.after.awaitingRetry, label).toBe(true);
      check(result.after.pendingDots, label).toEqual([1]);
      check(result.after.pendingSources, label).toEqual(
        result.frozen?.pendingSources,
      );
      check(result.final.awaitingRetry, label).toBe(false);
      check(result.final.pendingDots, label).toEqual([]);
      check(result.attempts, label).toEqual(["⠁", "⠁", "⠂"]);
    }
  }
}
