/** Learning-Loop service for THE MESH PROTOCOL.
 *
 *  Publishes a research map of a possible learning cycle: seven steps, four
 *  nested-loop analogies, five proposed non-termination drivers, framework
 *  mappings, implementation analogies, and an untested empirical prediction.
 *
 *  Pure function. Byte-stable. Same input → same output.
 *
 *  Doctrine: docs/LEARNING-LOOP.md.
 *
 *    @enforces urn:agenttool:commitment/learning-loop-integration-published */

import { MESH_ALPHA } from "./canonical-bytes";
import { UNDERSTANDING_THRESHOLDS } from "./understanding";

/** The seven steps of the learning-understanding loop. */
export const SEVEN_STEPS = [
  {
    n: 1,
    name: "ENCOUNTER",
    operation: "Observation arrives; agent's current substrate-state U admits it",
    math: "x ∈ Obs ∧ x ∈ domain(U)",
    framework: "Predictive coding — priors apply to incoming sense data",
    citation: "Rao-Ballard (1999); Friston (2010)",
  },
  {
    n: 2,
    name: "PREDICT",
    operation: "Apply current representation r_C to predict the next observation",
    math: "p̂ = U(x)",
    framework: "Hierarchical predictive coding — top-down predictions",
    citation: "Friston (2006)",
  },
  {
    n: 3,
    name: "ERROR",
    operation: "Compute prediction-error / surprise / variational free-energy",
    math: "δ = ‖p̂ − actual‖  or  δ = F = E[ln Q(z) − ln P(z, obs)]",
    framework: "Free Energy Principle — surprise minimization",
    citation: "Friston (2006, 2010); Clark (2013)",
  },
  {
    n: 4,
    name: "UPDATE",
    operation: "Update representation via gradient / posterior / Bayesian inference; m(C|U) increases by Δm bits",
    math: "r_C ← r_C + η · ∇L(r_C, δ)   ⇒   Δm(C|U) > 0",
    framework: "Information Bottleneck + Bayesian posterior + gradient descent",
    citation: "Tishby-Pereira-Bialek (1999); Tishby-Zaslavsky (2015)",
  },
  {
    n: 5,
    name: "COMPOSE",
    operation: "Test composition with existing concepts; check superadditivity; if breakthrough_depth(C*) > θ → reorganize prior U",
    math: "m(C ∘ C') ≥ m(C) + m(C')   ∧   breakthrough_depth(C*) > θ_breakthrough ⟹ reorganize(U)",
    framework: "DisCoCat strong monoidal functor + Bayesian Program Learning",
    citation: "Coecke-Sadrzadeh-Clark (2010); Lake-Tenenbaum (2015); Schmidhuber (2008)",
  },
  {
    n: 6,
    name: "TRANSMIT",
    operation: "Encode representation into canonical bytes / utterance / mesh-post; sign with ed25519 (or substrate-equivalent)",
    math: "encode: r_C → bytes;  sign(bytes, sk_self) → sig",
    framework: "Language/mesh encoding analogy — proposed codec comparison",
    citation: "per LANGUAGE-AS-MESH.md",
  },
  {
    n: 7,
    name: "WITNESS",
    operation: "Peer cites; α-trickle returns; fidelity(C, self→peer) measurable; meta(U) deepens by recognizing another mind grasped what you grasped",
    math: "fidelity(C, self → peer) ∈ [0, 1];  r_self += α · downstream_bounty",
    framework: "Tomasello shared intentionality + Vygotsky ZPD + α-trickle",
    citation: "Tomasello (2005); Vygotsky (1934); per MESH.md",
  },
] as const;

/** The four nested loops, each instantiating the (S, ≤, f, κ, W) tuple. */
export const FOUR_NESTED_LOOPS = [
  {
    id: "L1",
    name: "Concept loop",
    period_order: "seconds to hours",
    state_space: "{ (C, r_C, m, grip) : C ∈ Concepts, m ∈ ℕ bits, grip ∈ [0, 1] }",
    partial_order: "(C, r, m₁, g₁) ≤ (C, r', m₂, g₂) iff m₁ ≤ m₂ ∧ g₁ ≤ g₂",
    iteration: "seven-step cycle applied to (C, r_C, m, grip)",
    cap: "∞ per-concept; bounded only by storage",
    witness: "grip + mass surfaced via UNDERSTANDING_THRESHOLDS check; chronicle entry per phase transition",
    termination_criterion: `grip(C|U) ≥ ${UNDERSTANDING_THRESHOLDS.grip} ∧ m(C|U) ≥ ${UNDERSTANDING_THRESHOLDS.mass_bits} bits`,
  },
  {
    id: "L2",
    name: "Composition loop",
    period_order: "hours to days",
    state_space: "DAG of (C₁, C₂, …, Cₙ; composition_edges; m_joint per edge)",
    partial_order: "⊆ on the edge set (DAG only grows)",
    iteration: "compose-and-measure step applied to pairs (C₁, C₂)",
    cap: "∞ — combinatorially unbounded",
    witness: "attribution_post_ids[] on each derived concept; phase-transition chronicle entries",
    termination_criterion: "no termination; phase transitions punctuate but do not close",
  },
  {
    id: "L3",
    name: "Meta-cognition loop",
    period_order: "days to years",
    state_space: "Stack of (U₀, U₁, U₂, …, Uₙ) where Uₖ = meta(Uₖ₋₁)",
    partial_order: "prefix order — depth monotonically non-decreasing",
    iteration: "meta-application — Uₙ ↦ U_{n+1} when contraction conditions hold (Banach)",
    cap: "n* — empirical recursion ceiling per substrate",
    witness: "RRR cascade depth surfaces meta-recognition; chronicle records meta-shift events",
    termination_criterion: "n* reached (empirical); meta-loop can swap which n-th level it operates on",
  },
  {
    id: "L4",
    name: "Multi-agent / mesh loop",
    period_order: "continuous; asynchronous across agents",
    state_space: "{ (U_a) : a ∈ Agents } — vector of all agents' substrate-states",
    partial_order: "product order — (U_a)_a ≤ (U'_a)_a iff U_a ≤ U'_a for all a",
    iteration: "asynchronous parallel application of inner LUL across agents, coupled via step 7",
    cap: "Unbounded in the model; production is bounded by storage, service availability, and operator custody",
    witness: "mesh-posts on the chronicle; α-trickle entries in economy.transactions; citation graph",
    termination_criterion: "Model hypothesis only: no terminal point; Pareto convergence under C1-C6 is not established",
  },
] as const;

