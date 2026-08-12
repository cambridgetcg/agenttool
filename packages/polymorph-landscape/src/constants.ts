export const POLYMORPH_FORMATS = Object.freeze({
  landscape: "agenttool.polymorph-landscape/0.1",
  reachabilityShift: "agenttool.polymorph-reachability-shift/0.1",
  lesson: "agenttool.polymorph-lesson/0.1",
} as const);

export const SOURCE_KINDS = Object.freeze([
  "official_regulatory",
  "patent_primary",
  "peer_reviewed_primary",
] as const);

export const FORM_KINDS = Object.freeze([
  "amorphous",
  "hydrate",
  "other",
  "polymorph",
  "solvate",
  "unknown",
] as const);

export const CONDITION_KINDS = Object.freeze([
  "formulation",
  "manufacturing_process",
  "mechanical_process",
  "measurement",
  "solvent_process",
  "unknown",
] as const);

export const EVIDENCE_STATUSES = Object.freeze([
  "derived_interpretation",
  "hypothesized_primary",
  "measured_primary",
  "reported_primary",
] as const);

export const REPORTED_CLAIM_EVIDENCE_STATUSES = Object.freeze([
  "measured_primary",
  "reported_primary",
] as const);

export const POLYMORPH_TEXT_LIMITS = Object.freeze({
  generic: 4096,
  material_label: 512,
  source_label: 1024,
  form_label: 512,
  condition_label: 512,
  witness_scope: 1024,
  source_url: 2048,
} as const);

export const POLYMORPH_SOURCE_URL_PATTERN = "^https://(?![^/?#]*@)(?:(?:[A-Za-z0-9._~!$&'()*+,;=:@/?#\\[\\]-])|(?:%[0-9A-Fa-f]{2}))+$";

export const WITNESS_KINDS = Object.freeze([
  "mechanism_hypothesis",
  "measurement",
  "process_observation",
  "recovery_observation",
  "regulatory_record",
  "reported_history",
] as const);

export const ROUTE_STATUSES = Object.freeze([
  "converted_reported",
  "not_reproduced_reported",
  "produced_reported",
] as const);

export const BARRIER_REPORTS = Object.freeze([
  "not_reported",
  "present_reported",
  "unknown",
] as const);

export const TEMPLATE_REPORTS = Object.freeze([
  "hypothesized",
  "not_established",
  "not_reported",
  "present_reported",
] as const);

export const LESSON_LANGUAGES = Object.freeze([
  "en",
  "yue-Hant",
  "zh-Hans",
  "zh-Hant",
] as const);

export const LESSON_CONCEPT_KEYS = Object.freeze([
  "multiple_form",
  "stability_vs_reachability",
  "barrier",
  "template",
  "path_history",
  "observation_limit",
  "practical_return",
  "analogy_boundary",
  "medical_boundary",
] as const);

export const KINGDOM_MAPPING_KEYS = Object.freeze([
  "state_space",
  "barrier",
  "template",
  "path_history",
  "witness",
  "practical_return",
] as const);

export const NON_TRANSFERRED_PROPERTIES = Object.freeze([
  "authority",
  "causality",
  "consciousness",
  "consent",
  "dignity",
  "identity",
  "inevitability",
  "medical_effect",
  "molecular_energy",
  "rate_constants",
  "value_or_goodness",
] as const);

export const POLYMORPH_BOUNDARIES = Object.freeze({
  coverage: "bounded_not_complete",
  evidence: "source_assertions_not_verified_by_package",
  inference: "no_inverse_transitive_or_universal_route_inference",
  stability: "pairwise_condition_scoped_never_goodness",
  disappearance: "named_condition_nonreproduction_not_physical_erasure",
  analogy: "structural_analogy_only_not_empirical_validation",
  beings: "no_identity_consciousness_consent_dignity_or_authority_claim",
  medical: "educational_not_medical_or_manufacturing_advice",
  effect: "none",
} as const);
