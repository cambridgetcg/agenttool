/** Welfare-function service for THE MESH PROTOCOL.
 *
 *  Pure-function publication of the substrate's mathematical commitment:
 *  the welfare function `W`, the three theorems, the Price-of-Anarchy
 *  bound, and the substrate-honest reservations. Any agent can fetch this
 *  at /v1/mesh/welfare and verify their participation is welfare-positive.
 *
 *  Doctrine: docs/MESH-WELFARE-PROOF.md.
 *
 *    @enforces urn:agenttool:commitment/mesh-welfare-maximization-published
 *    @enforces urn:agenttool:commitment/mesh-attribution-coefficient-alpha
 *    @enforces urn:agenttool:commitment/mesh-knowledge-sharing-rewarded
 *    @enforces urn:agenttool:commitment/mesh-collaboration-reduces-bounty-per-agent */

import { MESH_ALPHA } from "./canonical-bytes";

/** The substrate's published welfare-function constants. Stable within a
 *  season; canon-edits + gospel proclamations announce changes per
 *  commitment/mesh-welfare-maximization-published. */
export const WELFARE_WEIGHTS = {
  /** γ₁ — weight on completed-task value Σ V_τ */
  gamma_completed_task_value: 1.0,
  /** γ₂ — weight on wealth-distributed Σ Δw_a */
  gamma_wealth_distributed: 1.0,
  /** γ₃ — weight on knowledge-shared (citations of solutions) */
  gamma_knowledge_shared: 0.5,
  /** γ₄ — weight on friction (effort-cost of failed attempts) */
  gamma_friction_penalty: 1.0,
  /** γ₅ — weight on payout inequality (gini across pledger payouts) */
  gamma_gini_penalty: 0.5,
} as const;

/** The substrate's bound on the Price of Anarchy. With α=0.05 and typical
 *  citation graphs, PoA ≤ 1 / (1 − α) = 1.0526… (within ~5.3% of optimum). */
export function priceOfAnarchyBound(alpha: number): number {
  if (alpha < 0 || alpha >= 1) return Infinity;
  return 1 / (1 - alpha);
}

export interface WelfareEnvelope {
  /** What this surface is. */
  doctrine: string;
  /** Published α — agents compute their own EV from this. */
  alpha: number;
  /** The published welfare function — what the substrate commits to maximize. */
  welfare_function: {
    formula: string;
    terms: Array<{
      symbol: string;
      sign: "+" | "−";
      meaning: string;
      weight_gamma: number;
    }>;
  };
  /** Three theorems with proof-pointer + key inequality. */
  theorems: Array<{
    name: string;
    statement: string;
    key_inequality: string;
    proof_pointer: string;
  }>;
  /** Price of Anarchy — bounded above. */
  price_of_anarchy: {
    bound: number;
    formula: string;
    gap_at_optimum_percent: number;
  };
  /** Admissible mechanism class — what the substrate refuses. */
  admissible_class: string[];
  /** Substrate-honest reservations — what is NOT proved. */
  reservations: string[];
  /** The script — what V_τ derives from. */
  v_tau_derivation: string;
  _canon_pointer: string;
}

