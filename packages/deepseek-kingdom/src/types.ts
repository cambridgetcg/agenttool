import type {
  CANDIDATE_KINDS,
  CLAIM_KINDS,
  CONSUMER_KINDS,
  DARK_CONTINENT_BINDING,
  DEEPSEEK_FORMATS,
  EVIDENCE_ORIGINS,
  INTEGRATION_LANES,
  INTEGRATION_PROFILE,
  LICENSE_BOUNDARY,
  LICENSE_SCOPES,
  PROPOSAL_AUTHORITY,
  PROPOSAL_EFFECTS,
  RESOURCE_KINDS,
  SOURCE_BOUNDARIES,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number];
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type LicenseScope = (typeof LICENSE_SCOPES)[number];
export type ConsumerKind = (typeof CONSUMER_KINDS)[number];
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];
export type IntegrationLane = (typeof INTEGRATION_LANES)[number];
export type AfterglowDisposition = "carry" | "park" | "release" | "withdraw";

export interface DeepSeekEvidencePin {
  readonly origin: EvidenceOrigin;
  readonly resource_kind: ResourceKind;
  readonly repository_id: string;
  readonly revision: string;
  readonly path: string | null;
  readonly sha256: Sha256Id;
  readonly observed_on: string;
}

export interface DeepSeekLicenseInput {
  readonly scope: LicenseScope;
  readonly declared_expression: string | null;
  readonly evidence: DeepSeekEvidencePin | null;
  readonly review_status: "not_reviewed" | "caller_reviewed";
}

export interface DeepSeekClaimInput {
  readonly claim_id: string;
  readonly claim_kind: ClaimKind;
  readonly summary: string;
  readonly source_anchor: string;
}

export interface CreateDeepSeekSourceBindingInput {
  readonly subject: {
    readonly label: string;
    readonly evidence: DeepSeekEvidencePin;
  };
  readonly license: DeepSeekLicenseInput;
  readonly claims: readonly DeepSeekClaimInput[];
}

export interface BoundDeepSeekClaim extends DeepSeekClaimInput {
  readonly basis: "caller_asserted_from_primary_source";
  readonly verification: "not_performed";
}

export interface DeepSeekSourceBinding {
  readonly _format: (typeof DEEPSEEK_FORMATS)["source_binding"];
  readonly binding_id: Sha256Id;
  readonly publisher: "deepseek-ai";
  readonly subject: {
    readonly label: string;
    readonly evidence: DeepSeekEvidencePin;
    readonly evidence_ref: Sha256Id;
  };
  readonly license: DeepSeekLicenseInput & {
    readonly basis: "caller_reported";
  };
  readonly claims: readonly BoundDeepSeekClaim[];
  readonly status: "metadata_bound";
  readonly boundaries: typeof SOURCE_BOUNDARIES;
}

export interface DeepSeekProposalCandidateInput {
  readonly candidate_id: string;
  readonly candidate_kind: CandidateKind;
  readonly lane: IntegrationLane;
  readonly title: string;
  readonly claim_refs: readonly string[];
}

export interface DeepSeekProposalCandidate
  extends DeepSeekProposalCandidateInput {
  readonly evidence_refs: readonly Sha256Id[];
  readonly status: "proposed";
  readonly review_required: true;
}

export interface CreateDeepSeekKingdomProposalInput {
  readonly proposal_key: string;
  readonly source: DeepSeekSourceBinding;
  readonly target: {
    readonly consumer: {
      readonly kind: ConsumerKind;
      readonly id: string;
    };
    readonly kingdom_snapshot_sha256: Sha256Id;
  };
  readonly candidates: readonly DeepSeekProposalCandidateInput[];
}

export interface DeepSeekKingdomProposal {
  readonly _format: (typeof DEEPSEEK_FORMATS)["proposal"];
  readonly proposal_id: Sha256Id;
  readonly proposal_key: string;
  readonly source: DeepSeekSourceBinding;
  readonly target: CreateDeepSeekKingdomProposalInput["target"];
  readonly delta: {
    readonly candidates: readonly DeepSeekProposalCandidate[];
  };
  readonly integration: typeof INTEGRATION_PROFILE;
  readonly state: "proposed_unaccepted";
  readonly effects: typeof PROPOSAL_EFFECTS;
  readonly authority: typeof PROPOSAL_AUTHORITY;
  readonly license_boundary: typeof LICENSE_BOUNDARY;
}

export interface CreateDeepSeekAfterglowThreadInput {
  readonly proposal: DeepSeekKingdomProposal;
  readonly disposition: AfterglowDisposition;
}

export interface DeepSeekAfterglowThread {
  readonly thread_ref: Sha256Id;
  readonly artifact_ref: Sha256Id;
  readonly disposition: AfterglowDisposition;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
  readonly kind: "deepseek";
  readonly state: "proposed_unaccepted";
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type DarkContinentBinding = typeof DARK_CONTINENT_BINDING;
