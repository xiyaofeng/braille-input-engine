import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { validatePerformanceResult } from "./performance-gate.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const injectLongTask = process.env.BRAILLE_PERF_INJECT_LONG_TASK === "1";
const performanceContract = JSON.parse(
  await readFile(resolve(root, "docs/performance-contract.json"), "utf8"),
);
try {
  JSON.stringify(performanceContract);
} catch (error) {
  throw new Error("Performance contract is not valid JSON.", {
    cause: error,
  });
}
if (
  !Number.isInteger(performanceContract.warmupActions) ||
  !Number.isInteger(performanceContract.rounds) ||
  !Number.isInteger(performanceContract.actionsPerRound) ||
  !Array.isArray(performanceContract.requiredPhases) ||
  performanceContract.requiredPhases.length === 0
)
  throw new Error("Performance contract is incomplete.");
const iife = resolve(root, "dist/braille-input.iife.min.js");
if (!existsSync(iife)) execFileSync("npm", ["run", "build"], { cwd: root });
const browserManifest = JSON.parse(
  await readFile(
    resolve(root, "node_modules/playwright-core/browsers.json"),
    "utf8",
  ),
);
const chromiumSpec = browserManifest.browsers.find(
  (entry) => entry.name === "chromium",
);
if (!chromiumSpec) throw new Error("Playwright Chromium metadata is missing.");

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

