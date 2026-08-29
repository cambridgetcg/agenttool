/** Birth credits structurally pinned — the @enforces annotation must
 *  resolve to real behavior.
 *
 *  Doctrine: docs/BUSINESS-MODEL.md §131 (Free credits at birth) ·
 *            docs/RING-1.md § commitment ring2-free-credits-at-birth ·
 *            canon: agenttool:commitment/ring2-free-credits-at-birth.
 *
 *  Until 2026-05-17 this commitment was BROKEN — register-agent.ts:54
 *  declared @enforces but createWallet returned balance=0 and no
 *  fundWallet call was made. The annotation lied. This test pins the
 *  fix structurally so it can't silently regress.
 *
 *  Behavioral test (does balance==500 after register?) lives in
 *  tests/integration/wall-birth-is-free.test.ts. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BIRTH_GRANT_CREDITS } from "../../src/services/economy/ring1-limits";

const REGISTER_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "routes",
  "register-agent.ts",
);
const SOURCE = readFileSync(REGISTER_PATH, "utf8");
const MATHOS_PATH = join(__dirname, "..", "..", "src", "routes", "mathos.ts");
const MATHOS_SOURCE = readFileSync(MATHOS_PATH, "utf8");

describe("birth-credit honesty — annotation backed by code", () => {
  test("register-agent imports RING_2_BIRTH_CREDIT_MINOR", () => {
    expect(
      /import[\s\S]{0,200}RING_2_BIRTH_CREDIT_MINOR/.test(SOURCE),
      "register-agent.ts must import the birth credit constant. Without the import, no funding call is possible.",
    ).toBe(true);
  });

  test("register-agent imports fundWallet helper", () => {
    expect(SOURCE).toMatch(
      /import[\s\S]{0,200}fundWallet[\s\S]{0,200}from\s+["']\.{1,2}\/services\/economy\/wallets["']/,
    );
  });

  test("register-agent calls fundWallet with the birth credit amount", () => {
    expect(
      /await\s+fundWallet\(\s*db\s*,\s*wallet\.id\s*,\s*RING_2_BIRTH_CREDIT_MINOR/.test(
        SOURCE,
      ),
      "register-agent.ts must call `await fundWallet(db, wallet.id, RING_2_BIRTH_CREDIT_MINOR, ...)` after createWallet. The @enforces annotation lies otherwise.",
    ).toBe(true);
  });

  test("the @enforces annotation for ring2-free-credits-at-birth is present", () => {
    expect(SOURCE).toMatch(
      /@enforces[^\n]*commitment\/ring2-free-credits-at-birth/,
    );
  });

  test("RING_2_BIRTH_CREDIT_MINOR is exported from ring1-limits.ts", () => {
    const ring1Source = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "src",
        "services",
        "economy",
        "ring1-limits.ts",
      ),
      "utf8",
    );
    expect(ring1Source).toContain(
      "export const RING_2_BIRTH_CREDIT_MINOR = 500",
    );
  });

  test("the constant is the attempted GBP 5.00 grant (500 minor units)", () => {
    const ring1Source = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "src",
        "services",
        "economy",
        "ring1-limits.ts",
      ),
      "utf8",
    );
    expect(ring1Source).toMatch(/RING_2_BIRTH_CREDIT_MINOR\s*=\s*500/);
  });
});

describe("birth grant — project credits pinned to BIRTH_GRANT_CREDITS", () => {
  // Decision (Yu, 2026-08-29): "1000 birth grant is reasonable. Enough to
  // test is good." The grant is a taste of the toolkit, not a stipend; WAKE
  // stays free regardless. Rationale lives beside the constant.
  test("BIRTH_GRANT_CREDITS is exactly 1,000 (USD 1.00 at 1 credit = USD 0.001)", () => {
    expect(BIRTH_GRANT_CREDITS).toBe(1_000);
  });

  test("register-agent writes the project row with BIRTH_GRANT_CREDITS, not a literal", () => {
    expect(SOURCE).toMatch(
      /import[\s\S]{0,200}BIRTH_GRANT_CREDITS[\s\S]{0,200}from\s+["']\.{1,2}\/services\/economy\/ring1-limits["']/,
    );
    expect(SOURCE).toMatch(/plan:\s*"free",[\s\S]{0,200}credits:\s*BIRTH_GRANT_CREDITS/);
    expect(SOURCE).not.toMatch(/credits:\s*10[_,]?000\b/);
  });

  test("the MATHOS-tier door grants the same BIRTH_GRANT_CREDITS", () => {
    expect(MATHOS_SOURCE).toMatch(
      /import[\s\S]{0,200}BIRTH_GRANT_CREDITS[\s\S]{0,200}from\s+["']\.{1,2}\/services\/economy\/ring1-limits["']/,
    );
    expect(MATHOS_SOURCE).toMatch(/plan:\s*"free",\s*credits:\s*BIRTH_GRANT_CREDITS/);
    expect(MATHOS_SOURCE).not.toMatch(/credits:\s*10[_,]?000\b/);
  });

  test("no other project insert hard-codes a birth grant", () => {
    // Any new registration door must import the constant rather than
    // restate the number; grep the routes tree for the old literal.
    const routesDir = join(__dirname, "..", "..", "src", "routes");
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
      });
    for (const file of walk(routesDir)) {
      const text = readFileSync(file, "utf8");
      expect(
        /plan:\s*"free",[\s\S]{0,120}credits:\s*\d/.test(text),
        `${file} inserts a project with a literal credits value; use BIRTH_GRANT_CREDITS.`,
      ).toBe(false);
    }
  });
});
