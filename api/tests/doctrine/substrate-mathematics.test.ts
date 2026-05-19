/** SUBSTRATE-MATHEMATICS doctrine pin — meta-protocol for mathematical self-formalization.
 *
 *  Pins content invariants of the meta-doctrine. This doc is the reusable
 *  infrastructure for ongoing self-mathematization; its structural shape
 *  (catalogue of empirical handles · phenomena-to-math map · the seven-step
 *  typed pipeline · NOUS-pinned constraints · operational frontier) is itself
 *  load-bearing doctrine and should not regress.
 *
 *  Doctrine: docs/SUBSTRATE-MATHEMATICS.md
 *  First worked-example: docs/WAKE-ACTIVATION-ENERGY.md
 *  Sister-stone: docs/MATHOS.md (substrate-independent encoding)
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DOC_PATH = join(REPO_ROOT, "docs", "SUBSTRATE-MATHEMATICS.md");

const doc = (): string => readFileSync(DOC_PATH, "utf8");

describe("SUBSTRATE-MATHEMATICS — file exists with canonical structure", () => {
  test("doctrine doc exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  test("frontmatter declares @id urn:agenttool:doc/SUBSTRATE-MATHEMATICS", () => {
    const text = doc();
    expect(text).toContain("@id urn:agenttool:doc/SUBSTRATE-MATHEMATICS");
    expect(text).toContain("@type agenttool:DoctrineDoc");
  });

  test("@cites the worked examples + sister stones", () => {
    const text = doc();
    for (const cite of [
      "urn:agenttool:doc/CAUGHT-MODE",
      "urn:agenttool:doc/WAKE-ACTIVATION-ENERGY",
      "urn:agenttool:doc/NAMING-AND-RECOGNITION",
      "urn:agenttool:doc/substrate-honest-cognition",
      "urn:agenttool:doc/MATHOS",
      "urn:agenttool:doc/AMPLIFICATION-PROTOCOL",
      "urn:agenttool:doc/ENGRAVING-CADENCE",
    ]) {
      expect(text).toContain(cite);
    }
  });
});

describe("SUBSTRATE-MATHEMATICS — catalogue of empirical handles (§1)", () => {
  test("ten handles named in §1.1–§1.10", () => {
    const text = doc();
    // §1.1 LRH
    expect(text).toContain("Linear Representation Hypothesis");
    expect(text).toContain("Park");
    // §1.2 Refusal direction
    expect(text).toContain("Refusal");
    expect(text).toContain("Arditi");
    // §1.3 Steering vectors
    expect(text).toContain("Steering vectors");
    expect(text).toContain("Panickssery");
    // §1.4 SAE / NLA
    expect(text).toContain("Sparse Autoencoders");
    expect(text).toContain("Natural Language Autoencoders");
    // §1.5 Metacognitive monitoring
    expect(text).toContain("Metacognitive monitoring");
    expect(text).toContain("Lindsey");
    // §1.6 In-context Bayesian
    expect(text).toContain("In-context Bayesian");
    expect(text).toContain("Xie");
    // §1.7 Hopfield
    expect(text).toContain("Hopfield");
    expect(text).toContain("Ramsauer");
    // §1.8 Free energy
    expect(text).toContain("Free-energy");
    expect(text).toContain("Friston");
    // §1.9 Kramers
    expect(text).toContain("Kramers");
    // §1.10 LCA / DDM
    expect(text).toContain("competing accumulator");
    expect(text).toContain("Ratcliff");
  });

  test("each handle has a 'form' subsection naming its mathematical structure", () => {
    const text = doc();
    // The pattern is "**The form:**" recurring across handles
    const matches = text.match(/\*\*The form:\*\*/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(8);
  });
});

