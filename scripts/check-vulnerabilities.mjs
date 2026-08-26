import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatVulnerabilityAuditResult,
  runVulnerabilityAudit,
} from "./vulnerability-audit.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const result = runVulnerabilityAudit({ root });
console.log(formatVulnerabilityAuditResult(result));
if (result.status !== "clean") process.exitCode = 1;
