import { transform } from "esbuild";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const dist = resolve(root, "dist");

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

// Vite owns the module graph and shared identities. Minify each module with
// normal identifier minification only; no private protocol mangling, string
// aliases, unsafe transforms or separately bundled replacement runtime.
for (const path of await filesUnder(dist)) {
  const source = compactPackedMessages(await readFile(path, "utf8"));
  const result = await transform(source, {
    loader: "js",
    format: path.endsWith(".cjs") ? "cjs" : "esm",
    minify: true,
    legalComments: "none",
    sourcemap: "external",
    sourcefile: relative(root, path),
  });
  await writeFile(path, result.code);
  await writeFile(`${path}.map`, result.map);
}

const iifePath = join(dist, "braille-input.iife.min.js");
let iife = await readFile(iifePath, "utf8");
iife = compactPackedMessages(iife);
await writeFile(iifePath, iife);
