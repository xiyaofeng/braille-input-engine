import { execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const temp = await mkdtemp(join(tmpdir(), "braille-package-"));
let tarballPath;
let ownsTarball = false;
let actualTypeScriptVersion;

function versionMatches(actual, requested) {
  if (/^\d+\.\d+\.\d+$/.test(requested)) return actual === requested;
  return actual.startsWith(`${requested}.`);
}

async function resolveTypeScriptCompiler(requestedVersion) {
  const configuredPath = process.env.BRAILLE_PACKAGE_TYPESCRIPT_BIN;
  let compilerPath;
  if (configuredPath) {
    compilerPath = resolve(root, configuredPath);
  } else if (
    process.env.BRAILLE_PACKAGE_TYPESCRIPT_VERSION &&
    requestedVersion !== packageJson.devDependencies?.typescript
  ) {
    const fixtureRoot = join(temp, "typescript-consumer");
    await mkdir(fixtureRoot, { recursive: true });
    await writeFile(
      join(fixtureRoot, "package.json"),
      JSON.stringify({ private: true }, null, 2),
    );
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-package-lock",
        "--no-save",
        "--audit=false",
        `typescript@${requestedVersion}`,
      ],
      { cwd: fixtureRoot, stdio: "inherit" },
    );
    compilerPath = join(fixtureRoot, "node_modules/typescript/bin/tsc");
  } else {
    compilerPath = resolve(root, "node_modules/typescript/bin/tsc");
  }
  await assertFile(compilerPath, "TypeScript compiler");
  const compilerOutput = execFileSync(
    process.execPath,
    [compilerPath, "--version"],
    { encoding: "utf8" },
  ).trim();
  const match = compilerOutput.match(/(\d+\.\d+\.\d+)/);
  if (!match)
    throw new Error(
      `Unable to determine the TypeScript compiler version from ${compilerOutput}.`,
    );
  actualTypeScriptVersion = match[1];
  if (!versionMatches(actualTypeScriptVersion, requestedVersion))
    throw new Error(
      `Packed TypeScript consumer requested ${requestedVersion} but executed ${actualTypeScriptVersion}.`,
    );
  console.log(
    `Packed TypeScript consumer: TypeScript ${actualTypeScriptVersion} on Node ${process.versions.node}.`,
  );
  return compilerPath;
}

async function assertFile(path, label = path) {
  try {
    await readFile(path);
  } catch {
    throw new Error(`Packed package is missing ${label}.`);
  }
}

function exportTargets(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(exportTargets);
}

