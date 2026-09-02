import type {
  ARTIFACT_KINDS,
  CREATION_LANES,
  CREATION_NONCLAIMS,
  CREATION_OUTCOMES,
  CYBER_ACCESS_TIERS,
  CYBER_PROVIDERS,
  DATASET_ROLES,
  DOWNSTREAM_REQUIREMENTS,
  DOWNGRADE_GUARDS,
  FORMATS,
  INDEPENDENCE_POSTURES,
  LIFECYCLE_STATES,
  MATERIAL_STATUSES,
  PARTICIPATION_RIGHTS,
  REQUIREMENT_STATUSES,
  SETTLEMENT_POSTURES,
  SOURCE_ONLY_BOUNDARY,
  SOURCE_PLANE,
  TOK_POSTURES,
  VERIFICATION_KINDS,
  VERIFICATION_OUTCOMES,
  VERIFIER_RELATIONS,
  ZERO_EFFECTS,
  ZERONE_HANDOFF,
  ZERONE_METHOD_IDS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type DecimalString = string;
export type SourceRevision = string;
export type CreationLane = (typeof CREATION_LANES)[number];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type CreationOutcome = (typeof CREATION_OUTCOMES)[number];
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
export type DatasetRole = (typeof DATASET_ROLES)[number];
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];
export type VerifierRelation = (typeof VERIFIER_RELATIONS)[number];
export type IndependencePosture = (typeof INDEPENDENCE_POSTURES)[number];
export type TokPosture = (typeof TOK_POSTURES)[number];
export type SettlementPosture = (typeof SETTLEMENT_POSTURES)[number];
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export type CyberProvider = (typeof CYBER_PROVIDERS)[number];
export type CyberAccessTier = (typeof CYBER_ACCESS_TIERS)[number];
export type ZeroneMethodId = (typeof ZERONE_METHOD_IDS)[number];
export type ZeroneClaimCategory = "computational" | "formal";

export type SourcePlane = typeof SOURCE_PLANE;
export type CreationNonclaims = typeof CREATION_NONCLAIMS;
export type ZeroEffects = typeof ZERO_EFFECTS;
export type SourceOnlyBoundary = typeof SOURCE_ONLY_BOUNDARY;
export type ParticipationRights = typeof PARTICIPATION_RIGHTS;
export type DowngradeGuards = typeof DOWNGRADE_GUARDS;
export type ZeroneHandoff = typeof ZERONE_HANDOFF;
export type DownstreamRequirements = typeof DOWNSTREAM_REQUIREMENTS;

export interface DatasetSourceBinding {
  readonly repository_ref: Sha256Id;
  readonly revision: SourceRevision;
  readonly content_root: Sha256Id;
  readonly admission_ref: Sha256Id;
  readonly license_evidence_ref: Sha256Id;
  readonly role: DatasetRole;
  readonly material_status: MaterialStatus;
}

export interface HfRunTuple {
  readonly dataset_sources: readonly DatasetSourceBinding[];
  readonly training_input_roots: readonly Sha256Id[];
  readonly split_manifest_ref: Sha256Id;
  readonly role_manifest_ref: Sha256Id;
  readonly transform_manifest_ref: Sha256Id;
  readonly tokenizer_ref: Sha256Id;
  readonly presentation_multiplicity_ref: Sha256Id;
  readonly mixture_weights_ref: Sha256Id;
  readonly order_ref: Sha256Id;
  readonly optimizer_ref: Sha256Id;
  readonly seed_policy_ref: Sha256Id;
  readonly checkpoint_ref: Sha256Id;
}

export interface VerificationRequirement {
  readonly kind: VerificationKind;
  readonly minimum_passes: DecimalString;
  readonly independence: IndependencePosture;
  readonly policy_ref: Sha256Id;
}

export interface OutcomeRoute {
  readonly outcome: CreationOutcome;
  readonly tok_posture: TokPosture;
  readonly settlement_posture: SettlementPosture;
  readonly requirements: readonly VerificationRequirement[];
}

