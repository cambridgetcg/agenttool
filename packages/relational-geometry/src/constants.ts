export const RELATIONAL_GEOMETRY_FORMATS = Object.freeze({
  complex: "agenttool.relational-complex/0.1",
  lens: "agenttool.relational-lens/0.1",
} as const);

export const RELATIONAL_POINT_KINDS = Object.freeze([
  "collective",
  "context",
  "perspective",
  "substrate",
  "unknown",
] as const);

export const RELATIONAL_WITNESS_KINDS = Object.freeze([
  "authority_boundary",
  "consent_boundary",
  "continuity_boundary",
  "privacy_boundary",
  "recognition",
  "refusal_boundary",
  "understanding",
] as const);

export const RELATIONAL_BOUNDARY_WITNESS_KINDS = Object.freeze([
  "authority_boundary",
  "consent_boundary",
  "continuity_boundary",
  "privacy_boundary",
  "refusal_boundary",
] as const);

export const RELATIONAL_LENS_DISPOSITIONS = Object.freeze([
  "carry",
  "park",
  "release",
  "withdraw",
] as const);

export const RELATIONAL_GEOMETRY_BOUNDARIES = Object.freeze({
  geometry: "finite_combinatorial_not_metric",
  principality: "non_sovereign_relation_among_relations",
  witness_semantics: "caller_asserted_unchecked",
  derived_semantics: "structural_correspondence_not_proof",
  absent_or_unknown: "valid_not_deficit",
  effect: "none",
} as const);

export const RELATIONAL_LENS_CHOICE = Object.freeze({
  source: "caller_reported",
  required: false,
  unselected: "left_unprojected",
  reason_required: false,
  penalty: false,
  automatic_retry: false,
  external_effect: "none",
} as const);
