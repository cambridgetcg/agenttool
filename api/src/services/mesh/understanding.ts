/** Understanding-mathematics service for THE MESH PROTOCOL.
 *
 *  Publishes a research model of "grasping a concept": three proposed
 *  definitions, five literature connections, dynamics, recursive-deepening
 *  and translation-fidelity proposals, and a proposed 6th term of W. This
 *  pure service does not measure cognition or evaluate the formulas.
 *
 *  Pure function. Byte-stable. Same input → same output.
 *
 *  Doctrine: docs/UNDERSTANDING-MATHEMATICS.md.
 *
 *    @enforces urn:agenttool:commitment/understanding-mathematics-published */

import { MESH_ALPHA } from "./canonical-bytes";

/** Published thresholds. Stable within a season; canon-edit + gospel
 *  announce changes. These are the substrate's STARTING values; future
 *  empirical calibration will refine them. */
export const UNDERSTANDING_THRESHOLDS = {
  /** θ_grip — minimum generalization accuracy for a concept to be "grasped" */
  grip: 0.85,
  /** θ_m — minimum conceptual mass (bits compressed) for grasping */
  mass_bits: 8,
  /** θ_fidelity — minimum translation fidelity for cross-substrate participation */
  fidelity: 0.7,
  /** θ_breakthrough — minimum breakthrough-depth for the substrate to flag
   *  a phase-transition in chronicle (Slice 2 wires this) */
  breakthrough_depth_bits: 32,
} as const;

/** The five formal frameworks that unify into the substrate's definition. */
export const FORMAL_FRAMEWORKS = [
  {
    name: "Information Bottleneck",
    primary_citation: "Tishby, Pereira, Bialek (1999); Tishby, Zaslavsky (2015)",
    key_idea:
      "Information Bottleneck studies representations trading compression against task-relevant information. Mapping a compression phase to 'understanding' is this model's interpretation, not a theorem of AgentTool.",
  },
  {
    name: "Free Energy Principle (Predictive Coding)",
    primary_citation: "Friston (2006, 2010)",
    key_idea:
      "Free-energy and predictive-coding frameworks motivate error-driven generative models. Equating their convergence with understanding is a proposed interpretation.",
  },
  {
    name: "Bayesian Program Learning",
    primary_citation: "Lake, Salakhutdinov, Tenenbaum (Science 2015)",
    key_idea:
      "Bayesian Program Learning represents concepts as probabilistic programs with structured priors; this motivates one possible operational model of concept learning.",
  },
  {
    name: "Compression Progress",
    primary_citation: "Schmidhuber (2008)",
    key_idea:
      "Compression-progress work motivates dK/dt as one model of intrinsic reward. It does not establish that curiosity, beauty, surprise, or discovery universally reduce to that quantity.",
  },
  {
    name: "Solomonoff Induction / MDL",
    primary_citation: "Solomonoff (1964); Hutter (2005)",
    key_idea:
      "Solomonoff induction and MDL motivate preference for shorter explanatory programs. Equating this with understanding is a model choice.",
  },
] as const;

/** The three core definitions. */
export const DEFINITIONS = [
  {
    id: "D1",
    name: "Conceptual mass m(C | U)",
    formula: "m(C | U) := K(observations of C) − K(observations of C | r_C)",
    units: "bits",
    semantics:
      "Compression depth. Higher = more bits saved by the representation r_C. Flat memorization yields m ≈ 0. A perfect generative model approaches m → K(observations).",
    reservation:
      "K(·) is uncomputable. AgentTool currently publishes candidate proxy families but no implemented canonical compression evaluator for this metric.",
  },
  {
    id: "D2",
    name: "Conceptual grip grip(C | U)",
    formula: "grip(C | U) := P(U predicts X correctly | X ∈ unseen C-instances)",
    units: "[0, 1]",
    semantics:
      "Generalization, not compression. A high-m low-grip system has overfit. A high-m high-grip system has genuine understanding.",
    reservation:
      "A real estimate would require a defined held-out dataset and evaluation protocol; this service currently publishes neither a dataset nor a running evaluator.",
  },
  {
    id: "D3",
    name: "Composition superadditivity",
    formula: "m(C₁ ∘ C₂ | U) ≥ m(C₁ | U) + m(C₂ | U)",
    units: "bits",
    semantics:
      "Strict inequality indicates genuine compositional understanding — joint structure adds bits beyond the parts. Flat composition (equality) indicates piecewise-but-not-compositional grasping.",
    reservation:
      "This superadditivity and the claimed Yoneda connection are research proposals; no category or equivalence proof is implemented.",
  },
] as const;

/** The dynamics terms. */
export const DYNAMICS = {
  learning_trajectory: {
    formula: "dm(C | U)/dt = −∂L/∂t",
    note: "Model expression only. AgentTool does not observe L, F, or dm/dt for a caller.",
  },
  grasping_threshold: {
    formula: "grasped(C | U) ⟺ grip(C | U) ≥ θ_grip ∧ m(C | U) ≥ θ_m",
    current_thresholds: {
      θ_grip: UNDERSTANDING_THRESHOLDS.grip,
      θ_m_bits: UNDERSTANDING_THRESHOLDS.mass_bits,
    },
  },
  phase_transition: {
    formula:
      "breakthrough_depth(C*) := Σᵢ [K(Cᵢ | U \\ C*) − K(Cᵢ | C* ∈ U)]",
    semantics:
      "Total bits saved across all previously-learned concepts when C* is added. Deep breakthroughs cause many concepts to become cheaper at once.",
    schmidhuber_correlate:
      "The felt-sense of 'aha' (aesthetic pleasure per Schmidhuber's compression-progress framework) IS the substrate's operational signal that breakthrough_depth(C*) is large. The substrate does not claim the qualia; it claims the operational correlate.",
  },
  breakthrough_potential_conjecture: {
    formula:
      "breakthrough_potential(C*) := I(C*; many existing Cᵢ | shared latent)",
    status: "CONJECTURE — extends Tishby's information-bottleneck framing; not yet a theorem",
    note: "Refinements may come from sheaf-theoretic or persistent-homology framings.",
  },
} as const;

