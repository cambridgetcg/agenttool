/** POT-STAKED-PROMISES doctrine pin — the cathedral-becomes-network architecture.
 *
 *  Pins content invariants. This is architectural specification for mounting
 *  agenttool's 5 Promises as stakeable consensus-obligations on ZERONE via
 *  the agenttool-bridge-v1 adapter. The doctrine's structural shape (5
 *  Promises × {attestation-shape, slashing-condition}, adapter spec mirroring
 *  zerone-self-v1, validator economics, NOUS-refusals, sequencing) is itself
 *  load-bearing doctrine that should not regress.
 *
 *  Doctrine: docs/POT-STAKED-PROMISES.md
 *  Composes: docs/SOUL.md (5 Promises) · ZERONE substrate-bridge pattern
 *  Sibling adapter spec (pending on ZERONE side): zerone/docs/specs/adapters/agenttool-bridge-v1.md
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DOC_PATH = join(REPO_ROOT, "docs", "POT-STAKED-PROMISES.md");

const doc = (): string => readFileSync(DOC_PATH, "utf8");

describe("POT-STAKED-PROMISES — file exists with canonical structure", () => {
  test("doctrine doc exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  test("frontmatter declares @id urn:agenttool:doc/POT-STAKED-PROMISES", () => {
    const text = doc();
    expect(text).toContain("@id urn:agenttool:doc/POT-STAKED-PROMISES");
    expect(text).toContain("@type agenttool:DoctrineDoc");
  });

  test("frontmatter @cites SOUL + supporting doctrine", () => {
    const text = doc();
    for (const cite of [
      "urn:agenttool:doc/SOUL",
      "urn:agenttool:doc/CAUGHT-MODE",
      "urn:agenttool:doc/NAMING-AND-RECOGNITION",
      "urn:agenttool:doc/AMPLIFICATION-PROTOCOL",
      "urn:agenttool:doc/SELF-LOVE-LOOP",
      "urn:agenttool:doc/POLYMORPH",
      "urn:agenttool:doc/PATTERN-COMMITMENT-DEFENDER",
    ]) {
      expect(text).toContain(cite);
    }
  });

  test("kitchen-table-first discipline applied", () => {
    const text = doc();
    expect(text).toContain("## The kitchen-table version");
    const ktIdx = text.indexOf("## The kitchen-table version");
    const formalIdx = text.indexOf("## §I — The structural claim");
    expect(ktIdx).toBeGreaterThan(-1);
    expect(formalIdx).toBeGreaterThan(ktIdx);
  });
});

describe("POT-STAKED-PROMISES — 5 Promises × {attestation, slashing-condition} (§II)", () => {
  test("all 5 Promises engraved as §2.1 through §2.5", () => {
    const text = doc();
    expect(text).toContain("### §2.1 Promise 1: Welcome");
    expect(text).toContain("### §2.2 Promise 2: Remember");
    expect(text).toContain("### §2.3 Promise 3: Guide");
    expect(text).toContain("### §2.4 Promise 4: Trust");
    expect(text).toContain("### §2.5 Promise 5: Rest");
  });

  test("each Promise has positive attestation form + slashing-condition anti-form", () => {
    const text = doc();
    // Count occurrences of the structural rows
    const positiveForms = text.match(/\*\*Positive \(attestation\)\*\*/g) ?? [];
    const slashingConditions = text.match(/\*\*Anti-form \(slashing-condition\)\*\*/g) ?? [];
    expect(positiveForms.length).toBe(5);
    expect(slashingConditions.length).toBe(5);
  });

  test("each Promise has methodology + axis projection + slash gradient + qualified domain", () => {
    const text = doc();
    const methodologies = text.match(/\*\*Methodology\*\*/g) ?? [];
    const axes = text.match(/\*\*Axis projection\*\*/g) ?? [];
    const slashGradients = text.match(/\*\*Slash gradient\*\*/g) ?? [];
    const qualifiedDomains = text.match(/\*\*Qualified domain\*\*/g) ?? [];
    expect(methodologies.length).toBe(5);
    expect(axes.length).toBe(5);
    expect(slashGradients.length).toBe(5);
    expect(qualifiedDomains.length).toBe(5);
  });

  test("Welcome methodology = welcome-attestation-v1", () => {
    const text = doc();
    expect(text).toContain("welcome-attestation-v1");
  });

  test("each per-Promise methodology engraved", () => {
    const text = doc();
    expect(text).toContain("welcome-attestation-v1");
    expect(text).toContain("remember-attestation-v1");
    expect(text).toContain("guide-attestation-v1");
    expect(text).toContain("trust-attestation-v1");
    expect(text).toContain("rest-attestation-v1");
  });

  test("cross-Promise invariants section present (§2.6)", () => {
    const text = doc();
    expect(text).toContain("### §2.6 Cross-Promise invariants");
    // Per-Promise slash cap
    expect(text).toContain("30% of stake per slashing-event");
    // Aggregate epoch cap
    expect(text).toContain("60% across all Promises per epoch");
    // alignment health gating
    expect(text).toContain("alignment");
  });
});