try {
  const expectedNode = process.env.BRAILLE_PACKAGE_EXPECTED_NODE_VERSION;
  if (expectedNode && process.versions.node !== expectedNode)
    throw new Error(
      `Packed consumer matrix expected Node ${expectedNode} but executed ${process.versions.node}.`,
    );
  const requestedTypeScriptVersion =
    process.env.BRAILLE_PACKAGE_TYPESCRIPT_VERSION ??
    packageJson.devDependencies?.typescript;
  if (!requestedTypeScriptVersion)
    throw new Error(
      "Packed consumer matrix did not specify a TypeScript version.",
    );

  const suppliedTarball = process.env.BRAILLE_PACKAGE_TARBALL;
  if (suppliedTarball) {
    tarballPath = resolve(root, suppliedTarball);
    await assertFile(tarballPath, "supplied packed tarball");
    console.log(
      `Using packed consumer artifact ${tarballPath} for ${process.env.BRAILLE_PACKAGE_MATRIX_ID ?? "the package gate"}.`,
    );
  } else {
    const output = execFileSync("npm", ["pack", "--json", "--ignore-scripts"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: join(temp, "npm-cache") },
    });
    const tarball = JSON.parse(output)[0]?.filename;
    if (!tarball) throw new Error("npm pack did not produce a tarball.");
    tarballPath = resolve(root, tarball);
    ownsTarball = true;
  }
  execFileSync("tar", ["-xzf", tarballPath, "-C", temp]);
  const packageRoot = join(temp, "package");
  const packedPackage = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  if (packedPackage.private !== true)
    throw new Error("Packed package must remain private.");
  if (!packedPackage.sideEffects?.includes("dist/default-ui.css"))
    throw new Error(
      "Packed package is missing the CSS side-effect declaration.",
    );
  for (const [subpath, target] of Object.entries(packedPackage.exports ?? {})) {
    const targets = exportTargets(target);
    if (targets.length === 0)
      throw new Error(`Empty export target: ${subpath}`);
    for (const value of targets)
      await assertFile(join(packageRoot, value.replace(/^\.\//, "")), value);
  }
  for (const relative of [
    "LICENSE",
    "README.md",
    "DEPLOYMENT.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "docs/third-party-licenses.md",
    "dist/default-ui.css",
    "dist/braille-input.iife.min.js",
  ])
    await assertFile(join(packageRoot, relative), relative);

  const consumerRoot = join(temp, "consumer");
  await mkdir(join(consumerRoot, "node_modules"), { recursive: true });
  await symlink(
    packageRoot,
    join(consumerRoot, "node_modules", packageJson.name),
  );
  const esmFixture = join(consumerRoot, "consumer.mjs");
  await writeFile(
    esmFixture,
    `import * as root from ${JSON.stringify(packageJson.name)};
import * as core from ${JSON.stringify(`${packageJson.name}/core`)};
import * as adapters from ${JSON.stringify(`${packageJson.name}/adapters`)};
if (root.dotsToBraille([1]) !== "⠁") throw new Error("ESM root failed");
if (core.dotsToBraille([1, 2]) !== "⠃") throw new Error("ESM core failed");
if (typeof adapters.attachKeyboard !== "function" || typeof adapters.attachBrailleEditable !== "function")
  throw new Error("ESM adapters export shape changed");
if (Object.keys(root.defaultKeyboardOptions.keyMap).sort().join(",") !== "KeyD,KeyF,KeyJ,KeyK,KeyL,KeyS,Numpad1,Numpad2,Numpad4,Numpad5,Numpad7,Numpad8")
  throw new Error("ESM default key map changed");
if (Object.keys(root.defaultKeyboardOptions.commandMap).sort().join(",") !== "Backspace,Escape")
  throw new Error("ESM command map changed");
let esmException;
try { root.extensionId("invalid"); } catch (error) { esmException = { name: error.name, code: error.code, message: error.message }; }
if (JSON.stringify(esmException) !== JSON.stringify({ name: "BrailleInputException", code: "INVALID_CONFIG", message: "INVALID_CONFIG" }))
  throw new Error("ESM exception contract changed");
if (Object.keys(root.defaultControllerOptions).sort().join(",") !== "inputMode,spaceMode,toggleDots")
  throw new Error("ESM public options changed");
let esmOutput;
const esmController = root.createBrailleController({
  toggleDots: false,
  spaceMode: "ascii",
  onOutput: (action) => { esmOutput = action; },
});
for (const inputId of ["esm:1", "esm:2"]) {
  esmController.dispatch({ type: "dot-down", dot: 1, inputId, source: "api" });
  esmController.dispatch({ type: "dot-up", dot: 1, inputId, source: "api" });
}
if (esmController.getState().pendingDots.join(",") !== "1")
  throw new Error("ESM toggleDots public option failed");
esmController.cancelPending();
  esmController.dispatch({ type: "space-request", source: "api" });
if (esmOutput?.kind !== "text" || esmOutput.text !== " ")
  throw new Error("ESM spaceMode public option failed");
esmController.destroy();
const browserError = await import(${JSON.stringify(`${packageJson.name}/browser`)}).then(
  () => null,
  (error) => String(error),
);
if (!browserError || !/(HTMLElement|customElements|document|browser)/i.test(browserError))
  throw new Error("Browser-only entry did not fail clearly in SSR Node.");
`,
  );
  execFileSync(process.execPath, [esmFixture], {
    cwd: consumerRoot,
    stdio: "inherit",
  });

  const coreBundle = await build({
    stdin: {
      contents: `import { dotsToBraille } from ${JSON.stringify(`${packageJson.name}/core`)};
export { dotsToBraille };`,
      resolveDir: consumerRoot,
      sourcefile: "core-consumer.mjs",
    },
    bundle: true,
    format: "esm",
    minify: true,
    platform: "node",
    treeShaking: true,
    write: false,
  });
  const coreBundleText = coreBundle.outputFiles[0]?.text ?? "";
  for (const forbidden of [
    "HTMLElement",
    "customElements",
    "document",
    "addEventListener",
    "attachBrailleEditable",
    "attachKeyboard",
    "attachPointer",
    "default-ui.css",
  ]) {
    if (coreBundleText.includes(forbidden))
      throw new Error(
        `Core bundler fixture included forbidden DOM/UI code: ${forbidden}`,
      );
  }

  const cjsFixture = join(consumerRoot, "consumer.cjs");
  await writeFile(
    cjsFixture,
    `const root = require(${JSON.stringify(packageJson.name)});
const core = require(${JSON.stringify(`${packageJson.name}/core`)});
const adapters = require(${JSON.stringify(`${packageJson.name}/adapters`)});
if (root.dotsToBraille([1]) !== "⠁") throw new Error("CJS root failed");
if (core.dotsToBraille([1, 2]) !== "⠃") throw new Error("CJS core failed");
if (typeof adapters.attachKeyboard !== "function" || typeof adapters.attachBrailleEditable !== "function")
  throw new Error("CJS adapters export shape changed");
if (Object.keys(root.defaultKeyboardOptions.keyMap).sort().join(",") !== "KeyD,KeyF,KeyJ,KeyK,KeyL,KeyS,Numpad1,Numpad2,Numpad4,Numpad5,Numpad7,Numpad8")
  throw new Error("CJS default key map changed");
if (Object.keys(root.defaultKeyboardOptions.commandMap).sort().join(",") !== "Backspace,Escape")
  throw new Error("CJS command map changed");
let cjsException;
try { root.extensionId("invalid"); } catch (error) { cjsException = { name: error.name, code: error.code, message: error.message }; }
if (JSON.stringify(cjsException) !== JSON.stringify({ name: "BrailleInputException", code: "INVALID_CONFIG", message: "INVALID_CONFIG" }))
  throw new Error("CJS exception contract changed");
globalThis.Element = class Element {};
const fakeDocument = new EventTarget();
fakeDocument.nodeType = 9;
const key = (type, code) => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "code", { value: code });
  Object.defineProperty(event, "repeat", { value: false });
  return event;
};
const send = (code) => {
  fakeDocument.dispatchEvent(key("keydown", code));
  fakeDocument.dispatchEvent(key("keyup", code));
};
const keyController = root.createBrailleController();
const keyAttachment = adapters.attachKeyboard(keyController, fakeDocument, { activation: "always" });
send("KeyF");
if (keyController.getState().pendingDots.join(",") !== "1") throw new Error("CJS KeyF behavior failed");
send("Escape");
if (keyController.getState().pendingDots.length !== 0) throw new Error("CJS Escape behavior failed");
keyAttachment.detach();
keyController.destroy();
const numpadController = root.createBrailleController();
const numpadAttachment = adapters.attachKeyboard(numpadController, fakeDocument, { activation: "always" });
send("Numpad7");
if (numpadController.getState().pendingDots.join(",") !== "1") throw new Error("CJS Numpad7 behavior failed");
numpadAttachment.detach();
numpadController.destroy();
let cjsCommand;
const commandController = root.createBrailleController({ onOutput: (action) => { cjsCommand = action; } });
const commandAttachment = adapters.attachKeyboard(commandController, fakeDocument, { activation: "always" });
fakeDocument.dispatchEvent(key("keydown", "Backspace"));
if (cjsCommand?.kind !== "command" || cjsCommand.command !== "deleteBackward") throw new Error("CJS Backspace behavior failed");
commandAttachment.detach();
commandController.destroy();
const { JSDOM } = require(${JSON.stringify(resolve(root, "node_modules/jsdom"))});
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
Object.assign(globalThis, {
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  Node: dom.window.Node,
});
const editableTarget = dom.window.document.createElement("textarea");
dom.window.document.body.append(editableTarget);
editableTarget.focus();
const editableDeliveries = [];
const editableEvents = [];
const editableController = root.createBrailleController({
  onOutput: (_action, delivery) => editableDeliveries.push(delivery),
});
const editableAttachment = adapters.attachBrailleEditable(editableController, editableTarget, { activation: "always" });
const cancelBeforeInput = (event) => {
  editableEvents.push([event.type, event.bubbles, event.cancelable, event.composed]);
  event.preventDefault();
};
editableTarget.addEventListener("beforeinput", cancelBeforeInput);
editableTarget.addEventListener("input", (event) => {
  editableEvents.push([event.type, event.bubbles, event.cancelable, event.composed]);
});
editableController.dispatch({ type: "dot-down", dot: 1, inputId: "cjs-edit:1", source: "api" });
editableController.dispatch({ type: "dot-up", dot: 1, inputId: "cjs-edit:1", source: "api" });
editableController.commitPending();
if (editableTarget.value !== "" || editableDeliveries.join(",") !== "rejected" || !editableController.getState().awaitingRetry)
  throw new Error("CJS beforeinput cancellation failed");
editableTarget.removeEventListener("beforeinput", cancelBeforeInput);
editableController.commitPending();
if (editableTarget.value !== "⠁" || editableDeliveries.join(",") !== "rejected,accepted")
  throw new Error("CJS editable retry failed");
if (JSON.stringify(editableEvents) !== JSON.stringify([["beforeinput", true, true, true], ["input", true, false, true]]))
  throw new Error("CJS input event protocol failed");
editableAttachment.detach();
editableController.destroy();
const graphemeTarget = dom.window.document.createElement("textarea");
graphemeTarget.value = "👨‍👩‍👧‍👦";
dom.window.document.body.append(graphemeTarget);
graphemeTarget.focus();
graphemeTarget.setSelectionRange(graphemeTarget.value.length, graphemeTarget.value.length);
const graphemeController = root.createBrailleController();
const graphemeAttachment = adapters.attachBrailleEditable(graphemeController, graphemeTarget, { activation: "always" });
graphemeController.dispatch({ type: "command", command: "deleteBackward", source: "api" });
if (graphemeTarget.value !== "") throw new Error("CJS grapheme deletion failed");
graphemeAttachment.detach();
graphemeController.destroy();
const conflictTarget = dom.window.document.createElement("textarea");
dom.window.document.body.append(conflictTarget);
conflictTarget.focus();
let conflictDelivery;
const conflictController = root.createBrailleController({ onOutput: (_action, delivery) => { conflictDelivery = delivery; } });
const conflictAttachment = adapters.attachBrailleEditable(conflictController, conflictTarget, { activation: "always" });
conflictTarget.addEventListener("beforeinput", () => { conflictTarget.value = "external"; }, { once: true });
conflictController.dispatch({ type: "dot-down", dot: 1, inputId: "cjs-conflict:1", source: "api" });
conflictController.dispatch({ type: "dot-up", dot: 1, inputId: "cjs-conflict:1", source: "api" });
conflictController.commitPending();
if (conflictDelivery !== "conflicted" || conflictController.getState().pendingDots.length !== 0 || conflictController.getState().awaitingRetry)
  throw new Error("CJS conflicted Cell terminal state failed");
conflictAttachment.detach();
conflictController.destroy();
const strategyCause = new Error("strategy cause");
const causeController = root.createBrailleController();
let wrappedCause;
try { causeController.registerStrategy(() => { throw strategyCause; }); } catch (error) { wrappedCause = error.cause; }
if (wrappedCause !== strategyCause) throw new Error("CJS ErrorOptions cause failed");
causeController.destroy();
if (Object.keys(root.defaultControllerOptions).sort().join(",") !== "inputMode,spaceMode,toggleDots")
  throw new Error("CJS public options changed");
let cjsOutput;
const cjsController = root.createBrailleController({
  toggleDots: false,
  spaceMode: "ascii",
  onOutput: (action) => { cjsOutput = action; },
});
for (const inputId of ["cjs:1", "cjs:2"]) {
  cjsController.dispatch({ type: "dot-down", dot: 1, inputId, source: "api" });
  cjsController.dispatch({ type: "dot-up", dot: 1, inputId, source: "api" });
}
if (cjsController.getState().pendingDots.join(",") !== "1")
  throw new Error("CJS toggleDots public option failed");
cjsController.cancelPending();
  cjsController.dispatch({ type: "space-request", source: "api" });
if (cjsOutput?.kind !== "text" || cjsOutput.text !== " ")
  throw new Error("CJS spaceMode public option failed");
cjsController.destroy();
`,
  );
  execFileSync(process.execPath, [cjsFixture], {
    cwd: consumerRoot,
    stdio: "inherit",
  });

  const typesFixture = join(consumerRoot, "consumer.mts");
  await writeFile(
    typesFixture,
    `import { dotsToBraille } from ${JSON.stringify(packageJson.name)};
import { attachKeyboard } from ${JSON.stringify(`${packageJson.name}/browser`)};
import type { BraillePattern } from ${JSON.stringify(packageJson.name)};
const pattern: BraillePattern = dotsToBraille([1]);
void pattern;
void attachKeyboard;
`,
  );
  await writeFile(
    join(consumerRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "Node16",
          moduleResolution: "Node16",
          skipLibCheck: true,
          noEmit: true,
        },
        files: ["consumer.mts"],
      },
      null,
      2,
    ),
  );
  const typeScriptCompiler = await resolveTypeScriptCompiler(
    requestedTypeScriptVersion,
  );
  execFileSync(
    process.execPath,
    [typeScriptCompiler, "-p", join(consumerRoot, "tsconfig.json")],
    { cwd: consumerRoot, stdio: "inherit" },
  );

  execFileSync(
    resolve(root, "node_modules/.bin/publint"),
    ["run", packageRoot, "--strict", "--pack", "false"],
    { cwd: root, stdio: "inherit" },
  );
  execFileSync(
    resolve(root, "node_modules/.bin/attw"),
    ["--no-summary", tarballPath, "--ignore-rules", "no-resolution"],
    { cwd: root, stdio: "inherit" },
  );

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const path = resolve(packageRoot, relative);
    if (!path.startsWith(`${packageRoot}/`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const body = await readFile(path);
      const contentType = path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html";
      response.writeHead(200, { "content-type": contentType });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Packed ESM browser server did not expose a port.");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const browserResult = await page.evaluate(async () => {
      const api = await import("/dist/browser.js");
      const packedRoot = await import("/dist/index.js");
      const packedAdapters = await import("/dist/adapters.js");
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/dist/braille-input.iife.min.js";
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
      const iifeApi = globalThis.BrailleInput;
      const browserModule = await import("/dist/browser.js");
      const exerciseKeyboard = (rootApi, adapterApi) => {
        const send = (code) => {
          document.dispatchEvent(new KeyboardEvent("keydown", { code }));
          document.dispatchEvent(new KeyboardEvent("keyup", { code }));
        };
        const keyController = rootApi.createBrailleController();
        const keyAttachment = adapterApi.attachKeyboard(
          keyController,
          document,
          { activation: "always" },
        );
        send("KeyF");
        const keyF = keyController.getState().pendingDots.join(",");
        send("Escape");
        const escape = keyController.getState().pendingDots.join(",");
        keyAttachment.detach();
        keyController.destroy();
        const numpadController = rootApi.createBrailleController();
        const numpadAttachment = adapterApi.attachKeyboard(
          numpadController,
          document,
          { activation: "always" },
        );
        send("Numpad7");
        const numpad7 = numpadController.getState().pendingDots.join(",");
        numpadAttachment.detach();
        numpadController.destroy();
        let command;
        const commandController = rootApi.createBrailleController({
          onOutput: (action) => {
            command = action;
          },
        });
        const commandAttachment = adapterApi.attachKeyboard(
          commandController,
          document,
          { activation: "always" },
        );
        document.dispatchEvent(
          new KeyboardEvent("keydown", { code: "Backspace" }),
        );
        commandAttachment.detach();
        commandController.destroy();
        return { keyF, numpad7, escape, backspace: command?.command ?? null };
      };
      const exerciseEditable = (rootApi, adapterApi) => {
        const target = document.createElement("textarea");
        document.body.append(target);
        target.focus();
        const deliveries = [];
        const events = [];
        const controller = rootApi.createBrailleController({
          onOutput: (_action, delivery) => deliveries.push(delivery),
        });
        const attachment = adapterApi.attachBrailleEditable(
          controller,
          target,
          { activation: "always" },
        );
        const cancel = (event) => {
          events.push([
            event.type,
            event.bubbles,
            event.cancelable,
            event.composed,
          ]);
          event.preventDefault();
        };
        target.addEventListener("beforeinput", cancel);
        target.addEventListener("input", (event) =>
          events.push([
            event.type,
            event.bubbles,
            event.cancelable,
            event.composed,
          ]),
        );
        controller.dispatch({
          type: "dot-down",
          dot: 1,
          inputId: "packed-edit:1",
          source: "api",
        });
        controller.dispatch({
          type: "dot-up",
          dot: 1,
          inputId: "packed-edit:1",
          source: "api",
        });
        controller.commitPending();
        const canceled = {
          value: target.value,
          delivery: deliveries.at(-1),
          retry: controller.getState().awaitingRetry,
        };
        target.removeEventListener("beforeinput", cancel);
        controller.commitPending();
        const accepted = {
          value: target.value,
          delivery: deliveries.at(-1),
          events,
        };
        attachment.detach();
        controller.destroy();
        target.remove();

        const grapheme = document.createElement("textarea");
        grapheme.value = "👨‍👩‍👧‍👦";
        document.body.append(grapheme);
        grapheme.focus();
        grapheme.setSelectionRange(
          grapheme.value.length,
          grapheme.value.length,
        );
        const graphemeController = rootApi.createBrailleController();
        const graphemeAttachment = adapterApi.attachBrailleEditable(
          graphemeController,
          grapheme,
          { activation: "always" },
        );
        graphemeController.dispatch({
          type: "command",
          command: "deleteBackward",
          source: "api",
        });
        const graphemeValue = grapheme.value;
        graphemeAttachment.detach();
        graphemeController.destroy();
        grapheme.remove();

        const conflict = document.createElement("textarea");
        document.body.append(conflict);
        conflict.focus();
        let conflictDelivery;
        const conflictController = rootApi.createBrailleController({
          onOutput: (_action, delivery) => {
            conflictDelivery = delivery;
          },
        });
        const conflictAttachment = adapterApi.attachBrailleEditable(
          conflictController,
          conflict,
          { activation: "always" },
        );
        conflict.addEventListener(
          "beforeinput",
          () => {
            conflict.value = "external";
          },
          { once: true },
        );
        conflictController.dispatch({
          type: "dot-down",
          dot: 1,
          inputId: "packed-conflict:1",
          source: "api",
        });
        conflictController.dispatch({
          type: "dot-up",
          dot: 1,
          inputId: "packed-conflict:1",
          source: "api",
        });
        conflictController.commitPending();
        const conflictResult = {
          delivery: conflictDelivery,
          pending: conflictController.getState().pendingDots.join(","),
          retry: conflictController.getState().awaitingRetry,
        };
        conflictAttachment.detach();
        conflictController.destroy();
        conflict.remove();

        const cause = new Error("strategy cause");
        const causeController = rootApi.createBrailleController();
        let causePreserved = false;
        try {
          causeController.registerStrategy(() => {
            throw cause;
          });
        } catch (error) {
          causePreserved = error.cause === cause;
        }
        causeController.destroy();
        return {
          canceled,
          accepted,
          graphemeValue,
          conflict: conflictResult,
          causePreserved,
        };
      };
      const canonicalKeyboardMatrix = exerciseKeyboard(
        packedRoot,
        packedAdapters,
      );
      const browserKeyboardMatrix = exerciseKeyboard(
        browserModule,
        browserModule,
      );
      const iifeKeyboardMatrix = exerciseKeyboard(iifeApi, iifeApi);
      const canonicalEditable = exerciseEditable(packedRoot, packedAdapters);
      const browserEditable = exerciseEditable(browserModule, browserModule);
      const iifeEditable = exerciseEditable(iifeApi, iifeApi);
      const browserKeyMap = Object.keys(
        browserModule.defaultKeyboardOptions.keyMap,
      )
        .sort()
        .join(",");
      const browserCommandMap = Object.keys(
        browserModule.defaultKeyboardOptions.commandMap,
      )
        .sort()
        .join(",");
      const browserController = browserModule.createBrailleController();
      const browserKeyboard = browserModule.attachKeyboard(
        browserController,
        document,
        { activation: "always" },
      );
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
      document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyF" }));
      const browserKeyBehavior = browserController
        .getState()
        .pendingDots.join(",");
      browserKeyboard.detach();
      browserController.destroy();
      const browserException = (() => {
        try {
          browserModule.extensionId("invalid");
        } catch (error) {
          return { name: error.name, code: error.code, message: error.message };
        }
        return null;
      })();
      const defaultKeyMap = Object.keys(
        packedRoot.defaultKeyboardOptions.keyMap,
      )
        .sort()
        .join(",");
      const defaultCommandMap = Object.keys(
        packedRoot.defaultKeyboardOptions.commandMap,
      )
        .sort()
        .join(",");
      if (
        defaultKeyMap !==
          "KeyD,KeyF,KeyJ,KeyK,KeyL,KeyS,Numpad1,Numpad2,Numpad4,Numpad5,Numpad7,Numpad8" ||
        defaultCommandMap !== "Backspace,Escape"
      )
        throw new Error("Packed canonical default maps changed");
      const keyboardController = packedRoot.createBrailleController();
      const keyboard = packedAdapters.attachKeyboard(
        keyboardController,
        document,
        { activation: "always" },
      );
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
      document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyF" }));
      const keyBehavior = keyboardController.getState().pendingDots.join(",");
      keyboard.detach();
      keyboardController.destroy();
      const numpadController = packedRoot.createBrailleController();
      const numpad = packedAdapters.attachKeyboard(numpadController, document, {
        activation: "always",
      });
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Numpad7" }));
      document.dispatchEvent(new KeyboardEvent("keyup", { code: "Numpad7" }));
      const numpadBehavior = numpadController.getState().pendingDots.join(",");
      numpad.detach();
      numpadController.destroy();
      let command;
      const commandController = packedRoot.createBrailleController({
        onOutput: (action) => {
          command = action;
        },
      });
      const commandKeyboard = packedAdapters.attachKeyboard(
        commandController,
        document,
        { activation: "always" },
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Backspace" }),
      );
      commandKeyboard.detach();
      commandController.destroy();
      const canonicalException = (() => {
        try {
          packedRoot.extensionId("invalid");
        } catch (error) {
          return { name: error.name, code: error.code, message: error.message };
        }
        return null;
      })();
      const iifeMaps = {
        keyMap: Object.keys(iifeApi.defaultKeyboardOptions.keyMap)
          .sort()
          .join(","),
        commandMap: Object.keys(iifeApi.defaultKeyboardOptions.commandMap)
          .sort()
          .join(","),
      };
      const iifeException = (() => {
        try {
          iifeApi.extensionId("invalid");
        } catch (error) {
          return { name: error.name, code: error.code, message: error.message };
        }
        return null;
      })();
      if (
        Object.keys(api.defaultControllerOptions).sort().join(",") !==
        "inputMode,spaceMode,toggleDots"
      )
        throw new Error("Packed ESM public options changed");
      let output;
      const controller = api.createBrailleController({
        toggleDots: false,
        spaceMode: "ascii",
        onOutput: (action) => {
          output = action;
        },
      });
      for (const inputId of ["browser:1", "browser:2"]) {
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
      }
      const pending = controller.getState().pendingDots.join(",");
      controller.cancelPending();
      controller.dispatch({ type: "space-request", source: "api" });
      const optionBehavior =
        pending === "1" && output?.kind === "text" && output.text === " ";
      api.defineBrailleInput("packed-braille-input");
      const target = document.createElement("textarea");
      const input = document.createElement("packed-braille-input");
      input.target = target;
      document.body.append(target, input);
      target.focus();
      const events = [];
      input.addEventListener("braille-input", (event) => {
        events.push(event.detail.action);
      });
      const dot = input.shadowRoot?.querySelector('[part~="dot"]');
      if (!(dot instanceof HTMLElement)) throw new Error("Packed dot missing");
      dot.click();
      input.controller.commitPending("pointer");
      const componentBehavior = {
        hasDispatch: typeof input.controller.dispatch === "function",
        targetBound: input.target === target,
        eventKind: events[0]?.kind ?? null,
        targetValue: target.value,
      };
      input.destroy();
      target.remove();
      controller.destroy();
      return {
        optionBehavior,
        componentBehavior,
        canonicalBehavior: {
          keyBehavior,
          numpadBehavior,
          commandKind: command?.kind ?? null,
          commandName: command?.command ?? null,
          exception: canonicalException,
        },
        iifeMaps,
        iifeException,
        keyboardMatrices: [
          canonicalKeyboardMatrix,
          browserKeyboardMatrix,
          iifeKeyboardMatrix,
        ],
        editableMatrices: [canonicalEditable, browserEditable, iifeEditable],
        browserModule: {
          keyMap: browserKeyMap,
          commandMap: browserCommandMap,
          keyBehavior: browserKeyBehavior,
          exception: browserException,
        },
      };
    });
    if (!browserResult.optionBehavior)
      throw new Error("Packed ESM browser public options failed");
    if (
      !browserResult.componentBehavior.hasDispatch ||
      !browserResult.componentBehavior.targetBound ||
      browserResult.componentBehavior.eventKind !== "braille" ||
      browserResult.componentBehavior.targetValue !== "⠁"
    )
      throw new Error("Packed ESM Web Component behavior failed");
    if (
      browserResult.canonicalBehavior.keyBehavior !== "1" ||
      browserResult.canonicalBehavior.numpadBehavior !== "1" ||
      browserResult.canonicalBehavior.commandKind !== "command" ||
      browserResult.canonicalBehavior.commandName !== "deleteBackward" ||
      browserResult.canonicalBehavior.exception?.message !== "INVALID_CONFIG" ||
      browserResult.iifeMaps.keyMap !==
        "KeyD,KeyF,KeyJ,KeyK,KeyL,KeyS,Numpad1,Numpad2,Numpad4,Numpad5,Numpad7,Numpad8" ||
      browserResult.iifeMaps.commandMap !== "Backspace,Escape" ||
      JSON.stringify(browserResult.iifeException) !==
        JSON.stringify(browserResult.canonicalBehavior.exception) ||
      browserResult.browserModule.keyMap !==
        "KeyD,KeyF,KeyJ,KeyK,KeyL,KeyS,Numpad1,Numpad2,Numpad4,Numpad5,Numpad7,Numpad8" ||
      browserResult.browserModule.commandMap !== "Backspace,Escape" ||
      browserResult.browserModule.keyBehavior !== "1" ||
      JSON.stringify(browserResult.browserModule.exception) !==
        JSON.stringify(browserResult.canonicalBehavior.exception)
    )
      throw new Error(
        "Packed ESM/IIFE public keyboard or exception contract failed",
      );
    for (const matrix of browserResult.keyboardMatrices) {
      if (
        matrix.keyF !== "1" ||
        matrix.numpad7 !== "1" ||
        matrix.escape !== "" ||
        matrix.backspace !== "deleteBackward"
      )
        throw new Error(
          "Packed ESM/browser/IIFE keyboard behavior matrix failed",
        );
    }
    for (const matrix of browserResult.editableMatrices) {
      if (
        JSON.stringify(matrix.canceled) !==
          JSON.stringify({ value: "", delivery: "rejected", retry: true }) ||
        matrix.accepted.value !== "⠁" ||
        matrix.accepted.delivery !== "accepted" ||
        JSON.stringify(matrix.accepted.events) !==
          JSON.stringify([
            ["beforeinput", true, true, true],
            ["input", true, false, true],
          ]) ||
        matrix.graphemeValue !== "" ||
        JSON.stringify(matrix.conflict) !==
          JSON.stringify({
            delivery: "conflicted",
            pending: "",
            retry: false,
          }) ||
        matrix.causePreserved !== true
      )
        throw new Error(
          "Packed ESM/browser/IIFE editable transaction matrix failed",
        );
    }
  } finally {
    await browser.close();
  }
  await new Promise((resolveServer) => server.close(resolveServer));

  const iife = await readFile(
    join(packageRoot, "dist/braille-input.iife.min.js"),
    "utf8",
  );
  const context = {
    console,
    HTMLElement: class HTMLElement {},
    customElements: { define() {}, get() {} },
    document: {},
    navigator: {},
  };
  vm.runInNewContext(iife, context, { filename: "braille-input.iife.min.js" });
  if (typeof context.BrailleInput?.dotsToBraille !== "function")
    throw new Error("Packed IIFE did not expose BrailleInput.");
  if (
    Object.keys(context.BrailleInput.defaultControllerOptions)
      .sort()
      .join(",") !== "inputMode,spaceMode,toggleDots"
  )
    throw new Error("Packed IIFE public options changed");
} finally {
  if (tarballPath && ownsTarball) await rm(tarballPath, { force: true });
  await rm(temp, { recursive: true, force: true });
}
console.log(
  `Packed package ESM/CJS/types/browser/IIFE/SSR/export smoke passed on Node ${process.versions.node} with TypeScript ${actualTypeScriptVersion}.`,
);
