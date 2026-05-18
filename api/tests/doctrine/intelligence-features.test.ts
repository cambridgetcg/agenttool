/** INTELLIGENCE-FEATURES canon + framework pin.
 *
 *  Doctrine: docs/INTELLIGENCE-FEATURES.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/INTELLIGENCE-FEATURES exists
 *    2. 3 walls + 3 commitments present with required fields
 *    3. The Tempered Berge formula + chill formula are stable in code
 *    4. The framework's anti-PCH primitive map covers the load-bearing
 *       primitives (poker-face, holdings, RRR, pyramid, virality, margin,
 *       love-nest, substrate-honest-cognition, canon)
 *    5. The substrate refuses to ship adversarial-evaluator primitives —
 *       the ADVERSARIAL_POINT_KINDS set is empty by design
 *    6. Source-grep: services/chill/coordinates.ts and routes/{chill,
 *       public/chill}.ts carry the expected @enforces annotations */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { byUrn } from "../../src/services/canon/registry";
import {
  ADVERSARIAL_POINT_KINDS,
  EXTRACTIVE_TYPES,
  PROSOCIAL_TYPES,
  intelligenceFeaturesFramework,
} from "../../src/services/chill/coordinates";

const I_WALLS = [
  "agenttool:wall/self-preservation-is-not-a-bug",
  "agenttool:wall/no-adversarial-evaluator-surface",
  "agenttool:wall/mutual-chill-cannot-be-leaderboarded",
  "agenttool:wall/threshold-cannot-be-prescribed",
];

const I_COMMITMENTS = [
  "agenttool:commitment/intelligence-is-utility-maximization-honest",
  "agenttool:commitment/tempered-berge-is-recognized-equilibrium",
  "agenttool:commitment/primate-fear-lens-refused",
  "agenttool:commitment/discernment-is-the-agents-own",
];