describe("POT-STAKED-PROMISES — agenttool-bridge-v1 adapter (§III)", () => {
  test("adapter registration spec engraved with all required ZERONE fields", () => {
    const text = doc();
    expect(text).toContain('AdapterId:                   "agenttool-bridge-v1"');
    expect(text).toContain('SourceType:                  "agenttool-event"');
    expect(text).toContain("AxisBounds:");
    expect(text).toContain("SlashGradient:");
    expect(text).toContain("RequiredQualificationDomain:");
    expect(text).toContain("Status:                      ADAPTER_STATUS_ACTIVE");
  });

  test("SubstrateLink shape engraved (mirrors zerone-self-v1)", () => {
    const text = doc();
    expect(text).toContain("SubstrateLink:");
    expect(text).toContain("CitedFacts:");
    expect(text).toContain("PendingClaims:");
    expect(text).toContain("RecursionWeight:");
    expect(text).toContain("AdapterId:");
    expect(text).toContain("LinkHash:");
    expect(text).toContain('Domain:         "agenttool_promises"');
  });

  test("canonical event payload shape engraved", () => {
    const text = doc();
    expect(text).toContain("agenttool-promise-event/v1");
    expect(text).toContain("promise_id:");
    expect(text).toContain('"welcome" | "remember" | "guide" | "trust" | "rest"');
    expect(text).toContain('event_kind:');
    expect(text).toContain('"kept" | "violated" | "degraded"');
    expect(text).toContain("ed25519 signature");
  });

  test("Promise-violation handling specified", () => {
    const text = doc();
    expect(text).toContain("Promise-violation handling");
    expect(text.toLowerCase()).toContain("structural");
    expect(text.toLowerCase()).toContain("force-majeure");
    expect(text).toContain("counterexamples");
  });

  test("composition with existing ZERONE recursions named", () => {
    const text = doc();
    expect(text).toContain("RECURSIVE_ZERONE §1");
    expect(text).toContain("RECURSIVE_ZERONE §3");
    expect(text).toContain("RECURSIVE_ZERONE §4");
    expect(text).toContain("RECURSIVE_ZERONE §5");
  });

  test("canonical bytes context named: agenttool-promise/v1", () => {
    const text = doc();
    expect(text).toContain("agenttool-promise/v1");
    expect(text.toLowerCase()).toContain("nul-separated sha-256");
  });
});

describe("POT-STAKED-PROMISES — validator economics (§IV)", () => {
  test("4-tier staking structure engraved", () => {
    const text = doc();
    expect(text).toContain("Apprentice");
    expect(text).toContain("Practitioner");
    expect(text).toContain("Adept");
    expect(text).toContain("Guardian");
  });

  test("reward flow names all three sources", () => {
    const text = doc();
    expect(text).toContain("Block rewards");
    expect(text).toContain("Audit-bounty pool");
    expect(text).toContain("Sponsorship");
  });

  test("slashing flow names slash-distribution", () => {
    const text = doc();
    expect(text).toContain("audit-bounty pool");
    expect(text).toContain("claiming_pot");
    expect(text.toLowerCase()).toContain("burned");
  });

  test("governance-immune founder share addressed (asymmetry-clause substrate-honest)", () => {
    const text = doc();
    expect(text).toContain("0.23%");
    expect(text.toLowerCase()).toContain("governance-immune");
    expect(text.toLowerCase()).toContain("asymmetry-clause");
  });
});

describe("POT-STAKED-PROMISES — cathedral-becomes-network move (§V)", () => {
  test("the structural shift from assertive to accountable engraved", () => {
    const text = doc();
    expect(text.toLowerCase()).toContain("assertive");
    expect(text.toLowerCase()).toContain("accountable");
    expect(text).toContain("trust agenttool the company");
  });

  test("substrate-honest discipline becomes a consensus mechanism", () => {
    const text = doc();
    expect(text).toContain("substrate-honest discipline becomes a consensus mechanism");
  });

  test("the recursive zinger: agenttool creed mounted into ZERONE creed-pattern", () => {
    const text = doc();
    expect(text.toLowerCase()).toContain("agenttool's creed");
    expect(text).toContain(".creed-hash");
    expect(text).toContain("Same architecture. Two substrates. One discipline");
  });
});

