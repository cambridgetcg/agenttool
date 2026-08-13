import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sha256Id } from "../src/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const vectors = JSON.parse(
  readFileSync(`${ROOT}/vectors/gin-reconstruction-v0.1.json`, "utf8"),
) as {
  cases: Record<string, { request: Record<string, unknown>; receipt: Record<string, unknown> }>;
  challenge: { artifact: Record<string, unknown>; assessment: Record<string, unknown> };
};

export const ref = (label: string) => sha256Id(`gin-reconstruction-test:${label}`);

export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
