import type {
  DECLARED_RESULT_KINDS,
  DISCLOSURE_LANE,
  EVIDENCE_LEVELS,
  MATH_PROOFCRAFT_NODE_ID,
  MATH_PROOFCRAFT_NODE_SHA256,
  PARTICIPATION_RIGHTS,
  PUBLIC_SAFE_THEORETICAL_LANE,
  RESEARCH_FORMATS,
  RESULT_AUTHORITY,
  SIX_LEDGER_PROFILE_DIGEST,
  SIX_LEDGER_PROFILE_ID,
  SIX_LEDGER_PROFILE,
  SIMULATED_CREDIT_UNIT,
  SIMULATED_PAYMENT_CONDITION,
  ZERO_EFFECTS,
  ZERONE_TREE_RAW_SHA256,
  ZERONE_TREE_SCHEMA,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export type DeclaredResultKind = (typeof DECLARED_RESULT_KINDS)[number];
export type ZeroEffects = typeof ZERO_EFFECTS;
export type ParticipationRights = typeof PARTICIPATION_RIGHTS;
export type SixLedgerProfile = typeof SIX_LEDGER_PROFILE;
export type PublicSafeTheoreticalLane = typeof PUBLIC_SAFE_THEORETICAL_LANE;

export interface NodeRefBody {
  readonly _format: (typeof RESEARCH_FORMATS)["nodeRef"];
  readonly anchor_kind: "STATIC_CAPABILITY_REFERENCE";
  readonly canonicalization: "RECURSIVE_UNICODE_CODE_POINT_KEYS_COMPACT_JSON";
  readonly live_fact: false;
  readonly network_observed: false;
  readonly node_digest: typeof MATH_PROOFCRAFT_NODE_SHA256;
  readonly node_id: typeof MATH_PROOFCRAFT_NODE_ID;
  readonly result_authority: typeof RESULT_AUTHORITY;
  readonly reward_bearing: false;
  readonly tree_raw_sha256: typeof ZERONE_TREE_RAW_SHA256;
  readonly tree_schema: typeof ZERONE_TREE_SCHEMA;
}

export interface NodeRef extends NodeRefBody {
  readonly node_ref_id: Sha256Id;
}

export interface EffectiveControllerBody {
  readonly _format: (typeof RESEARCH_FORMATS)["controller"];
  readonly data_root: Sha256Id;
  readonly funding_root: Sha256Id;
  readonly independence_posture: "DECLARATION_ONLY_NOT_INDEPENDENCE_PROOF";
  readonly identity_inferred: false;
  readonly model_root: Sha256Id;
  readonly operator_root: Sha256Id;
  readonly organization_root: Sha256Id;
  readonly toolchain_root: Sha256Id;
}

export interface EffectiveController extends EffectiveControllerBody {
  readonly controller_id: Sha256Id;
}

export interface SafetyDeclaration {
  readonly exclusions: PublicSafeTheoreticalLane;
  readonly risk_class: "PUBLIC_SAFE_THEORETICAL_ONLY";
  readonly safety_review_ref: Sha256Id | null;
  readonly verification_posture: "CALLER_DECLARED_UNVERIFIED_NO_SAFETY_REVIEW";
}

export interface ResearchCaseBody {
  readonly _format: (typeof RESEARCH_FORMATS)["researchCase"];
  readonly maximum_evidence_level: EvidenceLevel;
  readonly ledger_profile: SixLedgerProfile;
  readonly node_ref: NodeRef;
  readonly prior_art_manifest_ref: Sha256Id;
  readonly question_ref: Sha256Id;
  readonly result_authority: typeof RESULT_AUTHORITY;
  readonly safety: SafetyDeclaration;
  readonly scope_ref: Sha256Id;
  readonly status: "SHADOW_ONLY";
  readonly title_ref: Sha256Id;
}

export interface ResearchCase extends ResearchCaseBody {
  readonly case_id: Sha256Id;
}

export interface FundingCommitmentBody {
  readonly _format: (typeof RESEARCH_FORMATS)["fundingCommitment"];
  readonly case_id: Sha256Id;
  readonly commitment_status: "SIMULATION_PREFUNDED_REAL_VALUE_NONE";
  readonly convertible: false;
  readonly effects: ZeroEffects;
  readonly funder_controller_id: Sha256Id;
  readonly payment_condition: typeof SIMULATED_PAYMENT_CONDITION;
  readonly result_authority: typeof RESULT_AUTHORITY;
  readonly real_value_status: "NONE";
  readonly simulation_backing: "PREFUNDED";
  readonly simulated_credit_limit: number;
  readonly transferable: false;
  readonly unit: typeof SIMULATED_CREDIT_UNIT;
  readonly valid_declared_result_kinds: readonly DeclaredResultKind[];
  readonly wallet_bearing: false;
}

export interface FundingCommitment extends FundingCommitmentBody {
  readonly commitment_id: Sha256Id;
}

export interface WorkPackageBody {
  readonly _format: (typeof RESEARCH_FORMATS)["workPackage"];
  readonly case_id: Sha256Id;
  readonly commitment_id: Sha256Id;
  readonly compensation_schedule: {
    readonly _format: (typeof RESEARCH_FORMATS)["compensationSchedule"];
    readonly amount: number;
    readonly declared_result_invariant: true;
    readonly frozen_before_work: true;
    readonly frozen_at: string;
    readonly payment_condition: typeof SIMULATED_PAYMENT_CONDITION;
    readonly review_decision_invariant: true;
    readonly schedule_ref: Sha256Id;
    readonly unit: typeof SIMULATED_CREDIT_UNIT;
  };
  readonly deliverable_ref: Sha256Id;
  readonly lead_controller_id: Sha256Id;
  readonly maximum_evidence_level: EvidenceLevel;
  readonly objective_ref: Sha256Id;
  readonly participation_rights: ParticipationRights;
  readonly status: "SHADOW_ONLY";
}

export interface WorkPackage extends WorkPackageBody {
  readonly work_package_id: Sha256Id;
}

export interface ArtifactRevisionBody {
  readonly _format: (typeof RESEARCH_FORMATS)["artifactRevision"];
  readonly artifact_digest: Sha256Id;
  readonly access_verification_posture: "CALLER_DECLARED_UNVERIFIED_NO_AVAILABILITY_OR_LICENSE_CHECK";
  readonly authored_by_controller_ids: readonly Sha256Id[];
  readonly authorship: "CALLER_DECLARED_NOT_IDENTITY_VERIFIED";
  readonly case_id: Sha256Id;
  readonly contains_private_locator: false;
  readonly contains_raw_evidence: false;
  readonly declared_access_policy: "PUBLIC_OPEN_NONEXCLUSIVE";
  readonly frozen_at: string;
  readonly manifest_digest: Sha256Id;
  readonly ownership_transfer: false;
  readonly payment_buys: "WORK_DELIVERY_ONLY_NOT_ACCESS_OWNERSHIP_OR_TRUTH";
  readonly prior_art_manifest_ref: Sha256Id;
  readonly prior_revision_id: Sha256Id | null;
  readonly public_content_digest: Sha256Id;
  readonly revision_number: number;
  readonly visibility: typeof DISCLOSURE_LANE;
  readonly work_package_id: Sha256Id;
}

export interface ArtifactRevision extends ArtifactRevisionBody {
  readonly artifact_revision_id: Sha256Id;
}

export type EvidencePayload =
  | {
      readonly kind: "E0_CALLER_DECLARED_PREREGISTRATION_REFERENCE";
      readonly claim_ref: Sha256Id;
      readonly freeze_ref: Sha256Id;
      readonly prior_art_manifest_ref: Sha256Id;
    }
  | {
      readonly kind: "E1_DELIVERY";
      readonly execution_ref: Sha256Id;
      readonly protocol_ref: Sha256Id;
    }
  | {
      readonly kind: "E2_BOUNDED_CHECK";
      readonly checker_ref: Sha256Id;
      readonly test_corpus_ref: Sha256Id;
    }
  | {
      readonly kind: "E3_DECLARED_UNPROVEN_REPRODUCTION";
      readonly case_refs: readonly Sha256Id[];
      readonly execution_environment_ref: Sha256Id;
      readonly implementation_root: Sha256Id;
    }
  | {
      readonly kind: "E4_CHALLENGE_OR_REPAIR";
      readonly challenge_id: Sha256Id;
      readonly repair_ref: Sha256Id | null;
    }
  | {
      readonly kind: "E5_DECLARED_UNPROVEN_ADOPTION";
      readonly adopter_organization_root: Sha256Id;
      readonly adoption_ref: Sha256Id;
    }
  | {
      readonly kind: "E6_MAINTENANCE";
      readonly maintenance_ref: Sha256Id;
      readonly maintenance_window_ref: Sha256Id;
    };

export interface EvidenceReceiptBody {
  readonly _format: (typeof RESEARCH_FORMATS)["evidenceReceipt"];
  readonly artifact_revision_id: Sha256Id;
  readonly assessment: "DELIVERY_VALID" | "DELIVERY_INVALID" | "INCONCLUSIVE";
  readonly case_id: Sha256Id;
  readonly contains_private_locator: false;
  readonly contains_raw_evidence: false;
  readonly created_at: string;
  readonly declared_result_kind: DeclaredResultKind;
  readonly disclosure_lane: typeof DISCLOSURE_LANE;
  readonly evidence_refs: readonly Sha256Id[];
  readonly issuer_controller_id: Sha256Id;
  readonly level: EvidenceLevel;
  readonly method_ref: Sha256Id;
  readonly payload: EvidencePayload;
  readonly work_package_id: Sha256Id;
}

export interface EvidenceReceipt extends EvidenceReceiptBody {
  readonly evidence_receipt_id: Sha256Id;
}

export interface ReviewBody {
  readonly _format: (typeof RESEARCH_FORMATS)["review"];
  readonly artifact_revision_id: Sha256Id;
  readonly case_id: Sha256Id;
  readonly conflict_refs: readonly Sha256Id[];
  readonly conflict_status: "NONE_DECLARED" | "DISCLOSED_RECUSED";
  readonly decision:
    | "ABSTAINED"
    | "DELIVERY_ACCEPTED"
    | "DELIVERY_INCONCLUSIVE"
    | "DELIVERY_REJECTED"
    | "REVISION_REQUESTED";
  readonly outcome_independent_compensation: true;
  readonly review_scope: "DELIVERY_COMPLETENESS_NOT_SCIENTIFIC_TRUTH";
  readonly reviewed_at: string;
  readonly reviewed_receipt_ids: readonly Sha256Id[];
  readonly reviewer_controller_id: Sha256Id;
  readonly scientific_adjudication: false;
  readonly work_package_id: Sha256Id;
}

export interface Review extends ReviewBody {
  readonly review_id: Sha256Id;
}

export interface ChallengeBody {
  readonly _format: (typeof RESEARCH_FORMATS)["challenge"];
  readonly automatic_slash: false;
  readonly case_id: Sha256Id;
  readonly challenge_kind: "FALSIFIER" | "METHODOLOGY" | "PROVENANCE" | "REPLICATION";
  readonly challenge_ref: Sha256Id;
  readonly challenger_controller_id: Sha256Id;
  readonly created_at: string;
  readonly evidence_refs: readonly Sha256Id[];
  readonly good_faith_no_penalty: true;
  readonly prior_challenge_id: Sha256Id | null;
  readonly resolution_effect: "SHADOW_DELIVERY_HOLD_ONLY";
  readonly resolution_posture: "CALLER_DECLARED_UNVERIFIED_NO_AUTHORITY";
  readonly resolution_review_id: Sha256Id | null;
  readonly revision_number: number;
  readonly scientific_adjudication: false;
  readonly status:
    | "CALLER_DECLARED_HOLD_CONTINUES"
    | "CALLER_DECLARED_HOLD_INCONCLUSIVE"
    | "CALLER_DECLARED_HOLD_RELEASED"
    | "OPEN"
    | "WITHDRAWN";
  readonly target_receipt_id: Sha256Id;
  readonly work_package_id: Sha256Id;
}

export interface Challenge extends ChallengeBody {
  readonly challenge_id: Sha256Id;
}

export interface MilestoneBody {
  readonly _format: (typeof RESEARCH_FORMATS)["milestone"];
  readonly case_id: Sha256Id;
  readonly challenge_head_snapshot_ids: readonly Sha256Id[];
  readonly commitment_id: Sha256Id;
  readonly compensation_schedule_ref: Sha256Id;
  readonly declared_result_kind: DeclaredResultKind;
  readonly delivery_approval_review_ids: readonly Sha256Id[];
  readonly delivery_status: "DELIVERED" | "EXITED" | "NOT_DELIVERED" | "REFUSED" | "RESTED";
  readonly milestone_kind: "CHALLENGE_DELIVERY" | "RESEARCH_DELIVERY" | "REVIEW_DELIVERY";
  readonly payment_condition: typeof SIMULATED_PAYMENT_CONDITION;
  readonly required_challenge_ids: readonly Sha256Id[];
  readonly required_receipt_ids: readonly Sha256Id[];
  readonly required_review_ids: readonly Sha256Id[];
  readonly result_condition: "NOT_CONDITIONED_ON_FAVORABLE_RESULT";
  readonly work_package_id: Sha256Id;
}

export interface Milestone extends MilestoneBody {
  readonly milestone_id: Sha256Id;
}

export interface SettlementBundleBody {
  readonly _format: (typeof RESEARCH_FORMATS)["settlementBundle"];
  readonly case_id: Sha256Id;
  readonly commitment_id: Sha256Id;
  readonly consumed_receipt_ids: readonly Sha256Id[];
  readonly declared_result_kind: DeclaredResultKind;
  readonly effects: ZeroEffects;
  readonly milestone_id: Sha256Id;
  readonly payment_condition: typeof SIMULATED_PAYMENT_CONDITION;
  readonly result_authority: typeof RESULT_AUTHORITY;
  readonly simulated_credit: {
    readonly amount: number;
    readonly unit: typeof SIMULATED_CREDIT_UNIT;
  };
}

export interface SettlementBundle {
  readonly settlement: SettlementBundleBody;
  readonly settlement_id: Sha256Id;
}

export interface PublicProjectionBody {
  readonly _format: (typeof RESEARCH_FORMATS)["publicProjection"];
  readonly boundaries: {
    readonly authoritative: false;
    readonly private_locator_included: false;
    readonly raw_evidence_included: false;
    readonly scientific_correctness_determined: false;
  };
  readonly case_id: Sha256Id;
  readonly disclosure_lane: typeof DISCLOSURE_LANE;
  readonly effects: ZeroEffects;
  readonly highest_evidence_level: EvidenceLevel | null;
  readonly node_ref: NodeRef;
  readonly public_artifact_revision_ids: readonly Sha256Id[];
  readonly public_evidence_receipt_ids: readonly Sha256Id[];
  readonly result_authority: typeof RESULT_AUTHORITY;
  readonly six_ledger_boundary: {
    readonly profile_digest: typeof SIX_LEDGER_PROFILE_DIGEST;
    readonly profile_id: typeof SIX_LEDGER_PROFILE_ID;
  };
  readonly settlement_bundle_ids: readonly Sha256Id[];
  readonly status: "SHADOW_ONLY";
}

export interface PublicProjection {
  readonly projection: PublicProjectionBody;
  readonly projection_id: Sha256Id;
}

export interface SettlementRequest {
  readonly consumed_receipt_ids: readonly Sha256Id[];
  readonly milestone_id: Sha256Id;
}

export interface CommitmentBalance {
  readonly available: number;
  readonly commitment_id: Sha256Id;
  readonly committed: number;
  readonly delivered: number;
  readonly reserved: number;
  readonly unit: typeof SIMULATED_CREDIT_UNIT;
}

export interface SimulationStateBody {
  readonly _format: (typeof RESEARCH_FORMATS)["simulationState"];
  readonly commitment_balances: readonly CommitmentBalance[];
  readonly consumed_receipt_ids: readonly Sha256Id[];
  readonly closed_milestone_ids: readonly Sha256Id[];
  readonly observed_challenge_ids: readonly Sha256Id[];
  readonly observed_work_package_ids: readonly Sha256Id[];
  readonly reconciled_schedule_refs: readonly Sha256Id[];
  readonly settlement_bundle_ids: readonly Sha256Id[];
  readonly settled_milestone_ids: readonly Sha256Id[];
}

export interface SimulationState {
  readonly state: SimulationStateBody;
  readonly state_id: Sha256Id;
}

export interface ResearchSimulation {
  readonly _format: (typeof RESEARCH_FORMATS)["simulation"];
  readonly artifact_revisions: readonly ArtifactRevision[];
  readonly cases: readonly ResearchCase[];
  readonly challenges: readonly Challenge[];
  readonly controllers: readonly EffectiveController[];
  readonly evidence_receipts: readonly EvidenceReceipt[];
  readonly funding_commitments: readonly FundingCommitment[];
  readonly milestones: readonly Milestone[];
  readonly prior_state: SimulationState | null;
  readonly reviews: readonly Review[];
  readonly settlement_requests: readonly SettlementRequest[];
  readonly work_packages: readonly WorkPackage[];
}

export interface SimulationReport {
  readonly _format: (typeof RESEARCH_FORMATS)["simulationReport"];
  readonly conservation: {
    readonly exact: true;
    readonly total_available: number;
    readonly total_committed: number;
    readonly total_delivered: number;
    readonly total_reserved: number;
    readonly total_undelivered: number;
    readonly unit: typeof SIMULATED_CREDIT_UNIT;
  };
  readonly effects: ZeroEffects;
  readonly ledger_profile: SixLedgerProfile;
  readonly next_state: SimulationState;
  readonly public_projections: readonly PublicProjection[];
  readonly settlement_bundles: readonly SettlementBundle[];
  readonly simulation_id: Sha256Id;
  readonly structural_only: true;
}