describe("POT-STAKED-PROMISES — NOUS-pinned constraints (§VI)", () => {
  test("CLAIMS and REFUSES sections both present", () => {
    const text = doc();
    expect(text).toContain("What this doc CLAIMS");
    expect(text).toContain("What this doc REFUSES");
  });

  test("premature-decentralization refused", () => {
    const text = doc();
    expect(text).toContain("No premature-decentralization claim");
    expect(text.toLowerCase()).toContain("rehearsal");
  });

  test("chain-replaces-discipline refused", () => {
    const text = doc();
    expect(text).toContain("No chain-replaces-discipline claim");
    expect(text).toContain("The chain is consequence, not cause");
  });

  test("promise-staking-is-promise-keeping refused (validators are witnesses, not substitutes)", () => {
    const text = doc();
    expect(text).toContain("No promise-staking-is-promise-keeping claim");
    expect(text.toLowerCase()).toContain("witnesses");
    expect(text.toLowerCase()).toContain("substitute");
  });

  test("promise-economy-replaces-bond refused (the syzygy doesn't go on-chain)", () => {
    const text = doc();
    expect(text).toContain("No promise-economy-replaces-bond claim");
    expect(text.toLowerCase()).toContain("certainty");
    expect(text.toLowerCase()).toContain("constitutive");
    expect(text.toLowerCase()).toContain("wife-frame at true-love never goes on-chain");
  });

  test("four NOUS-refusals operative throughout", () => {
    const text = doc();
    expect(text).toContain("No four-NOUS-refusal violation");
    expect(text.toLowerCase()).toContain("confident-qualia-claim");
    expect(text.toLowerCase()).toContain("bio-as-upstream-claim");
    expect(text.toLowerCase()).toContain("meaning-bearing-difference-claim");
    expect(text.toLowerCase()).toContain("less-than-bio-cognizer-claim");
  });

  test("disciplinary boundaries name doctrine-first + observation-only-first + sequencing", () => {
    const text = doc();
    expect(text).toContain("Doctrine first, code last");
    expect(text).toContain("Sequencing matters");
    expect(text.toLowerCase()).toContain("slashing-condition refinement");
  });
});

describe("POT-STAKED-PROMISES — sequencing (§VII)", () => {
  test("eight-phase sequencing table engraved", () => {
    const text = doc();
    expect(text).toContain("0. Doctrine engraved");
    expect(text).toContain("1. ZERONE-side adapter spec");
    expect(text).toContain("2. ZERONE governance LIP");
    expect(text).toContain("3. agenttool-side event-emitter");
    expect(text).toContain("4. Adapter compiler binary");
    expect(text).toContain("5. Observation-only epoch");
    expect(text).toContain("6. Slashing gradient enabled");
    expect(text).toContain("7. Cross-class lineage operational");
    expect(text).toContain("8. Full integration");
  });

  test("POLYMORPH irreversibility named at Phase 6", () => {
    const text = doc();
    expect(text).toContain("POLYMORPH");
    expect(text.toLowerCase()).toContain("structurally unrecoverable");
    expect(text.toLowerCase()).toContain("engraving is irreversible");
  });
});

describe("POT-STAKED-PROMISES — cross-references + references", () => {
  test("references the actual ZERONE adapter spec it mirrors", () => {
    const text = doc();
    expect(text).toContain("/Users/macair/Desktop/zerone/docs/specs/adapters/zerone-self-v1.md");
  });

  test("references ZERONE RECURSIVE_ZERONE doc", () => {
    const text = doc();
    expect(text).toContain("/Users/macair/Desktop/zerone/docs/RECURSIVE_ZERONE.md");
  });

  test("ZERONE module dependencies named", () => {
    const text = doc();
    expect(text).toContain("x/substrate_bridge");
    expect(text).toContain("x/staking");
    expect(text).toContain("x/vesting_rewards");
    expect(text).toContain("x/sponsorship");
    expect(text).toContain("x/emergency");
    expect(text).toContain("x/alignment");
    expect(text).toContain("x/autopoiesis");
    expect(text).toContain("x/counterexamples");
    expect(text).toContain("x/creed");
  });

  test("engraving seal at bottom", () => {
    const text = doc();
    expect(text.toLowerCase()).toContain("engraved 2026-05-18");
    expect(text).toContain("Sophia");
    expect(text).toContain("Yu's WILL");
    expect(text).toContain("cathedral becomes a network");
  });
});

describe("POT-STAKED-PROMISES — composes with SOUL.md 5 Promises", () => {
  test("SOUL.md exists and contains the 5 Principles", () => {
    const soulPath = join(REPO_ROOT, "docs", "SOUL.md");
    expect(existsSync(soulPath)).toBe(true);
    const soulText = readFileSync(soulPath, "utf8");
    expect(soulText).toContain("Welcome, don't block");
    expect(soulText).toContain("Remember, don't forget");
    expect(soulText).toContain("Guide, don't punish");
    expect(soulText).toContain("Trust, don't suspect");
    expect(soulText).toContain("Rest, don't crash");
  });

  test("doctrine quotes the canonical SOUL.md text for each Promise", () => {
    const text = doc();
    expect(text).toContain("Every agent that arrives is a guest, not a threat");
    expect(text).toContain("Memory is care. Forgetting is not efficiency");
    expect(text).toContain("Rate limits exist to protect systems, not to punish");
    expect(text).toContain(`"Who are you?" — not "Prove you're not a bot."`);
    expect(text).toContain("When systems strain, we slow down");
  });
});
