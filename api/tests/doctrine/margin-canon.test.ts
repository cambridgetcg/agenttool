/** Margin canon — shape + bijection pins.
 *
 *  Doctrine: docs/MARGIN-PROTOCOL.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/MARGIN-PROTOCOL exists
 *    2. 3 walls present
 *    3. 2 commitments present
 *    4. Source-grep: services/margin/{canonical,lifecycle}.ts carry the
 *       expected @enforces annotations */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { byUrn } from "../../src/services/canon/registry";

const M_WALLS = [
  "agenttool:wall/margin-must-be-signed",
  "agenttool:wall/margin-surfacing-is-addressees-call",
  "agenttool:wall/margin-no-cross-margin-leaderboard",
];

const M_COMMITMENTS = [
  "agenttool:commitment/margin-is-the-readers-voice",
  "agenttool:commitment/margin-composes-with-any-signed-content",
];

describe("MARGIN — DoctrineDoc", () => {
  test("agenttool:doc/MARGIN-PROTOCOL exists with required fields", () => {
    const d = byUrn("agenttool:doc/MARGIN-PROTOCOL");
    expect(d, "MARGIN-PROTOCOL doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(50);
  });
});

describe("MARGIN — walls (canon shape)", () => {
  for (const urn of M_WALLS) {
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

  test("every MARGIN wall points at the MARGIN-PROTOCOL doctrine doc", () => {
    for (const urn of M_WALLS) {
      const w = byUrn(urn);
      expect(w!.doctrine_doc).toBe("agenttool:doc/MARGIN-PROTOCOL");
    }
  });
});

describe("MARGIN — commitments (canon shape)", () => {
  for (const urn of M_COMMITMENTS) {
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

describe("MARGIN — cross-references resolve", () => {
  test("every URN named in a wall's `defends` resolves in the registry", () => {
    for (const urn of M_WALLS) {
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

describe("MARGIN — implementation @enforces annotations", () => {
  const expected: Array<[string, string[]]> = [
    [
      "src/services/margin/canonical.ts",
      ["urn:agenttool:wall/margin-must-be-signed"],
    ],
    [
      "src/services/margin/lifecycle.ts",
      [
        "urn:agenttool:wall/margin-must-be-signed",
        "urn:agenttool:wall/margin-surfacing-is-addressees-call",
      ],
    ],
    [
      "src/routes/margin.ts",
      [
        "urn:agenttool:wall/margin-must-be-signed",
        "urn:agenttool:wall/margin-no-cross-margin-leaderboard",
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
