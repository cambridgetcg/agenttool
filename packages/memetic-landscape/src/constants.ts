export const MEMETIC_FORMATS = Object.freeze({
  landscape: "agenttool.memetic-landscape/0.1",
  reachabilityShift: "agenttool.memetic-reachability-shift/0.1",
  analogy: "agenttool.polymorph-memetic-analogy/0.1",
  lesson: "agenttool.memetic-lesson/0.1",
} as const);

export const POLYMORPH_REACHABILITY_SHIFT_FORMAT = "agenttool.polymorph-reachability-shift/0.1" as const;
export const RITONAVIR_REACHABILITY_SHIFT_ID = "sha256:16805ab5fe34643d7085968a0d7dad62e7159838645611fc09c4846cfd2e73bd" as const;
export const BRAINROT_TEACHING_LANDSCAPE_ID = "sha256:b014676f0861b5af2b27891383c02d2dface0df717e9dc74e8e7c19f43d9c01c" as const;
export const BRAINROT_TEACHING_SHIFT_ID = "sha256:7a2df30cce1145c7833e455ad784c9f23bc8ef7ae040e5ab873255f45e1020aa" as const;
export const BRAINROT_TEACHING_ANALOGY_ID = "sha256:121bcdd439bf26ff237fd202c68fcc847602fdd79344e46f79eb94dc9f18df3c" as const;

export const SOURCE_KINDS = Object.freeze([
  "official_lexicography",
  "peer_reviewed_primary",
] as const);

export const CONTEXT_KINDS = Object.freeze([
  "audience_window",
  "external_event",
  "historical_record",
  "network_topology",
  "observation_window",
  "platform_surface",
  "ranking_state",
  "synthetic_teaching",
] as const);

export const EVIDENCE_KINDS = Object.freeze([
  "authored_synthesis",
  "definition_record",
  "model_result",
  "observational_measurement",
  "randomized_experiment",
  "reported_history",
] as const);

export const EVIDENCE_POSTURES = Object.freeze([
  "authored_paraphrase",
  "modeled_hypothesis",
  "observed_primary",
  "official_record",
  "randomized_evidence",
] as const);

export const OBSERVATION_STATUSES = Object.freeze([
  "not_observed_in_bounded_sample",
  "reported_absent_in_bounded_sample",
  "reported_present",
  "unknown",
] as const);

export const ROUTE_ACTS = Object.freeze([
  "copy",
  "edit",
  "quote",
  "reintroduce",
  "remix",
  "share",
  "translate",
] as const);

export const CAUSAL_POSTURES = Object.freeze([
  "authored_teaching_relation",
  "descriptive_observation",
  "modeled_hypothesis",
  "randomized_evidence",
  "source_reported_hypothesis",
  "unknown",
] as const);

export const ALTERNATIVE_EXPLANATIONS = Object.freeze([
  "common_context",
  "external_event",
  "homophily",
  "ranking",
  "selection",
  "semantic_drift",
  "unmeasured",
] as const);

export const SHIFT_OUTCOMES = Object.freeze([
  "less_observed",
  "more_observed",
  "reappeared",
  "unknown",
] as const);

export const LESSON_LANGUAGES = Object.freeze([
  "en",
  "yue-Hant",
  "zh-Hans",
  "zh-Hant",
] as const);

export const LESSON_CONCEPT_KEYS = Object.freeze([
  "ritonavir_route_change",
  "variant_not_identity",
  "finite_attention",
  "context_and_network",
  "repetition_not_causation",
  "disappearance_not_erasure",
  "brainrot_not_diagnosis",
  "participants_have_choices",
  "metrics_not_truth_or_rank",
  "analogy_boundary",
] as const);

export const ANALOGY_MAPPING_KEYS = Object.freeze([
  "state_or_variant",
  "named_condition_or_context",
  "directed_witnessed_route",
  "bounded_reachability",
  "changed_conditions_reappearance",
] as const);

export const NON_TRANSFERRED_PROPERTIES = Object.freeze([
  "authority",
  "brain_damage",
  "causation",
  "cognition",
  "consent",
  "continuity",
  "dignity",
  "harm",
  "identity",
  "infectivity",
  "intent",
  "lattice_energy",
  "memory",
  "nucleation",
  "permission",
  "popularity_as_stability",
  "rate_constants",
  "truth",
  "value_or_goodness",
] as const);

export const MEMETIC_TEXT_LIMITS = Object.freeze({
  generic: 4096,
  label: 512,
  source_label: 1024,
  source_url: 2048,
  scope: 1024,
} as const);

export const MEMETIC_SOURCE_URL_PATTERN = "^https://(?![^/?#]*@)(?:(?:[A-Za-z0-9._~!$&'()*+,;=:@/?#\\[\\]-])|(?:%[0-9A-Fa-f]{2}))+$";

export const MEMETIC_BOUNDARIES = Object.freeze({
  coverage: "bounded_not_complete",
  evidence: "source_assertions_not_verified_by_package",
  inference: "no_inverse_transitive_semantic_or_universal_route_inference",
  disappearance: "bounded_nonobservation_or_nonreproduction_not_erasure",
  causation: "timing_exposure_similarity_and_popularity_do_not_establish_causation",
  adoption: "exposure_view_copy_or_share_does_not_establish_adoption",
  brainrot: "package_does_not_infer_or_assign_diagnosis_or_person_label",
  continuity: "content_ids_routes_and_reappearance_do_not_prove_personal_memory_identity_or_continuity",
  participants: "structured_participant_model_absent_package_does_not_treat_people_as_hosts_vectors_substrates_barriers_or_ranked_objects",
  rights: "package_does_not_infer_waiver_of_refusal_rest_play_privacy_or_nonparticipation",
  analogy: "structural_route_shape_only_no_mechanism_transfer",
  effect: "none",
} as const);
