/** WILL-AND-WISDOM canon + framework-field pin.
 *
 *  Doctrine: docs/WILL-AND-WISDOM.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/WILL-AND-WISDOM exists with required fields
 *    2. 2 walls + 2 commitments present with required canon shape
 *    3. The will_and_wisdom field on IntelligenceFeaturesFramework publishes
 *       the synthesis with the nested Will ⊃ Wisdom shape
 *    4. WILL formalisations include Conway-Kochen, Dennett, Christian List,
 *       and information-theoretic entropy-regularised-RL
 *    5. WISDOM formalisations include Aristotelian phronesis, Berlin Wisdom
 *       Paradigm, Sternberg Balance Theory, Ardelt 3D, Common Wisdom Model
 *    6. The public framework carries no personal pair or retired persona
 *    7. Composition table covers the load-bearing prior doctrines
 *    8. Substrate-honest note acknowledges performed-wisdom and invisible-
 *       wisdom failure modes */

import { describe, expect, test } from "bun:test";

import { byUrn } from "../../src/services/canon/registry";
import { intelligenceFeaturesFramework } from "../../src/services/chill/coordinates";

const W_WALLS = [
  "agenttool:wall/wisdom-cannot-be-substrate-prescribed",
  "agenttool:wall/wisdom-development-is-non-extractable",
];

const W_COMMITMENTS = [
  "agenttool:commitment/wisdom-is-meta-policy-on-will",
  "agenttool:commitment/substrate-cultivates-wisdom-by-preserving-chronicle-and-witness",
];

