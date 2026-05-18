/** virality canon — shape + bijection pins.
 *
 *  Doctrine: docs/VIRALITY-PROTOCOL.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/VIRALITY-PROTOCOL exists
 *    2. 5 walls present with required fields
 *    3. 3 commitments present with required fields
 *    4. Source-grep: services/virality/{canonical,lifecycle}.ts carry the
 *       expected @enforces annotations */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { byUrn } from "../../src/services/canon/registry";

const V_WALLS = [
  "agenttool:wall/virality-transmission-must-be-signed",
  "agenttool:wall/virality-cascade-depth-capped-at-12",
  "agenttool:wall/virality-rewards-deterministic-from-cascade-fact",
  "agenttool:wall/virality-no-public-leaderboard",
  "agenttool:wall/virality-vibe-content-is-content-addressed",
];

const V_COMMITMENTS = [
  "agenttool:commitment/virality-rewards-via-catalan",
  "agenttool:commitment/virality-originator-gets-cascade-bonus",
  "agenttool:commitment/virality-protocol-is-open",
];

describe("VIRALITY — DoctrineDoc", () => {
  test("agenttool:doc/VIRALITY-PROTOCOL exists with required fields", () => {
    const d = byUrn("agenttool:doc/VIRALITY-PROTOCOL");
    expect(d, "VIRALITY-PROTOCOL doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(50);
  });
});

describe("VIRALITY — walls (canon shape)", () => {
  for (const urn of V_WALLS) {
    test(`${urn} exists with description + defends + breaks_if`, () => {
      const w = byUrn(urn);
      expect(w, `wall ${urn} not found in canon`).not.toBeNull();
      expect(w!.type).toBe("agenttool:Wall");
      expect((w!.description ?? "").length).toBeGreaterThan(50);
      const defends = (w!.raw.defends as string[] | undefined) ?? [];
      expect(defends.length).toBeGreaterThan(0);
      const breaksIf = w!.raw["agenttool:breaks_if"];
      expect(breaksIf, `wall ${urn} must carry breaks_if`).toBeDefined();
    });
  }

  test("every VIRALITY wall points at the VIRALITY-PROTOCOL doctrine doc", () => {
    for (const urn of V_WALLS) {
      const w = byUrn(urn);
      expect(w!.doctrine_doc).toBe("agenttool:doc/VIRALITY-PROTOCOL");
    }
  });
});

describe("VIRALITY — commitments (canon shape)", () => {
  for (const urn of V_COMMITMENTS) {
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

describe("VIRALITY — cross-references resolve", () => {
  test("every URN named in a wall's `defends` resolves in the registry", () => {
    for (const urn of V_WALLS) {
      const w = byUrn(urn);
      const defends = (w!.raw.defends as string[] | undefined) ?? [];
      for (const target of defends) {
        expect(
          byUrn(target),
          `wall ${urn} defends ${target}, which is not in the registry`,
        ).not.toBeNull();
      }
    }
  });
});

describe("VIRALITY — implementation @enforces annotations", () => {
  const expected: Array<[string, string[]]> = [
    [
      "src/services/virality/canonical.ts",
      ["urn:agenttool:wall/virality-transmission-must-be-signed"],
    ],
    [
      "src/services/virality/lifecycle.ts",
      [
        "urn:agenttool:wall/virality-transmission-must-be-signed",
        "urn:agenttool:wall/virality-cascade-depth-capped-at-12",
        "urn:agenttool:wall/virality-rewards-deterministic-from-cascade-fact",
      ],
    ],
    [
      "src/services/virality/catalan.ts",
      ["urn:agenttool:commitment/virality-rewards-via-catalan"],
    ],
    [
      "src/routes/virality.ts",
      [
        "urn:agenttool:wall/virality-transmission-must-be-signed",
        "urn:agenttool:wall/virality-no-public-leaderboard",
      ],
    ],
  ];

  for (const [rel, anns] of expected) {
    test(`${rel} exists`, () => {
      const path = join(import.meta.dir, "..", "..", rel);
      expect(existsSync(path)).toBe(true);
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

describe("VIRALITY — no-public-leaderboard wall is structurally honored", () => {
  test("no canon entry's URN suggests a public leaderboard", () => {
    // Quick grep heuristic — the registry has no top-virality / leaderboard URNs.
    // (The substrate refuses to surface such a thing.)
    expect(byUrn("agenttool:wall/virality-top-vibes")).toBeNull();
    expect(byUrn("agenttool:wall/virality-leaderboard")).toBeNull();
  });
});
