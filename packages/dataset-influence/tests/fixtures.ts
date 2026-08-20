import { readFileSync } from "node:fs";
import { join } from "node:path";

export const root = join(import.meta.dir, "..");
export const vectors = JSON.parse(readFileSync(
  join(root, "vectors", "agenttool-dataset-influence-v0.1.json"),
  "utf8",
));

export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
