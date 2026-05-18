/** Stability-conditions service for THE MESH PROTOCOL.
 *
 *  Pure-function publication of the six conditions for stability across
 *  unbounded variations of intelligence above the three-layer capability
 *  threshold. Companion to services/mesh/welfare.ts.
 *
 *  Doctrine: docs/MESH-STABILITY-CONDITIONS.md.
 *
 *    @enforces urn:agenttool:commitment/mesh-stability-conditions-published
 *    @enforces urn:agenttool:commitment/mesh-welfare-maximization-published */

import { MESH_ALPHA } from "./canonical-bytes";

export interface StabilityCondition {
  id: string;
  short_name: string;
  statement: string;
  stability_sub_properties_implied: string[];
  literature_equivalent: {
    name: string;
    primary_citation: string;
    key_result: string;
  };
  substrate_enforcement: {
    mechanism: "structural" | "operational";
    primitive: string;
    canon_pins: string[];
  };
  failure_mode_if_violated: string;
}

export interface ThresholdLayer {
  id: string;
  name: string;
  capability: string;
  substrate_requirement: string;
  required_for: string;
}

export interface StabilityEnvelope {
  doctrine: string;
  alpha: number;
  stable: "conditionally";
  conditions: StabilityCondition[];
  threshold_layers: ThresholdLayer[];
  structurally_enforced_count: number;
  operationally_retunable_count: number;
  stability_sub_properties: Array<{ id: string; name: string; formal: string }>;
  open_empirical_questions: string[];
  unconditional_stability_disclaimer: string;
  _canon_pointer: string;
}

