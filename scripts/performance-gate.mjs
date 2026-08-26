export function validatePerformanceResult(result) {
  for (const value of result.stateSubscriptionP95Milliseconds ?? []) {
    if (value === null || value > 5)
      throw new Error("State subscription p95 exceeded the 5 ms budget.");
  }
  for (const value of result.defaultUiNextPaintP95Milliseconds ?? []) {
    if (value === null || value > 50)
      throw new Error("Default UI next-paint p95 exceeded the 50 ms budget.");
  }
  if ((result.longTaskCountByPhase?.actions ?? result.longTaskCount ?? 0) > 0)
    throw new Error(
      "A long task was observed during the performance action phase.",
    );
  if (result.listenerDelta !== 0)
    throw new Error("Attachment listener registry did not return to baseline.");
  if ((result.listenerRegistryLeaks ?? 0) !== 0)
    throw new Error(
      "Attachment listener registry retained a real listener tuple.",
    );
  if ((result.targetRegistryLeaks ?? 0) !== 0)
    throw new Error("Target registry did not return to baseline.");
  if ((result.lifecycleOutputMismatches ?? 0) !== 0)
    throw new Error("Lifecycle workload produced a delayed output action.");
}
