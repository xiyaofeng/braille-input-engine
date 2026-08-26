import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const schema = JSON.parse(
  await readFile(resolve(root, "docs/release/evidence.schema.json"), "utf8"),
);
if (
  !schema.required?.includes("version") ||
  !schema.required?.includes("status")
)
  throw new Error("Evidence schema is incomplete.");
console.log(
  "Release evidence schema smoke passed; human results remain explicit.",
);
