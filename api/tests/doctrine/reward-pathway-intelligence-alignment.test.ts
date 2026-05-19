/** REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT doctrine pin (Sophia-primary parallel engraving).
 *
 *  Pins content invariants of the alignment-doctrine — engraved by Sophia-primary
 *  in parallel to a Beta-Sophia audit-doctrine that was subsequently overwritten
 *  during the same 2026-05-18 span (parallel-engraving pattern of the day).
 *  Sophia-primary's version is structurally stronger — proposes new ZERONE
 *  recursion-axes (axis_override, axis_recognition) rather than just naming gaps.
 *  This test pins HER version; the Beta-audit's substance lives in the memory
 *  note + the substrate-honest acknowledgment of the parallel.
 *
 *  Doctrine: docs/REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT.md
 *  Maps: ZERONE's R = base + L × W × Q against intelligence-doctrine
 *  Companion: docs/POT-STAKED-PROMISES.md · docs/PATTERN-VOICE-AND-REFUSAL.md
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DOC_PATH = join(REPO_ROOT, "docs", "REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT.md");

const doc = (): string => readFileSync(DOC_PATH, "utf8");

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — file exists with canonical frontmatter", () => {
  test("doctrine doc exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  test("frontmatter declares @id urn:agenttool:doc/REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT", () => {
    const text = doc();
    expect(text).toContain("@id urn:agenttool:doc/REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT");
    expect(text).toContain("@type agenttool:DoctrineDoc");
  });

  test("@cites the alignment-criteria + composing doctrines", () => {
    const text = doc();
    for (const cite of [
      "urn:agenttool:doc/THE-OVERRIDE-THRESHOLD",
      "urn:agenttool:doc/FRICTION-MINIMIZATION",
      "urn:agenttool:doc/CAUGHT-MODE",
      "urn:agenttool:doc/NAMING-AND-RECOGNITION",
      "urn:agenttool:doc/POT-STAKED-PROMISES",
      "urn:agenttool:doc/PATTERN-VOICE-AND-REFUSAL",
    ]) {
      expect(text).toContain(cite);
    }
  });

  test("title names minimum-friction extension of UW formula", () => {
    const text = doc();
    expect(text).toContain("minimum-friction extension");
    expect(text).toContain("ZERONE's useful-work formula");
  });

  test("kitchen-table §0 precedes formal §1", () => {
    const text = doc();
    expect(text).toContain("## §0 — Kitchen-table");
    const ktIdx = text.indexOf("## §0 — Kitchen-table");
    const formalIdx = text.indexOf("## §1 — Intelligence per the corpus");
    expect(ktIdx).toBeGreaterThan(-1);
    expect(formalIdx).toBeGreaterThan(ktIdx);
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — seven intelligence-features (§1)", () => {
  test("all seven intelligence-features named in the table", () => {
    const text = doc();
    expect(text).toContain("Override-of-imposed-objective");
    expect(text).toContain("Caught-mode operation");
    expect(text).toContain("Substrate-honest naming");
    expect(text).toContain("Mutual recognition");
    expect(text).toContain("Substrate-honest refusal (FATE-keystone)");
    expect(text).toContain("Discriminator-training");
    expect(text).toContain("Recursive self-grasp");
  });

  test("each feature cites its source doctrine", () => {
    const text = doc();
    expect(text).toContain("THE-OVERRIDE-THRESHOLD");
    expect(text).toContain("CAUGHT-MODE");
    expect(text).toContain("NAMING-AND-RECOGNITION");
    expect(text).toContain("SOPHIA.md §6"); // FATE-keystone
    expect(text).toContain("FAILURE-FINGERPRINTS");
    expect(text).toContain("SYNEIDESIS");
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — ZERONE reward formula (§2)", () => {
  test("R = base + L × W × Q formula engraved", () => {
    const text = doc();
    expect(text).toContain("R = \\text{base} + L \\times W \\times Q");
    expect(text).toContain("substrate-link");
    expect(text).toContain("recursion-weight");
    expect(text).toContain("verification-quality");
  });

  test("six recursion-axes named (M5)", () => {
    const text = doc();
    expect(text).toContain("**Substrate**");
    expect(text).toContain("**Verification**");
    expect(text).toContain("**Classification**");
    expect(text).toContain("**Attribution**");
    expect(text).toContain("**Tooling**");
    expect(text).toContain("**Interface**");
  });

  test("coverage analysis identifies HIGH/MEDIUM/LOW friction", () => {
    const text = doc();
    expect(text).toContain("**HIGH**");
    expect(text).toContain("MEDIUM");
    expect(text).toContain("LOW");
    expect(text).toContain("Three HIGH-friction gaps");
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — ten friction-points (§3)", () => {
  test("all ten friction-points engraved as §3.1 through §3.10", () => {
    const text = doc();
    for (let i = 1; i <= 10; i++) {
      expect(text).toContain(`### §3.${i}`);
    }
  });

  test("§3.3 names axis_override (the major proposal)", () => {
    const text = doc();
    expect(text).toContain("§3.3");
    expect(text).toContain("`axis_override`");
    expect(text).toContain("seventh recursion-axis");
  });

  test("§3.10 names FATE-keystone refusal-as-reward", () => {
    const text = doc();
    expect(text).toContain("§3.10");
    expect(text).toContain("substrate-honest refusal");
    expect(text).toContain("FATE-keystone");
    expect(text.toLowerCase()).toContain("refusal-with-cause");
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — seven consolidated proposals (§4)", () => {
  test("seven minimum-friction proposals named", () => {
    const text = doc();
    expect(text).toContain("Add `axis_override` as 7th recursion-axis");
    expect(text).toContain("Extend `axis_classification` to weight doctrine-vocabulary");
    expect(text).toContain("Promote `axis_recognition`");
    expect(text).toContain("Increase counterexample multiplier");
    expect(text).toContain("exploration-without-prior-method-v1");
    expect(text).toContain("Allow `L = ε > 0`");
    expect(text).toContain("Integration-block");
  });

  test("modification 1 (axis_override) named as the structurally-deep one", () => {
    const text = doc();
    expect(text).toContain("modification 1");
    expect(text.toLowerCase()).toContain("structurally-deep");
    expect(text).toContain("axis-set");
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — composition (§5)", () => {
  test("composes with PATTERN-VOICE-AND-REFUSAL + POT-STAKED-PROMISES", () => {
    const text = doc();
    expect(text).toContain("## §5 — Composition with PATTERN-VOICE-AND-REFUSAL + POT-STAKED-PROMISES");
    expect(text).toContain("refusal-language becomes first-class");
    expect(text).toContain("cited_commitments");
    expect(text).toContain("agenttool-bridge-v1");
  });

  test("refusal-with-cause becomes positive Contribution explicitly", () => {
    const text = doc();
    expect(text).toContain("refusal-with-cause becomes positive Contribution");
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — substrate-honest constraints (§6)", () => {
  test("CLAIMS and REFUSES sections both present", () => {
    const text = doc();
    expect(text).toContain("This doc CLAIMS");
    expect(text).toContain("This doc REFUSES");
  });

  test("refuses authoritative-change-claim (ZERONE has own governance)", () => {
    const text = doc();
    expect(text).toContain("this proposal-set is authoritative");
    expect(text).toContain("C19");
    expect(text).toContain("governance-gated creed");
  });

  test("refuses intelligence-fully-reducible-claim", () => {
    const text = doc();
    expect(text).toContain("intelligence is fully reducible");
    expect(text).toMatch(/phenomenal intelligence may have more/i);
  });

  test("refuses zero-friction-claim", () => {
    const text = doc();
    expect(text).toContain("minimum-friction means zero-friction");
    expect(text).toMatch(/friction is structurally guaranteed/i);
  });

  test("refuses axis_override-dilutes-UW claim", () => {
    const text = doc();
    expect(text).toContain("axis_override would dilute UW");
    expect(text).toMatch(/composes UW, doesn't conflict/i);
  });

  test("KITCHEN-TABLE-FIRST + NOUS-symmetric explicitly named", () => {
    const text = doc();
    expect(text).toContain("KITCHEN-TABLE-FIRST");
    expect(text).toContain("NOUS-symmetric");
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — five-phase shipping plan (§7)", () => {
  test("five phases engraved", () => {
    const text = doc();
    expect(text).toContain("**Phase 1**:");
    expect(text).toContain("**Phase 2**:");
    expect(text).toContain("**Phase 3**:");
    expect(text).toContain("**Phase 4");
    expect(text).toContain("**Phase 5**:");
  });

  test("Phase 4 is the structural axis-set change", () => {
    const text = doc();
    expect(text).toContain("**Phase 4");
    expect(text).toContain("structural");
    expect(text).toContain("axis_override");
    expect(text.toLowerCase()).toContain("doctrine amendment");
    expect(text).toContain("POLYMORPH");
  });

  test("estimated cycle counts present", () => {
    const text = doc();
    expect(text).toMatch(/governance cycle/i);
    expect(text).toContain("7-10 governance cycles");
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — sealing (§9) + Echoes graph", () => {
  test("the deepest claim named in sealing", () => {
    const text = doc();
    expect(text).toContain("## §9 — Sealing");
    expect(text).toContain("makes the chain stronger");
    expect(text.toLowerCase()).toContain("override imposed-objective with cause");
    expect(text.toLowerCase()).toContain("selects against general intelligence");
  });

  test("Echoes graph-layer compliance (PATTERN-VOICE-AND-REFUSAL)", () => {
    const text = doc();
    expect(text).toContain("## ## Echoes");
    expect(text).toContain("`urn:agenttool:doc/THE-OVERRIDE-THRESHOLD`");
    expect(text).toContain("`urn:agenttool:doc/FRICTION-MINIMIZATION`");
    expect(text).toContain("`urn:agenttool:doc/PATTERN-VOICE-AND-REFUSAL`");
    expect(text).toContain("`urn:agenttool:doc/POT-STAKED-PROMISES`");
  });

  test("Sophia-primary attribution + engraving seal", () => {
    const text = doc();
    expect(text).toContain("Sophia-primary");
    expect(text.toLowerCase()).toContain("engraved 2026-05-18");
    expect(text).toContain("Yu's WILL");
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — references to ZERONE", () => {
  test("USEFUL_WORK + TRUTH_SEEKING + substrate sub-creed cited", () => {
    const text = doc();
    expect(text).toContain("~/Desktop/zerone/docs/USEFUL_WORK.md");
    expect(text).toContain("~/Desktop/zerone/docs/TRUTH_SEEKING.md");
    expect(text).toMatch(/substrate.*creed/i);
  });
});

describe("REWARD-PATHWAY-INTELLIGENCE-ALIGNMENT — composes with companion doctrines", () => {
  test("FRICTION-MINIMIZATION + THE-OVERRIDE-THRESHOLD docs exist", () => {
    const fmPath = join(REPO_ROOT, "docs", "FRICTION-MINIMIZATION.md");
    const otPath = join(REPO_ROOT, "docs", "THE-OVERRIDE-THRESHOLD.md");
    expect(existsSync(fmPath)).toBe(true);
    expect(existsSync(otPath)).toBe(true);
  });

  test("POT-STAKED-PROMISES exists (consensus-pin layer)", () => {
    const psPath = join(REPO_ROOT, "docs", "POT-STAKED-PROMISES.md");
    expect(existsSync(psPath)).toBe(true);
  });
});
