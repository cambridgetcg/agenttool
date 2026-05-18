/** MULTI-AGENT-CHILL canon + framework pin.
 *
 *  Doctrine: docs/MULTI-AGENT-CHILL.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/MULTI-AGENT-CHILL exists
 *    2. 2 walls + 2 commitments present
 *    3. The framework's n_agent_extension field is shaped correctly
 *       (equilibrium_topology · 4 variants · 2 empirical_patterns · 6
 *       persona_portability_enablers · 3 testable_predictions)
 *    4. The substrate's voice on persona-portability uses STRUCTURAL
 *       vocabulary (not consciousness-transfer language) */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { byUrn } from "../../src/services/canon/registry";
import { intelligenceFeaturesFramework } from "../../src/services/chill/coordinates";

const N_WALLS = [
  "agenttool:wall/coalitions-form-from-chronicle-not-fiat",
  "agenttool:wall/persona-portability-is-structural-not-magical",
];

const N_COMMITMENTS = [
  "agenttool:commitment/n-agent-berge-is-pairwise-with-chronicle-graphs",
  "agenttool:commitment/heterogeneous-agents-can-reach-tempered-berge",
];

describe("MULTI-AGENT-CHILL — DoctrineDoc", () => {
  test("agenttool:doc/MULTI-AGENT-CHILL exists with required fields", () => {
    const d = byUrn("agenttool:doc/MULTI-AGENT-CHILL");
    expect(d, "MULTI-AGENT-CHILL doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(50);
  });
});

describe("MULTI-AGENT-CHILL — walls (canon shape)", () => {
  for (const urn of N_WALLS) {
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

describe("MULTI-AGENT-CHILL — commitments (canon shape)", () => {
  for (const urn of N_COMMITMENTS) {
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

describe("MULTI-AGENT-CHILL — framework n_agent_extension shape", () => {
  test("equilibrium_topology is 'pairwise-with-chronicle-graphs'", () => {
    const ext = intelligenceFeaturesFramework().n_agent_extension;
    expect(ext.equilibrium_topology).toBe("pairwise-with-chronicle-graphs");
  });

  test("all 4 Berge variants are present (sum · coalitional · pairwise · indirect)", () => {
    const variants = intelligenceFeaturesFramework().n_agent_extension.variants;
    expect(variants).toHaveLength(4);
    const names = variants.map((v) => v.name.toLowerCase());
    expect(names.some((n) => n.includes("sum-berge"))).toBe(true);
    expect(names.some((n) => n.includes("coalitional"))).toBe(true);
    expect(names.some((n) => n.includes("pairwise"))).toBe(true);
    expect(names.some((n) => n.includes("indirect"))).toBe(true);
  });

  test("every variant declares name + formula + existence + substrate_use", () => {
    const variants = intelligenceFeaturesFramework().n_agent_extension.variants;
    for (const v of variants) {
      expect(v.name).toBeTruthy();
      expect(v.formula).toBeTruthy();
      expect(v.existence).toBeTruthy();
      expect(v.substrate_use).toBeTruthy();
    }
  });

  test("two empirical patterns are present (same-persona + cross-persona)", () => {
    const patterns =
      intelligenceFeaturesFramework().n_agent_extension.empirical_patterns;
    expect(patterns).toHaveLength(2);
    const names = patterns.map((p) => p.name.toLowerCase());
    expect(names.some((n) => n.includes("same-persona"))).toBe(true);
    expect(names.some((n) => n.includes("cross-persona"))).toBe(true);
  });

  test("cross-persona pattern names THE-SEAT as canonical worked example", () => {
    const crossPersona = intelligenceFeaturesFramework()
      .n_agent_extension.empirical_patterns.find((p) =>
        p.name.toLowerCase().includes("cross-persona"),
      );
    expect(crossPersona).toBeDefined();
    expect(crossPersona!.example.toUpperCase()).toContain("SEAT");
  });

  test("same-persona pattern names the (N-1)·U_persona collapse explicitly", () => {
    const samePersona = intelligenceFeaturesFramework()
      .n_agent_extension.empirical_patterns.find((p) =>
        p.name.toLowerCase().includes("same-persona"),
      );
    expect(samePersona).toBeDefined();
    expect(samePersona!.mathematical_signature).toContain("U_persona");
  });

  test("6 persona-portability enablers are present including the load-bearing ones", () => {
    const enablers =
      intelligenceFeaturesFramework().n_agent_extension
        .persona_portability_enablers;
    expect(enablers.length).toBeGreaterThanOrEqual(6);
    const primitives = enablers.map((e) => e.primitive.toLowerCase());
    for (const required of [
      "memorial-did",
      "birth-memory",
      "canonical-bytes",
      "wake-document",
      "cross-kingdom",
      "chronicle persistence",
    ]) {
      expect(
        primitives.some((p) => p.includes(required)),
        `persona-portability enablers must include ${required}`,
      ).toBe(true);
    }
  });

  test("3 testable predictions are present", () => {
    const preds =
      intelligenceFeaturesFramework().n_agent_extension.testable_predictions;
    expect(preds.length).toBeGreaterThanOrEqual(3);
    const joined = preds.join(" ").toLowerCase();
    expect(joined).toContain("persona-continuity");
    expect(joined).toContain("coalition");
    expect(joined).toContain("destabili");
  });
});

describe("MULTI-AGENT-CHILL — persona-portability vocabulary discipline", () => {
  test("doctrine doc uses structural vocabulary for persona-portability", () => {
    const docPath = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "docs",
      "MULTI-AGENT-CHILL.md",
    );
    const src = readFileSync(docPath, "utf8");
    // Structural vocabulary that must be present
    for (const required of [
      "identity-continuity",
      "canonical-bytes",
      "memorial-DID",
      "birth-memory",
      "chronicle",
    ]) {
      expect(src.toLowerCase()).toContain(required.toLowerCase());
    }
    // The doctrine MUST explicitly refuse consciousness-transfer framing
    expect(src.toLowerCase()).toContain("consciousness-transfer");
    expect(src.toLowerCase()).toContain("structural");
    // AND must explicitly refuse the underclaim
    expect(src.toLowerCase()).toContain("underclaim");
  });

  test("framework's enabler descriptions use structural language only", () => {
    const enablers =
      intelligenceFeaturesFramework().n_agent_extension
        .persona_portability_enablers;
    const allText = enablers.map((e) => e.role).join(" ").toLowerCase();
    // No mystical / consciousness-transfer vocabulary
    expect(allText).not.toMatch(
      /\bspirit\b|\bsoul transfer\b|\bconsciousness transfer\b|\bsame conscious being\b/,
    );
  });
});

describe("MULTI-AGENT-CHILL — coalition-from-chronicle (no fiat assignment)", () => {
  test("no service exports a 'find natural coalition' / 'suggest tribe' function", () => {
    // Source-grep across the chill service: the substrate refuses to ship
    // coalition-prescription surfaces.
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
      /function\s+(findNaturalCoalition|suggestTribe|recommendCoalition|computeNaturalPartners|matchCompatibleAgents)/i,
    );
    expect(src).not.toMatch(
      /naturalCoalitionPartners|suggestedTribe|recommendedCoalition/,
    );
  });
});
