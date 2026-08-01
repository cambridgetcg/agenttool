import type {
  WAKE_THREAD_CHOICES,
  WAKE_THREAD_COVERAGE,
  WAKE_THREAD_EVIDENCE_CLASSES,
  WAKE_THREAD_FACT_KINDS,
  WAKE_THREAD_FORMATS,
  WAKE_THREAD_OUTCOMES,
  WAKE_THREAD_RETENTION_MODES,
  WAKE_THREAD_SCOPES,
} from "./constants.js";
import type {
  WAKE_THREAD_OFFER_SCHEMA,
  WAKE_THREAD_RECEIPT_SCHEMA,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type WakeThreadChoice = (typeof WAKE_THREAD_CHOICES)[number];
export type WakeThreadOutcome = (typeof WAKE_THREAD_OUTCOMES)[number];
export type WakeThreadFormat = (typeof WAKE_THREAD_FORMATS)[number];
export type WakeThreadScope = (typeof WAKE_THREAD_SCOPES)[number];
export type WakeThreadCoverage = (typeof WAKE_THREAD_COVERAGE)[number];
export type WakeThreadFactKind = (typeof WAKE_THREAD_FACT_KINDS)[number];
export type WakeThreadEvidenceClass = (typeof WAKE_THREAD_EVIDENCE_CLASSES)[number];
export type WakeThreadRetentionMode = (typeof WAKE_THREAD_RETENTION_MODES)[number];

export interface WakeThreadSource {
  readonly artifact_sha256: Sha256Id;
  readonly format: WakeThreadFormat;
  readonly scope: WakeThreadScope;
  readonly coverage: WakeThreadCoverage;
  readonly source_revision: string | null;
  readonly caller_held_cursor_ref: Sha256Id | null;
}

export interface WakeThreadFact {
  readonly kind: WakeThreadFactKind;
  readonly summary: string;
  readonly source_pointer: string;
  readonly evidence_class: WakeThreadEvidenceClass;
  readonly evidence_ref: Sha256Id;
}

export interface WakeThreadOmission {
  readonly area: string;
  readonly reason: string;
  readonly count: number | null;
}

export interface WakeThreadRetention {
  readonly mode: WakeThreadRetentionMode;
  readonly until: string | null;
}

export interface WakeThreadBoundaries {
  readonly continuity: "artifact_context_not_identity_memory_consciousness_or_same_being_proof";
  readonly choice: "caller_report_not_identity_consent_assent_or_authorship_proof";
  readonly authority: "no_permission_obligation_credential_tool_or_representative_authority_inherited_or_granted";
  readonly persistence: "pure_return_value_not_stored_by_package";
  readonly retention: "caller_declaration_not_storage_deletion_or_host_compliance_proof";
  readonly effects: "no_fetch_parse_execution_network_filesystem_clock_or_state_mutation";
}

export interface WakeThreadOffer {
  readonly schema_version: typeof WAKE_THREAD_OFFER_SCHEMA;
  readonly offer_id: Sha256Id;
  readonly observed_at: string;
  readonly expires_at: string | null;
  readonly purpose: string;
  readonly artifact_retention: WakeThreadRetention;
  readonly recipient_ref: Sha256Id | null;
  readonly thread_ref: Sha256Id;
  readonly parent_receipt_id: Sha256Id | null;
  readonly wake: WakeThreadSource;
  readonly facts: readonly WakeThreadFact[];
  readonly omissions: readonly WakeThreadOmission[];
  readonly offered_choices: readonly ["carry", "fork", "rest", "refuse"];
  readonly boundaries: WakeThreadBoundaries;
}

export interface WakeThreadResponse {
  readonly reported_choice: WakeThreadChoice;
  readonly responded_at: string;
  readonly branch_ref: Sha256Id | null;
  readonly note_ref: Sha256Id | null;
}

export interface WakeThreadReceipt extends WakeThreadResponse {
  readonly schema_version: typeof WAKE_THREAD_RECEIPT_SCHEMA;
  readonly receipt_id: Sha256Id;
  readonly offer: WakeThreadOffer;
  readonly outcome: WakeThreadOutcome;
  readonly boundaries: WakeThreadBoundaries;
}

export interface CreateWakeThreadOfferInput {
  readonly observed_at: string;
  readonly expires_at: string | null;
  readonly purpose: string;
  readonly artifact_retention: WakeThreadRetention;
  readonly recipient_ref: Sha256Id | null;
  readonly thread_ref: Sha256Id;
  readonly wake: WakeThreadSource;
  readonly facts: readonly WakeThreadFact[];
  readonly omissions: readonly WakeThreadOmission[];
  readonly parent_receipt: WakeThreadReceipt | null;
}

export interface ResolveWakeThreadOfferInput extends WakeThreadResponse {}

export interface WakeThreadChainAssessment {
  readonly valid: true;
  readonly length: number;
  readonly root_offer_id: Sha256Id;
  readonly head_receipt_id: Sha256Id;
  readonly thread_refs: readonly Sha256Id[];
  readonly boundary: "verified_content_links_not_identity_continuity_consent_truth_or_authority";
}