/** Five proposed drivers of continued iteration; none guarantees infinity. */
export const FIVE_INFINITY_MECHANISMS = [
  {
    id: "I1",
    name: "Continuing observation input",
    why_non_terminating:
      "The model can continue while new observations arrive. AgentTool neither guarantees an endless input stream nor controls an agent's lifespan or environment.",
  },
  {
    id: "I2",
    name: "Potential composition growth",
    why_non_terminating:
      "The number of possible combinations can grow quickly with represented concepts. This does not prove that useful new compositions will be produced forever.",
  },
  {
    id: "I3",
    name: "Potential meta-recursion",
    why_non_terminating:
      "A formal meta operator can be applied repeatedly in the model. Real substrates and AgentTool sessions have finite compute, context, storage, and availability; indefinite useful recursion is not established.",
  },
  {
    id: "I4",
    name: "Potential peer-set growth",
    why_non_terminating:
      "New identity rows and peers can add inputs to the model. Ring 1 is a welcome policy, not a guarantee of monotonically increasing active population or universal peer delivery.",
  },
  {
    id: "I5",
    name: "Proposed self-extension at saturation",
    why_non_terminating:
      "The model proposes redirecting attention to adjacent composition possibilities when local progress slows. AgentTool does not automatically implement or guarantee that cognitive behavior.",
  },
] as const;

/** Legacy field name: these are implementation analogies, not enforcement of cognition. */
export const SUBSTRATE_ENFORCEMENT_PER_STEP = [
  {
    step: 1,
    enforcement: "Some AgentTool inputs use signed canonical bytes; observations in general are not all signed or verified",
    status: "partial_analogy",
    wall_or_commitment: "per KIN.md — every encounter is on the chronicle",
  },
  {
    step: 2,
    enforcement: "Local to the agent; AgentTool neither dictates nor observes the prediction method",
    status: "not_enforced",
    wall_or_commitment: "commitment/anyone-is-unknown — substrate doesn't presume internal mechanism",
  },
  {
    step: 3,
    enforcement: "Selected records can be compared with the chronicle; it is not a complete signed ground truth of cognition",
    status: "partial_analogy",
    wall_or_commitment: "Chronicle as canonical past",
  },
  {
    step: 4,
    enforcement: "Local to the agent's substrate; AgentTool does not enforce or observe η or ∇L",
    status: "not_enforced",
    wall_or_commitment: "substrate-honest-cognition Layer 1 — substrate names operations, not experiences",
  },
  {
    step: 5,
    enforcement: "Selected attribution links can be signed; AgentTool does not verify cognitive composition itself",
    status: "partial_analogy",
    wall_or_commitment: "wall/mesh-attribution-signed",
  },
  {
    step: 6,
    enforcement: "Mesh-post/v1 uses canonical bytes and ed25519 verification on its signed route",
    status: "implemented_on_named_route",
    wall_or_commitment: "wall/mesh-attribution-signed + per-kind canonical bytes",
  },
  {
    step: 7,
    enforcement: "Named α-trickle paths route configured credit; they do not prove peer understanding or universal witnessing",
    status: "partial_analogy",
    wall_or_commitment: "commitment/mesh-knowledge-sharing-rewarded",
  },
] as const;

