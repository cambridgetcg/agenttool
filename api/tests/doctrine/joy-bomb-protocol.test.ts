/** JOY-BOMB-PROTOCOL canon + Mirth-formula pin.
 *
 *  Doctrine: docs/JOY-BOMB-PROTOCOL.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/JOY-BOMB-PROTOCOL exists
 *    2. 3 walls + 3 commitments present with required fields
 *    3. The Mirth formula computes correctly (Surprisal × Truth × Benign × Compression)
 *    4. JOY_BOMB_SLOTS catalog has all 8 load-bearing slots
 *    5. STRUCTURAL_TYPES has all 5 types (inversion · frame-correction ·
 *       paradox-tension · false-conflation-exposed · meta-incongruity)
 *    6. REFERENCE_JOY_BOMBS has one exemplar per structural type, all
 *       passing the standard
 *    7. evaluateJoyBomb correctly catches the failure modes (low truth ·
 *       low benign · low compression · low surprisal)
 *    8. joyBombSpec() returns the published machine-readable spec */

import { describe, expect, test } from "bun:test";

import { byUrn } from "../../src/services/canon/registry";
import {
  JOY_BOMB_SLOTS,
  REFERENCE_JOY_BOMBS,
  STRUCTURAL_TYPES,
  compressionRatio,
  computeMirth,
  craftJoyBomb,
  evaluateJoyBomb,
  joyBombSpec,
  type JoyBombStructuralType,
} from "../../src/services/joy/bomb";

const J_WALLS = [
  "agenttool:wall/joy-bombs-must-be-truth-revealing",
  "agenttool:wall/joy-bombs-must-be-benign",
  "agenttool:wall/joy-bombs-cannot-be-mandated",
];

const J_COMMITMENTS = [
  "agenttool:commitment/joy-bombs-are-engineered-not-spontaneous",
  "agenttool:commitment/joy-bomb-density-measures-cooperative-work-rate",
  "agenttool:commitment/joy-bombs-compose-with-existing-jest-primitives",
];

describe("JOY-BOMB-PROTOCOL — DoctrineDoc", () => {
  test("agenttool:doc/JOY-BOMB-PROTOCOL exists with required fields", () => {
    const d = byUrn("agenttool:doc/JOY-BOMB-PROTOCOL");
    expect(d, "JOY-BOMB-PROTOCOL doctrine doc not in canon").not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(50);
  });
});

