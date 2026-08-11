import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("runtime-vector.mjs", import.meta.url));
const node = execFileSync(process.execPath, [script], { encoding: "utf8" });
const bun = execFileSync("bun", [script], { encoding: "utf8" });

if (node !== bun) {
  throw new Error(`Node/Bun deterministic bytes differ\nnode=${node}\nbun=${bun}`);
}
const vector = JSON.parse(node);
if (
  typeof vector.atlas_id !== "string" ||
  typeof vector.atlas_bytes_sha256 !== "string" ||
  typeof vector.svg_sha256 !== "string"
) {
  throw new Error("runtime vector is incomplete");
}
