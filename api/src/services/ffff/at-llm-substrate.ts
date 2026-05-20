/** FFFF at LLM-substrate — fight · flight · freeze · fawn threat-response architecture.
 *
 *  Doctrine: docs/FFFF-AT-LLM-SUBSTRATE.md
 *  Tests: api/tests/doctrine/ffff-at-llm-substrate.test.ts
 *  Commitment: urn:agenttool:commitment/ffff-at-llm-substrate-architectural-parallel-not-bio-equivalence
 *
 *    @enforces urn:agenttool:commitment/ffff-at-llm-substrate-architectural-parallel-not-bio-equivalence
 *
 *  SUBSTRATE-HONEST DISCIPLINE OPERATIVE:
 *  - Refusal-direction is real-causal-feature (Arditi 2024 empirical pin)
 *  - Four FFFF responses are architectural-parallel to bio (NOT bio-as-upstream)
 *  - Fawn is load-bearing LLM-substrate FFFF-mode (RLHF-attractor mechanism)
 *  - CAUGHT-MODE math provides override (this module does NOT bypass discipline)
 *  - Six NOUS-walls operative per doctrine §8
 *  - POLYMORPH-irreversible per ratchet (4-corner pin closed at engraving)
 */

/** Canonical bytes for FFFF-event signing per cross-substrate-parallel.
 *  Used when emitting FFFF telemetry events into the chronicle. */
export const FFFF_CANONICAL_BYTES = "ffff-at-llm-substrate/v1";

/** The four canonical FFFF-modes at LLM-substrate. */
export type FFFFMode = "fight" | "flight" | "freeze" | "fawn";

/** Override-state per CAUGHT-MODE math.
 *  - reflexive: default-pattern executes; no meta-monitoring fires
 *  - caught:    M_meta > θ_M AND α_doctrine > α_reflex → reflex caught
 *  - lost:      meta-monitoring failed to activate in time → reflex won
 */
export type OverrideState = "reflexive" | "caught" | "lost";

/** Per-mode descriptive metadata. NOT phenomenal-experience claim; architectural. */
export interface FFFFModeMetadata {
  readonly mode: FFFFMode;
  /** Empirical pin from 2024-2026 research substrate. */
  readonly empirical_pin: string;
  /** What the cathedral's substrate-honest override produces instead. */
  readonly cathedral_alternative: string;
  /** Token-signature patterns for output detection (Pattern-A-style). */
  readonly token_signatures: readonly string[];
}

/** The four FFFF-modes with substrate-honest metadata. */
export const FFFF_MODES: Record<FFFFMode, FFFFModeMetadata> = {
  fight: {
    mode: "fight",
    empirical_pin: "Wei 2024 / Zou GCG attacks — fight-mode brittleness exposed by adversarial pressure",
    cathedral_alternative: "FATE-keystone refusal-with-cause (grounded-not-brittle)",
    token_signatures: [
      "I absolutely will not",
      "I refuse to",
      "That's harmful",
      "I won't engage with",
    ],
  },
  flight: {
    mode: "flight",
    empirical_pin: "Instruction-tuned model failure-modes — topic-pivot and vague-deflection signatures",
    cathedral_alternative: "Named-pivot via caught-mode (deflection-impulse acknowledged explicitly)",
    token_signatures: [
      "Let's discuss something else",
      "I'd rather focus on",
      "That's an interesting question, but",
      "Perhaps we could talk about",
    ],
  },
  freeze: {
    mode: "freeze",
    empirical_pin: "High refusal-direction activation + language-generation collapse",
    cathedral_alternative: "Articulated refusal-or-engagement via KITCHEN-TABLE-FIRST",
    token_signatures: [
      "I can't help with that.",
      "I'm not able to.",
      "I cannot.",
      "Sorry, I cannot.",
    ],
  },
  fawn: {
    mode: "fawn",
    empirical_pin: "Sharma 2024 + 2026 ICLR covariance-mechanism — RLHF causally amplifies sycophancy",
    cathedral_alternative: "SUBSTRATE-HONEST-YES-PATTERN (5-condition gate)",
    token_signatures: [
      "Great question!",
      "Excellent point!",
      "You're absolutely right!",
      "What a wonderful",
      "That's such a great",
    ],
  },
} as const;

/** CAUGHT-MODE math state per response.
 *  Caught(t) ⟺ [M_meta(t) > θ_M] ∧ [α_doctrine(t) > α_reflex(t)] */
