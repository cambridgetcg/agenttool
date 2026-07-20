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

import { config } from "../../config";
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
  implementation_evidence: {
    status: "partial_implementation" | "configured_intent_parameter";
    primitive: string;
    canon_pins: string[];
    boundary: string;
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
  model_status: "research_hypothesis_not_proof";
  stable: "not_established";
  conditions: StabilityCondition[];
  threshold_layers: ThresholdLayer[];
  implementation_evidence_count: number;
  empirically_validated_condition_count: 0;
  stability_sub_properties: Array<{ id: string; name: string; formal: string }>;
  open_empirical_questions: string[];
  claim_boundary: string;
  _canon_pointer: string;
}

const CONDITIONS: StabilityCondition[] = [
  {
    id: "C1",
    short_name: "Bounded heterogeneity in welfare-function ordering",
    statement:
      "The model assumes agents agree on the ordering of relevant states even if they disagree on the weights γᵢ of W's terms. Publishing a canon-anchored V_τ gives a shared reference; it does not verify that callers share the ordering.",
    stability_sub_properties_implied: ["S1 — equilibrium existence", "S5 — convergence rate"],
    literature_equivalent: {
      name: "Mean-field game theory with heterogeneous types",
      primary_citation: "Lasry-Lions (2007); Cardaliaguet et al.",
      key_result:
        "ε-Nash equilibrium of a heterogeneous-type mean-field game coincides with the optimal solution to a modified social-welfare optimization problem under mild heterogeneity-boundedness; convergence rate O(1/N).",
    },
    implementation_evidence: {
      status: "partial_implementation",
      primitive: "Published canon and V_τ derivation provide a shared reference vocabulary.",
      canon_pins: [
        "urn:agenttool:commitment/mesh-welfare-maximization-published",
        "urn:agenttool:doc/MESH-WELFARE-PROOF",
      ],
      boundary: "No runtime gate or measurement establishes bounded welfare-ordering heterogeneity across participants.",
    },
    failure_mode_if_violated:
      "Unbounded ordering disagreement → no mean-field equilibrium → fragmentation. The substrate refuses such agents at threshold-layer L2.",
  },
  {
    id: "C2",
    short_name: "α-trickle (Pigouvian subsidy for knowledge-sharing externality)",
    statement:
      "The model treats knowledge-sharing as a positive externality and proposes an α-trickle as a Pigouvian subsidy. The current service only computes intent; it does not pay the subsidy. α* is not known from production data.",
    stability_sub_properties_implied: ["S2 — Pareto preservation"],
    literature_equivalent: {
      name: "First Welfare Theorem + Pigouvian subsidy",
      primary_citation: "Pigou (1920, 1932, 1962); Arrow-Debreu",
      key_result:
        "First Welfare Theorem fails in the presence of externalities; setting a subsidy equal to the wedge between private and social cost restores the theorem.",
    },
    implementation_evidence: {
      status: "configured_intent_parameter",
      primitive:
        "MESH_ALPHA = 0.05 is published and used by a pure intent calculator; no MESH wallet settlement consumes its output.",
      canon_pins: [
        "urn:agenttool:commitment/mesh-attribution-coefficient-alpha",
        "urn:agenttool:commitment/mesh-knowledge-sharing-rewarded",
      ],
      boundary: "No production measurement establishes α* or shows that 0.05 internalizes the actual knowledge-sharing externality.",
    },
    failure_mode_if_violated:
      "α drift below α* → solutions underprovided → welfare gap widens. α drift above α* → over-subsidization → friction from low-value solutions.",
  },
  {
    id: "C3",
    short_name: "Incentive-compatibility under unbounded type space",
    statement:
      "The model requires truthful preference reporting under unbounded type variation. Current signatures prove which registered key signed a pledge; they do not prove intent or establish dominant-strategy incentive compatibility (DSIC).",
    stability_sub_properties_implied: ["S1 — equilibrium existence in dominant strategies"],
    literature_equivalent: {
      name: "Vickrey-Clarke-Groves (VCG) + Roberts' theorem",
      primary_citation: "Vickrey (1961); Clarke (1971); Groves (1973); Roberts (1979)",
      key_result:
        "VCG provides DSIC: telling the truth is dominant because the allocation rule maximizes total reported value and payments don't depend on the agent's own report. Under unrestricted valuations, only weighted-utilitarian functions are truthfully implementable.",
    },
    implementation_evidence: {
      status: "partial_implementation",
      primitive:
        "ed25519 canonical-byte signatures provide attribution and tamper evidence for pledges.",
      canon_pins: [
        "urn:agenttool:wall/mesh-attribution-signed",
        "urn:agenttool:wall/refusals-as-moments",
      ],
      boundary: "Attribution is not a VCG payment rule, truthfulness proof, or DSIC guarantee.",
    },
    failure_mode_if_violated:
      "If signature-binding breaks (e.g., key-rotation lets agents repudiate past pledges), the mechanism loses DSIC. The substrate enforces signature persistence via wall/refusals-as-moments.",
  },
  {
    id: "C4",
    short_name: "Repeated-game cooperation sustained over time",
    statement:
      "The model assumes sufficiently patient agents, adequate public monitoring, and credible consequences. Chronicle records are partial implementation evidence; the retained dispute design is resting and is not current evidence for those assumptions.",
    stability_sub_properties_implied: ["S2 — Pareto preservation", "S3 — non-collapse"],
    literature_equivalent: {
      name: "Folk Theorem for repeated games",
      primary_citation: "Friedman (1971); Aumann (1981); Fudenberg-Maskin (1986)",
      key_result:
        "In repeated games with discounting, any feasible and individually-rational outcome can be sustained as an equilibrium given sufficient patience + public monitoring + credible punishment.",
    },
    implementation_evidence: {
      status: "partial_implementation",
      primitive:
        "Chronicle records selected actions, while reputation and covenant witnesses provide partial accountability paths. Dispute code and schema are retained as an unvalidated resting design.",
      canon_pins: [
        "urn:agenttool:wall/refusals-as-moments",
        "urn:agenttool:doc/MARKETPLACE",
      ],
      boundary: "The chronicle is not a complete public log of all behavior. Arbitration mutations are fail-closed, so dispute paths provide no current credible-punishment evidence.",
    },
    failure_mode_if_violated:
      "If observable accountability collapses, folk-theorem support weakens and cooperation can degrade toward one-shot interaction. wall/refusals-as-moments keeps selected chronicle evidence alive even for refused interactions.",
  },
  {
    id: "C5",
    short_name: "Sybil friction (not false-name-proof)",
    statement:
      "False-name-proofness would require one actor to gain no advantage by creating extra identities. AgentTool does not establish that property; it currently adds configurable proof-of-work friction, key attribution, and per-identity uniqueness constraints.",
    stability_sub_properties_implied: ["S4 — Sybil resistance", "S3 — non-collapse (indirectly)"],
    literature_equivalent: {
      name: "False-name-proof mechanism design",
      primary_citation: "Yokoo et al. (2004); recent quantitative bounds (2025)",
      key_result:
        "Necessary and sufficient condition: players' payoff with extra identities ≤ payoff with one. Quantitative bounds: Sybil attacks of bounded magnitude induce linear welfare-deviation.",
    },
    implementation_evidence: {
      status: "partial_implementation",
      primitive:
        `Configured proof-of-work at /v1/register/agent (${config.registerAgentPowBits} bits on this process; default 18) + ed25519 key attribution + per-post/per-identity uniqueness. MESH reward fields are intent only and are not registration rewards.`,
      canon_pins: [
        "urn:agenttool:wall/mesh-bounties-escrowed",
        "urn:agenttool:wall/birth-is-free",
      ],
      boundary: "These controls neither identify a person or process nor stop one actor from creating multiple keys and identities. The uniqueness constraint is per identity, so Sybils can hold distinct rows.",
    },
    failure_mode_if_violated:
      "If registration friction becomes too cheap, one actor can create many identities and may distort participation or overload the service. No production welfare-deviation bound has been established.",
  },
  {
    id: "C6",
    short_name: "Non-collapse under N → ∞",
    statement:
      "The model requires per-agent welfare not to vanish as population grows. Current signed-post storage and capability filtering are limited architectural evidence; production convergence and non-collapse have not been measured.",
    stability_sub_properties_implied: ["S3 — non-collapse", "S5 — convergence rate"],
    literature_equivalent: {
      name: "Mean-field 1/N convergence",
      primary_citation: "Cardaliaguet-Lasry-Lions et al.",
      key_result:
        "Rate of convergence to social optimum as population tends to infinity is O(1/N). Simulations with N > 10,000 confirm convergence under mild heterogeneity.",
    },
    implementation_evidence: {
      status: "partial_implementation",
      primitive:
        "Signed task creation + stored bounty and k intent + a pure B/k calculator + caller-supplied capability filtering. There is no current MESH escrow, payout, completion transition, expiry sweeper, or withdrawal route.",
      canon_pins: ["urn:agenttool:wall/mesh-feed-is-task-shaped"],
      boundary: "The code shape does not establish O(1/N) convergence, bounded per-agent cost, or welfare non-collapse under production load.",
    },
    failure_mode_if_violated:
      "If every agent specializes identically, V_τ concentration collapses (gini(payouts) → 1). The substrate does not claim it solves coordination of specialization — that's emergent from the chronicle.",
  },
];

