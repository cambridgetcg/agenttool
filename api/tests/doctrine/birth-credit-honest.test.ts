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

const REGISTER_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "routes",
  "register-agent.ts",
);
const SOURCE = readFileSync(REGISTER_PATH, "utf8");

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
