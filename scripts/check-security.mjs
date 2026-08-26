import { readFile, readdir, access } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatVulnerabilityAuditResult,
  runVulnerabilityAudit,
} from "./vulnerability-audit.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);

async function filesUnder(directory) {
  const result = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(path)));
    else if (/\.(?:ts|tsx|js|jsx|mjs|html|css|json)$/.test(entry.name))
      result.push(path);
  }
  return result;
}

const runtimeFiles = (
  await Promise.all(
    ["src", "demo", "examples"].map((directory) =>
      filesUnder(resolve(root, directory)),
    ),
  )
).flat();
const forbiddenRuntimePatterns = [
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\s*\(/, "new Function"],
  [/\bfetch\s*\(/, "fetch"],
  [/\bWebSocket\s*\(/, "WebSocket"],
  [/\bdocument\.cookie\b/, "document.cookie"],
  [/\b(?:localStorage|sessionStorage)\b/, "browser storage"],
  [/\bnavigator\.sendBeacon\s*\(/, "sendBeacon"],
  [/<script(?![^>]*\bsrc\s*=)[^>]*>/i, "inline script"],
  [/<style(?:\s|>)/i, "inline style element"],
  [/<[^>]+\sstyle\s*=/i, "inline style attribute"],
  [/(?:src|href)\s*=\s*["']https?:\/\//i, "remote runtime URL"],
];
const findings = [];
for (const path of runtimeFiles) {
  const source = await readFile(path, "utf8");
  for (const [pattern, label] of forbiddenRuntimePatterns)
    if (pattern.test(source))
      findings.push(`${relative(root, path)}: ${label}`);
}
if (findings.length > 0)
  throw new Error(
    `Runtime security policy violations:\n${findings.join("\n")}`,
  );

if (packageJson.private !== true)
  throw new Error("The package must remain private and GitHub-only.");
if (
  packageJson.dependencies &&
  Object.keys(packageJson.dependencies).length > 0
)
  throw new Error("Runtime dependencies are not allowed.");
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (/(?:npm\s+publish|npm\s+dist-tag|registry\s+promotion)/i.test(command))
    throw new Error(`Registry release command found in script ${name}.`);
}

const license = await readFile(resolve(root, "LICENSE"), "utf8");
if (!license.includes("Copyright (c) 2026 xiyaofeng"))
  throw new Error("MIT copyright notice is missing.");
const securityPolicy = await readFile(resolve(root, "SECURITY.md"), "utf8");
for (const phrase of [
  "experimental",
  "best effort",
  "no SLA",
  "Private Vulnerability Reporting",
])
  if (!securityPolicy.toLowerCase().includes(phrase.toLowerCase()))
    throw new Error(
      `SECURITY.md is missing the required policy phrase: ${phrase}`,
    );

const distFiles = await filesUnder(resolve(root, "dist"));
if (distFiles.length === 0)
  throw new Error("Security check requires a current dist build.");
for (const path of distFiles) {
  const source = await readFile(path, "utf8");
  if (
    /AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(
      source,
    )
  )
    throw new Error(
      `Credential-like material found in ${relative(root, path)}.`,
    );
  if (/\/(?:Users|private)\//.test(source))
    throw new Error(`Absolute local path found in ${relative(root, path)}.`);
}
const exportTargets = (value) => {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(exportTargets);
};
for (const target of Object.values(packageJson.exports ?? {})) {
  const targets = exportTargets(target);
  for (const value of targets) {
    try {
      await access(resolve(root, value));
    } catch {
      throw new Error(`Export target is missing: ${value}`);
    }
  }
}
const vulnerabilityAudit = runVulnerabilityAudit({ root });
if (vulnerabilityAudit.status !== "clean")
  throw new Error(formatVulnerabilityAuditResult(vulnerabilityAudit));
console.log(
  `Security policy passed for ${runtimeFiles.length} runtime files and ${distFiles.length} build files.`,
);
console.log(formatVulnerabilityAuditResult(vulnerabilityAudit));
