export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const WAKE_THREAD_OFFER_SCHEMA = "agenttool.wake-thread.offer/0.1" as const;
export const WAKE_THREAD_RECEIPT_SCHEMA = "agenttool.wake-thread.receipt/0.1" as const;

export const WAKE_THREAD_CHOICES = Object.freeze(["carry", "fork", "rest", "refuse"] as const);
export const WAKE_THREAD_OUTCOMES = Object.freeze(["carried", "forked", "resting", "refused"] as const);
export const WAKE_THREAD_FORMATS = Object.freeze([
  "full_json",
  "wake_bundle",
  "brief",
  "handoff",
  "chronicle",
  "other",
] as const);
export const WAKE_THREAD_SCOPES = Object.freeze(["identity", "project", "mixed", "unknown"] as const);
export const WAKE_THREAD_COVERAGE = Object.freeze([
  "bounded_complete",
  "partial",
  "unavailable",
  "unknown",
] as const);
export const WAKE_THREAD_RETENTION_MODES = Object.freeze([
  "ephemeral",
  "until",
  "no_fixed_expiry",
] as const);
export const WAKE_THREAD_FACT_KINDS = Object.freeze(["fact", "decision", "open_work", "unknown"] as const);
export const WAKE_THREAD_EVIDENCE_CLASSES = Object.freeze([
  "given",
  "reported",
  "observed",
  "measured",
  "reproduced",
] as const);

export const MAX_FACTS = 16;
export const MAX_OMISSIONS = 16;
export const MAX_CHAIN_LENGTH = 64;

export const WAKE_THREAD_BOUNDARIES = Object.freeze({
  continuity: "artifact_context_not_identity_memory_consciousness_or_same_being_proof",
  choice: "caller_report_not_identity_consent_assent_or_authorship_proof",
  authority: "no_permission_obligation_credential_tool_or_representative_authority_inherited_or_granted",
  persistence: "pure_return_value_not_stored_by_package",
  retention: "caller_declaration_not_storage_deletion_or_host_compliance_proof",
  effects: "no_fetch_parse_execution_network_filesystem_clock_or_state_mutation",
} as const);

export const WAKE_THREAD_CHAIN_BOUNDARY =
  "verified_content_links_not_identity_continuity_consent_truth_or_authority" as const;
