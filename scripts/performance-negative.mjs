import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const result = spawnSync(process.execPath, ["scripts/performance.mjs"], {
  cwd: root,
  env: { ...process.env, BRAILLE_PERF_INJECT_LONG_TASK: "1" },
  encoding: "utf8",
});
if (result.status === 0)
  throw new Error("Injected long-task performance run unexpectedly passed.");
const report = JSON.parse(
  await readFile(resolve(root, "dist/performance-negative.json"), "utf8"),
);
if (!report.browserResult?.longTaskObserverSupported)
  throw new Error("Negative performance run did not use PerformanceObserver.");
if ((report.browserResult.longTaskCountByPhase?.actions ?? 0) === 0)
  throw new Error(
    "Negative performance run did not observe an actions-phase long task.",
  );
if (
  !/negative gate failed closed|real actions-phase/i.test(
    result.stderr + result.stdout,
  )
)
  throw new Error("Negative performance run failed for an unexpected reason.");
console.log(
  JSON.stringify(
    {
      status: "negative probe passed",
      actionsPhaseLongTasks: report.browserResult.longTaskCountByPhase.actions,
    },
    null,
    2,
  ),
);