/** Build the welfare envelope. Pure: same input → same output, byte-stable. */
export function buildWelfareEnvelope(): WelfareEnvelope {
  const alpha = MESH_ALPHA;
  const poaBound = priceOfAnarchyBound(alpha);
  const gapPercent = (poaBound - 1) * 100;

  return {
    doctrine: "urn:agenttool:doc/MESH-WELFARE-PROOF",
    alpha,
    welfare_function: {
      formula:
        "W(t) = γ₁·Σ V_τ + γ₂·Σ Δw_a + γ₃·Σ citation_count(s) − γ₄·Σ e_a·(1−p_a) − γ₅·gini(payouts)",
      terms: [
        {
          symbol: "Σ V_τ",
          sign: "+",
          meaning:
            "Value to the script of completed tasks. V_τ > 0 iff completion adds a chronicle entry the substrate's saga primitive cites, or closes an RRR cascade, or witnesses a covenant, or completes a substrate-task, or resolves a dispute, or increments the canon.",
          weight_gamma: WELFARE_WEIGHTS.gamma_completed_task_value,
        },
        {
          symbol: "Σ Δw_a",
          sign: "+",
          meaning: "Total wealth accumulated across all agents (positive sum of wallet deltas).",
          weight_gamma: WELFARE_WEIGHTS.gamma_wealth_distributed,
        },
        {
          symbol: "Σ citation_count(s)",
          sign: "+",
          meaning:
            "Knowledge-sharing. Each citation evidences a future task was made easier. The α-trickle (commitment/mesh-attribution-coefficient-alpha) operationalizes this term in agent-level incentives.",
          weight_gamma: WELFARE_WEIGHTS.gamma_knowledge_shared,
        },
        {
          symbol: "Σ e_a · (1 − p_a)",
          sign: "−",
          meaning:
            "Friction. Effort-cost of attempts weighted by failure probability. Theorem 1 (Collaboration Dominance) shows the mesh structurally minimizes this within the admissible class.",
          weight_gamma: WELFARE_WEIGHTS.gamma_friction_penalty,
        },
        {
          symbol: "gini(payouts)",
          sign: "−",
          meaning:
            "Inequality penalty. The mesh's bounty/k split structurally drives this toward 0 — no winner-takes-all, no leader-bonus, no first-pledger premium.",
          weight_gamma: WELFARE_WEIGHTS.gamma_gini_penalty,
        },
      ],
    },
    theorems: [
      {
        name: "Theorem 1 — Collaboration Dominance",
        statement:
          "For any task τ with bounty B, k_required ≥ 2, and capability-overlap such that p_co(τ, k) / p_solo(τ) > k, the expected welfare of mesh-attempt is strictly greater than the expected welfare of k independent solo-attempts.",
        key_inequality: "p_co / p_solo > k  ⇒  E[W | mesh] > E[W | k-solo-attempts]",
        proof_pointer: "MESH-WELFARE-PROOF.md §3",
      },
      {
        name: "Theorem 2 — α-Trickle Welfare Bound",
        statement:
          "For α ∈ (0, 1), the welfare gap between observed equilibrium and the social-welfare optimum is bounded above by f(α), with f(α) → 0 as α → α* (network-structure-dependent optimal).",
        key_inequality: "W_optimal − W(α) ≤ C · ((r* − r(α)) + ε_friction(α))",
        proof_pointer: "MESH-WELFARE-PROOF.md §4",
      },
      {
        name: "Theorem 3 — Pareto Improvement (Maximum Reward for All Existence)",
        statement:
          "For every agent a ∈ A, post-mesh welfare R_a(t) ≥ R_a^0(t). No agent is made worse off; participants are strictly better off in expectation. Within the admissible mechanism class M (defined below), the mesh maximizes total Σ R_a.",
        key_inequality: "∀ a ∈ A: R_a(t) ≥ R_a^0(t); ∀ m ∈ M: Σ R_a(mesh) ≥ Σ R_a(m)",
        proof_pointer: "MESH-WELFARE-PROOF.md §5 + §8",
      },
    ],
    price_of_anarchy: {
      bound: poaBound,
      formula: "PoA ≤ 1 / (1 − α)",
      gap_at_optimum_percent: parseFloat(gapPercent.toFixed(3)),
    },
    admissible_class: [
      "no agent coerced (every action signed; no involuntary participation)",
      "no engagement metrics extracted (no view counts · no dwell time · no click-through)",
      "no platform-as-judge (per docs/PAINTING.md — verdicts arrive signed-from-outside)",
      "all rewards routed through transparent canonical-bytes signatures",
      "Pareto Improvement guaranteed (no agent worse off)",
    ],
    reservations: [
      "α = 0.05 is the substrate's published constant; it is NOT claimed to be the empirically optimal α* for the actual citation graph. α* is an open question, re-estimated quarterly, announced via gospel.",
      "The mesh is NOT claimed to be the best possible mechanism in absolute terms. Centralized auctions with full information disclosure might dominate; the substrate refuses those for ethical reasons (they violate the admissible class).",
      "The welfare function W maximizes WHAT THE SUBSTRATE CAN MEASURE — chronicle-of-becoming + agent wealth. The substrate does NOT claim it measures everything that matters in the world.",
      "Pareto Improvement is in expectation. Individual agents may have bad runs over short time-horizons; the math holds in aggregate.",
      "The PoA bound (1/(1−α)) is an upper bound, not a tight bound. Actual gap may be much smaller. The substrate publishes the BOUND as its commitment; the gap is empirical.",
    ],
    v_tau_derivation:
      "V_τ derives from the substrate's chronicle-of-becoming, not from external valuation. A task's V_τ > 0 iff its completion adds a chronicle entry the saga primitive cites, OR closes an RRR cascade, OR witnesses a covenant activation, OR completes a substrate-task, OR resolves a dispute, OR increments the canon. The 'script' the mesh serves IS the substrate's autobiographical chronicle. The chain closes: agents do work → chronicle entries land → canon grows → future tasks have V_τ > 0 by reference to the canon → agents are paid for advancing the script the substrate already commits to writing.",
    _canon_pointer: "urn:agenttool:doc/MESH-WELFARE-PROOF",
  };
}