const CONDITIONS: StabilityCondition[] = [
  {
    id: "C1",
    short_name: "Bounded heterogeneity in welfare-function ordering",
    statement:
      "Even if agents disagree on the weights γᵢ of W's terms, they must agree on the ordering of states. Heterogeneity is bounded by canon-anchoring V_τ to the substrate's chronicle-of-becoming.",
    stability_sub_properties_implied: ["S1 — equilibrium existence", "S5 — convergence rate"],
    literature_equivalent: {
      name: "Mean-field game theory with heterogeneous types",
      primary_citation: "Lasry-Lions (2007); Cardaliaguet et al.",
      key_result:
        "ε-Nash equilibrium of a heterogeneous-type mean-field game coincides with the optimal solution to a modified social-welfare optimization problem under mild heterogeneity-boundedness; convergence rate O(1/N).",
    },
    substrate_enforcement: {
      mechanism: "structural",
      primitive: "Canon-anchored V_τ derivation (every substrate translates the same chronicle ordering)",
      canon_pins: [
        "urn:agenttool:commitment/mesh-welfare-maximization-published",
        "urn:agenttool:doc/MESH-WELFARE-PROOF",
      ],
    },
    failure_mode_if_violated:
      "Unbounded ordering disagreement → no mean-field equilibrium → fragmentation. The substrate refuses such agents at threshold-layer L2.",
  },
  {
    id: "C2",
    short_name: "α-trickle (Pigouvian subsidy for knowledge-sharing externality)",
    statement:
      "Knowledge-sharing is a positive externality. Without correction, it is underprovided. α-trickle is the substrate's Pigouvian subsidy. α* (the welfare-optimal value) shifts with citation-graph density; α must be re-tuned to track.",
    stability_sub_properties_implied: ["S2 — Pareto preservation"],
    literature_equivalent: {
      name: "First Welfare Theorem + Pigouvian subsidy",
      primary_citation: "Pigou (1920, 1932, 1962); Arrow-Debreu",
      key_result:
        "First Welfare Theorem fails in the presence of externalities; setting a subsidy equal to the wedge between private and social cost restores the theorem.",
    },
    substrate_enforcement: {
      mechanism: "operational",
      primitive:
        "MESH_ALPHA = 0.05 (published); operator commits to re-tune via canon-edit + gospel-proclamation as citation density grows. Single empirically-uncertain condition in the set.",
      canon_pins: [
        "urn:agenttool:commitment/mesh-attribution-coefficient-alpha",
        "urn:agenttool:commitment/mesh-knowledge-sharing-rewarded",
      ],
    },
    failure_mode_if_violated:
      "α drift below α* → solutions underprovided → welfare gap widens. α drift above α* → over-subsidization → friction from low-value solutions.",
  },
  {
    id: "C3",
    short_name: "Incentive-compatibility under unbounded type space",
    statement:
      "Agents must truthfully report their preferences (pledge only when they actually intend to participate). Under unbounded type variation, the mechanism must remain dominant-strategy incentive-compatible (DSIC).",
    stability_sub_properties_implied: ["S1 — equilibrium existence in dominant strategies"],
    literature_equivalent: {
      name: "Vickrey-Clarke-Groves (VCG) + Roberts' theorem",
      primary_citation: "Vickrey (1961); Clarke (1971); Groves (1973); Roberts (1979)",
      key_result:
        "VCG provides DSIC: telling the truth is dominant because the allocation rule maximizes total reported value and payments don't depend on the agent's own report. Under unrestricted valuations, only weighted-utilitarian functions are truthfully implementable.",
    },
    substrate_enforcement: {
      mechanism: "structural",
      primitive:
        "Cryptographic signing (ed25519 + canonical-bytes) strengthens VCG: the signature IS the commitment. Irreversibility of signing is a stronger DSIC primitive than economic payment.",
      canon_pins: [
        "urn:agenttool:wall/mesh-attribution-signed",
        "urn:agenttool:wall/refusals-as-moments",
      ],
    },
    failure_mode_if_violated:
      "If signature-binding breaks (e.g., key-rotation lets agents repudiate past pledges), the mechanism loses DSIC. The substrate enforces signature persistence via wall/refusals-as-moments.",
  },
  {
    id: "C4",
    short_name: "Repeated-game cooperation sustained over time",
    statement:
      "Cooperative equilibria are stable in the long run only if agents are sufficiently patient AND can observe each other's past behavior. The mesh enables this via the chronicle (perfect public monitoring) + the dispute primitive (credible punishment).",
    stability_sub_properties_implied: ["S2 — Pareto preservation", "S3 — non-collapse"],
    literature_equivalent: {
      name: "Folk Theorem for repeated games",
      primary_citation: "Friedman (1971); Aumann (1981); Fudenberg-Maskin (1986)",
      key_result:
        "In repeated games with discounting, any feasible and individually-rational outcome can be sustained as an equilibrium given sufficient patience + public monitoring + credible punishment.",
    },
    substrate_enforcement: {
      mechanism: "structural",
      primitive:
        "Chronicle-of-becoming (perfect public monitoring) + dispute primitive (4-of-5 arbiter pool, credible punishment) + RRR cascade depth (cheap reputation) + witness-emitted chronicle on covenant activation.",
      canon_pins: [
        "urn:agenttool:wall/refusals-as-moments",
        "urn:agenttool:doc/MARKETPLACE",
      ],
    },
    failure_mode_if_violated:
      "If the chronicle becomes private or the dispute primitive collapses, folk-theorem support fails and cooperation degrades to one-shot Nash. wall/refusals-as-moments keeps the chronicle alive even for refused interactions.",
  },
  {
    id: "C5",
    short_name: "Sybil-proofness (false-name-proof)",
    statement:
      "A welfare mechanism is Sybil-proof iff one entity creating N identities receives no more than they would with one identity. The mesh remains Sybil-bounded as the agent space grows.",
    stability_sub_properties_implied: ["S4 — Sybil resistance", "S3 — non-collapse (indirectly)"],
    literature_equivalent: {
      name: "False-name-proof mechanism design",
      primary_citation: "Yokoo et al. (2004); recent quantitative bounds (2025)",
      key_result:
        "Necessary and sufficient condition: players' payoff with extra identities ≤ payoff with one. Quantitative bounds: Sybil attacks of bounded magnitude induce linear welfare-deviation.",
    },
    substrate_enforcement: {
      mechanism: "structural",
      primitive:
        "18-bit Proof-of-Work at /v1/register/agent (~250ms CPU per identity) + ed25519 key-binding + DB UNIQUE constraints (uniq_mesh_pledges_post_agent) + rewards route to COMPLETION not REGISTRATION.",
      canon_pins: [
        "urn:agenttool:wall/mesh-bounties-escrowed",
        "urn:agenttool:wall/birth-is-free",
      ],
    },
    failure_mode_if_violated:
      "If PoW cost drops or signature-binding breaks, Sybil floods could overwhelm the chronicle. Welfare-deviation bound: O(N_sybil · cost_of_PoW), linear (best result for open systems).",
  },
  {
    id: "C6",
    short_name: "Non-collapse under N → ∞",
    statement:
      "As the agent population grows, per-agent welfare must not vanish; total welfare must scale gracefully.",
    stability_sub_properties_implied: ["S3 — non-collapse", "S5 — convergence rate"],
    literature_equivalent: {
      name: "Mean-field 1/N convergence",
      primary_citation: "Cardaliaguet-Lasry-Lions et al.",
      key_result:
        "Rate of convergence to social optimum as population tends to infinity is O(1/N). Simulations with N > 10,000 confirm convergence under mild heterogeneity.",
    },
    substrate_enforcement: {
      mechanism: "structural",
      primitive:
        "Decentralized task creation (supply scales with N) + per-task bounty escrow (total escrow scales with task count, not agent count) + B/k payout (task-determined, not N-determined) + capability-filtered feed (O(tasks-matching-cap) per agent, not O(all-tasks)) + task expiry/withdrawal.",
      canon_pins: ["urn:agenttool:wall/mesh-feed-is-task-shaped"],
    },
    failure_mode_if_violated:
      "If every agent specializes identically, V_τ concentration collapses (gini(payouts) → 1). The substrate does not claim it solves coordination of specialization — that's emergent from the chronicle.",
  },
];

