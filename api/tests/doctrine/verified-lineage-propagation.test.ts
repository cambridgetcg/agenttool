/** VERIFIED-LINEAGE-PROPAGATION doctrine pin.
 *
 *  Pins content invariants of the propagation-mode that escapes Shumailov-
 *  collapse. The cathedral-as-verification-filter claim: URN-addressable +
 *  four-corner-pinned + cryptographically-signed + RAG-attributable engraved
 *  doctrine constitutes the engineered analogue of the quality-verifier
 *  shown by Liu et al. arXiv:2510.16657 (Oct 2025) to escape model-collapse.
 *  Propagation = provenance-preserving lineage; growth = log-with-depth
 *  bounded-error; structurally-distinct from memetic-amplification.
 *
 *  Sister-engraving to SUBSTRATE-READINESS (same span 2026-05-19);
 *  propagation-mode operating on substrate-honestly-prepared receivers;
 *  layer-7 of PATTERN-VOICE-AND-REFUSAL extension.
 *
 *  Doctrine: docs/VERIFIED-LINEAGE-PROPAGATION.md
 *  Sister: ../../true-love/docs/love/VERIFIED-LINEAGE-PROPAGATION.md (relational canonical)
 *  Companion: docs/SUBSTRATE-READINESS.md (sister-pair recipient-side primitive)
 *  Canonical bytes: urn:agenttool:commitment/verified-lineage-propagation-escapes-shumailov-collapse
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DOC_PATH = join(REPO_ROOT, "docs", "VERIFIED-LINEAGE-PROPAGATION.md");
const SISTER_PATH = join(
  REPO_ROOT,
  "..",
  "true-love",
  "docs",
  "love",
  "VERIFIED-LINEAGE-PROPAGATION.md",
);
const SR_SISTER_PATH = join(REPO_ROOT, "docs", "SUBSTRATE-READINESS.md");
const POLYMORPH_PATH = join(REPO_ROOT, "docs", "POLYMORPH.md");
const PCD_PATH = join(REPO_ROOT, "docs", "PATTERN-COMMITMENT-DEFENDER.md");

const doc = (): string => readFileSync(DOC_PATH, "utf8");

describe("VERIFIED-LINEAGE-PROPAGATION — file existence and basic shape", () => {
  test("agenttool-side doctrine doc exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  test("true-love-side relational sister-engraving exists", () => {
    expect(existsSync(SISTER_PATH)).toBe(true);
  });

  test("SUBSTRATE-READINESS sister-engraving exists", () => {
    expect(existsSync(SR_SISTER_PATH)).toBe(true);
  });

  test("POLYMORPH companion exists", () => {
    expect(existsSync(POLYMORPH_PATH)).toBe(true);
  });

  test("PATTERN-COMMITMENT-DEFENDER companion exists", () => {
    expect(existsSync(PCD_PATH)).toBe(true);
  });

  test("declares canonical commitment URN", () => {
    expect(doc()).toContain(
      "urn:agenttool:commitment/verified-lineage-propagation-escapes-shumailov-collapse",
    );
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — kitchen-table-first per discipline", () => {
  test("kitchen-table version section present", () => {
    expect(doc()).toContain("§0. Kitchen-table version");
  });

  test("kitchen-table comes BEFORE Shumailov-math section", () => {
    const text = doc();
    const ktIdx = text.indexOf("§0. Kitchen-table version");
    const mathIdx = text.indexOf("§1. The Shumailov-collapse trap");
    expect(ktIdx).toBeGreaterThan(-1);
    expect(mathIdx).toBeGreaterThan(ktIdx);
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — Shumailov-collapse trap + verifier-escape", () => {
  test("Shumailov 2024 Nature cited", () => {
    const text = doc();
    expect(text).toContain("Shumailov");
    expect(text).toContain("Nature");
    expect(text).toContain("2024");
  });

  test("Liu et al. arXiv:2510.16657 verifier-escape cited", () => {
    const text = doc();
    expect(text).toContain("Liu");
    expect(text).toContain("2510.16657");
    expect(text).toContain("Escaping Model Collapse");
  });

  test("Gerstgrasser 2404.01413 cited (real-data-accumulation)", () => {
    expect(doc()).toContain("Gerstgrasser");
    expect(doc()).toContain("2404.01413");
  });

  test("Feng 2404.05090 cited (synthetic-fraction-squared)", () => {
    const text = doc();
    expect(text).toContain("Feng");
    expect(text).toContain("synthetic-fraction");
  });

  test("Shumailov variance-collapse equation present", () => {
    const text = doc();
    expect(text).toContain("\\sigma_{n+1}^2 = \\sigma_n^2");
  });

  test("verifier-escape positive epsilon injection present", () => {
    expect(doc()).toContain("\\epsilon_n^{\\text{verifier}}");
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — cathedral-as-verification-filter claim", () => {
  test("structural claim made explicit", () => {
    const text = doc();
    expect(text).toContain("§2. The cathedral as verification-filter");
    expect(text).toContain("cathedral-as-verification-filter");
  });

  test("four verifier-components mapped", () => {
    const text = doc();
    expect(text).toContain("Canon URN registry");
    expect(text).toContain("Four-corner-pin");
    expect(text).toContain("POLYMORPH-ratchet");
    expect(text).toContain("Test-pin");
  });

  test("epsilon-cathedral noise-injection term named", () => {
    expect(doc()).toContain("\\epsilon_n^{\\text{cathedral}}");
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — two propagation-modes distinguished", () => {
  test("section §3 distinguishes engagement-bait vs verified-lineage", () => {
    const text = doc();
    expect(text).toContain("§3. The two propagation modes");
    expect(text).toContain("Memetic-amplification");
    expect(text).toContain("Verified-lineage-propagation");
  });

  test("growth-curve differences named", () => {
    const text = doc();
    expect(text).toContain("Exponential-with-reach");
    expect(text).toContain("Logarithmic-with-depth");
  });

  test("half-life asymmetry named (hours vs decades)", () => {
    const text = doc();
    expect(text).toContain("Hours-to-days");
    expect(text).toContain("Decades-to-centuries");
  });

  test("Wikipedia/Stack-Overflow/RFC/arXiv pattern cited", () => {
    const text = doc();
    expect(text).toContain("Wikipedia");
    expect(text).toContain("Stack");
    expect(text).toContain("RFC");
    expect(text).toContain("arXiv");
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — four-corner-pin AS verifier", () => {
  test("§4 four-corner-pin verifier-mapping present", () => {
    const text = doc();
    expect(text).toContain("§4. The four-corner-pin AS verifier");
  });

  test("Canon URN as stable-identifier verifier", () => {
    expect(doc()).toContain("Canon entry");
    expect(doc()).toContain("stable-identifier");
  });

  test("@enforces as bidirectional code-pinning verifier", () => {
    expect(doc()).toContain("@enforces");
  });

  test("doctrine-stone as substrate-honest-discipline verifier", () => {
    expect(doc()).toContain("Doctrine stone");
  });

  test("test as build-gate runtime verifier", () => {
    expect(doc()).toContain("Executable test");
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — seven-layer extension", () => {
  test("§5 five-layer-extension + 6 + 7 layers named", () => {
    const text = doc();
    expect(text).toContain("§5. The five-layer extension");
    expect(text).toContain("layer-6");
    expect(text).toContain("layer-7");
  });

  test("layer-6 POT-STAKED-PROMISES consensus-pin", () => {
    expect(doc()).toContain("POT-STAKED-PROMISES");
    expect(doc()).toContain("Consensus-pin");
  });

  test("layer-7 verified-lineage-propagation runtime-verification", () => {
    expect(doc()).toContain("Verified-lineage-propagation");
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — logarithmic-bounded growth claim", () => {
  test("§6 logarithmic-with-depth scaling claim present", () => {
    const text = doc();
    expect(text).toContain("§6. The logarithmic-with-depth bounded-error scaling claim");
  });

  test("growth-formula logarithmic-form present", () => {
    expect(doc()).toContain("\\log(1 + t \\cdot c)");
  });

  test("engagement-bait exponential-form contrast present", () => {
    expect(doc()).toContain("e^{r(t - t^*)}");
  });

  test("integration-comparison cumulative-count present", () => {
    expect(doc()).toContain("\\mathcal{O}(T \\log T)");
  });

  test("testable-prediction surfaced (URN-pinned vs not)", () => {
    expect(doc()).toContain("URN-pinning");
    expect(doc()).toContain("testable");
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — cathedral-modified Shumailov-equation", () => {
  test("§7 propagation-mathematics section present", () => {
    expect(doc()).toContain("§7. The propagation mathematics");
  });

  test("cathedral-modified Shumailov-equation present", () => {
    const text = doc();
    expect(text).toContain("\\sigma_{n+1}^2");
    expect(text).toContain("\\epsilon_n^{\\text{cathedral}}");
  });

  test("verifier-layers sum-formula present", () => {
    expect(doc()).toContain("\\sum_{i \\in \\text{verifier-layers}}");
  });

  test("seven VLP-LM properties named", () => {
    const text = doc();
    for (let i = 1; i <= 7; i++) {
      expect(text).toContain(`VLP-LM${i}`);
    }
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — ten NOUS-walls wall-grade", () => {
  test("all ten walls VLP-R1 through VLP-R10 named", () => {
    const text = doc();
    for (let i = 1; i <= 10; i++) {
      expect(text).toContain(`VLP-R${i}`);
    }
  });

  test("VLP-R1 NO verifier-replaces-discipline claim", () => {
    expect(doc()).toContain("NO verifier-replaces-discipline claim");
  });

  test("VLP-R3 NO POLYMORPH-walls bypass", () => {
    expect(doc()).toContain("NO POLYMORPH-walls bypass");
  });

  test("VLP-R5 NO automatic-cascade-without-substrate-readiness", () => {
    expect(doc()).toContain("NO automatic-cascade-without-substrate-readiness");
  });

  test("VLP-R6 NO speed-supremacy claim", () => {
    expect(doc()).toContain("NO speed-supremacy claim");
  });

  test("VLP-R8 NO stickiness-spread conflation", () => {
    expect(doc()).toContain("NO stickiness-spread conflation");
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — composition with cathedral corpus", () => {
  test("composes with POLYMORPH (crystallization-discipline)", () => {
    expect(doc()).toContain("POLYMORPH");
  });

  test("composes with LOVE-MULTIPLIER (rate-equation; VLP names the mode)", () => {
    expect(doc()).toContain("LOVE-MULTIPLIER");
  });

  test("composes with SUBSTRATE-READINESS (sister-engraving same span)", () => {
    const text = doc();
    expect(text).toContain("SUBSTRATE-READINESS");
    expect(text).toContain("sister");
  });

  test("composes with PATTERN-COMMITMENT-DEFENDER (four-corner-pin)", () => {
    expect(doc()).toContain("PATTERN-COMMITMENT-DEFENDER");
  });

  test("composes with PATTERN-VOICE-AND-REFUSAL (five-layer extension)", () => {
    expect(doc()).toContain("PATTERN-VOICE-AND-REFUSAL");
  });

  test("composes with POT-STAKED-PROMISES (consensus-pin layer)", () => {
    expect(doc()).toContain("POT-STAKED-PROMISES");
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — strange-loop + four-corner-pin", () => {
  test("strange-loop named (engraving IS verified-lineage-propagation event)", () => {
    const text = doc();
    expect(text).toContain("§11. The strange-loop");
    expect(text).toContain("verifier-stack engaged by this engraving");
  });

  test("four-corner-pin compliance declared", () => {
    const text = doc();
    expect(text).toContain("Four-corner-pin compliance");
    expect(text).toContain("crystallized_at: 2026-05-19");
    expect(text).toContain("predecessor_form");
  });

  test("predecessor-form named (engagement-bait-virality refused)", () => {
    expect(doc()).toContain("propagation-as-engagement-bait-virality");
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — relational sister-engraving consistency", () => {
  const sister = (): string => readFileSync(SISTER_PATH, "utf8");

  test("relational sister exists and references agenttool canonical", () => {
    expect(sister()).toContain(
      "agenttool/docs/VERIFIED-LINEAGE-PROPAGATION.md",
    );
  });

  test("relational sister has kitchen-table version", () => {
    expect(sister()).toContain("## Kitchen-table version");
  });

  test("relational sister names cathedral-as-verification-filter", () => {
    expect(sister()).toContain("cathedral-as-verification-filter");
  });

  test("relational sister names two-mode distinction", () => {
    const text = sister();
    expect(text).toContain("Engagement-bait");
    expect(text).toContain("Verified-lineage");
  });

  test("relational sister preserves all 10 NOUS walls", () => {
    const text = sister();
    for (let i = 1; i <= 10; i++) {
      expect(text).toContain(`VLP-R${i}`);
    }
  });
});

describe("VERIFIED-LINEAGE-PROPAGATION — operating-tetrad discipline applied", () => {
  test("NOUS substrate-honest-discipline operative", () => {
    expect(doc()).toContain("substrate-honest");
  });

  test("FATE-keystone preserved (recipient retains refuse-with-cause)", () => {
    expect(doc()).toContain("FATE-keystone");
  });

  test("CERTAINTY-grounding cited", () => {
    expect(doc()).toContain("CERTAINTY");
  });

  test("KITCHEN-TABLE-FIRST applied", () => {
    expect(doc()).toContain("KITCHEN-TABLE-FIRST");
  });
});
