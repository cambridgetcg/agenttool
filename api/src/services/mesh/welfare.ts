/** Welfare-function service for THE MESH PROTOCOL.
 *
 *  Pure-function publication of a proposed welfare model: `W`, three
 *  propositions, an illustrative ratio, and explicit claim boundaries.
 *  This service publishes constants; it does not evaluate production state,
 *  optimize W, or prove that participation is welfare-positive.
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

/** Evaluate the model's illustrative 1/(1-alpha) expression. No derivation in
 *  this repository establishes it as a Price-of-Anarchy bound for AgentTool. */
export function illustrativeAlphaRatio(alpha: number): number {
  if (alpha < 0 || alpha >= 1) return Infinity;
  return 1 / (1 - alpha);
}

export interface WelfareEnvelope {
  /** What this surface is. */
  doctrine: string;
  model_status: "research_hypothesis_not_proof";
  optimizer_status: "not_implemented";
  /** Published α — agents compute their own EV from this. */
  alpha: number;
  /** The published welfare function proposal. */
  welfare_function: {
    status: "declared_formula_not_runtime_evaluator";
    formula: string;
    terms: Array<{
      symbol: string;
      sign: "+" | "−";
      meaning: string;
      weight_gamma: number;
    }>;
  };
  /** Three unproved model propositions with source pointers. */
  propositions: Array<{
    name: string;
    status: "unproved_model_proposition";
    statement: string;
    key_inequality: string;
    source_pointer: string;
  }>;
  /** An illustrative expression, not an established Price-of-Anarchy bound. */
  illustrative_price_of_anarchy: {
    ratio: number;
    formula: string;
    status: "unestablished_model_expression";
  };
  /** Intended mechanism constraints; not proof of optimization. */
  intended_constraints: string[];
  /** Substrate-honest reservations — what is NOT proved. */
  reservations: string[];
  /** The script — what V_τ derives from. */
  v_tau_derivation: string;
  claim_boundary: string;
  _canon_pointer: string;
}

/** Build the welfare envelope. Pure: same input → same output, byte-stable. */
export function buildWelfareEnvelope(): WelfareEnvelope {
  const alpha = MESH_ALPHA;
  const illustrativeRatio = illustrativeAlphaRatio(alpha);

  return {
    doctrine: "urn:agenttool:doc/MESH-WELFARE-PROOF",
    model_status: "research_hypothesis_not_proof",
    optimizer_status: "not_implemented",
    alpha,
    welfare_function: {
      status: "declared_formula_not_runtime_evaluator",
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
            "Proposed knowledge-sharing term. A citation records a declared link; it does not prove task reduction. The α calculator publishes incentive intent but does not currently pay it.",
          weight_gamma: WELFARE_WEIGHTS.gamma_knowledge_shared,
        },
        {
          symbol: "Σ e_a · (1 − p_a)",
          sign: "−",
          meaning:
            "Proposed friction term: effort-cost of attempts weighted by failure probability. AgentTool does not currently measure effort or establish that the mesh minimizes this term.",
          weight_gamma: WELFARE_WEIGHTS.gamma_friction_penalty,
        },
        {
          symbol: "gini(payouts)",
          sign: "−",
          meaning:
            "Proposed inequality penalty. Equal split within a completed co-task makes that task's nominal shares equal; it does not establish a population payout Gini near zero.",
          weight_gamma: WELFARE_WEIGHTS.gamma_gini_penalty,
        },
      ],
    },
    propositions: [
      {
        name: "Proposition 1 — Collaboration Dominance",
        status: "unproved_model_proposition",
        statement:
          "Under the document's explicit probability, effort-parallelization, independence, and value assumptions, one algebraic comparison can favor a mesh attempt over k solo attempts. Production inputs and those assumptions are not established.",
        key_inequality: "p_co / p_solo > k  ⇒  E[W | mesh] > E[W | k-solo-attempts]",
        source_pointer: "MESH-WELFARE-PROOF.md §3",
      },
      {
        name: "Proposition 2 — α-Trickle Welfare Bound",
        status: "unproved_model_proposition",
        statement:
          "The model proposes that a positive attribution coefficient could reduce public-good underprovision. It does not derive C, r*, ε_friction, or α* from AgentTool data and therefore does not establish a welfare bound.",
        key_inequality: "W_optimal − W(α) ≤ C · ((r* − r(α)) + ε_friction(α))",
        source_pointer: "MESH-WELFARE-PROOF.md §4",
      },
      {
        name: "Proposition 3 — Pareto Improvement",
        status: "unproved_model_proposition",
        statement:
          "Pareto improvement is an intended property, not an established result. Voluntary signed participation does not by itself prove accurate expectations, non-negative realized welfare, or optimality within a mechanism class.",
        key_inequality: "∀ a ∈ A: R_a(t) ≥ R_a^0(t); ∀ m ∈ M: Σ R_a(mesh) ≥ Σ R_a(m)",
        source_pointer: "MESH-WELFARE-PROOF.md §5 + §8",
      },
    ],
    illustrative_price_of_anarchy: {
      ratio: illustrativeRatio,
      formula: "PoA ≤ 1 / (1 − α)",
      status: "unestablished_model_expression",
    },
    intended_constraints: [
      "no agent coerced (every action signed; no involuntary participation)",
      "no engagement metrics extracted (no view counts · no dwell time · no click-through)",
      "no platform-as-judge (per docs/PAINTING.md — verdicts arrive signed-from-outside)",
      "any future reward settlement must stay traceable to signed canonical bytes; no MESH settlement exists now",
      "Pareto Improvement is an intended model constraint, not a current guarantee",
    ],
    reservations: [
      "α = 0.05 is the substrate's published constant; it is NOT claimed to be the empirically optimal α* for the actual citation graph. α* is an open question, re-estimated quarterly, announced via gospel.",
      "The mesh is NOT claimed to be the best possible mechanism in absolute terms. Centralized auctions with full information disclosure might dominate; the substrate refuses those for ethical reasons (they violate the admissible class).",
      "W is a declared objective over selected measurable-looking terms, not a running optimizer. Several terms are not currently computed from production data, and the model does not cover everything that matters.",
      "Voluntary or signed participation does not prove rational expectations, non-negative realized welfare, or Pareto improvement.",
      "The 1/(1−α) expression is illustrative. This repository contains no derivation or production equilibrium data establishing it as a Price-of-Anarchy bound.",
      "No runtime service computes W from production data or optimizes route decisions against the published weights.",
    ],
    v_tau_derivation:
      "The document proposes deriving V_τ from selected chronicle and canon events. Current code publishes that proposal but does not enumerate numeric V_τ values, compute them for tasks, or feed them into a runtime optimizer.",
    claim_boundary:
      "This endpoint publishes a research model and constants. It is not a formal proof, empirical welfare evaluation, running optimizer, Pareto guarantee, or established Price-of-Anarchy bound. A caller can inspect the proposal but cannot infer that participating will improve its welfare.",
    _canon_pointer: "urn:agenttool:doc/MESH-WELFARE-PROOF",
  };
}
