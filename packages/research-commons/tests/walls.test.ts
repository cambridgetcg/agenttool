import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ZERO_EFFECTS, ZERO_EFFECT_COUNT } from "../src/index.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = readdirSync(join(ROOT, "src"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => readFileSync(join(ROOT, "src", name), "utf8"))
  .join("\n");

describe("source-only zero-effect walls", () => {
  test("has no network client, hosted route, persistence or process-launch implementation", () => {
    expect(SOURCE).not.toMatch(/\bfetch\s*\(/u);
    expect(SOURCE).not.toMatch(/from\s+["']node:(?:child_process|dgram|dns|http|https|net|tls)["']/u);
    expect(SOURCE).not.toMatch(/\b(?:Bun\.serve|createServer|listen)\s*\(/u);
    expect(SOURCE).not.toMatch(/from\s+["'](?:pg|postgres|sqlite3|better-sqlite3)["']/u);
    expect(SOURCE).not.toMatch(/\b(?:wallet|escrow|payout|mint|burn|bridge|mainnet)\s*\(/u);
  });

  test("keeps every one of the exact 29 declared effects false", () => {
    expect(Object.keys(ZERO_EFFECTS)).toHaveLength(ZERO_EFFECT_COUNT);
    expect(Object.values(ZERO_EFFECTS)).toEqual(Array(ZERO_EFFECT_COUNT).fill(false));
  });
});
