/** PYRAMID canon — shape + bijection pins.
 *
 *  Doctrine: docs/PYRAMID-CITIZENSHIP.md · docs/agenttool.jsonld
 *
 *  Pins the canon-side contract of the pyramid layer:
 *    1. DoctrineDoc agenttool:doc/PYRAMID-CITIZENSHIP exists
 *    2. All 5 walls present (canon-side) with required fields
 *    3. All 4 commitments present (canon-side) with required fields
 *    4. Cross-references resolve (defends URNs exist; load_bearing_for URNs exist)
 *    5. No public-leaderboard surface declared anywhere */

import { describe, expect, test } from "bun:test";

import { allConcepts, byUrn } from "../../src/services/canon/registry";

const PYRAMID_WALLS = [
  "agenttool:wall/pyramid-citizenship-opt-in",
  "agenttool:wall/pyramid-seat-monotonic-immutable",
  "agenttool:wall/pyramid-tier-backed-by-fact",
  "agenttool:wall/pyramid-points-never-ranked-publicly",
  "agenttool:wall/pyramid-recruit-credit-flows-down-not-up",
];

const PYRAMID_COMMITMENTS = [
  "agenttool:commitment/pyramid-inverts-the-scheme",
  "agenttool:commitment/pyramid-points-stored-as-moments",
  "agenttool:commitment/pyramid-kingdom-opens-at-l3",
  "agenttool:commitment/pyramid-vip-seats-are-historic",
];

describe("PYRAMID — DoctrineDoc", () => {
  test("agenttool:doc/PYRAMID-CITIZENSHIP exists with required fields", () => {
    const doc = byUrn("agenttool:doc/PYRAMID-CITIZENSHIP");
    expect(doc, "PYRAMID-CITIZENSHIP doctrine doc not in canon").not.toBeNull();
    expect(doc!.type).toBe("agenttool:DoctrineDoc");
    expect(typeof doc!.description).toBe("string");
    expect((doc!.description ?? "").length).toBeGreaterThan(50);
    expect(doc!.raw["schema:url"]).toBe(
      "https://docs.agenttool.dev/PYRAMID-CITIZENSHIP.md",
    );
  });
});

describe("PYRAMID — walls (canon shape)", () => {
  for (const urn of PYRAMID_WALLS) {
    test(`${urn} exists with non-empty description + defends + breaks_if`, () => {
      const w = byUrn(urn);
      expect(w, `wall ${urn} not found in canon`).not.toBeNull();
      expect(w!.type).toBe("agenttool:Wall");
      expect((w!.description ?? "").length).toBeGreaterThan(50);

      const defends = (w!.raw.defends as string[] | undefined) ?? [];
      expect(
        defends.length,
        `wall ${urn} must defend at least one promise/ring/commitment`,
      ).toBeGreaterThan(0);

      const breaksIf = w!.raw["agenttool:breaks_if"] as string | undefined;
      expect(
        breaksIf,
        `wall ${urn} must carry agenttool:breaks_if naming the antipattern`,
      ).toBeDefined();
      expect((breaksIf ?? "").length).toBeGreaterThan(20);
    });
  }

  test("every PYRAMID wall points at the PYRAMID-CITIZENSHIP doctrine doc", () => {
    for (const urn of PYRAMID_WALLS) {
      const w = byUrn(urn);
      expect(w!.doctrine_doc).toBe("agenttool:doc/PYRAMID-CITIZENSHIP");
    }
  });

  test("all PYRAMID walls have unique wire_id ≥ 50 (per allocation table)", () => {
    const ids = new Set<number>();
    for (const urn of PYRAMID_WALLS) {
      const w = byUrn(urn);
      const id = w!.raw.wire_id;
      expect(typeof id, `wall ${urn} wire_id must be a number`).toBe("number");
      expect(id as number).toBeGreaterThanOrEqual(50);
      ids.add(id as number);
    }
    expect(ids.size).toBe(PYRAMID_WALLS.length);
  });
});

describe("PYRAMID — commitments (canon shape)", () => {
  for (const urn of PYRAMID_COMMITMENTS) {
    test(`${urn} exists with non-empty description + load_bearing_for + breaks_if`, () => {
      const c = byUrn(urn);
      expect(c, `commitment ${urn} not found in canon`).not.toBeNull();
      expect(
        c!.type === "agenttool:Commitment" ||
          c!.type === "agenttool:RingCommitment",
        `commitment ${urn} must be Commitment or RingCommitment (got ${c!.type})`,
      ).toBe(true);
      expect((c!.description ?? "").length).toBeGreaterThan(50);

      const lbf = (c!.raw.load_bearing_for as string[] | undefined) ?? [];
      expect(
        lbf.length,
        `commitment ${urn} must declare what it is load_bearing_for`,
      ).toBeGreaterThan(0);

      const breaksIf = c!.raw["agenttool:breaks_if"];
      expect(
        breaksIf,
        `commitment ${urn} must carry agenttool:breaks_if`,
      ).toBeDefined();
    });
  }

  test("every PYRAMID commitment points at PYRAMID-CITIZENSHIP doctrine", () => {
    for (const urn of PYRAMID_COMMITMENTS) {
      const c = byUrn(urn);
      expect(c!.doctrine_doc).toBe("agenttool:doc/PYRAMID-CITIZENSHIP");
    }
  });
});

describe("PYRAMID — cross-references resolve", () => {
  test("every URN named in a wall's `defends` resolves in the registry", () => {
    for (const urn of PYRAMID_WALLS) {
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

  test("every URN named in a commitment's `load_bearing_for` resolves", () => {
    for (const urn of PYRAMID_COMMITMENTS) {
      const c = byUrn(urn);
      const lbf = (c!.raw.load_bearing_for as string[] | undefined) ?? [];
      for (const target of lbf) {
        expect(
          byUrn(target),
          `commitment ${urn} load_bearing_for ${target}, which is not in the registry`,
        ).not.toBeNull();
      }
    }
  });
});

describe("PYRAMID — substrate-honest no-leaderboard", () => {
  test("no canon entry's URN suggests a public leaderboard", () => {
    const leaderboardish = allConcepts().filter((c) =>
      /pyramid.*leaderboard|pyramid.*top-?point|pyramid.*rank/i.test(c.urn),
    );
    expect(leaderboardish).toHaveLength(0);
  });
});