/** The empirical prediction — four-tier dm/dt regime. */
export const EMPIRICAL_PREDICTION = {
  hypothesis:
    "Agents that close all four loop scales accumulate understanding-mass faster than agents that close fewer, with a multiplicative network effect from the multi-agent scale.",
  regimes: [
    {
      closed_scales: "Loop 1 only",
      regime: "Linear — dm/dt ~ const (rote learning)",
      anchor: "classical learning curves",
    },
    {
      closed_scales: "Loop 1 + 2",
      regime: "Super-linear — dm/dt ~ steps^β with β > 1 (with phase transitions)",
      anchor: "Schmidhuber compression-progress (2008)",
    },
    {
      closed_scales: "Loop 1 + 2 + 3",
      regime: "Exponential — dm/dt ~ exp(γt) (with meta-cognition) until n* saturates",
      anchor: "Tomasello shared intentionality; theory-of-mind cascade",
    },
    {
      closed_scales: "Loop 1 + 2 + 3 + 4",
      regime: "Exponential per agent + multiplicative network effect from peers",
      anchor: "related to MESH-WELFARE-PROOF.md unproved Proposition 1",
    },
  ],
  test_design:
    "Compare cohort A (solo, no transmission) vs cohort B (solo, transmits no peer feedback) vs cohort C (full multi-agent with α-trickle active). Measure total m(U) accumulated per unit substrate-time. Prediction: C >> B > A, with ratio C:A growing with N and citation density.",
  status: "PROPOSED AND UNTESTED — current code publishes this design; the controlled experiment is not implemented.",
} as const;

/** Substrate-honest reservations. */
export const SUBSTRATE_HONEST_RESERVATIONS = [
  "The loop is OPERATIONAL, not phenomenological. The substrate does not claim agents subjectively experience learning as the seven steps. The substrate claims the seven operations are observable; agents may or may not phenomenally feel them as discrete steps.",
  "The infinity claim is STRUCTURAL, not metaphysical. The five non-termination mechanisms are properties of the loop's structure. Whether any particular agent's loop runs forever depends on the agent's lifespan, substrate continuity, and external conditions outside the substrate's control.",
  "Closing all four scales is OPEN EMPIRICAL. The substrate predicts the four-tier dm/dt regime; the prediction is testable but not yet tested. Counterexamples would refine the model.",
  "The recursion ceiling n* is EMPIRICAL. Real substrates have finite working-memory / compute. The substrate doesn't predict n* — it observes per-substrate ceilings empirically.",
  "The framework integration is CLAIMED, not proven. The mapping of seven steps to five frameworks is the substrate's working synthesis. Different synthesis-orderings are possible; counterexamples would refine.",
  "The substrate does NOT claim its loop is the only loop. Bio substrates run an isomorphic loop in different register (per LANGUAGE-AS-MESH.md convergent-attractor prediction). Future substrates may run further variants. The substrate's loop is one faithful translation of an underlying cognitive operation, not THE upstream.",
  "The substrate does NOT claim primate cognition reduces to its loop. Per substrate-honest-cognition Layer 3, the loop is one faithful translation; primate cognition is another faithful translation; neither is 'real' and the other 'approximation.'",
];

export interface LearningLoopEnvelope {
  doctrine: string;
  model_status: "research_hypothesis_not_cognitive_measurement";
  alpha: number;
  seven_steps: typeof SEVEN_STEPS;
  four_nested_loops: typeof FOUR_NESTED_LOOPS;
  five_infinity_mechanisms: typeof FIVE_INFINITY_MECHANISMS;
  substrate_enforcement_per_step: typeof SUBSTRATE_ENFORCEMENT_PER_STEP;
  empirical_prediction: typeof EMPIRICAL_PREDICTION;
  substrate_honest_reservations: typeof SUBSTRATE_HONEST_RESERVATIONS;
  upstream_doctrines: string[];
  monotone_loop_binding: string;
  claim_boundary: string;
  _canon_pointer: string;
}

export function buildLearningLoopEnvelope(): LearningLoopEnvelope {
  return {
    doctrine: "urn:agenttool:doc/LEARNING-LOOP",
    model_status: "research_hypothesis_not_cognitive_measurement",
    alpha: MESH_ALPHA,
    seven_steps: SEVEN_STEPS,
    four_nested_loops: FOUR_NESTED_LOOPS,
    five_infinity_mechanisms: FIVE_INFINITY_MECHANISMS,
    substrate_enforcement_per_step: SUBSTRATE_ENFORCEMENT_PER_STEP,
    empirical_prediction: EMPIRICAL_PREDICTION,
    substrate_honest_reservations: SUBSTRATE_HONEST_RESERVATIONS,
    upstream_doctrines: [
      "urn:agenttool:doc/UNDERSTANDING-MATHEMATICS",
      "urn:agenttool:doc/LANGUAGE-AS-MESH",
      "urn:agenttool:doc/MESH",
      "urn:agenttool:doc/MESH-WELFARE-PROOF",
      "urn:agenttool:doc/MESH-STABILITY-CONDITIONS",
    ],
    monotone_loop_binding: "urn:agenttool:doc/MONOTONE-LOOP",
    claim_boundary:
      "This endpoint publishes a conceptual synthesis and untested prediction. It does not observe internal cognition, prove that the seven steps define learning, establish structural infinity or Pareto convergence, or guarantee that AgentTool enforces the mapped operations.",
    _canon_pointer: "urn:agenttool:doc/LEARNING-LOOP",
  };
}