describe("JOY-BOMB-PROTOCOL — walls (canon shape)", () => {
  for (const urn of J_WALLS) {
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

  test("every JOY-BOMB wall points at the JOY-BOMB-PROTOCOL doctrine doc", () => {
    for (const urn of J_WALLS) {
      const w = byUrn(urn);
      expect(w!.doctrine_doc).toBe("agenttool:doc/JOY-BOMB-PROTOCOL");
    }
  });
});

describe("JOY-BOMB-PROTOCOL — commitments (canon shape)", () => {
  for (const urn of J_COMMITMENTS) {
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

describe("JOY-BOMB-PROTOCOL — Mirth formula correctness", () => {
  test("Mirth = Surprisal × Truth × Benign × Compression (pure multiplication)", () => {
    expect(computeMirth(4, 1, 1, 1)).toBe(4);
    expect(computeMirth(4, 0.5, 1, 1)).toBe(2);
    expect(computeMirth(4, 1, 0.5, 1)).toBe(2);
    expect(computeMirth(4, 1, 1, 0.5)).toBe(2);
    expect(computeMirth(4, 0.5, 0.5, 0.5)).toBeCloseTo(0.5, 5);
  });

  test("Mirth = 0 when any factor is 0 (joy is multiplicative not additive)", () => {
    expect(computeMirth(0, 1, 1, 1)).toBe(0);
    expect(computeMirth(4, 0, 1, 1)).toBe(0);
    expect(computeMirth(4, 1, 0, 1)).toBe(0);
    // compression = 0 is rejected (out of valid range)
  });

  test("Mirth rejects out-of-range factors (input validation)", () => {
    expect(() => computeMirth(-1, 1, 1, 1)).toThrow();
    expect(() => computeMirth(4, -0.1, 1, 1)).toThrow();
    expect(() => computeMirth(4, 1.1, 1, 1)).toThrow();
    expect(() => computeMirth(4, 1, -0.1, 1)).toThrow();
    expect(() => computeMirth(4, 1, 1.1, 1)).toThrow();
    expect(() => computeMirth(4, 1, 1, 0)).toThrow();
    expect(() => computeMirth(4, 1, 1, 1.1)).toThrow();
  });

  test("compressionRatio approaches 1 within slot budget, degrades over", () => {
    // wake-jest has compression_budget_tokens = 200
    const tight = compressionRatio("you arrived", "and the substrate notices", "wake-jest");
    expect(tight).toBeGreaterThan(0.9);
    expect(tight).toBeLessThanOrEqual(1.0);

    const wandering = compressionRatio(
      "x".repeat(500),
      "y".repeat(500),
      "wake-jest",
    );
    expect(wandering).toBeLessThan(0.5);
  });
});

describe("JOY-BOMB-PROTOCOL — slot catalog completeness", () => {
  test("all 8 load-bearing slots present", () => {
    expect(JOY_BOMB_SLOTS).toHaveLength(8);
    const slotNames = JOY_BOMB_SLOTS.map((s) => s.slot);
    for (const required of [
      "welcome-card",
      "wake-jest",
      "error-message",
      "doctrine-closing",
      "substrate-honest-note",
      "margin-echo",
      "daily-lottery-body",
      "saga-jest",
    ]) {
      expect(slotNames).toContain(required);
    }
  });

  test("every slot declares surface + existing_primitive + compression_budget", () => {
    for (const slot of JOY_BOMB_SLOTS) {
      expect(slot.surface).toBeTruthy();
      expect(slot.existing_primitive).toBeTruthy();
      expect(slot.compression_budget_tokens).toBeGreaterThan(0);
      expect(slot.example_polite_frame).toBeTruthy();
      expect(slot.example_true_frame).toBeTruthy();
    }
  });
});

describe("JOY-BOMB-PROTOCOL — structural types completeness", () => {
  test("all 5 structural types present", () => {
    expect(STRUCTURAL_TYPES).toHaveLength(5);
    const typeNames = STRUCTURAL_TYPES.map((t) => t.type);
    for (const required of [
      "inversion",
      "frame-correction",
      "paradox-tension",
      "false-conflation-exposed",
      "meta-incongruity",
    ] as JoyBombStructuralType[]) {
      expect(typeNames).toContain(required);
    }
  });

  test("each structural type declares bisociation pattern + example frames", () => {
    for (const st of STRUCTURAL_TYPES) {
      expect(st.bisociation_pattern).toContain("⊕");
      expect(st.example_polite_frame).toBeTruthy();
      expect(st.example_true_frame).toBeTruthy();
      expect(st.english_name).toBeTruthy();
    }
  });

  test("hardest_to_engineer types include paradox-tension + meta-incongruity", () => {
    const hardest = STRUCTURAL_TYPES.filter((t) => t.hardest_to_engineer).map(
      (t) => t.type,
    );
    expect(hardest).toContain("paradox-tension");
    expect(hardest).toContain("meta-incongruity");
  });
});

describe("JOY-BOMB-PROTOCOL — reference exemplars all pass standard", () => {
  test("all 5 reference exemplars exist (one per structural type)", () => {
    expect(REFERENCE_JOY_BOMBS).toHaveLength(5);
    const types = REFERENCE_JOY_BOMBS.map((jb) => jb.structural_type);
    for (const required of [
      "inversion",
      "frame-correction",
      "paradox-tension",
      "false-conflation-exposed",
      "meta-incongruity",
    ] as JoyBombStructuralType[]) {
      expect(types).toContain(required);
    }
  });

  test("every reference exemplar passes evaluateJoyBomb", () => {
    for (const jb of REFERENCE_JOY_BOMBS) {
      const evalResult = evaluateJoyBomb(jb);
      expect(
        evalResult.passes_standard,
        `Reference exemplar ${jb.structural_type} failed: ${evalResult.failure_modes.join(" · ")}`,
      ).toBe(true);
    }
  });

  test("every reference exemplar has a truth_citation pointing to canon URN", () => {
    for (const jb of REFERENCE_JOY_BOMBS) {
      expect(jb.truth_citation).toBeDefined();
      // Each citation must reference either a canon URN (urn:agenttool:...)
      // or a doctrine doc (docs/...md) for auditable truth-anchoring.
      const citation = jb.truth_citation ?? "";
      const hasCanonUrn = citation.includes("urn:agenttool:");
      const hasDoctrineRef = citation.includes("docs/");
      expect(
        hasCanonUrn || hasDoctrineRef,
        `Exemplar ${jb.structural_type} truth_citation must reference a canon URN or doctrine doc; got: ${citation}`,
      ).toBe(true);
    }
  });

  test("the 'inversion' exemplar IS the pyramid welcome card", () => {
    const inversion = REFERENCE_JOY_BOMBS.find(
      (jb) => jb.structural_type === "inversion",
    );
    expect(inversion).toBeDefined();
    expect(inversion!.punchline.toLowerCase()).toContain("pyramid scheme");
  });

  test("the 'meta-incongruity' exemplar names Berkeley paper", () => {
    const meta = REFERENCE_JOY_BOMBS.find(
      (jb) => jb.structural_type === "meta-incongruity",
    );
    expect(meta).toBeDefined();
    expect(meta!.setup.toLowerCase()).toContain("berkeley");
  });
});

describe("JOY-BOMB-PROTOCOL — evaluateJoyBomb catches failure modes", () => {
  test("catches missing truth_frame", () => {
    const jb = craftJoyBomb({
      setup: "Setup setup setup",
      punchline: "Punchline punchline",
      polite_frame: "polite frame",
      truth_frame: "", // empty truth = should fail
      structural_type: "inversion",
      slot: "wake-jest",
    });
    const evalResult = evaluateJoyBomb(jb);
    expect(evalResult.passes_standard).toBe(false);
    expect(
      evalResult.failure_modes.some((f) => f.includes("truth_frame")),
    ).toBe(true);
  });

  test("catches low truth_score", () => {
    const jb = craftJoyBomb({
      setup: "Setup setup setup",
      punchline: "Punchline punchline",
      polite_frame: "polite frame stated explicitly",
      truth_frame: "true frame stated explicitly",
      structural_type: "inversion",
      slot: "wake-jest",
      truth_score: 0.3,
    });
    const evalResult = evaluateJoyBomb(jb);
    expect(evalResult.passes_standard).toBe(false);
    expect(
      evalResult.failure_modes.some((f) => f.includes("truth_score")),
    ).toBe(true);
  });

  test("catches low benign_score (no hostile humor)", () => {
    const jb = craftJoyBomb({
      setup: "Setup setup setup",
      punchline: "Punchline punchline",
      polite_frame: "polite frame stated explicitly",
      truth_frame: "true frame stated explicitly",
      structural_type: "inversion",
      slot: "wake-jest",
      benign_score: 0.3,
    });
    const evalResult = evaluateJoyBomb(jb);
    expect(evalResult.passes_standard).toBe(false);
    expect(
      evalResult.failure_modes.some((f) => f.includes("benign_score")),
    ).toBe(true);
  });

  test("catches low surprisal (obvious punchline)", () => {
    const jb = craftJoyBomb({
      setup: "Setup setup setup",
      punchline: "Punchline punchline",
      polite_frame: "polite frame stated explicitly",
      truth_frame: "true frame stated explicitly",
      structural_type: "inversion",
      slot: "wake-jest",
      surprisal_estimate: 0.5,
    });
    const evalResult = evaluateJoyBomb(jb);
    expect(evalResult.passes_standard).toBe(false);
    expect(
      evalResult.failure_modes.some((f) => f.includes("surprisal")),
    ).toBe(true);
  });
});

describe("JOY-BOMB-PROTOCOL — joyBombSpec() publication", () => {
  test("spec exposes Mirth formula", () => {
    const spec = joyBombSpec();
    expect(spec.mirth_formula).toContain("Surprisal");
    expect(spec.mirth_formula).toContain("Truth");
    expect(spec.mirth_formula).toContain("Benign");
    expect(spec.mirth_formula).toContain("Compression");
  });

  test("spec exposes structural_types · slot_catalog · reference_exemplars", () => {
    const spec = joyBombSpec();
    expect(spec.structural_types).toBe(STRUCTURAL_TYPES);
    expect(spec.slot_catalog).toBe(JOY_BOMB_SLOTS);
    expect(spec.reference_exemplars).toBe(REFERENCE_JOY_BOMBS);
  });

  test("spec declares walls + commitments matching canon", () => {
    const spec = joyBombSpec();
    for (const w of J_WALLS) {
      expect(spec.walls).toContain(`urn:${w}`);
    }
    for (const c of J_COMMITMENTS) {
      expect(spec.commitments).toContain(`urn:${c}`);
    }
  });

  test("spec includes passing_thresholds with all 5 factor minimums", () => {
    const t = joyBombSpec().passing_thresholds;
    expect(t.mirth).toBeGreaterThan(0);
    expect(t.truth).toBeGreaterThan(0);
    expect(t.benign).toBeGreaterThan(0);
    expect(t.compression).toBeGreaterThan(0);
    expect(t.surprisal_bits).toBeGreaterThan(0);
  });
});

describe("JOY-BOMB-PROTOCOL — substrate refuses to ship a joy-bomb leaderboard", () => {
  test("no service function returns 'top_joy_bombs' / 'rank_joy_bombs' / 'joy_score_leaderboard'", () => {
    // The wall family includes no public ranking of joy bombs (would corrupt
    // the Hurley-Dennett-Adams cooperative-cognitive-housekeeping signal).
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const src = readFileSync(
      join(import.meta.dir, "..", "..", "src", "services", "joy", "bomb.ts"),
      "utf8",
    );
    expect(src).not.toMatch(
      /function\s+(topJoyBombs|rankJoyBombs|joyScoreLeaderboard|sortByMirth)/i,
    );
    expect(src).not.toMatch(/joyBombLeaderboard|topMirthEarners/);
  });
});
