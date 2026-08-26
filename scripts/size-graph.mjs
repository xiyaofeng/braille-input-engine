import { access, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { gzipSize } from "gzip-size";

const importPatterns = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveImport(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`Bundle import is missing: ${relative(process.cwd(), base)}`);
}

export async function collectReachableFiles(root, entries) {
  const rootPath = resolve(root);
  const pending = entries.map((entry) => resolve(rootPath, entry));
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const source = await readFile(current, "utf8");
    for (const pattern of importPatterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const dependency = await resolveImport(current, match[1]);
        if (dependency && !visited.has(dependency)) pending.push(dependency);
      }
    }
  }
  return [...visited].sort();
}

export async function measureScenario({
  root,
  entries,
  extraFiles = [],
  budget,
  name = "scenario",
}) {
  const rootPath = resolve(root);
  const reachable = await collectReachableFiles(rootPath, entries);
  const filePaths = [
    ...new Set([
      ...reachable,
      ...extraFiles.map((file) => resolve(rootPath, file)),
    ]),
  ].sort();
  const files = [];
  for (const path of filePaths) {
    const contents = await readFile(path);
    files.push({
      path: relative(rootPath, path).split("\\").join("/"),
      bytes: contents.byteLength,
      gzipBytes: await gzipSize(contents, { level: 9, mtime: 0 }),
    });
  }
  const result = {
    name,
    entries: [...entries],
    files,
    rawBytes: files.reduce((total, file) => total + file.bytes, 0),
    gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
    budget,
  };
  return result;
}
