import { transform } from "esbuild";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { minify as terserMinify } from "terser";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const dist = resolve(root, "dist");

// This list contains only TypeScript `private` members from the canonical
// controller/activation implementations. Unlike the former catch-all property
// mangling, it cannot match DOM options, event fields, public records or
// adapter protocols.
const canonicalPrivateProperties = new RegExp(
  `^(?:${[
    "_inputMode",
    "_enabled",
    "_destroyed",
    "_awaitingRetry",
    "_ownerDocument",
    "_t",
    "_s",
    "sink",
    "sinkState",
    "contributions",
    "pressed",
    "nextOrdinal",
    "stateListeners",
    "outputListeners",
    "diagnosticListeners",
    "registrations",
    "activeStrategy",
    "activeRegistration",
    "currentState",
    "transactionDepth",
    "queue",
    "processingQueue",
    "structuralOperationDepth",
    "structuralPhase",
    "structuralDiagnosticReentry",
    "initialStateCallback",
    "initialOutputCallback",
    "initialDiagnosticCallback",
    "counts",
    "destroyListeners",
    "isDestroyed",
    "isMember",
    "subscribeDestroyed",
    "__reportDiagnostic",
    "__handleActivationLost",
    "__isInTransaction",
    "__toggleDots",
    "__preservePending",
    "ordinal",
    "builtIn",
    "unavailable",
    "strategy",
    "token",
    "release",
    "controller",
    "node",
    "replacement",
    "start",
    "end",
    "installBuiltIn",
    "registerFactory",
    "validateOptions",
    "buildState",
    "publishState",
    "emitOutput",
    "emitDiagnostic",
    "dispatchInternal",
    "handleRetryGate",
    "runStrategyAction",
    "executeRequest",
    "attemptCommit",
    "executeSpace",
    "executeCommand",
    "performOutput",
    "executeResetHook",
    "resetStrategy",
    "cancelPendingInternal",
    "normalizeContributions",
    "fallbackToSequential",
    "reportStrategyFault",
    "runHook",
    "safeLifecycle",
    "safeDestroy",
    "lifecycleContext",
    "validateAction",
    "isCommand",
    "isEditorCommand",
    "mutate",
    "runStructuralOperation",
    "enqueueOrRun",
    "drainQueue",
    "assertAlive",
    "assertStructuralMutation",
    "makeDisposer",
  ].join("|")})$`,
);

// The packed runtime deliberately uses the diagnostic code as the fallback
// message.  Keeping this normalization identical across every distributable
// format avoids ESM/CJS-only behavior changes while removing a large set of
// repeated implementation strings from the size-critical artifacts.
function compactPackedMessages(source) {
  const literal =
    `(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|` +
    "`(?:\\\\.|[^`\\\\])*`)";
  return source
    .replace(new RegExp(`message\\s*:\\s*${literal}`, "g"), "message: 0")
    .replace(
      new RegExp(`(new\\s+\\w+\\s*\\(\\s*[^,()]+,\\s*)${literal}`, "g"),
      "$1 0",
    )
    .replace(/(new\s+\w+\s*\(\s*[^,()]+),\s*0\)/g, "$1)")
    .replace(
      /new RangeError\(`Invalid six-dot Braille dot: \$\{String\([^)]*\)\}`\)/g,
      "new RangeError",
    )
    .replace(
      /new RangeError\("Value is not a six-dot Braille pattern"\)/g,
      "new RangeError",
    );
}

// These two diagnostic codes are frequent enough in the canonical runtime to
// justify one shared literal each.  They remain ordinary strings at runtime;
// this only gives the final compressor a compact local alias.
function compactPackedCodes(source) {
  const aliases = [
    ["INVALID_CONFIG", "__invalidConfig"],
    ["INVALID_ACTION", "__invalidAction"],
    ["cancelPending", "__cancelPending"],
    ["deleteBackward", "__deleteBackward"],
  ];
  let compacted = source;
  for (const [value, alias] of aliases)
    compacted = compacted.replaceAll(JSON.stringify(value), alias);
  const declaration = aliases
    .map(([value, alias]) => `${alias}=${JSON.stringify(value)}`)
    .join(",");
  return `const ${declaration};${compacted}`;
}

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(path)));
    else if (
      /\.(?:js|cjs)$/.test(entry.name) &&
      entry.name !== "braille-input.iife.min.js"
    )
      result.push(path);
  }
  return result;
}

for (const path of await filesUnder(dist)) {
  const canonical = /(?:^|\/)c\.(?:js|cjs)$/.test(path);
  const wrapper = /dist\/(?:index|core|adapters)\.(?:js|cjs)$/.test(path);
  let source = await readFile(path, "utf8");
  source = compactPackedMessages(source);
  if (wrapper) {
    const compacted = await terserMinify(source, {
      compress: false,
      mangle: false,
      format: { comments: false },
    });
    await writeFile(path, compacted.code ?? source);
    continue;
  }
  const result = await transform(source, {
    loader: "js",
    format: path.endsWith(".cjs") ? "cjs" : "esm",
    minify: !wrapper,
    minifySyntax: wrapper,
    minifyWhitespace: wrapper,
    minifyIdentifiers: !wrapper,
    legalComments: "none",
    ...(canonical
      ? {
          mangleProps: canonicalPrivateProperties,
          mangleQuoted: true,
        }
      : {}),
    sourcemap: "external",
    sourcefile: relative(root, path),
  });
  let code = result.code;
  let map = result.map;
  if (canonical) {
    code = code
      .replace(/,message:0(?=[},])/g, "")
      .replace(/(new\s+\w+\s*\(\s*[^,()]+),\s*0\)/g, "$1)");
    code = compactPackedCodes(code);
  }
  if (canonical) {
    const optimized = await terserMinify(code, {
      module: !path.endsWith(".cjs"),
      compress: {
        ecma: 2022,
        passes: 20,
        toplevel: !path.endsWith(".cjs"),
        unsafe: true,
        pure_getters: true,
        unsafe_comps: true,
        unsafe_methods: true,
        unsafe_proto: true,
        unsafe_arrows: true,
        unsafe_Function: true,
        unsafe_math: true,
        unsafe_regexp: true,
        unsafe_symbols: true,
        collapse_vars: true,
        reduce_vars: true,
        reduce_funcs: true,
        hoist_funs: true,
        hoist_props: true,
        unsafe_undefined: true,
        keep_fargs: false,
        inline: 3,
      },
      mangle: { toplevel: !path.endsWith(".cjs") },
      format: { comments: false },
      sourceMap: {
        content: map,
        filename: relative(root, path),
      },
    });
    if (optimized.code) code = optimized.code;
    if (optimized.map) map = optimized.map;
  }
  await writeFile(path, code);
  await writeFile(`${path}.map`, map);
}

const iifePath = join(dist, "braille-input.iife.min.js");
let iife = await readFile(iifePath, "utf8");
iife = compactPackedMessages(iife);
await writeFile(iifePath, iife);