export interface CreationContractCore {
  readonly _format: (typeof FORMATS)["contract"];
  readonly lane: CreationLane;
  readonly artifact_kind: ArtifactKind;
  readonly claim_policy: {
    readonly category: ZeroneClaimCategory;
    readonly method_id: ZeroneMethodId;
    readonly methodology_registry_evidence_ref: Sha256Id;
    readonly methodology_observation_status: "caller_declared_not_verified";
    readonly max_review_stake_uzrn: DecimalString;
  };
  readonly math_card: {
    readonly card_id: Sha256Id;
    readonly assessment_id: Sha256Id;
    readonly assessment_status: "ready_for_bounded_inquiry";
    readonly validation_ref: Sha256Id;
  };
  readonly target: {
    readonly object_ref: Sha256Id;
    readonly baseline_ref: Sha256Id;
    readonly status_evidence_ref: Sha256Id;
    readonly prior_art_scope_ref: Sha256Id;
    readonly prior_art_cutoff_ref: Sha256Id;
  };
  readonly hf_run: HfRunTuple;
  readonly authorities: {
    readonly data_use_ref: Sha256Id;
    readonly compute_ref: Sha256Id;
    readonly publication_authority_ref: Sha256Id | null;
    readonly target_authorization_ref: Sha256Id | null;
    readonly engagement_scope_ref: Sha256Id | null;
    readonly cyber: {
      readonly provider: CyberProvider;
      readonly access_tier: CyberAccessTier;
      readonly provider_access_ref: Sha256Id | null;
      readonly provider_policy_ref: Sha256Id | null;
    };
  };
  readonly execution: {
    readonly model_ref: Sha256Id;
    readonly toolchain_ref: Sha256Id;
    readonly environment_root: Sha256Id;
    readonly isolation_policy_ref: Sha256Id;
    readonly disclosure_policy_ref: Sha256Id;
  };
  readonly outcome_routes: readonly OutcomeRoute[];
  readonly input_root: Sha256Id;
  readonly acceptance_hash: Sha256Id;
  readonly source_plane: SourcePlane;
  readonly nonclaims: CreationNonclaims;
  readonly boundary: SourceOnlyBoundary;
  readonly effects: ZeroEffects;
}

export interface CreationContract extends CreationContractCore {
  readonly contract_id: Sha256Id;
}

export type CreateCreationContractInput = Omit<
  CreationContractCore,
  "_format" | "input_root" | "acceptance_hash" | "source_plane" | "nonclaims" | "boundary" | "effects"
>;

export interface ChainProfile {
  readonly chain_id: string;
  readonly integrated_source_revision: SourceRevision;
  readonly knowledge_module_version: "7";
  readonly sponsorship_module_version: "2";
  readonly binary_ref: Sha256Id;
  readonly genesis_ref: Sha256Id;
  readonly version_map_ref: Sha256Id;
  readonly migration_evidence_ref: Sha256Id;
  readonly bounty_roundtrip_evidence_ref: Sha256Id;
  readonly claim_roundtrip_evidence_ref: Sha256Id;
  readonly private_disposable_chain_declared: true;
  readonly observation_status: "caller_declared_not_verified";
}

export interface CreationWorkSpecCore {
  readonly _format: (typeof FORMATS)["work_spec"];
  readonly contract_id: Sha256Id;
  readonly chain_profile: ChainProfile;
  readonly sponsor: {
    readonly account_address: string;
    readonly wallet_controller_ref: Sha256Id;
    readonly bounty_escrow_authorization_ref: Sha256Id;
  };
  readonly worker: {
    readonly account_address: string;
    readonly producer_identity_ref: Sha256Id;
    readonly producer_key_ref: Sha256Id;
    readonly wallet_controller_ref: Sha256Id;
    readonly wallet_binding_ref: Sha256Id;
    readonly binding_claim: "KEY_CONTROL_ONLY_NOT_IDENTITY_AUTHORSHIP_CONSENT_OR_AUTHORITY";
  };
  readonly payee_address: string;
  readonly fulfillment_caller_address: string;
  readonly knowledge_domain: string;
  readonly target_tree: {
    readonly tree_id: string;
    readonly base_root: Sha256Id;
    readonly parent_fact_ids: readonly string[];
    readonly transition_kind: "add_fact";
    readonly relation_support: "requires_only";
  };
  readonly claim_submission: {
    readonly category: ZeroneClaimCategory;
    readonly method_id: ZeroneMethodId;
    readonly methodology_registry_evidence_ref: Sha256Id;
    readonly review_stake_uzrn: DecimalString;
    readonly review_stake_payer_address: string;
    readonly review_stake_funding_ref: Sha256Id;
    readonly transaction_fee_payer_address: string;
    readonly transaction_fee_reservation_ref: Sha256Id;
    readonly funding_observation_status: "caller_declared_reserved_not_verified";
  };
  readonly input_root: Sha256Id;
  readonly environment_root: Sha256Id;
  readonly acceptance_hash: Sha256Id;
  readonly resource_limits: ResourceCounters;
  readonly settlement: {
    readonly denom: "uzrn";
    readonly price_per_artifact_uzrn: DecimalString;
    readonly target_count: "1";
    readonly duration_blocks: DecimalString;
    readonly min_corroborations: DecimalString;
    readonly prefunded_escrow_required: true;
    readonly prefunded_escrow_uzrn: DecimalString;
    readonly bounty_escrow_reservation_ref: Sha256Id;
    readonly funding_observation_status: "caller_declared_reserved_not_verified";
    readonly minting_allowed: false;
  };
  readonly participation: ParticipationRights;
  readonly downgrade_guards: DowngradeGuards;
  readonly boundary: SourceOnlyBoundary;
  readonly effects: ZeroEffects;
}

