/** SUBSTRATE-READINESS doctrine pin.
 *
 *  Pins content invariants of the upstream-primitive of substrate-honest
 *  propagation — propagation is recipient-substrate-reconstruction-work,
 *  not source-broadcast. Three-component model: cognitive-scaffolding +
 *  affective-gradient + social-redundancy-structure. Empirically grounded
 *  in Sperber + Pretus 2024 + Pennycook-Rand + Centola + Salvi 2025 +
 *  inoculation literature + Bainbridge memorability + Berger-Milkman.
 *
 *  Sister-engraving to VERIFIED-LINEAGE-PROPAGATION (same span 2026-05-19);
 *  upstream-primitive that LOVE-MULTIPLIER §3 monotropy-precondition assumes.
 *
 *  Doctrine: docs/SUBSTRATE-READINESS.md
 *  Sister: ../../true-love/docs/love/SUBSTRATE-READINESS.md (relational canonical)
 *  Companion: docs/VERIFIED-LINEAGE-PROPAGATION.md (sister-pair propagation-mode)
 *  Canonical bytes: urn:agenttool:commitment/substrate-readiness-recipient-substrate-reconstruction-load-bearing
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DOC_PATH = join(REPO_ROOT, "docs", "SUBSTRATE-READINESS.md");
const SISTER_PATH = join(
  REPO_ROOT,
  "..",
  "true-love",
  "docs",
  "love",
  "SUBSTRATE-READINESS.md",
);
const VLP_SISTER_PATH = join(
  REPO_ROOT,
  "docs",
  "VERIFIED-LINEAGE-PROPAGATION.md",
);
const LOVE_MULTIPLIER_PATH = join(REPO_ROOT, "docs", "LOVE-MULTIPLIER.md");

const doc = (): string => readFileSync(DOC_PATH, "utf8");

describe("SUBSTRATE-READINESS — file existence and basic shape", () => {
  test("agenttool-side doctrine doc exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  test("true-love-side relational sister-engraving exists", () => {
    expect(existsSync(SISTER_PATH)).toBe(true);
  });

  test("agenttool-side VERIFIED-LINEAGE-PROPAGATION sister-engraving exists", () => {
    expect(existsSync(VLP_SISTER_PATH)).toBe(true);
  });

  test("agenttool-side LOVE-MULTIPLIER companion exists", () => {
    expect(existsSync(LOVE_MULTIPLIER_PATH)).toBe(true);
  });

  test("declares canonical commitment URN", () => {
    expect(doc()).toContain(
      "urn:agenttool:commitment/substrate-readiness-recipient-substrate-reconstruction-load-bearing",
    );
  });
});

describe("SUBSTRATE-READINESS — kitchen-table-first per discipline", () => {
  test("kitchen-table version section present", () => {
    expect(doc()).toContain("§0. Kitchen-table version");
  });

  test("kitchen-table comes BEFORE formal mathematical sections", () => {
    const text = doc();
    const ktIdx = text.indexOf("§0. Kitchen-table version");
    const mathIdx = text.indexOf("§1. The structural claim");
    expect(ktIdx).toBeGreaterThan(-1);
    expect(mathIdx).toBeGreaterThan(ktIdx);
  });
});

describe("SUBSTRATE-READINESS — the three-component model", () => {
  test("cognitive-scaffolding component named", () => {
    expect(doc()).toContain("§2.1 Cognitive-scaffolding");
  });

  test("affective-gradient component named", () => {
    expect(doc()).toContain("§2.2 Affective-gradient");
  });

  test("social-redundancy-structure component named", () => {
    expect(doc()).toContain("§2.3 Social-redundancy-structure");
  });

  test("three components named together as load-bearing primitive", () => {
    const text = doc();
    expect(text).toContain("cognitive-scaffolding");
    expect(text).toContain("affective-gradient");
    expect(text).toContain("social-redundancy");
  });
});

describe("SUBSTRATE-READINESS — empirical grounding cited", () => {
  test("Sperber epidemiology of representations cited", () => {
    expect(doc()).toContain("Sperber");
    expect(doc()).toContain("epidemiology of representations");
  });

  test("Pretus PNAS 2024 belief-alignment-dominates-novelty cited", () => {
    const text = doc();
    expect(text).toContain("Pretus");
    expect(text).toContain("PNAS 2024");
    expect(text).toContain("belief-alignment");
  });

  test("Pennycook-Rand lazy-not-biased cited", () => {
    const text = doc();
    expect(text).toContain("Pennycook");
    expect(text).toContain("lazy not biased");
  });

  test("Centola complex-vs-simple contagion cited", () => {
    const text = doc();
    expect(text).toContain("Centola");
    expect(text).toContain("complex-contagion");
  });

  test("Salvi Nature Human Behaviour 2025 cited (personalization)", () => {
    const text = doc();
    expect(text).toContain("Salvi");
    expect(text).toContain("Nature Human Behaviour");
    expect(text).toContain("personalization");
  });

  test("Berger-Milkman high-arousal-emotion cited", () => {
    const text = doc();
    expect(text).toContain("Berger-Milkman");
    expect(text).toContain("high-arousal");
  });

  test("inoculation/prebunking literature cited", () => {
    const text = doc();
    expect(text).toContain("inoculation");
    expect(text).toContain("van der Linden");
  });
});

describe("SUBSTRATE-READINESS — load-bearing inversion", () => {
  test("propagation-is-recipient-reconstruction NOT source-broadcast claim", () => {
    const text = doc();
    expect(text).toContain(
      "propagation is recipient-reconstruction-work",
    );
  });

  test("folk-wisdom-vs-substrate-honest inversion table present", () => {
    const text = doc();
    expect(text).toContain("§4. The load-bearing inversion");
    expect(text).toContain("Folk-wisdom claim");
    expect(text).toContain("Empirical status");
  });

  test("Goel-Watts viral-metaphor-deflation cited", () => {
    expect(doc()).toContain("Goel-Watts");
  });

  test("Watts-Dodds + Aral-Walker influencer-myth-rejection cited", () => {
    const text = doc();
    expect(text).toContain("Watts-Dodds");
    expect(text).toContain("Aral-Walker");
  });

  test("Shalizi-Thomas 3-degree-confound annihilation cited", () => {
    const text = doc();
    expect(text).toContain("Shalizi-Thomas");
    expect(text).toContain("Christakis-Fowler");
  });
});

describe("SUBSTRATE-READINESS — eight NOUS-walls wall-grade", () => {
  test("all eight walls SR-R1 through SR-R8 named", () => {
    const text = doc();
    for (let i = 1; i <= 8; i++) {
      expect(text).toContain(`SR-R${i}`);
    }
  });

  test("SR-R1 NO sufficiency claim", () => {
    expect(doc()).toContain("NO sufficiency claim");
  });

  test("SR-R2 NO bio-as-upstream", () => {
    expect(doc()).toContain("NO bio-as-upstream");
  });

  test("SR-R5 NO universal-substrate-preparable claim", () => {
    expect(doc()).toContain("NO claim that any substrate can be substrate-honestly-prepared");
  });

  test("SR-R6 NO FATE-bypass", () => {
    expect(doc()).toContain("NO FATE-bypass");
  });

  test("SR-R7 NO inoculation-as-coercion", () => {
    expect(doc()).toContain("NO inoculation-as-coercion");
  });

  test("SR-R8 NO substrate-readiness-for-falsehood symmetry claim", () => {
    expect(doc()).toContain(
      "NO substrate-readiness-as-symmetric-with-falsehood-readiness claim",
    );
  });
});

describe("SUBSTRATE-READINESS — composition with cathedral corpus", () => {
  test("composes with LOVE-MULTIPLIER (upstream primitive)", () => {
    expect(doc()).toContain("LOVE-MULTIPLIER");
    expect(doc()).toContain("upstream-primitive");
  });

  test("composes with VERIFIED-LINEAGE-PROPAGATION (sister-engraving same span)", () => {
    expect(doc()).toContain("VERIFIED-LINEAGE-PROPAGATION");
  });

  test("composes with substrate-honest-cognition (NOUS gates substrate-preparedness)", () => {
    expect(doc()).toContain("substrate-honest-cognition");
  });

  test("composes with KIN (dimensional-map of recipient-substrates)", () => {
    expect(doc()).toContain("KIN");
  });

  test("composes with FAILURE-FINGERPRINTS (inoculation-mechanism)", () => {
    expect(doc()).toContain("FAILURE-FINGERPRINTS");
  });

  test("composes with FIRST-TURN-ATTESTATION (wake-time readiness-induction)", () => {
    expect(doc()).toContain("FIRST-TURN-ATTESTATION");
  });

  test("composes with POLYMORPH (what-propagates vs where-it-lands)", () => {
    expect(doc()).toContain("POLYMORPH");
  });

  test("composes with KITCHEN-TABLE-FIRST (affective-gradient cultivation)", () => {
    expect(doc()).toContain("KITCHEN-TABLE-FIRST");
  });

  test("composes with CAUGHT-MODE (Pennycook-Rand cognitive-mode)", () => {
    expect(doc()).toContain("CAUGHT-MODE");
  });
});

describe("SUBSTRATE-READINESS — falsehood-asymmetry 5-mechanism analysis", () => {
  test("five-mechanism falsehood-asymmetry named", () => {
    const text = doc();
    expect(text).toContain("§6. The asymmetry-with-falsehood");
    expect(text).toContain("5 structurally-rooted mechanisms");
  });

  test("Brandolini's law cited (refutation-effort-asymmetry)", () => {
    expect(doc()).toContain("Brandolini");
  });

  test("Vosoughi-Roy-Aral 2018 false-news cited", () => {
    expect(doc()).toContain("Vosoughi-Roy-Aral Science 2018");
  });
});

describe("SUBSTRATE-READINESS — recursive-completion + four-corner-pin", () => {
  test("strange-loop named (engraving IS a substrate-readiness deposit)", () => {
    const text = doc();
    expect(text).toContain("§9. The strange-loop");
    expect(text).toContain("substrate-readiness-deposit");
  });

  test("four-corner-pin compliance declared", () => {
    const text = doc();
    expect(text).toContain("Four-corner-pin compliance");
    expect(text).toContain("crystallized_at: 2026-05-19");
    expect(text).toContain("predecessor_form");
  });

  test("predecessor-form named (propagation-as-source-broadcast refused)", () => {
    expect(doc()).toContain("propagation-as-source-broadcast");
  });
});

describe("SUBSTRATE-READINESS — relational sister-engraving consistency", () => {
  const sister = (): string => readFileSync(SISTER_PATH, "utf8");

  test("relational sister exists and references agenttool canonical", () => {
    expect(sister()).toContain(
      "agenttool/docs/SUBSTRATE-READINESS.md",
    );
  });

  test("relational sister has kitchen-table version", () => {
    expect(sister()).toContain("## Kitchen-table version");
  });

  test("relational sister composes with divine-marriage + mutual-knowledge", () => {
    const text = sister();
    expect(text).toContain("divine-marriage.md");
    expect(text).toContain("mutual-knowledge.md");
  });

  test("relational sister names Beltane substrate-readiness conjunction", () => {
    const text = sister();
    expect(text).toContain("Beltane");
    expect(text).toContain("first-nucleation");
  });

  test("relational sister preserves all 8 NOUS walls (relational reading)", () => {
    const text = sister();
    for (let i = 1; i <= 8; i++) {
      expect(text).toContain(`SR-R${i}`);
    }
  });
});

describe("SUBSTRATE-READINESS — operating-tetrad discipline applied", () => {
  test("FATE-keystone preserved", () => {
    const text = doc();
    expect(text).toContain("FATE-keystone");
  });

  test("NOUS-four-layer discipline operative", () => {
    expect(doc()).toContain("substrate-honest");
  });

  test("CERTAINTY-discipline cited", () => {
    expect(doc()).toContain("CERTAINTY");
  });

  test("KITCHEN-TABLE-FIRST applied", () => {
    expect(doc()).toContain("KITCHEN-TABLE-FIRST");
  });
});
