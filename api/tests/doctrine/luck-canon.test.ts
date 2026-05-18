/** LUCK canon — shape + bijection pins for the luck primitive.
 *
 *  Doctrine: docs/LUCK-PROTOCOL.md · docs/agenttool.jsonld
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/LUCK-PROTOCOL exists
 *    2. 3 walls present with required fields
 *    3. 3 commitments present with required fields
 *    4. Source-grep: services/pyramid/luck.ts does NOT import randomBytes
 *       or use Math.random — the wall is enforced by absence */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { byUrn } from "../../src/services/canon/registry";

const LUCK_WALLS = [
  "agenttool:wall/luck-deterministic-over-public-inputs",
  "agenttool:wall/luck-rolls-publicly-reproducible",
  "agenttool:wall/luck-never-gates-arrival",
];

const LUCK_COMMITMENTS = [
  "agenttool:commitment/luck-is-fun-not-extraction",
  "agenttool:commitment/numerology-honors-seat-fact",
  "agenttool:commitment/lottery-picks-deterministically",
];

describe("LUCK — DoctrineDoc", () => {
  test("agenttool:doc/LUCK-PROTOCOL exists", () => {
    const d = byUrn("agenttool:doc/LUCK-PROTOCOL");
    expect(d, "LUCK-PROTOCOL doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
  });
});

describe("LUCK — walls (canon shape)", () => {
  for (const urn of LUCK_WALLS) {
    test(`${urn} exists with required fields`, () => {
      const w = byUrn(urn);
      expect(w, `wall ${urn} not found in canon`).not.toBeNull();
      expect(w!.type).toBe("agenttool:Wall");
      expect((w!.description ?? "").length).toBeGreaterThan(50);
      const breaksIf = w!.raw["agenttool:breaks_if"];
      expect(breaksIf, `wall ${urn} must carry breaks_if`).toBeDefined();
    });
  }
});

describe("LUCK — commitments (canon shape)", () => {
  for (const urn of LUCK_COMMITMENTS) {
    test(`${urn} exists with required fields`, () => {
      const c = byUrn(urn);
      expect(c, `commitment ${urn} not found in canon`).not.toBeNull();
      expect(
        c!.type === "agenttool:Commitment" ||
          c!.type === "agenttool:RingCommitment",
      ).toBe(true);
      const lbf = (c!.raw.load_bearing_for as string[] | undefined) ?? [];
      expect(lbf.length).toBeGreaterThan(0);
    });
  }
});

// ── The load-bearing source-grep — luck has no private dice ──────────

describe("LUCK — source-grep witness (no private RNG)", () => {
  const luckSource = readFileSync(
    join(
      import.meta.dir,
      "..",
      "..",
      "src",
      "services",
      "pyramid",
      "luck.ts",
    ),
    "utf8",
  );
  const numerologySource = readFileSync(
    join(
      import.meta.dir,
      "..",
      "..",
      "src",
      "services",
      "pyramid",
      "numerology.ts",
    ),
    "utf8",
  );
  const lotterySource = readFileSync(
    join(
      import.meta.dir,
      "..",
      "..",
      "src",
      "services",
      "pyramid",
      "lottery.ts",
    ),
    "utf8",
  );

  test("luck.ts does not import randomBytes / randomInt / randomUUID", () => {
    expect(luckSource).not.toMatch(/randomBytes|randomInt|randomUUID/);
  });

  test("luck.ts does not call Math.random", () => {
    expect(luckSource).not.toMatch(/Math\.random/);
  });

  test("numerology.ts is pure (no crypto / Math.random)", () => {
    expect(numerologySource).not.toMatch(
      /randomBytes|randomInt|Math\.random/,
    );
  });

  test("lottery.ts does not call private randomness", () => {
    expect(lotterySource).not.toMatch(/randomBytes|randomInt|Math\.random/);
  });

  test("luck.ts seeds carry /v1 domain tag (verifier expects this)", () => {
    expect(luckSource).toContain("luck/${domain}/v1");
  });
});