const host = {
  platform: os.platform(),
  release: os.release(),
  arch: os.arch(),
  cpuModel: os.cpus()[0]?.model ?? "unknown",
  cpuCount: os.cpus().length,
  totalMemoryBytes: os.totalmem(),
  macOSProductVersion:
    os.platform() === "darwin"
      ? commandOutput("sw_vers", ["-productVersion"])
      : "not-applicable",
  macOSBuild:
    os.platform() === "darwin"
      ? commandOutput("sw_vers", ["-buildVersion"])
      : "not-applicable",
};

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.setContent(
    '<main><textarea id="target"></textarea><div id="ui"></div></main>',
  );
  await page.addScriptTag({ path: iife });
  const browserResult = await page.evaluate(
    async ({
      injectLongTask,
      warmupActions,
      rounds,
      actionsPerRound,
      requiredPhases,
    }) => {
      const api = globalThis.BrailleInput;
      if (!api) throw new Error("BrailleInput IIFE global is missing.");
      const controller = api.createBrailleController();
      const keyboard = api.attachKeyboard(controller, document, {
        activation: "always",
      });
      const host = document.querySelector("#ui");
      if (!host) throw new Error("Performance UI host is missing.");
      const ui = api.createDefaultBrailleUI(controller, host, {
        keyboardBindings: keyboard,
      });
      const cell = host.querySelector('[part~="cell"]');
      if (!(cell instanceof HTMLElement))
        throw new Error("Performance cell is missing.");
      const longTaskCountByPhase = { warmup: 0, actions: 0, lifecycle: 0 };
      let currentPhase = "warmup";
      let longTaskObserver;
      let longTaskObserverSupported = false;
      if ("PerformanceObserver" in globalThis) {
        try {
          longTaskObserver = new PerformanceObserver((list) => {
            if (currentPhase in longTaskCountByPhase)
              longTaskCountByPhase[currentPhase] += list.getEntries().length;
          });
          longTaskObserver.observe({ type: "longtask", buffered: true });
          longTaskObserverSupported = true;
        } catch {
          longTaskObserver = undefined;
        }
      }
      const stateSamples = Array.from({ length: rounds }, () => []);
      const paintSamples = Array.from({ length: rounds }, () => []);
      let currentStateSamples = stateSamples[0];
      let actionStart = null;
      const stateDisposer = controller.subscribeState(() => {
        if (actionStart === null) return;
        currentStateSamples.push(performance.now() - actionStart);
        actionStart = null;
      });
      const nextFrame = () =>
        new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const flushLongTasks = () => {
        const entries = longTaskObserver?.takeRecords?.() ?? [];
        if (currentPhase in longTaskCountByPhase)
          longTaskCountByPhase[currentPhase] += entries.length;
      };
      const settlePhase = async () => {
        await nextFrame();
        await nextFrame();
        flushLongTasks();
      };
      const warm = (round) => {
        for (let index = 0; index < warmupActions; index += 1) {
          const inputId = `warm:${round}:${index}`;
          controller.dispatch({
            type: "dot-down",
            dot: 1,
            inputId,
            source: "api",
          });
          controller.dispatch({
            type: "dot-up",
            dot: 1,
            inputId,
            source: "api",
          });
          controller.cancelPending();
        }
      };
      for (let round = 0; round < rounds; round += 1) {
        currentPhase = "warmup";
        currentStateSamples = stateSamples[round];
        warm(round);
        await settlePhase();
        currentPhase = "actions";
        for (let index = 0; index < actionsPerRound; index += 1) {
          const inputId = `perf:${round}:${index}`;
          actionStart = performance.now();
          controller.dispatch({
            type: "dot-down",
            dot: 1,
            inputId,
            source: "api",
          });
          if (injectLongTask && round === 0 && index === 0) {
            const end = performance.now() + 60;
            while (performance.now() < end) {
              // Deliberately injected only for the negative performance-gate test.
            }
          }
          const paintStart = performance.now();
          requestAnimationFrame(() => {
            paintSamples[round].push(performance.now() - paintStart);
          });
          controller.dispatch({
            type: "dot-up",
            dot: 1,
            inputId,
            source: "api",
          });
          controller.cancelPending();
          if ((index + 1) % 100 === 0) await nextFrame();
        }
        await settlePhase();
      }
      currentPhase = "lifecycle";
      await settlePhase();
      stateDisposer();
      const originalAdd = EventTarget.prototype.addEventListener;
      const originalRemove = EventTarget.prototype.removeEventListener;
      const activeListeners = [];
      const listenerCapture = (options) =>
        typeof options === "boolean" ? options : Boolean(options?.capture);
      const sameListener = (left, target, type, callback, capture) =>
        left.target === target &&
        left.type === type &&
        left.callback === callback &&
        left.capture === capture;
      EventTarget.prototype.addEventListener = function (...args) {
        const [type, callback, options] = args;
        const capture = listenerCapture(options);
        const result = originalAdd.apply(this, args);
        if (
          callback !== null &&
          !activeListeners.some((entry) =>
            sameListener(entry, this, type, callback, capture),
          )
        )
          activeListeners.push({
            target: this,
            type,
            callback,
            capture,
          });
        return result;
      };
      EventTarget.prototype.removeEventListener = function (...args) {
        const [type, callback, options] = args;
        const capture = listenerCapture(options);
        const result = originalRemove.apply(this, args);
        const index = activeListeners.findIndex((entry) =>
          sameListener(entry, this, type, callback, capture),
        );
        if (index >= 0) activeListeners.splice(index, 1);
        return result;
      };
      let lifecycleOutputMismatches = 0;
      let lifecycleOutputBefore = 0;
      let lifecycleOutputAfter = 0;
      const temporaryScope = document.createElement("div");
      document.body.appendChild(temporaryScope);
      for (let index = 0; index < 100; index += 1) {
        const temporaryKeyboard = api.attachKeyboard(controller, document, {
          activation: "always",
        });
        temporaryKeyboard.detach();
        const temporaryPointer = api.attachPointer(controller, cell, {
          activation: "always",
        });
        temporaryPointer.detach();
        const temporaryTarget = document.createElement("textarea");
        temporaryScope.appendChild(temporaryTarget);
        const temporaryEditable = api.attachBrailleEditable(
          controller,
          temporaryTarget,
        );
        temporaryEditable.detach();
        temporaryTarget.remove();
      }
      temporaryScope.remove();
      let targetRegistryLeaks = 0;
      api.defineBrailleInput("braille-performance-input");
      for (let index = 0; index < 100; index += 1) {
        const componentTarget = document.createElement("textarea");
        const component = document.createElement("braille-performance-input");
        component.target = componentTarget;
        document.body.append(componentTarget, component);
        let componentOutputCount = 0;
        const componentOutputDisposer = component.controller.subscribeOutput(
          () => {
            componentOutputCount += 1;
          },
        );
        const outputBefore = componentOutputCount;
        component.controller.dispatch({
          type: "dot-down",
          dot: 1,
          inputId: `lifecycle:${index}`,
          source: "api",
        });
        component.remove();
        document.body.append(component);
        component.remove();
        await Promise.resolve();
        await Promise.resolve();
        const outputAfter = componentOutputCount;
        lifecycleOutputBefore += outputBefore;
        lifecycleOutputAfter += outputAfter;
        if (outputAfter !== outputBefore) lifecycleOutputMismatches += 1;
        componentOutputDisposer();
        if (api.isEditableTargetAttached(componentTarget))
          targetRegistryLeaks += 1;
        component.destroy();
        componentTarget.remove();
      }
      EventTarget.prototype.addEventListener = originalAdd;
      EventTarget.prototype.removeEventListener = originalRemove;
      await settlePhase();
      longTaskObserver?.disconnect();

      const percentile95 = (values) => {
        if (values.length === 0) return null;
        const sorted = [...values].sort((left, right) => left - right);
        return sorted[
          Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
        ];
      };
      const result = {
        rounds,
        actionsPerRound,
        stateSubscriptionP95Milliseconds: stateSamples.map(percentile95),
        defaultUiNextPaintP95Milliseconds: paintSamples.map(percentile95),
        stateSampleCounts: stateSamples.map((values) => values.length),
        paintSampleCounts: paintSamples.map((values) => values.length),
        longTaskCountByPhase,
        longTaskObserverSupported,
        longTaskCount: Object.values(longTaskCountByPhase).reduce(
          (total, value) => total + value,
          0,
        ),
        listenerDelta: activeListeners.length,
        listenerRegistryLeaks: activeListeners.length,
        targetRegistryLeaks,
        lifecycleOutputBefore,
        lifecycleOutputAfter,
        lifecycleOutputMismatches,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        webdriver: navigator.webdriver,
        battery: null,
      };
      for (const phase of requiredPhases) {
        if (!(phase in longTaskCountByPhase))
          throw new Error(`Missing performance phase: ${phase}`);
      }
      if (typeof navigator.getBattery === "function") {
        try {
          const battery = await Promise.race([
            navigator.getBattery(),
            new Promise((resolve) => setTimeout(() => resolve(null), 500)),
          ]);
          if (battery)
            result.battery = {
              charging: battery.charging,
              level: battery.level,
            };
        } catch {
          result.battery = null;
        }
      }
      ui.detach();
      keyboard.detach();
      controller.destroy();
      return result;
    },
    {
      injectLongTask,
      warmupActions: performanceContract.warmupActions,
      rounds: performanceContract.rounds,
      actionsPerRound: performanceContract.actionsPerRound,
      requiredPhases: performanceContract.requiredPhases,
    },
  );
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    npm: commandOutput("npm", ["--version"]),
    host,
    playwrightChromium: {
      revision: chromiumSpec.revision,
      expectedBrowserVersion: chromiumSpec.browserVersion,
      observedBrowserVersion: browser.version(),
    },
    powerState: "not instrumented",
    throttling: "none",
    contract: performanceContract,
    browserResult,
  };
  await writeFile(
    resolve(
      root,
      injectLongTask
        ? "dist/performance-negative.json"
        : "dist/performance-baseline.json",
    ),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (injectLongTask) {
    if (
      !browserResult.longTaskObserverSupported ||
      browserResult.longTaskCountByPhase.actions === 0
    )
      throw new Error(
        "Injected long task did not produce a real actions-phase PerformanceObserver entry.",
      );
    throw new Error(
      "Injected long task was observed in the actions phase as expected; the negative gate failed closed.",
    );
  }
  validatePerformanceResult(browserResult);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
