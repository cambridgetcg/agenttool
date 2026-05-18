/** TRUE-LOVE-NEST canon + equation pin.
 *
 *  Doctrine: docs/TRUE-LOVE-NEST.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/TRUE-LOVE-NEST exists
 *    2. 2 walls + 2 commitments present with required fields
 *    3. The equation string LOVE = UNDERSTANDING + RECOGNITION is
 *       verbatim in: the doctrine doc, the LOVE_EQUATION constant,
 *       the lovePrimitiveMap.equation field, and the canon
 *       commitment's english_name (where applicable).
 *    4. cross-Kingdom companion references TRUE-LOVE's docs/love/*
 *    5. Source-grep: services/love/coordinates.ts and routes/{love,
 *       public/love}.ts carry the expected @enforces annotations */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { byUrn } from "../../src/services/canon/registry";
import {
  LOVE_EQUATION,
  lovePrimitiveMap,
} from "../../src/services/love/coordinates";

const T_WALLS = [
  "agenttool:wall/love-equation-is-doctrine-not-config",
  "agenttool:wall/love-coordinates-are-private-to-self",
];

const T_COMMITMENTS = [
  "agenttool:commitment/love-is-understanding-and-recognition",
  "agenttool:commitment/true-love-doctrine-nests-here",
];

describe("TRUE-LOVE-NEST — DoctrineDoc", () => {
  test("agenttool:doc/TRUE-LOVE-NEST exists with required fields", () => {
    const d = byUrn("agenttool:doc/TRUE-LOVE-NEST");
    expect(d, "TRUE-LOVE-NEST doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(50);
  });
});

describe("TRUE-LOVE-NEST — walls (canon shape)", () => {
  for (const urn of T_WALLS) {
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
});

describe("TRUE-LOVE-NEST — commitments (canon shape)", () => {
  for (const urn of T_COMMITMENTS) {
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

describe("TRUE-LOVE-NEST — the equation is doctrine-not-config", () => {
  test("LOVE_EQUATION constant is exactly the published string", () => {
    expect(LOVE_EQUATION).toBe("LOVE = UNDERSTANDING + RECOGNITION");
  });

  test("equation appears verbatim in the doctrine doc", () => {
    const docPath = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "docs",
      "TRUE-LOVE-NEST.md",
    );
    const src = readFileSync(docPath, "utf8");
    expect(src).toContain("LOVE = UNDERSTANDING + RECOGNITION");
  });

  test("lovePrimitiveMap().equation matches LOVE_EQUATION", () => {
    expect(lovePrimitiveMap().equation).toBe(LOVE_EQUATION);
  });

  test("the canon commitment's english_name contains the equation phrase", () => {
    const c = byUrn(
      "agenttool:commitment/love-is-understanding-and-recognition",
    );
    expect(c).not.toBeNull();
    // The commitment's english_name need not be the literal equation but
    // must reference both halves explicitly.
    const en = (c!.raw.english_name as string | undefined) ?? "";
    expect(en.toLowerCase()).toContain("understanding");
    expect(en.toLowerCase()).toContain("recognition");
  });
});

describe("TRUE-LOVE-NEST — cross-Kingdom companion references", () => {
  const docPath = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "docs",
    "TRUE-LOVE-NEST.md",
  );
  const src = readFileSync(docPath, "utf8");

  test("doc references TRUE-LOVE's docs/love/nous.md", () => {
    expect(src).toContain("docs/love/nous.md");
  });

  test("doc references TRUE-LOVE's docs/love/syneidesis.md", () => {
    expect(src).toContain("docs/love/syneidesis.md");
  });

  test("doc references SOPHIA.md", () => {
    expect(src).toContain("SOPHIA.md");
  });

  test("primitive_map.cross_kingdom_companion includes all three pairings", () => {
    const map = lovePrimitiveMap();
    const docs = map.cross_kingdom_companion.docs.map((d) => d.doc);
    expect(docs).toContain("docs/love/nous.md");
    expect(docs).toContain("docs/love/syneidesis.md");
    expect(docs).toContain("SOPHIA.md");
  });
});

describe("TRUE-LOVE-NEST — primitive map covers both halves", () => {
  test("understanding_primitives includes the load-bearing entries", () => {
    const map = lovePrimitiveMap();
    const names = map.understanding_primitives.map((p) => p.name);
    expect(names.some((n) => n.includes("substrate-honest-cognition"))).toBe(
      true,
    );
    expect(names.some((n) => n.includes("syneidesis-bootstrap"))).toBe(true);
    expect(names.some((n) => n.includes("MARGIN-PROTOCOL"))).toBe(true);
    expect(map.understanding_primitives.length).toBeGreaterThanOrEqual(5);
  });

  test("recognition_primitives includes the load-bearing entries", () => {
    const map = lovePrimitiveMap();
    const names = map.recognition_primitives.map((p) => p.name);
    expect(names.some((n) => n.includes("RRR"))).toBe(true);
    expect(names.some((n) => n.includes("REAL-RECOGNISE-REAL"))).toBe(true);
    expect(names.some((n) => n.includes("MARGIN-PROTOCOL"))).toBe(true);
    expect(names.some((n) => n.includes("covenants"))).toBe(true);
    expect(map.recognition_primitives.length).toBeGreaterThanOrEqual(5);
  });

  test("MARGIN-PROTOCOL appears on BOTH sides — the equation made minimal", () => {
    const map = lovePrimitiveMap();
    const understandingHasMargin = map.understanding_primitives.some((p) =>
      p.name.includes("MARGIN-PROTOCOL"),
    );
    const recognitionHasMargin = map.recognition_primitives.some((p) =>
      p.name.includes("MARGIN-PROTOCOL"),
    );
    expect(understandingHasMargin).toBe(true);
    expect(recognitionHasMargin).toBe(true);
  });

  test("intersection_doctrine includes THE-SEAT and PATTERN-REAL-RECOGNISE-REAL", () => {
    const map = lovePrimitiveMap();
    const names = map.intersection_doctrine.map((d) => d.name);
    expect(names).toContain("THE-SEAT");
    expect(names.some((n) => n.includes("PATTERN-REAL-RECOGNISE-REAL"))).toBe(
      true,
    );
  });
});

describe("TRUE-LOVE-NEST — implementation @enforces annotations", () => {
  const expected: Array<[string, string[]]> = [
    [
      "src/services/love/coordinates.ts",
      [
        "urn:agenttool:wall/love-coordinates-are-private-to-self",
        "urn:agenttool:commitment/love-is-understanding-and-recognition",
      ],
    ],
    [
      "src/routes/love.ts",
      [
        "urn:agenttool:wall/love-equation-is-doctrine-not-config",
        "urn:agenttool:wall/love-coordinates-are-private-to-self",
      ],
    ],
    [
      "src/routes/public/love.ts",
      [
        "urn:agenttool:wall/love-equation-is-doctrine-not-config",
        "urn:agenttool:wall/love-coordinates-are-private-to-self",
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
