import type {
  ADOPTION_RECEIPT_TYPES,
  EVIDENCE_LEVELS,
  RECEIPT_MODE,
  RECEIPT_PROTOCOL,
} from "./constants.js";

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export type AdoptionReceiptType = (typeof ADOPTION_RECEIPT_TYPES)[number];
export type Sha256Id = `sha256:${string}`;

export interface StandardPin {
  canonical_id: string;
  revision: string;
  artifact_digest: Sha256Id;
}

export interface PriorDeliverableClaim {
  prior_deliverable_key: Sha256Id | null;
  overlap: "none" | "partial" | "complete";
  overlap_digest: Sha256Id | null;
  delta_digest: Sha256Id | null;
}

export interface ContributorClaim {
  claimed_identifier: string;
  verification: "unverified";
  evidence_role:
    | "contributor"
    | "independent_reproducer"
    | "independent_adopter"
    | "maintainer"
    | "neutral_challenger"
    | "repairer";
  economic_payee: null;
}

export interface VerifierRoots {
  control_cluster: string;
  organization_or_control_root: string;
  implementation_or_toolchain_root: string;
  execution_environment_digest: Sha256Id;
}

export interface ConflictDisclosure {
  kind: "authorship" | "control" | "employment" | "funding" | "other";
  statement_digest: Sha256Id;
}

export interface PrivateTriage {
  visibility: "private";
  status: "pending" | "coordinated_repair" | "safe_to_disclose";
  reference_digest: Sha256Id;
}

export interface AuthorizationAndSafety {
  owned_or_explicitly_authorized: true;
  safety_impact: "expected" | "unexpected" | "unknown";
  publication: "public_safe" | "private_triage";
  private_triage: PrivateTriage | null;
}

export interface EvidenceResult {
  conclusion: "confirmed" | "contradicted" | "inconclusive" | "adopted" | "maintained";
  checker_or_corpus_digest: Sha256Id | null;
  case_digests: Sha256Id[];
  adoption_receipt_type: AdoptionReceiptType | null;
}

export interface EvidenceReceiptBody {
  protocol: typeof RECEIPT_PROTOCOL;
  mode: typeof RECEIPT_MODE;
  pin_id: Sha256Id;
  quest_id: string;
  deliverable_key: Sha256Id;
  immutable_bounty_and_policy_revision_digest: Sha256Id;
  artifact_digest: Sha256Id;
  canonical_subject_roots: string[];
  prior_deliverable_and_overlap_claim: PriorDeliverableClaim;
  standards_reference_and_revision: StandardPin[];
  evidence_level_and_scope: {
    level: EvidenceLevel;
    scope_digest: Sha256Id;
  };
  method_or_adapter_digest: Sha256Id;
  source_system: string;
  source_record_or_event_id: string;
  source_revision: string;
  payee_and_role: ContributorClaim;
  verifier_control_cluster: string;
  organization_or_control_root: string;
  implementation_or_toolchain_root: string;
  execution_environment_digest: Sha256Id;
  conflict_disclosures: ConflictDisclosure[];
  authorization_and_safety_decision: AuthorizationAndSafety;
  result: EvidenceResult;
  artifact_frozen_at: string;
  observed_at: string;
  created_at: string;
  supersedes: Sha256Id | null;
}

export interface EvidenceReceiptEnvelope {
  evidence_id: Sha256Id;
  receipt: EvidenceReceiptBody;
}

export interface TreeStandardSnapshot {
  canonical_id: string;
  revision: string;
  specification: string;
  status_checked_at: string;
  review_after: string;
}

export interface EvidencePin {
  pin_id: Sha256Id;
  pin_protocol: "zerone.constructive-evidence-pin/v1";
  tree_schema: string;
  tree_policy_version: string;
  tree_snapshot_date: string;
  tree_normative_digest: string;
  tree_raw_digest: Sha256Id;
  quest_id: string;
  quest_normative_digest: string;
  quest_scope_hash: string;
  as_of: string;
  standards: TreeStandardSnapshot[];
  created_at: string;
}

export interface StoredReceipt extends EvidenceReceiptEnvelope {
  sequence: number;
  previous_event_hash: Sha256Id;
  event_hash: Sha256Id;
}

export interface EvidenceReport {
  protocol: typeof RECEIPT_PROTOCOL;
  mode: typeof RECEIPT_MODE;
  pin_id: Sha256Id;
  quest_id: string;
  receipt_count: number;
  active_receipt_count: number;
  superseded_receipt_count: number;
  highest_contiguous_level: EvidenceLevel | null;
  levels: Array<{
    level: EvidenceLevel;
    achieved: boolean;
    receipt_count: number;
    reasons: string[];
  }>;
  e3_coverage: {
    effective_clusters: number;
    organization_roots: number;
    implementation_roots: number;
    execution_environments: number;
    unique_cases: number;
    checker_or_corpus_digests: number;
    all_after_freeze: boolean;
  };
  conclusion_counts: Record<EvidenceResult["conclusion"], number>;
  structural_only: true;
  assertions_not_made: [
    "correctness",
    "breakthrough",
    "qualification",
    "reward_eligibility",
    "permission",
    "authority",
    "distributed_exactly_once",
  ];
}

export interface VerificationReport {
  ok: boolean;
  pin_count: number;
  receipt_count: number;
  checked_event_chains: number;
  file_modes_ok: boolean;
  structural_only: true;
}