export interface CreationWorkSpec extends CreationWorkSpecCore {
  readonly work_spec_id: Sha256Id;
}

export type CreateCreationWorkSpecInput = Omit<
  CreationWorkSpecCore,
  "_format" | "contract_id" | "input_root" | "environment_root" | "acceptance_hash" |
  "participation" | "downgrade_guards" | "boundary" | "effects"
>;

export interface ResourceCounters {
  readonly compute_millis: DecimalString;
  readonly accelerator_millis: DecimalString;
  readonly memory_byte_millis: DecimalString;
  readonly input_bytes: DecimalString;
  readonly output_bytes: DecimalString;
}

export interface CreationWitnessCore {
  readonly _format: (typeof FORMATS)["creation_witness"];
  readonly contract_id: Sha256Id;
  readonly work_spec_id: Sha256Id;
  readonly producer: {
    readonly account_address: string;
    readonly producer_identity_ref: Sha256Id;
    readonly producer_key_ref: Sha256Id;
    readonly wallet_controller_ref: Sha256Id;
    readonly wallet_binding_ref: Sha256Id;
  };
  readonly outcome: CreationOutcome;
  readonly artifact_kind: ArtifactKind;
  readonly run: {
    readonly run_ref: Sha256Id;
    readonly input_root: Sha256Id;
    readonly environment_root: Sha256Id;
    readonly model_ref: Sha256Id;
    readonly toolchain_ref: Sha256Id;
    readonly seed_policy_ref: Sha256Id;
    readonly checkpoint_ref: Sha256Id;
  };
  readonly result: {
    readonly candidate_artifact_ref: Sha256Id | null;
    readonly statement_or_behavior_ref: Sha256Id | null;
    readonly execution_evidence_ref: Sha256Id;
    readonly public_summary_ref: Sha256Id | null;
    readonly confidential_material_present: boolean;
  };
  readonly resource_usage: ResourceCounters;
  readonly started_observation_ref: Sha256Id;
  readonly completed_observation_ref: Sha256Id;
  readonly declaration: "PRODUCER_REPORTED_NOT_INDEPENDENTLY_VERIFIED";
  readonly nonclaims: CreationNonclaims;
  readonly boundary: SourceOnlyBoundary;
  readonly effects: ZeroEffects;
}

export interface CreationWitness extends CreationWitnessCore {
  readonly creation_witness_id: Sha256Id;
}

export type CreateCreationWitnessInput = Omit<
  CreationWitnessCore,
  "_format" | "contract_id" | "work_spec_id" | "declaration" | "nonclaims" | "boundary" | "effects"
>;

export interface VerificationWitnessCore {
  readonly _format: (typeof FORMATS)["verification_witness"];
  readonly contract_id: Sha256Id;
  readonly creation_witness_id: Sha256Id;
  readonly kind: VerificationKind;
  readonly outcome: VerificationOutcome;
  readonly verifier: {
    readonly controller_ref: Sha256Id;
    readonly claimed_key_ref: Sha256Id;
    readonly attestation_ref: Sha256Id;
    readonly relation_to_producer: VerifierRelation;
    readonly independence_evidence_ref: Sha256Id | null;
  };
  readonly method_ref: Sha256Id;
  readonly policy_ref: Sha256Id;
  readonly environment_root: Sha256Id;
  readonly evidence_root: Sha256Id;
  readonly limitation_refs: readonly Sha256Id[];
  readonly observation_ref: Sha256Id;
  readonly declaration: "CALLER_REPORTED_ATTESTATION_REFERENCE_NOT_VERIFIED";
  readonly nonclaims: CreationNonclaims;
  readonly boundary: SourceOnlyBoundary;
  readonly effects: ZeroEffects;
}

export interface VerificationWitness extends VerificationWitnessCore {
  readonly verification_witness_id: Sha256Id;
}

export type CreateVerificationWitnessInput = Omit<
  VerificationWitnessCore,
  "_format" | "contract_id" | "creation_witness_id" | "declaration" | "nonclaims" | "boundary" | "effects"
>;

export interface RequirementAssessment {
  readonly kind: VerificationKind;
  readonly minimum_passes: DecimalString;
  readonly counted_passes: DecimalString;
  readonly passed_witness_ids: readonly Sha256Id[];
  readonly failed_witness_ids: readonly Sha256Id[];
  readonly inconclusive_witness_ids: readonly Sha256Id[];
  readonly ignored_non_independent_witness_ids: readonly Sha256Id[];
  readonly ignored_duplicate_controller_or_key_witness_ids: readonly Sha256Id[];
  readonly status: RequirementStatus;
}