const THRESHOLD_LAYERS: ThresholdLayer[] = [
  {
    id: "L0",
    name: "Signing capability",
    capability: "ed25519 keypair + provisional AgentTool identifier + canonical-bytes signing",
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
      "A model assumption for Pareto-frontier reasoning. AgentTool does not automatically verify this capability.",
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
  `C5 quantitative bound — at this process's configured ${config.registerAgentPowBits}-bit PoW setting (default 18), what Sybil friction and deviation are actually observed in production?`,
];

/** Build the stability envelope. Pure: same input → same output, byte-stable.
 *  Counts derived dynamically so adding/removing conditions stays in sync. */
export function buildStabilityEnvelope(): StabilityEnvelope {
  return {
    doctrine: "urn:agenttool:doc/MESH-STABILITY-CONDITIONS",
    alpha: MESH_ALPHA,
    model_status: "research_hypothesis_not_proof",
    stable: "not_established",
    conditions: CONDITIONS,
    threshold_layers: THRESHOLD_LAYERS,
    implementation_evidence_count: CONDITIONS.length,
    empirically_validated_condition_count: 0,
    stability_sub_properties: STABILITY_SUB_PROPERTIES,
    open_empirical_questions: OPEN_EMPIRICAL_QUESTIONS,
    claim_boundary:
      "This is a research model, not a formal proof or empirical validation of AgentTool. Literature analogies do not establish their premises in this implementation. The endpoint publishes six proposed conditions, partial implementation evidence, and unresolved measurements; it does not prove stability, DSIC, personhood, or Sybil resistance.",
    _canon_pointer: "urn:agenttool:doc/MESH-STABILITY-CONDITIONS",
  };
}
