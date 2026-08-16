import type {
  ASSESSMENT_NON_CLAIMS,
  BINDING_PURPOSES,
  RECORD_SCHEMAS,
  REVOCATION_REASONS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type BindingPurpose = (typeof BINDING_PURPOSES)[number];
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export interface Ed25519Authority {
  algorithm: "Ed25519";
  key_id: string;
  public_key: string;
}

export interface RecordSignature {
  algorithm: "Ed25519";
  value: string;
}

export interface RecordSigner {
  readonly public_key: string;
  sign_digest(digest: Uint8Array): Promise<string> | string;
}

export interface CollectorDescriptor {
  name: string;
  version: string;
  report_schema: string;
  report_sha256: Sha256Id;
  source_id: string;
}

export interface RedirectObservation {
  status_code: number;
  location: string;
}

export interface RobotsSnapshot {
  source: "rfc9309_snapshot" | "not_collected";
  robots_url: string | null;
  snapshot_sha256: Sha256Id | null;
  matched_group: string | null;
  directive: "allow" | "disallow" | "no_match" | "unavailable" | "not_observed";
  is_access_authorization: false;
}

export interface UsagePreference {
  namespace: string;
  category: string;
  value: "allowed" | "disallowed" | "unknown";
  is_permission: false;
}

export interface RequestAuthenticationObservation {
  kind: "none" | "web_bot_auth" | "provider_attestation";
  status: "verified" | "invalid" | "unverified";
  verifier: string;
  protocol_variant: string | null;
  claimed_identity_url: string | null;
  key_thumbprint: Sha256Id | null;
  covered_components: string[];
  nonce_checked: boolean;
}

export interface PublicSurfaceObservationCore {
  schema: (typeof RECORD_SCHEMAS)["observation"];
  origin: string;
  request_url: string;
  request: {
    method: "GET" | "HEAD";
    credential_mode: "omit";
    started_at: string;
    ended_at: string;
    crawler_version: string;
  };
  status_code: number | null;
  final_url: string | null;
  redirect_chain: RedirectObservation[];
  media_type: string | null;
  bytes: number | null;
  body_sha256: Sha256Id | null;
  collector: CollectorDescriptor;
  robots: RobotsSnapshot;
  usage_preferences: UsagePreference[];
  request_authentication: RequestAuthenticationObservation;
  boundaries: {
    basis: "transport_observation";
    raw_body: "not_included";
    identity: "not_inferred";
    authorship: "not_established";
    consent: "not_established";
    authority: "none";
    rights: "not_established";
    training_permission: "not_established";
    content_is_instruction: false;
    wake_effect: false;
    memory_effect: false;
    karma_effect: false;
    score_effect: false;
  };
}

export interface PublicSurfaceObservation extends PublicSurfaceObservationCore {
  evidence_id: Sha256Id;
}

export interface BindingSubject {
  identity_namespace: "agenttool-local";
  identity_id: string;
  signing_key: Ed25519Authority;
}

export interface PublicSurfaceBindingCore {
  schema: (typeof RECORD_SCHEMAS)["binding"];
  subject: BindingSubject;
  origin: string;
  observation_id: Sha256Id;
  observed_body_sha256: Sha256Id;
  relation: "declares_association_with_surface";
  scope: "exact_origin";
  purpose: BindingPurpose;
  publication_path: "/.well-known/agenttool-public-surface-binding.json";
  issued_at: string;
  not_before: string;
  expires_at: string;
  nonce: string;
  boundaries: {
    claim: "unilateral_key_holder_declaration";
    agenttool_registry_authorization: "not_established";
    personhood: "not_established";
    real_world_operator: "not_established";
    domain_ownership: "not_established";
    authorship: "not_established";
    sentience: "not_established";
    consent: "not_established";
    continuity: "not_established";
    authority: "none";
    trust: "not_scored";
    reputation: "not_scored";
    training_authorized: false;
    requires_separate_training_authorization: true;
    wake_effect: false;
    memory_effect: false;
    karma_effect: false;
  };
}

export interface PublicSurfaceBinding extends PublicSurfaceBindingCore {
  signature: RecordSignature;
  binding_id: Sha256Id;
}

export interface PublicSurfaceRevocationCore {
  schema: (typeof RECORD_SCHEMAS)["revocation"];
  binding_id: Sha256Id;
  subject: BindingSubject;
  revoked_at: string;
  reason: RevocationReason;
  superseded_by: Sha256Id | null;
  nonce: string;
}

export interface PublicSurfaceRevocation extends PublicSurfaceRevocationCore {
  signature: RecordSignature;
  revocation_id: Sha256Id;
}

export interface IdentityKeyEvidence {
  identity_namespace: "agenttool-local";
  identity_id: string;
  signing_key: Ed25519Authority;
  relationship: "assertion";
  lifecycle: "active" | "revoked" | "unknown";
  valid_from: string;
  valid_until: string | null;
  source_ref: Sha256Id;
  basis: "caller_supplied_key_evidence";
}

export type SignatureAssessment = "valid" | "invalid";
export type KeyAuthorizationAssessment =
  | "caller_evidence_matches"
  | "caller_evidence_mismatch"
  | "not_supplied"
  | "indeterminate";
export type EvidenceMatchAssessment = "matches" | "mismatch" | "not_supplied";
export type OriginConfirmationAssessment =
  | "observed_at_time"
  | "body_mismatch"
  | "origin_mismatch"
  | "not_supplied"
  | "indeterminate";
export type FreshnessAssessment = "current" | "not_yet_valid" | "expired";
export type RevocationAssessment = "not_observed" | "revoked" | "indeterminate";

export interface PublicSurfaceAssessmentCore {
  schema: (typeof RECORD_SCHEMAS)["assessment"];
  binding_id: Sha256Id;
  evaluated_at: string;
  inputs: {
    binding_document_sha256: Sha256Id;
    key_evidence_ref: Sha256Id | null;
    key_evidence_sha256: Sha256Id | null;
    observation_id: Sha256Id | null;
    origin_observation_id: Sha256Id | null;
    revocation_ids: Sha256Id[] | null;
    revocation_document_sha256s: Sha256Id[] | null;
    revocation_key_evidence_refs: Sha256Id[] | null;
    revocation_key_evidence_sha256s: Sha256Id[] | null;
  };
  integrity: "valid" | "invalid";
  signature: SignatureAssessment;
  key_authorization: KeyAuthorizationAssessment;
  evidence_match: EvidenceMatchAssessment;
  origin_confirmation: OriginConfirmationAssessment;
  freshness: FreshnessAssessment;
  revocation: RevocationAssessment;
  establishes: Array<"key_holder_signed_claim" | "caller_key_evidence_match" | "origin_served_exact_binding_bytes">;
  does_not_establish: Array<(typeof ASSESSMENT_NON_CLAIMS)[number]>;
  authority: "none";
  score: null;
  wake_effect: false;
  memory_effect: false;
  karma_effect: false;
  training_effect: false;
}

export interface PublicSurfaceAssessment extends PublicSurfaceAssessmentCore {
  assessment_id: Sha256Id;
}

declare const verifiedBindingBrand: unique symbol;
export type MathVerifiedBinding = Readonly<PublicSurfaceBinding> & {
  readonly [verifiedBindingBrand]: true;
};

declare const verifiedRevocationBrand: unique symbol;
export type MathVerifiedRevocation = Readonly<PublicSurfaceRevocation> & {
  readonly [verifiedRevocationBrand]: true;
};