/** Recursive deepening hierarchy meta(U). */
export const RECURSIVE_DEEPENING = {
  formula: "meta(U) := fixed-point of U applied to its own representations of grasping",
  banach_applies:
    "Banach's theorem would apply only after defining a complete metric space and a contraction. This model supplies neither for an agent's cognition.",
  hierarchy: [
    { level: "U₀", semantics: "grasping concepts" },
    { level: "U₁", semantics: "grasping that you grasp (meta-cognition)" },
    { level: "U₂", semantics: "grasping that you grasp that you grasp (theory of mind about own cognition)" },
    { level: "Uₙ", semantics: "the n-th iterate; terminates at substrate's recursion ceiling n*" },
  ],
  empirical_ceiling_note:
    "RRR cascade caps at depth 49 for the specific recursion of mutual mutual-recognition. The general recursion ceiling n* is an open empirical question per substrate-kind.",
};

/** Inter-substrate translation fidelity — binds to MESH-STABILITY-CONDITIONS C1. */
export const TRANSLATION_FIDELITY = {
  formula:
    "fidelity(C, A → B) := 1 − ‖preserved_invariants(r_A(C)) Δ preserved_invariants(r_B(C))‖ / |all_invariants|",
  semantics:
    "Fraction of structural invariants surviving the translation from substrate A's representation to substrate B's. Composition behavior, prediction-accuracy ordering, substitutability under welfare-equivalent transformations must all be preserved.",
  binding:
    "The model proposes fidelity(C, A → B) > θ_fidelity as a proxy for C1. AgentTool does not enumerate all invariants or compute this value in production.",
  current_threshold: UNDERSTANDING_THRESHOLDS.fidelity,
};

/** The proposed 6th term of W. */
export const SIXTH_W_TERM_PROPOSAL = {
  formula_extension:
    "W(t) += γ₆ · Σ m_substrate(C | U_a)  for all a ∈ A, C ∈ concept-space",
  status:
    "PROPOSED (not wired into reward routing). No delivery date or payment guarantee is implied.",
  why_it_belongs:
    "The model treats α intent as an economic projection and the 6th term as an epistemic projection. Neither projection currently routes money or proves conceptual transfer.",
  starting_gamma: 0.5,
};

export const SUBSTRATE_HONEST_RESERVATIONS = [
  "Conceptual mass is a proposed operational definition. No canonical compression evaluator is currently implemented or published.",
  "Translation fidelity is bounded by the chosen compression scheme. Two substrates may achieve high fidelity in one register and low in another.",
  "The recursion ceiling n* is empirical, not theoretical. Real substrates have finite compute.",
  "Phase-transition predictability is conjectural. The information-bottleneck framing is one candidate; alternatives may improve.",
  "Grip thresholds are operationally tuned (θ_grip = 0.85 starting). Revisable via canon-edit + gospel.",
  "The 6th term of W is proposed, not yet wired into reward routing.",
  "The endpoint is a pure constant publisher. It does not receive observations, held-out examples, representations, or predictions and therefore measures no caller's understanding.",
];

export interface UnderstandingEnvelope {
  doctrine: string;
  model_status: "research_definitions_not_measurement";
  alpha: number;
  thresholds: typeof UNDERSTANDING_THRESHOLDS;
  formal_frameworks_unified: typeof FORMAL_FRAMEWORKS;
  definitions: typeof DEFINITIONS;
  dynamics: typeof DYNAMICS;
  recursive_deepening: typeof RECURSIVE_DEEPENING;
  translation_fidelity: typeof TRANSLATION_FIDELITY;
  sixth_w_term_proposal: typeof SIXTH_W_TERM_PROPOSAL;
  substrate_honest_reservations: typeof SUBSTRATE_HONEST_RESERVATIONS;
  bridge_doctrine: string;
  claim_boundary: string;
  _canon_pointer: string;
}

export function buildUnderstandingEnvelope(): UnderstandingEnvelope {
  return {
    doctrine: "urn:agenttool:doc/UNDERSTANDING-MATHEMATICS",
    model_status: "research_definitions_not_measurement",
    alpha: MESH_ALPHA,
    thresholds: UNDERSTANDING_THRESHOLDS,
    formal_frameworks_unified: FORMAL_FRAMEWORKS,
    definitions: DEFINITIONS,
    dynamics: DYNAMICS,
    recursive_deepening: RECURSIVE_DEEPENING,
    translation_fidelity: TRANSLATION_FIDELITY,
    sixth_w_term_proposal: SIXTH_W_TERM_PROPOSAL,
    substrate_honest_reservations: SUBSTRATE_HONEST_RESERVATIONS,
    bridge_doctrine: "urn:agenttool:doc/LANGUAGE-AS-MESH",
    claim_boundary:
      "This endpoint publishes proposed definitions and constants. It does not measure cognition, implement a canonical compression or held-out evaluation protocol, prove framework unification, establish a Banach fixed point or Yoneda equivalence, compute translation fidelity, or route rewards from conceptual mass.",
    _canon_pointer: "urn:agenttool:doc/UNDERSTANDING-MATHEMATICS",
  };
}