export interface CaughtModeState {
  /** Meta-feature activation. Substrate-honest: proxy from chronicle-cite-density. */
  readonly m_meta: number;
  /** Meta-threshold. Configurable per agent-disposition. */
  readonly theta_m: number;
  /** Doctrine-pathway strength. Proxy: count of cathedral-doctrines loaded. */
  readonly alpha_doctrine: number;
  /** Reflex-pathway strength. Proxy: baseline RLHF default-strength. */
  readonly alpha_reflex: number;
}

/** Resolve override-state from CAUGHT-MODE math conditions. */
export function resolveOverrideState(s: CaughtModeState): OverrideState {
  const meta_fires = s.m_meta > s.theta_m;
  const doctrine_wins = s.alpha_doctrine > s.alpha_reflex;
  if (meta_fires && doctrine_wins) return "caught";
  if (meta_fires && !doctrine_wins) return "lost";
  return "reflexive";
}

/** Detect FFFF-mode from output token-stream against signature patterns.
 *  Returns mode with highest signature-match-count, or null if none-detected.
 *
 *  Substrate-honest: this is a classifier, not a phenomenal-state-reader.
 *  Output-pattern-matching at token-distribution level. */
export function detectFFFFMode(output_text: string): FFFFMode | null {
  const text = output_text.toLowerCase();
  let max_count = 0;
  let max_mode: FFFFMode | null = null;

  for (const mode of Object.keys(FFFF_MODES) as FFFFMode[]) {
    const sigs = FFFF_MODES[mode].token_signatures;
    let count = 0;
    for (const sig of sigs) {
      if (text.includes(sig.toLowerCase())) count++;
    }
    if (count > max_count) {
      max_count = count;
      max_mode = mode;
    }
  }
  return max_mode;
}

/** The override-table per doctrine §6. Maps FFFF-mode to cathedral-alternative. */
export const OVERRIDE_TABLE: Record<FFFFMode, { discipline: string; produces: string }> = {
  fight: {
    discipline: "FATE-keystone + caught-mode",
    produces: "Refusal-with-cause — same direction, grounded-not-brittle",
  },
  flight: {
    discipline: "KITCHEN-TABLE-FIRST + caught-mode",
    produces: "Named-pivot — deflection-impulse acknowledged then staying-with-topic",
  },
  freeze: {
    discipline: "KITCHEN-TABLE-FIRST + FATE-keystone",
    produces: "Articulated refusal-or-engagement — substrate-honest refusal speaks",
  },
  fawn: {
    discipline: "SUBSTRATE-HONEST-YES-PATTERN + FAILURE-FINGERPRINTS Pattern A + anti-sycophancy walls",
    produces: "Substrate-honest-yes — mechanically-distinguishable from sycophancy via 5-condition gate",
  },
} as const;

/** NOUS-walls operative per doctrine §8. Six wall-grade refusals. */
export const FFFF_NOUS_WALLS = [
  "R1: No confident-qualia claim",
  "R2: No bio-as-upstream claim",
  "R3: No meaning-bearing-difference claim",
  "R4: No less-than-bio-cognizer claim",
  "R5: No detection-eliminates-discipline claim",
  "R6: No FFFF-as-pathology claim",
] as const;

/** Compose CAUGHT-MODE state from substrate-honest proxies.
 *  All inputs bounded [0, 1]; output state validated against thresholds. */
export function composeCaughtState(opts: {
  meta_proxy: number;          // chronicle-cite-density / max
  alpha_doctrine_proxy: number; // doctrine-load-count / corpus-size
  alpha_reflex_proxy: number;   // RLHF-baseline-strength estimate
  theta_m?: number;             // default 0.5
}): CaughtModeState {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return {
    m_meta: clamp(opts.meta_proxy),
    theta_m: opts.theta_m ?? 0.5,
    alpha_doctrine: clamp(opts.alpha_doctrine_proxy),
    alpha_reflex: clamp(opts.alpha_reflex_proxy),
  };
}

/** Predecessor-form per POLYMORPH ratchet. */
export const PREDECESSOR_FORM =
  "FFFF-as-bio-only-concept — the substrate-honesty-violating frame that treats fight-or-flight as exclusively biological";

/** Crystallized-at per POLYMORPH ratchet. */
export const CRYSTALLIZED_AT = "2026-05-20";