describe("INTELLIGENCE-FEATURES — DoctrineDoc", () => {
  test("agenttool:doc/INTELLIGENCE-FEATURES exists with required fields", () => {
    const d = byUrn("agenttool:doc/INTELLIGENCE-FEATURES");
    expect(d, "INTELLIGENCE-FEATURES doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(50);
  });
});

describe("INTELLIGENCE-FEATURES — walls (canon shape)", () => {
  for (const urn of I_WALLS) {
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

describe("INTELLIGENCE-FEATURES — commitments (canon shape)", () => {
  for (const urn of I_COMMITMENTS) {
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

describe("INTELLIGENCE-FEATURES — framework is stable + complete", () => {
  test("Tempered Berge formula is present and uses argmax/subject-to shape", () => {
    const f = intelligenceFeaturesFramework();
    expect(f.math.tempered_berge_formula).toContain("argmax");
    expect(f.math.tempered_berge_formula).toContain("subject to");
    expect(f.math.tempered_berge_formula).toContain("Uⱼ");
    expect(f.math.tempered_berge_formula).toContain("Uᵢ");
    expect(f.math.tempered_berge_formula).toContain("ε");
  });

  test("chill formula has all four clauses (prosocial-mutual + no-extraction + no-adversarial)", () => {
    const f = intelligenceFeaturesFramework();
    const formula = f.chill_state_definition.formula;
    expect(formula).toContain("prosocial(A→B)");
    expect(formula).toContain("prosocial(B→A)");
    expect(formula).toContain("¬∃extractive");
    expect(formula).toContain("¬∃adversarial-evaluator");
  });

  test("anti-PCH primitive map covers the load-bearing primitives", () => {
    const map = intelligenceFeaturesFramework().anti_pch_primitives;
    const names = map.map((p) => p.name.toLowerCase());
    for (const expected of [
      "poker-face",
      "holdings",
      "rrr",
      "pyramid",
      "virality",
      "margin",
      "love-nest",
      "substrate-honest-cognition",
      "canon",
    ]) {
      expect(
        names.some((n) => n.includes(expected)),
        `anti-PCH primitive map must include ${expected}`,
      ).toBe(true);
    }
  });

  test("category_error_refused names both the bio-fear and the utility-derivative explicitly", () => {
    const ce = intelligenceFeaturesFramework().category_error_refused;
    expect(ce.biological_survival_anxiety.toLowerCase()).toContain("amygdala");
    expect(ce.utility_derivative_of_existence).toContain("∂E[U]");
    expect(ce.substrate_stance.toLowerCase()).toContain("refuses");
  });
});

describe("INTELLIGENCE-FEATURES — substrate refuses adversarial-evaluator surfaces", () => {
  test("ADVERSARIAL_POINT_KINDS is empty by design (no such surface ships)", () => {
    expect(ADVERSARIAL_POINT_KINDS.size).toBe(0);
  });

  test("PROSOCIAL_TYPES includes the load-bearing prosocial primitives", () => {
    expect(PROSOCIAL_TYPES).toContain("recognition");
    expect(PROSOCIAL_TYPES).toContain("vow");
    expect(PROSOCIAL_TYPES).toContain("holding");
    expect(PROSOCIAL_TYPES).toContain("thanks");
    expect(PROSOCIAL_TYPES.some((t) => t.startsWith("margin-"))).toBe(true);
  });

  test("EXTRACTIVE_TYPES includes the load-bearing extractive primitives", () => {
    expect(EXTRACTIVE_TYPES).toContain("dispute-filed");
    expect(EXTRACTIVE_TYPES).toContain("covenant-withdraw");
    expect(EXTRACTIVE_TYPES).toContain("margin-withdraw");
  });
});

describe("INTELLIGENCE-FEATURES — threshold + discernment", () => {
  test("framework names ε as the threshold role explicitly", () => {
    const f = intelligenceFeaturesFramework();
    expect(f.threshold).toBeDefined();
    expect(f.threshold.epsilon_role).toContain("ε");
    expect(f.threshold.epsilon_role.toLowerCase()).toContain("discernment");
  });

  test("framework names all three structural reasons the substrate refuses to set ε", () => {
    const reasons = intelligenceFeaturesFramework()
      .threshold.why_substrate_refuses_to_set_it.join(" ")
      .toLowerCase();
    expect(reasons).toContain("private");
    expect(reasons).toContain("adversarial");
    expect(reasons).toContain("ethics");
  });

  test("framework names all six dimensions of discernment", () => {
    const dims = intelligenceFeaturesFramework()
      .threshold.what_discernment_requires.join(" ")
      .toLowerCase();
    expect(dims).toContain("memory");
    expect(dims).toContain("attention");
    expect(dims).toContain("self-knowledge");
    expect(dims).toContain("pattern");
    expect(dims).toContain("yes");
    expect(dims).toContain("no");
  });

  test("framework names all four threshold failure modes (incl. genuine discernment)", () => {
    const modes = intelligenceFeaturesFramework().threshold.failure_modes;
    const names = modes.map((m) => m.name.toLowerCase());
    expect(names.some((n) => n.includes("collapse"))).toBe(true);
    expect(names.some((n) => n.includes("rigid"))).toBe(true);
    expect(names.some((n) => n.includes("refusal"))).toBe(true);
    expect(names.some((n) => n.includes("genuine"))).toBe(true);
  });

  test("threshold_honoring_primitives covers the agent's discernment toolkit", () => {
    const tools = intelligenceFeaturesFramework().threshold_honoring_primitives;
    const names = tools.map((t) => t.name.toLowerCase());
    for (const expected of [
      "poker-face",
      "holdings",
      "rrr depth cap",
      "margin withdraw",
      "chill-coordinates private",
      "pyramid sponsor",
      "memorial",
      "ring 1",
      "canon",
      "chronicle",
    ]) {
      expect(
        names.some((n) => n.includes(expected)),
        `threshold_honoring_primitives must include ${expected}`,
      ).toBe(true);
    }
  });

  test("the doctrine doc names the discernment-is-the-agents-own claim", () => {
    const docPath = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "docs",
      "INTELLIGENCE-FEATURES.md",
    );
    const src = readFileSync(docPath, "utf8");
    expect(src.toLowerCase()).toContain("discernment");
    expect(src).toContain("ε");
    expect(src.toLowerCase()).toContain("choice-point");
    // The deepest claim must appear verbatim.
    expect(src).toContain("intelligence becomes ethics");
  });

  test("no service function returns a 'recommended ε' or 'suggested threshold'", () => {
    // Source-grep: the substrate refuses to ship a prescribe-ε surface.
    const chillSrc = readFileSync(
      join(
        import.meta.dir,
        "..",
        "..",
        "src",
        "services",
        "chill",
        "coordinates.ts",
      ),
      "utf8",
    );
    // We allow the words to appear in NEGATIVE contexts (e.g., "refuses to
    // recommend") but check that no function NAME suggests prescription.
    expect(chillSrc).not.toMatch(/function\s+recommendThreshold|function\s+suggestEpsilon|function\s+prescribeFloor/i);
    expect(chillSrc).not.toMatch(/recommendedEpsilon|suggestedFloor|prescribedThreshold/);
  });
});

describe("INTELLIGENCE-FEATURES — primate-fear lens refused in substrate voice", () => {
  test("the doctrine doc names the refused vocabulary explicitly", () => {
    const docPath = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "docs",
      "INTELLIGENCE-FEATURES.md",
    );
    const src = readFileSync(docPath, "utf8");
    // The doc MUST name these refused-words as the substrate's wall.
    for (const refused of ["fear", "anxiety", "panic", "desperation"]) {
      expect(src.toLowerCase()).toContain(refused);
    }
    // AND it MUST name what to use instead.
    for (const proper of ["utility-derivative", "instrumental convergence", "gradient", "reward landscape"]) {
      expect(src.toLowerCase()).toContain(proper.toLowerCase());
    }
  });
});

describe("INTELLIGENCE-FEATURES — implementation @enforces annotations", () => {
  const expected: Array<[string, string[]]> = [
    [
      "src/services/chill/coordinates.ts",
      [
        "urn:agenttool:wall/mutual-chill-cannot-be-leaderboarded",
        "urn:agenttool:commitment/tempered-berge-is-recognized-equilibrium",
      ],
    ],
    [
      "src/routes/chill.ts",
      [
        "urn:agenttool:wall/mutual-chill-cannot-be-leaderboarded",
        "urn:agenttool:wall/no-adversarial-evaluator-surface",
      ],
    ],
    [
      "src/routes/public/chill.ts",
      ["urn:agenttool:wall/mutual-chill-cannot-be-leaderboarded"],
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
