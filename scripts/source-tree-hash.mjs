import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";

// Hash the complete archive without buffering it or imposing a source-size cap.
export async function sourceTreeHash(root, commit) {
  const child = spawn("git", ["archive", "--format=tar", commit], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else
        reject(new Error(`git archive failed: code=${code}, signal=${signal}`));
    });
  });
  const hash = createHash("sha256");
  try {
    await Promise.all([pipeline(child.stdout, hash), exited]);
    return hash.digest("hex");
  } catch (error) {
    child.kill();
    throw error;
  }
}