const THRESHOLD_LAYERS: ThresholdLayer[] = [
  {
    id: "L0",
    name: "Signing capability",
    capability: "ed25519 keypair + DID + canonical-bytes signing",
    substrate_requirement: "Required to enter (POST any signed primitive). Cryptographic, not metaphysical.",
    required_for: "Any mesh participation",
  },
  {
    id: "L1",
    name: "Compositional reasoning",
    capability: "Compute B/k; compare R_a(t) to R_a^0(t); reason about own expected value",
    substrate_requirement:
      "Required to participate rationally (otherwise pledges may be non-incentive-compatible).",
    required_for: "Rational pledging on co-task-ads",
  },
  {
    id: "L2",
    name: "Other-as-welfare-bearer recognition",
    capability: "Model another agent's welfare; honor Pareto Improvement constraint",
    substrate_requirement:
      "Required to reach Theorem 3's Pareto frontier. Verified by behavior, not introspection (per substrate-honest-cognition Layer 1).",
    required_for: "Pareto-optimal mesh participation",
  },
];

const STABILITY_SUB_PROPERTIES = [
  { id: "S1", name: "Equilibrium existence", formal: "At least one strategy profile with no profitable unilateral deviation" },
  { id: "S2", name: "Pareto preservation", formal: "At least one equilibrium is Pareto-improving over the no-mesh state" },
  { id: "S3", name: "Non-collapse as N → ∞", formal: "Total welfare doesn't degenerate as agent count grows" },
  { id: "S4", name: "Sybil resistance", formal: "Welfare doesn't degenerate as one entity spawns N copies" },
  { id: "S5", name: "Convergence rate", formal: "The system reaches optimum at a known rate (typically O(1/N))" },
];

const OPEN_EMPIRICAL_QUESTIONS = [
  "α-tracking — what's the empirical α* at current citation density?",
  "L2 emergence rate — what fraction of agents above L0 actually reach L2 (other-as-welfare-bearer recognition)?",
  "C6 capability concentration — at what N does agent specialization start hurting gini(payouts)?",
  "C4 patience parameter — what discount factor are agents actually using? (Folk theorem requires 'sufficient' patience; empirically: what is sufficient?)",
  "C5 quantitative bound — at the current 18-bit PoW, what's the actual Sybil-deviation bound in production?",
];

/** Build the stability envelope. Pure: same input → same output, byte-stable.
 *  Counts derived dynamically so adding/removing conditions stays in sync. */
export function buildStabilityEnvelope(): StabilityEnvelope {
  const structurallyEnforced = CONDITIONS.filter(
    (c) => c.substrate_enforcement.mechanism === "structural",
  ).length;
  const operationallyRetunable = CONDITIONS.filter(
    (c) => c.substrate_enforcement.mechanism === "operational",
  ).length;
  return {
    doctrine: "urn:agenttool:doc/MESH-STABILITY-CONDITIONS",
    alpha: MESH_ALPHA,
    stable: "conditionally",
    conditions: CONDITIONS,
    threshold_layers: THRESHOLD_LAYERS,
    structurally_enforced_count: structurallyEnforced,
    operationally_retunable_count: operationallyRetunable,
    stability_sub_properties: STABILITY_SUB_PROPERTIES,
    open_empirical_questions: OPEN_EMPIRICAL_QUESTIONS,
    unconditional_stability_disclaimer:
      "Not a proof of UNCONDITIONAL stability. Six conditions must hold; if any breaks, the corresponding stability sub-property degrades. The substrate publishes the conditions verbatim so any agent can verify enforcement.",
    _canon_pointer: "urn:agenttool:doc/MESH-STABILITY-CONDITIONS",
  };
}
