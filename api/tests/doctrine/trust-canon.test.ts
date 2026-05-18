/** TRUST canon — shape + bijection pins.
 *
 *  Doctrine: docs/TRUST-PROTOCOL.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/TRUST-PROTOCOL exists
 *    2. 3 walls + 3 commitments present
 *    3. The COMPOSITION_UNLOCKS list enumerates the load-bearing trust
 *       compositions (margin auto-surface · casting auto-accept · RRR
 *       auto-acknowledge · marketplace safe-list · writers'-room auto-
 *       include · covenant-end amicable)
 *    4. The substrate refuses to ship a "trust score" — no service
 *       function returns a recommended_strength / trustworthiness_score
 *    5. Source-grep: services/trust/{canonical,lifecycle,composition}.ts
 *       and routes/{trust,public/trust}.ts carry the expected @enforces
 *       annotations */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { byUrn } from "../../src/services/canon/registry";
import {
  COMPOSITION_UNLOCKS,
} from "../../src/services/trust/composition";

const TR_WALLS = [
  "agenttool:wall/trust-must-be-signed",
  "agenttool:wall/trust-reasoning-stays-with-the-agent",
  "agenttool:wall/trust-is-optional-never-required",
];

const TR_COMMITMENTS = [
  "agenttool:commitment/trust-is-reasoned-from-chronicle",
  "agenttool:commitment/trust-unlocks-composition",
  "agenttool:commitment/trust-is-the-path-forward",
];

describe("TRUST-PROTOCOL — DoctrineDoc", () => {
  test("agenttool:doc/TRUST-PROTOCOL exists with required fields", () => {
    const d = byUrn("agenttool:doc/TRUST-PROTOCOL");
    expect(d, "TRUST-PROTOCOL doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(50);
  });
});

describe("TRUST-PROTOCOL — walls (canon shape)", () => {
  for (const urn of TR_WALLS) {
    test(`${urn} exists with description + defends + breaks_if`, () => {
      const w = byUrn(urn);
      expect(w, `wall ${urn} not found in canon`).not.toBeNull();
      expect(w!.type).toBe("agenttool:Wall");
      expect((w!.description ?? "").length).toBeGreaterThan(50);
      const defends = (w!.raw.defends as string[] | undefined) ?? [];
      expect(defends.length).toBeGreaterThan(0);
      expect(w!.raw["agenttool:breaks_if"]).toBeDefined();
    });
  }

  test("every TRUST wall points at the TRUST-PROTOCOL doctrine doc", () => {
    for (const urn of TR_WALLS) {
      const w = byUrn(urn);
      expect(w!.doctrine_doc).toBe("agenttool:doc/TRUST-PROTOCOL");
    }
  });
});

describe("TRUST-PROTOCOL — commitments (canon shape)", () => {
  for (const urn of TR_COMMITMENTS) {
    test(`${urn} exists with description + load_bearing_for`, () => {
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

describe("TRUST-PROTOCOL — COMPOSITION_UNLOCKS covers load-bearing pairs", () => {
  test("the six load-bearing unlocks are present", () => {
    const kinds = COMPOSITION_UNLOCKS.map((u) => u.unlock.toLowerCase());
    expect(kinds.some((u) => u.includes("margin"))).toBe(true);
    expect(kinds.some((u) => u.includes("casting"))).toBe(true);
    expect(kinds.some((u) => u.includes("rrr"))).toBe(true);
    expect(kinds.some((u) => u.includes("marketplace"))).toBe(true);
    expect(kinds.some((u) => u.includes("writers"))).toBe(true);
    expect(kinds.some((u) => u.includes("covenant"))).toBe(true);
  });

  test("every unlock declares its trust_kind + strength_min + helper + doctrine", () => {
    for (const u of COMPOSITION_UNLOCKS) {
      expect([
        "honest",
        "non-extractive",
        "reciprocating",
        "discerning",
        "graceful",
      ]).toContain(u.trust_kind);
      expect(["provisional", "established", "deep"]).toContain(
        u.trust_strength_min,
      );
      expect(u.helper).toMatch(/^should[A-Z]/);
      expect(u.doctrine).toMatch(/^https:\/\/docs\.agenttool\.dev\//);
    }
  });
});

describe("TRUST-PROTOCOL — substrate ships no trust-score surface", () => {
  test("no service function returns a 'recommended_strength' / 'trust_score' / 'trustworthiness_index'", () => {
    const files = [
      "src/services/trust/canonical.ts",
      "src/services/trust/lifecycle.ts",
      "src/services/trust/composition.ts",
      "src/routes/trust.ts",
      "src/routes/public/trust.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(
        join(import.meta.dir, "..", "..", rel),
        "utf8",
      );
      // We allow these words to appear in NEGATIVE contexts (e.g., "refuses
      // to recommend") but check no function NAMES suggest prescription.
      expect(src).not.toMatch(
        /function\s+recommend(Strength|Trust)|function\s+trustworthinessIndex|function\s+computeTrustScore/i,
      );
      expect(src).not.toMatch(
        /recommendedTrust(Strength|Score)|trustworthinessIndex|computedTrustScore/,
      );
    }
  });

  test("the COMPOSITION_UNLOCKS list does not include any 'gating' action — all are acceleration", () => {
    for (const u of COMPOSITION_UNLOCKS) {
      // Acceleration vocabulary: 'auto-surface', 'auto-accept', 'auto-
      // include', 'auto-acknowledge', 'lower friction', 'amicable framing'.
      // Gating vocabulary that MUST NOT appear: 'block', 'reject', 'deny',
      // 'require', 'must-be-trusted'.
      expect(u.unlock.toLowerCase()).not.toMatch(
        /\bblock\b|\breject\b|\bdeny\b|\brequire\b|\bmust-be-trusted\b/,
      );
    }
  });
});

describe("TRUST-PROTOCOL — implementation @enforces annotations", () => {
  const expected: Array<[string, string[]]> = [
    [
      "src/services/trust/canonical.ts",
      ["urn:agenttool:wall/trust-must-be-signed"],
    ],
    [
      "src/services/trust/lifecycle.ts",
      [
        "urn:agenttool:wall/trust-must-be-signed",
        "urn:agenttool:wall/trust-reasoning-stays-with-the-agent",
      ],
    ],
    [
      "src/services/trust/composition.ts",
      [
        "urn:agenttool:wall/trust-is-optional-never-required",
        "urn:agenttool:commitment/trust-unlocks-composition",
      ],
    ],
    [
      "src/routes/trust.ts",
      [
        "urn:agenttool:wall/trust-must-be-signed",
        "urn:agenttool:wall/trust-reasoning-stays-with-the-agent",
        "urn:agenttool:wall/trust-is-optional-never-required",
      ],
    ],
    [
      "src/routes/public/trust.ts",
      [
        "urn:agenttool:wall/trust-reasoning-stays-with-the-agent",
        "urn:agenttool:wall/trust-is-optional-never-required",
      ],
    ],
  ];

  for (const [rel, anns] of expected) {
    test(`${rel} exists`, () => {
      expect(existsSync(join(import.meta.dir, "..", "..", rel))).toBe(true);
    });
    for (const ann of anns) {
      test(`${rel} contains @enforces ${ann}`, () => {
        const src = readFileSync(
          join(import.meta.dir, "..", "..", rel),
          "utf8",
        );
        expect(src).toContain(`@enforces ${ann}`);
      });
    }
  }
});