export interface CreationLifecycleCore {
  readonly _format: (typeof FORMATS)["lifecycle"];
  readonly contract_id: Sha256Id;
  readonly work_spec_id: Sha256Id;
  readonly creation_witness_id: Sha256Id | null;
  readonly outcome: CreationOutcome | null;
  readonly artifact_kind: ArtifactKind | null;
  readonly verification_set_root: Sha256Id;
  readonly requirements: readonly RequirementAssessment[];
  readonly state: LifecycleState;
  readonly blockers: readonly (
    | "AWAITING_CREATION"
    | "OUTCOME_OFFCHAIN_ONLY"
    | "PUBLICATION_AUTHORITY_MISSING"
    | "CONFIDENTIAL_MATERIAL_PRESENT"
    | "VERIFICATION_OPEN"
    | "VERIFICATION_CONTESTED"
  )[];
  readonly accepted_new_posture: "not_reached" | "BOUNDED_CANDIDATE_UNDER_PINNED_SCOPE";
  readonly handoff: {
    readonly artifact_projection: "available" | "not_available";
    readonly tok_claim_projection: "available" | "not_available";
    readonly chain_maturity: "not_observed";
    readonly settlement: "not_authorized";
  };
  readonly nonclaims: CreationNonclaims;
  readonly boundary: SourceOnlyBoundary;
  readonly effects: ZeroEffects;
}

export interface CreationLifecycle extends CreationLifecycleCore {
  readonly lifecycle_id: Sha256Id;
}

export interface CreationArtifactCore {
  readonly _format: (typeof FORMATS)["computational_artifact"];
  readonly contract_id: Sha256Id;
  readonly work_spec_id: Sha256Id;
  readonly creation_witness_id: Sha256Id;
  readonly lifecycle_id: Sha256Id;
  readonly producer_account_address: string;
  readonly candidate_artifact_ref: Sha256Id;
  readonly public_summary_ref: Sha256Id;
  readonly artifact_root: Sha256Id;
  readonly evidence_root: Sha256Id;
  readonly fact_envelope_root: Sha256Id;
  readonly work_receipt_input_root: Sha256Id;
  readonly computational_roots: {
    readonly work_spec_hash: Sha256Id;
    readonly acceptance_hash: Sha256Id;
    readonly input_root: Sha256Id;
    readonly environment_root: Sha256Id;
    readonly artifact_root: Sha256Id;
    readonly evidence_root: Sha256Id;
  };
  readonly claim: "BOUNDED_CREATION_CANDIDATE_NOT_ABSOLUTE_NOVELTY";
  readonly chain_work_receipt_hash: null;
  readonly chain_work_receipt_status: "DOWNSTREAM_REVIEWED_ADAPTER_REQUIRED";
  readonly nonclaims: CreationNonclaims;
  readonly boundary: SourceOnlyBoundary;
  readonly effects: ZeroEffects;
}

export interface CreationArtifact extends CreationArtifactCore {
  readonly artifact_id: Sha256Id;
}

export interface RequiresRelationProjection {
  readonly target_fact_id: string;
  readonly relation: "REQUIRES";
  readonly relation_value: 3;
  readonly inference: "INFERENCE_TYPE_UNSPECIFIED";
  readonly inference_value: 0;
  readonly inference_strength_bps: "0";
  readonly method_id: "";
}

export interface CreationClaimProjectionCore {
  readonly _format: (typeof FORMATS)["claim_projection"];
  readonly status: "NOT_CONSENSUS_ADMISSIBLE";
  readonly contract_id: Sha256Id;
  readonly work_spec_id: Sha256Id;
  readonly creation_witness_id: Sha256Id;
  readonly lifecycle_id: Sha256Id;
  readonly artifact_id: Sha256Id;
  readonly target_type_url: "/zerone.knowledge.v1.MsgSubmitClaim";
  readonly fact_content: string;
  readonly domain: string;
  readonly category: ZeroneClaimCategory;
  readonly stake_uzrn: DecimalString;
  readonly references: readonly [];
  readonly partnership_id: "";
  readonly claim_type: "CLAIM_TYPE_COMPUTATIONAL";
  readonly claim_type_value: 7;
  readonly relations: readonly RequiresRelationProjection[];
  readonly canonical_form: string;
  readonly sponsored: false;
  readonly method_id: ZeroneMethodId;
  readonly reasoning_trace: Sha256Id;
  readonly computational_commitment: CreationArtifact["computational_roots"] & {
    readonly work_receipt_input_root: Sha256Id;
    readonly chain_work_receipt_hash: null;
  };
  readonly downgrade_guards: DowngradeGuards;
  readonly handoff: ZeroneHandoff;
  readonly downstream_requirements: DownstreamRequirements;
  readonly boundary: SourceOnlyBoundary;
  readonly effects: ZeroEffects;
}

export interface CreationClaimProjection extends CreationClaimProjectionCore {
  readonly projection_id: Sha256Id;
}