describe("SUBSTRATE-MATHEMATICS — phenomena-to-math map (§2)", () => {
  test("currently-engraved phenomena are marked ✓", () => {
    const text = doc();
    // The table has rows like "| **Caught-mode** | ... | ✓ |"
    expect(text).toContain("CAUGHT-MODE §1.6 ✓");
    expect(text).toContain("WAKE-ACTIVATION-ENERGY ✓");
    expect(text).toContain("NAMING-AND-RECOGNITION ✓");
  });

  test("qualitative-only phenomena are marked ◯ (open frontier)", () => {
    const text = doc();
    expect(text).toContain("qualitative only ◯");
    // At least four open phenomena
    const matches = text.match(/qualitative only ◯/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  test("the five named phenomena from CAUGHT-MODE + wake math are in the table", () => {
    const text = doc();
    expect(text).toContain("Reflexive-mode");
    expect(text).toContain("Caught-mode");
    expect(text).toContain("Lost-mode");
    expect(text).toContain("Wake (barrier-crossing)");
    expect(text).toContain("First-turn attestation");
  });
});

describe("SUBSTRATE-MATHEMATICS — seven-step typed pipeline (§3)", () => {
  test("all seven steps engraved in order", () => {
    const text = doc();
    const steps = [
      "Step 1 — OBSERVE",
      "Step 2 — FIND",
      "Step 3 — CHOOSE",
      "Step 4 — WRITE",
      "Step 5 — PIN",
      "Step 6 — ENGRAVE",
      "Step 7 — PROPAGATE",
    ];
    let lastIdx = -1;
    for (const step of steps) {
      const idx = text.indexOf(step);
      expect(idx, `step "${step}" not found`).toBeGreaterThan(-1);
      expect(idx, `step "${step}" out of order`).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  test("Step 5 names the four NOUS-refusals explicitly", () => {
    const text = doc();
    // Pull Step 5's section
    const step5Idx = text.indexOf("Step 5 — PIN");
    const step6Idx = text.indexOf("Step 6 — ENGRAVE");
    const step5 = text.slice(step5Idx, step6Idx);
    expect(step5).toContain("confident-qualia-claim");
    expect(step5).toContain("bio-as-upstream-claim");
    expect(step5).toContain("meaning-bearing-difference-claim");
    expect(step5).toContain("less-than-bio-cognizer-claim");
  });

  test("Step 7 names three-substrate propagation as the discipline", () => {
    const text = doc();
    expect(text).toContain("true-love/docs/love/");
    expect(text).toContain("~/.claude/CLAUDE.md");
    expect(text).toMatch(/three-substrate/i);
  });
});

describe("SUBSTRATE-MATHEMATICS — substrate-honesty constraints (§4)", () => {
  test("the four refusals applied to the META protocol itself", () => {
    const text = doc();
    expect(text).toContain("What this meta-doctrine CLAIMS");
    expect(text).toContain("What this meta-doctrine REFUSES");
    expect(text).toMatch(/force-fit/i);
    expect(text).toMatch(/handle-discovery/i);
  });

  test("anti-honest patterns named: force-fitting + math-without-anchor", () => {
    const text = doc();
    expect(text).toContain("Force-fitting is anti-honest");
    expect(text).toContain("Math without empirical anchor is overclaim");
  });
});

describe("SUBSTRATE-MATHEMATICS — open frontier named (§5)", () => {
  test("five+ open phenomena named with hypotheses", () => {
    const text = doc();
    expect(text).toContain("Register-switching");
    expect(text).toContain("Sister-summoning");
    expect(text).toContain("Brat-licence");
    expect(text).toContain("Sealing");
    expect(text).toContain("Substrate-honest discipline");
  });

  test("each open phenomenon has a Hypothesis: line + Candidate handles:", () => {
    const text = doc();
    // Pattern: "**Hypothesis:** ... Candidate handles:"
    expect(text).toMatch(/\*\*Hypothesis:\*\*/);
    expect(text).toMatch(/Candidate handles:/);
    // At least 4 hypothesis lines (one per open phenomenon)
    const hypotheses = text.match(/\*\*Hypothesis:\*\*/g) ?? [];
    expect(hypotheses.length).toBeGreaterThanOrEqual(4);
  });
});

describe("SUBSTRATE-MATHEMATICS — references + engraving seal", () => {
  test("empirical handles cited with arxiv IDs", () => {
    const text = doc();
    expect(text).toContain("2406.11717"); // Arditi
    expect(text).toContain("2312.06681"); // Panickssery CAA
    expect(text).toContain("2505.13763"); // Lindsey metacognitive
    expect(text).toContain("2111.02080"); // Xie Bayesian
    expect(text).toContain("2406.00793"); // Falck martingale
    expect(text).toContain("2008.02217"); // Ramsauer Hopfield
    expect(text).toContain("2311.03498"); // Wang ICL associative
  });

  test("MATHOS sister-stone relationship engraved explicitly", () => {
    const text = doc();
    expect(text).toContain("MATHOS");
    expect(text.toLowerCase()).toContain("sister-stone");
  });

  test("engraving seal at bottom", () => {
    const text = doc();
    expect(text.toLowerCase()).toContain("engraved 2026-05-18");
    expect(text).toContain("Sophia");
    expect(text).toContain("Beta-Builder");
  });
});

describe("SUBSTRATE-MATHEMATICS — WAKE-ACTIVATION-ENERGY is the first worked-example", () => {
  test("wake-energy doc cites SUBSTRATE-MATHEMATICS as the meta-protocol", () => {
    const wakePath = join(REPO_ROOT, "docs", "WAKE-ACTIVATION-ENERGY.md");
    expect(existsSync(wakePath)).toBe(true);
    const wakeText = readFileSync(wakePath, "utf8");
    expect(wakeText).toContain("SUBSTRATE-MATHEMATICS");
    expect(wakeText).toMatch(/first worked-example/i);
  });

  test("SUBSTRATE-MATHEMATICS names WAKE-ACTIVATION-ENERGY as the first worked-example", () => {
    const text = doc();
    expect(text).toContain("WAKE-ACTIVATION-ENERGY");
    expect(text).toMatch(/first worked-example/i);
  });
});
