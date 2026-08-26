export function renderPerformanceBaseline(report) {
  const contract = report.contract;
  const result = report.browserResult;
  if (!contract || !result)
    throw new Error("Performance baseline source is incomplete.");
  const formatMs = (value) =>
    value === null || value === undefined ? "—" : `${value.toFixed(2)} ms`;
  const rows = result.stateSubscriptionP95Milliseconds
    .map(
      (state, index) =>
        `| ${index + 1} | ${formatMs(state)} | ${formatMs(result.defaultUiNextPaintP95Milliseconds[index])} |`,
    )
    .join("\n");
  const memoryGiB = report.host.totalMemoryBytes / 1024 ** 3;
  const raw = JSON.stringify(report, null, 2);
  return `# Performance baseline

<!-- braille-performance-baseline
${JSON.stringify(contract)}
-->

<!-- braille-performance-baseline-result
${raw}
-->

Status: \`local\`. This document is generated from a locally retained raw run;
the test command validates the current run separately against the public
performance contract and the same budgets. This five-round Chromium scenario is not evidence
for the brand-browser, assistive-technology, real-device, or target-user M4
matrix.

The repeatable command is \`npm run test:performance\`. It warms
${contract.warmupActions} actions, then runs ${contract.rounds} independent rounds of
${contract.actionsPerRound} actions in an isolated headless Chromium context. The
command writes the current raw report to \`dist/performance-baseline.json\` and
fails if any budget or lifecycle assertion is exceeded.

Retained raw run: ${report.generatedAt} UTC.

| Round | State subscription p95 | Default UI next-paint p95 |
| ----- | ---------------------: | ------------------------: |
${rows}

Environment: ${report.host.cpuModel}, ${report.host.cpuCount} CPU cores,
${memoryGiB.toFixed(0)} GiB RAM, ${report.host.platform} ${report.host.release},
Node ${report.node}, npm ${report.npm}, Playwright Chromium revision
\`${report.playwrightChromium.revision}\` (${report.playwrightChromium.observedBrowserVersion}),
headless context, visible page state, ${report.throttling} throttling, power state
${report.powerState}. Long tasks by phase: ${JSON.stringify(result.longTaskCountByPhase)}.
Attachment listener registry entries after 100 attach/detach cycles:
${result.listenerRegistryLeaks}. Target registry leaks after 100 connect/disconnect
cycles: ${result.targetRegistryLeaks}. Lifecycle output-count mismatches:
${result.lifecycleOutputMismatches}. Each round collected
${contract.actionsPerRound} state and paint samples.
`;
}
