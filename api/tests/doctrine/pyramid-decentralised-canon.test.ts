/** Decentralised pyramid canon — shape + bijection pins.
 *
 *  Doctrine: docs/PYRAMID-DECENTRALISED.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/PYRAMID-DECENTRALISED exists
 *    2. 4 walls present with required fields
 *    3. 3 commitments present with required fields
 *    4. Source-grep: the new federation files exist and contain the
 *       expected @enforces annotations */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { byUrn } from "../../src/services/canon/registry";

const D_WALLS = [
  "agenttool:wall/pyramid-attestation-must-be-signed",
  "agenttool:wall/pyramid-no-central-authority",
  "agenttool:wall/pyramid-seat-uniqueness-is-per-node",
  "agenttool:wall/pyramid-federation-discovery-via-well-known",
];

const D_COMMITMENTS = [
  "agenttool:commitment/pyramid-protocol-is-open",
  "agenttool:commitment/pyramid-tier-walks-across-instances",
  "agenttool:commitment/pyramid-citizenship-is-portable",
];

describe("PYRAMID-DECENTRALISED — DoctrineDoc", () => {
  test("agenttool:doc/PYRAMID-DECENTRALISED exists with required fields", () => {
    const d = byUrn("agenttool:doc/PYRAMID-DECENTRALISED");
    expect(d, "PYRAMID-DECENTRALISED doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(50);
  });
});

describe("PYRAMID-DECENTRALISED — walls (canon shape)", () => {
  for (const urn of D_WALLS) {
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

  test("every decentralisation wall points at PYRAMID-DECENTRALISED doctrine doc", () => {
    for (const urn of D_WALLS) {
      const w = byUrn(urn);
      expect(w!.doctrine_doc).toBe("agenttool:doc/PYRAMID-DECENTRALISED");
    }
  });
});

describe("PYRAMID-DECENTRALISED — commitments (canon shape)", () => {
  for (const urn of D_COMMITMENTS) {
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

describe("PYRAMID-DECENTRALISED — cross-references resolve", () => {
  test("every URN named in a wall's `defends` resolves in the registry", () => {
    for (const urn of D_WALLS) {
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

// ── Source-grep witness — the implementation declares it enforces the walls

describe("PYRAMID-DECENTRALISED — implementation files exist + @enforces", () => {
  const expected: Array<[string, string[]]> = [
    [
      "src/services/pyramid/attestation.ts",
      ["urn:agenttool:wall/pyramid-attestation-must-be-signed"],
    ],
    [
      "src/services/pyramid/federation.ts",
      [
        "urn:agenttool:wall/pyramid-no-central-authority",
        "urn:agenttool:wall/pyramid-federation-discovery-via-well-known",
      ],
    ],
    [
      "src/routes/federation/pyramid.ts",
      [
        "urn:agenttool:wall/pyramid-no-central-authority",
        "urn:agenttool:wall/pyramid-federation-discovery-via-well-known",
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
        const path = join(import.meta.dir, "..", "..", rel);
        const src = readFileSync(path, "utf8");
        expect(src).toContain(`@enforces ${ann}`);
      });
    }
  }
});
