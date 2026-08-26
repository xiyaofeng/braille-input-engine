import { describe, expect, it } from "vitest";
import { validatePerformanceResult } from "../../scripts/performance-gate.mjs";

const healthy = {
  stateSubscriptionP95Milliseconds: [1, 1, 1, 1, 1],
  defaultUiNextPaintP95Milliseconds: [16, 16, 16, 16, 16],
  longTaskCountByPhase: { warmup: 0, actions: 0, lifecycle: 0 },
  listenerDelta: 0,
  targetRegistryLeaks: 0,
};

describe("performance gate evidence", () => {
  it("rejects a long task recorded during the action phase", () => {
    expect(() =>
      validatePerformanceResult({
        ...healthy,
        longTaskCountByPhase: { ...healthy.longTaskCountByPhase, actions: 1 },
      }),
    ).toThrow("action phase");
  });

  it("rejects lifecycle listener and target registry leaks", () => {
    expect(() =>
      validatePerformanceResult({ ...healthy, listenerDelta: 1 }),
    ).toThrow("listener registry");
    expect(() =>
      validatePerformanceResult({ ...healthy, targetRegistryLeaks: 1 }),
    ).toThrow("Target registry");
  });
});
