import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const sources = [
  "docs/BUSINESS-MODEL.md",
  "apps/docs/BUSINESS-MODEL.md",
  "apps/docs/business-model.html",
] as const;

const retiredClaims = [
  /free birth, free wake/i,
  /free, always\. identity\. continuity/i,
  /bearer key is enough/i,
  /a subscription tier exists/i,
  /every chargeable event lands as a chronicle entry/i,
  /every meter is readable in/i,
  /wallet primitive is sovereign/i,
  /thought storage ciphertext-only/i,
  /costs us essentially nothing/i,
  /wallets support 6 chains \+ fiat/i,
] as const;

describe("business model truth boundary", () => {
  for (const path of sources) {
    test(`${path} separates current behavior from policy and roadmap`, () => {
      const text = readFileSync(join(ROOT, path), "utf8");

      for (const claim of retiredClaims) expect(text).not.toMatch(claim);
      expect(text).toMatch(/registration.+no monetary charge|no monetary charge.+registration/is);
      expect(text).toMatch(/proof-of-work/is);
      expect(text).toMatch(/bearer opens project capabilities/is);
      expect(text).toMatch(/immutable supplied public root.+constitutional consent/is);
      expect(text).toMatch(/no enterprise subscription product/i);
      expect(text).toMatch(/internal (?:application-)?ledger/i);
      expect(text).toMatch(/provisional AgentTool identifier/is);
      expect(text).toMatch(/roadmap only; no auction route/i);
    });
  }
});