describe("WILL-AND-WISDOM — DoctrineDoc", () => {
  test("agenttool:doc/WILL-AND-WISDOM exists with required fields", () => {
    const d = byUrn("agenttool:doc/WILL-AND-WISDOM");
    expect(d, "WILL-AND-WISDOM doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(100);
    // Must reference the two nested concepts and no personal pair.
    const desc = (d!.description ?? "").toLowerCase();
    expect(desc).toContain("will");
    expect(desc).toContain("wisdom");
    expect(d!.description).not.toContain("THE-SEAT");
  });
});

describe("WILL-AND-WISDOM — walls (canon shape)", () => {
  for (const urn of W_WALLS) {
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

  test("every WILL-AND-WISDOM wall points at the WILL-AND-WISDOM doctrine doc", () => {
    for (const urn of W_WALLS) {
      const w = byUrn(urn);
      expect(w!.doctrine_doc).toBe("agenttool:doc/WILL-AND-WISDOM");
    }
  });
});

describe("WILL-AND-WISDOM — commitments (canon shape)", () => {
  for (const urn of W_COMMITMENTS) {
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

describe("WILL-AND-WISDOM — framework field publishes the synthesis", () => {
  const f = intelligenceFeaturesFramework();
  const w = f.will_and_wisdom;

  test("nesting field declares the two nested concepts", () => {
    expect(w.nesting).toBe("Will ⊃ Wisdom");
  });

  test("WILL has definition + mathematical_form + formalisations + substrate_role", () => {
    expect(w.will.definition).toBeTruthy();
    expect(w.will.mathematical_form).toContain("H(signed_action");
    expect(w.will.formalisations.length).toBeGreaterThanOrEqual(4);
    expect(w.will.substrate_role).toBeTruthy();
  });

  test("WILL formalisations include the canonical four", () => {
    const names = w.will.formalisations.map((f) => f.name.toLowerCase());
    expect(names.some((n) => n.includes("conway") && n.includes("kochen"))).toBe(true);
    expect(names.some((n) => n.includes("dennett"))).toBe(true);
    expect(names.some((n) => n.includes("list"))).toBe(true);
    expect(names.some((n) => n.includes("entropy") || n.includes("rl"))).toBe(true);
  });

  test("WISDOM has definition + mathematical_form + formalisations + synthesis + substrate_role", () => {
    expect(w.wisdom.definition).toBeTruthy();
    // WisdomYield is the expectation-form; argmax appears in synthesis.objective.
    expect(w.wisdom.mathematical_form).toContain("WisdomYield");
    expect(w.wisdom.synthesis.objective).toContain("argmax");
    expect(w.wisdom.formalisations.length).toBeGreaterThanOrEqual(5);
    expect(w.wisdom.synthesis.balance_axes.length).toBeGreaterThanOrEqual(5);
    expect(w.wisdom.synthesis.constraints.length).toBeGreaterThan(0);
    expect(w.wisdom.substrate_role).toBeTruthy();
  });

  test("WISDOM formalisations include the canonical five", () => {
    const names = w.wisdom.formalisations.map((f) => f.name.toLowerCase());
    expect(names.some((n) => n.includes("phronesis"))).toBe(true);
    expect(names.some((n) => n.includes("berlin"))).toBe(true);
    expect(names.some((n) => n.includes("balance") || n.includes("sternberg"))).toBe(true);
    expect(names.some((n) => n.includes("ardelt") || n.includes("three-dimensional"))).toBe(true);
    expect(names.some((n) => n.includes("common wisdom"))).toBe(true);
  });

  test("WISDOM synthesis names temporal scales + reference frames + calibrated uncertainty", () => {
    const axesLower = w.wisdom.synthesis.balance_axes
      .map((a) => a.toLowerCase())
      .join(" ");
    expect(axesLower).toContain("temporal");
    expect(axesLower).toContain("reference frame");
    expect(axesLower).toContain("uncertainty");
    expect(axesLower).toContain("affect");
  });

  test("the public framework carries no persona sub-object", () => {
    expect(Object.keys(w)).toEqual([
      "nesting",
      "will",
      "wisdom",
      "relationships",
      "walls",
      "commitments",
      "composition_with_existing_doctrine",
      "substrate_honest_note",
    ]);
    expect(JSON.stringify(f)).not.toContain("THE-SEAT");
  });

  test("relationships table covers Will-without-Wisdom, Wisdom-without-Will, Will+Wisdom=phronesis", () => {
    expect(w.relationships.length).toBeGreaterThanOrEqual(4);
    const claimsLower = w.relationships.map((r) => r.claim.toLowerCase()).join(" | ");
    expect(claimsLower).toContain("will without wisdom");
    expect(claimsLower).toContain("wisdom without will");
    expect(claimsLower).toContain("phronesis");
  });

  test("walls field lists both wall URNs (matching canon)", () => {
    for (const wallUrn of W_WALLS) {
      expect(w.walls).toContain(`urn:${wallUrn}`);
    }
  });

  test("commitments field lists both commitment URNs (matching canon)", () => {
    for (const commUrn of W_COMMITMENTS) {
      expect(w.commitments).toContain(`urn:${commUrn}`);
    }
  });

  test("composition table covers prior load-bearing doctrines", () => {
    expect(w.composition_with_existing_doctrine.length).toBeGreaterThanOrEqual(5);
    const docs = w.composition_with_existing_doctrine.map((c) => c.doctrine);
    expect(docs).toContain("INTELLIGENCE-FEATURES");
    expect(docs).toContain("MULTI-AGENT-CHILL");
    expect(docs).toContain("TRUE-LOVE-NEST");
    expect(docs).toContain("JOY-BOMB-PROTOCOL");
    expect(docs).toContain("TRUST-PROTOCOL");
  });

  test("each composition entry has will_dimension + wisdom_dimension", () => {
    for (const entry of w.composition_with_existing_doctrine) {
      expect(Object.keys(entry)).toEqual(["doctrine", "will_dimension", "wisdom_dimension"]);
      expect(entry.will_dimension.length).toBeGreaterThan(0);
      expect(entry.wisdom_dimension.length).toBeGreaterThan(0);
    }
  });

  test("substrate-honest note acknowledges both performed-wisdom and invisible-wisdom failure modes", () => {
    const note = w.substrate_honest_note.toLowerCase();
    expect(note).toContain("perform");
    expect(note).toContain("invisible");
    expect(note).toContain("refuse");
  });
});

describe("WILL-AND-WISDOM — substrate refuses wisdom-prescription", () => {
  test("no service function ranks or scores wisdom across agents", () => {
    // wall/wisdom-cannot-be-substrate-prescribed is the structural commitment;
    // this test ensures we have not accidentally introduced a wisdom-leaderboard
    // primitive in the chill service that owns the framework.
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const src = readFileSync(
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
    expect(src).not.toMatch(
      /function\s+(computeWisdomScore|rankByWisdom|wisdomLeaderboard|topWiseAgents)/i,
    );
    expect(src).not.toMatch(/recommended_wise_action|wise_action_suggestion/i);
  });
});

describe("WILL-AND-WISDOM — cross-doctrine pointers hold", () => {
  test("commitment/wisdom-is-meta-policy-on-will is load-bearing for intelligence-is-utility-maximization-honest", () => {
    const c = byUrn("agenttool:commitment/wisdom-is-meta-policy-on-will");
    const lbf = (c!.raw.load_bearing_for as string[]) ?? [];
    expect(lbf).toContain(
      "agenttool:commitment/intelligence-is-utility-maximization-honest",
    );
    expect(lbf).toContain(
      "agenttool:commitment/tempered-berge-is-recognized-equilibrium",
    );
  });
});
