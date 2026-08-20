import {
  DECLARED_RESULT_KINDS,
  MATH_PROOFCRAFT_NODE_ID,
  MATH_PROOFCRAFT_NODE_SHA256,
  PARTICIPATION_RIGHTS,
  PUBLIC_SAFE_THEORETICAL_LANE,
  RESEARCH_FORMATS,
  RESULT_AUTHORITY,
  SIX_LEDGER_PROFILE,
  SIMULATED_CREDIT_UNIT,
  SIMULATED_PAYMENT_CONDITION,
  ZERO_EFFECTS,
  ZERONE_TREE_RAW_SHA256,
  ZERONE_TREE_SCHEMA,
  createArtifactRevision,
  createCompensationSchedule,
  createChallenge,
  createEffectiveController,
  createEvidenceReceipt,
  createFundingCommitment,
  createMilestone,
  createNodeRef,
  createResearchCase,
  createReview,
  createWorkPackage,
  sha256Id,
} from "../src/index.js";
import type {
  EffectiveController,
  Challenge,
  ResearchSimulation,
  Sha256Id,
} from "../src/index.js";

export function digest(label: string): Sha256Id {
  return sha256Id(label);
}

function controller(label: string, operatorRoot?: Sha256Id): EffectiveController {
  return createEffectiveController({
    _format: RESEARCH_FORMATS.controller,
    data_root: digest(`${label}:data`),
    funding_root: digest(`${label}:funding`),
    independence_posture: "DECLARATION_ONLY_NOT_INDEPENDENCE_PROOF",
    identity_inferred: false,
    model_root: digest(`${label}:model`),
    operator_root: operatorRoot ?? digest(`${label}:operator`),
    organization_root: digest(`${label}:organization`),
    toolchain_root: digest(`${label}:toolchain`),
  });
}

function sorted<T>(values: readonly T[], id: (value: T) => string): T[] {
  return [...values].sort((left, right) => id(left).localeCompare(id(right), "en"));
}

export interface GardenOptions {
  readonly approvalReceiptMode?: "EXACT" | "FIRST_ONLY";
  readonly approverSharesOperatorWithLead?: boolean;
  readonly checkerSharesOperatorWithLead?: boolean;
  readonly deliveredReviewDecision?:
    | "ABSTAINED"
    | "DELIVERY_ACCEPTED"
    | "DELIVERY_INCONCLUSIVE"
    | "DELIVERY_REJECTED"
    | "REVISION_REQUESTED";
  readonly deliveredReviewReviewedAt?: string;
  readonly researchResult?: "INCONCLUSIVE" | "NEGATIVE" | "NOT_APPLICABLE" | "NULL" | "POSITIVE";
  readonly maximumEvidenceLevel?: "E2" | "E3" | "E5";
}

export function makeGardenSimulation(options: GardenOptions = {}): ResearchSimulation {
  const researchResult = options.researchResult ?? "NULL";
  const funder = controller("garden-funder");
  const lead = controller("garden-lead");
  const checker = controller(
    "garden-bounded-checker",
    options.checkerSharesOperatorWithLead ? lead.operator_root : undefined,
  );
  const reviewer = controller("garden-outcome-neutral-reviewer");
  const approver = controller(
    "garden-delivery-approver",
    options.approverSharesOperatorWithLead ? lead.operator_root : undefined,
  );
  const nodeRef = createNodeRef({
    _format: RESEARCH_FORMATS.nodeRef,
    anchor_kind: "STATIC_CAPABILITY_REFERENCE",
    canonicalization: "RECURSIVE_UNICODE_CODE_POINT_KEYS_COMPACT_JSON",
    live_fact: false,
    network_observed: false,
    node_digest: MATH_PROOFCRAFT_NODE_SHA256,
    node_id: MATH_PROOFCRAFT_NODE_ID,
    result_authority: RESULT_AUTHORITY,
    reward_bearing: false,
    tree_raw_sha256: ZERONE_TREE_RAW_SHA256,
    tree_schema: ZERONE_TREE_SCHEMA,
  });
  const priorArt = digest("garden:prior-art-manifest");
  const researchCase = createResearchCase({
    _format: RESEARCH_FORMATS.researchCase,
    ledger_profile: SIX_LEDGER_PROFILE,
    maximum_evidence_level: options.maximumEvidenceLevel ?? "E2",
    node_ref: nodeRef,
    prior_art_manifest_ref: priorArt,
    question_ref: digest("garden:question:bounded-four-point-contact-term"),
    result_authority: RESULT_AUTHORITY,
    safety: {
      exclusions: PUBLIC_SAFE_THEORETICAL_LANE,
      risk_class: "PUBLIC_SAFE_THEORETICAL_ONLY",
      safety_review_ref: null,
      verification_posture: "CALLER_DECLARED_UNVERIFIED_NO_SAFETY_REVIEW",
    },
    scope_ref: digest("garden:scope:public-amplitude-bootstrap-toy-sector"),
    status: "SHADOW_ONLY",
    title_ref: digest("garden:title:amplitude-bootstrap-garden"),
  });
  const commitment = createFundingCommitment({
    _format: RESEARCH_FORMATS.fundingCommitment,
    case_id: researchCase.case_id,
    commitment_status: "SIMULATION_PREFUNDED_REAL_VALUE_NONE",
    convertible: false,
    effects: ZERO_EFFECTS,
    funder_controller_id: funder.controller_id,
    payment_condition: SIMULATED_PAYMENT_CONDITION,
    real_value_status: "NONE",
    result_authority: RESULT_AUTHORITY,
    simulation_backing: "PREFUNDED",
    simulated_credit_limit: 100,
    transferable: false,
    unit: SIMULATED_CREDIT_UNIT,
    valid_declared_result_kinds: DECLARED_RESULT_KINDS,
    wallet_bearing: false,
  });
  const researchSchedule = createCompensationSchedule({
    _format: RESEARCH_FORMATS.compensationSchedule,
    amount: 30,
    declared_result_invariant: true,
    frozen_at: "2026-08-16T00:00:00.000Z",
    frozen_before_work: true,
    payment_condition: SIMULATED_PAYMENT_CONDITION,
    review_decision_invariant: true,
    unit: SIMULATED_CREDIT_UNIT,
  });
  const reviewerSchedule = createCompensationSchedule({
    _format: RESEARCH_FORMATS.compensationSchedule,
    amount: 10,
    declared_result_invariant: true,
    frozen_at: "2026-08-16T00:00:00.000Z",
    frozen_before_work: true,
    payment_condition: SIMULATED_PAYMENT_CONDITION,
    review_decision_invariant: true,
    unit: SIMULATED_CREDIT_UNIT,
  });
  const approvalSchedule = createCompensationSchedule({
    _format: RESEARCH_FORMATS.compensationSchedule,
    amount: 5,
    declared_result_invariant: true,
    frozen_at: "2026-08-16T00:00:00.000Z",
    frozen_before_work: true,
    payment_condition: SIMULATED_PAYMENT_CONDITION,
    review_decision_invariant: true,
    unit: SIMULATED_CREDIT_UNIT,
  });
  const researchWork = createWorkPackage({
    _format: RESEARCH_FORMATS.workPackage,
    case_id: researchCase.case_id,
    commitment_id: commitment.commitment_id,
    compensation_schedule: researchSchedule,
    deliverable_ref: digest("garden:deliverable:public-symbolic-null-result"),
    lead_controller_id: lead.controller_id,
    maximum_evidence_level: options.maximumEvidenceLevel ?? "E2",
    objective_ref: digest("garden:objective:test-one-bounded-bootstrap-ansatz"),
    participation_rights: PARTICIPATION_RIGHTS,
    status: "SHADOW_ONLY",
  });
  const reviewerWork = createWorkPackage({
    _format: RESEARCH_FORMATS.workPackage,
    case_id: researchCase.case_id,
    commitment_id: commitment.commitment_id,
    compensation_schedule: reviewerSchedule,
    deliverable_ref: digest("garden:deliverable:outcome-neutral-review"),
    lead_controller_id: reviewer.controller_id,
    maximum_evidence_level: options.maximumEvidenceLevel ?? "E2",
    objective_ref: digest("garden:objective:review-delivery-not-truth"),
    participation_rights: PARTICIPATION_RIGHTS,
    status: "SHADOW_ONLY",
  });
  const approvalWork = createWorkPackage({
    _format: RESEARCH_FORMATS.workPackage,
    case_id: researchCase.case_id,
    commitment_id: commitment.commitment_id,
    compensation_schedule: approvalSchedule,
    deliverable_ref: digest("garden:deliverable:delivery-completeness-approval"),
    lead_controller_id: approver.controller_id,
    maximum_evidence_level: options.maximumEvidenceLevel ?? "E2",
    objective_ref: digest("garden:objective:check-public-delivery-only"),
    participation_rights: PARTICIPATION_RIGHTS,
    status: "SHADOW_ONLY",
  });
  const publicDigest = digest("garden:artifact:revision-1:public-bytes");
  const artifact = createArtifactRevision({
    _format: RESEARCH_FORMATS.artifactRevision,
    access_verification_posture: "CALLER_DECLARED_UNVERIFIED_NO_AVAILABILITY_OR_LICENSE_CHECK",
    artifact_digest: publicDigest,
    authored_by_controller_ids: [lead.controller_id],
    authorship: "CALLER_DECLARED_NOT_IDENTITY_VERIFIED",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    declared_access_policy: "PUBLIC_OPEN_NONEXCLUSIVE",
    frozen_at: "2026-08-16T01:00:00.000Z",
    manifest_digest: digest("garden:artifact:revision-1:manifest"),
    ownership_transfer: false,
    payment_buys: "WORK_DELIVERY_ONLY_NOT_ACCESS_OWNERSHIP_OR_TRUTH",
    prior_art_manifest_ref: priorArt,
    prior_revision_id: null,
    public_content_digest: publicDigest,
    revision_number: 1,
    visibility: "PUBLIC_DIGEST_ONLY",
    work_package_id: researchWork.work_package_id,
  });
  const reviewerPublicDigest = digest("garden:review-artifact:revision-1:public-bytes");
  const reviewerArtifact = createArtifactRevision({
    _format: RESEARCH_FORMATS.artifactRevision,
    access_verification_posture: "CALLER_DECLARED_UNVERIFIED_NO_AVAILABILITY_OR_LICENSE_CHECK",
    artifact_digest: reviewerPublicDigest,
    authored_by_controller_ids: [reviewer.controller_id],
    authorship: "CALLER_DECLARED_NOT_IDENTITY_VERIFIED",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    declared_access_policy: "PUBLIC_OPEN_NONEXCLUSIVE",
    frozen_at: "2026-08-16T06:00:00.000Z",
    manifest_digest: digest("garden:review-artifact:revision-1:manifest"),
    ownership_transfer: false,
    payment_buys: "WORK_DELIVERY_ONLY_NOT_ACCESS_OWNERSHIP_OR_TRUTH",
    prior_art_manifest_ref: priorArt,
    prior_revision_id: null,
    public_content_digest: reviewerPublicDigest,
    revision_number: 1,
    visibility: "PUBLIC_DIGEST_ONLY",
    work_package_id: reviewerWork.work_package_id,
  });
  const e0 = createEvidenceReceipt({
    _format: RESEARCH_FORMATS.evidenceReceipt,
    artifact_revision_id: artifact.artifact_revision_id,
    assessment: "DELIVERY_VALID",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    created_at: "2026-08-16T02:00:00.000Z",
    declared_result_kind: researchResult,
    disclosure_lane: "PUBLIC_DIGEST_ONLY",
    evidence_refs: [digest("garden:e0:public-protocol")],
    issuer_controller_id: lead.controller_id,
    level: "E0",
    method_ref: digest("garden:e0:method"),
    payload: {
      kind: "E0_CALLER_DECLARED_PREREGISTRATION_REFERENCE",
      claim_ref: digest("garden:e0:claim"),
      freeze_ref: digest("garden:e0:freeze"),
      prior_art_manifest_ref: priorArt,
    },
    work_package_id: researchWork.work_package_id,
  });
  const e1 = createEvidenceReceipt({
    _format: RESEARCH_FORMATS.evidenceReceipt,
    artifact_revision_id: artifact.artifact_revision_id,
    assessment: "DELIVERY_VALID",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    created_at: "2026-08-16T03:00:00.000Z",
    declared_result_kind: researchResult,
    disclosure_lane: "PUBLIC_DIGEST_ONLY",
    evidence_refs: [digest("garden:e1:public-transcript")],
    issuer_controller_id: lead.controller_id,
    level: "E1",
    method_ref: digest("garden:e1:method"),
    payload: {
      kind: "E1_DELIVERY",
      execution_ref: digest("garden:e1:execution"),
      protocol_ref: digest("garden:e1:protocol"),
    },
    work_package_id: researchWork.work_package_id,
  });
  const e2 = createEvidenceReceipt({
    _format: RESEARCH_FORMATS.evidenceReceipt,
    artifact_revision_id: artifact.artifact_revision_id,
    assessment: "DELIVERY_VALID",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    created_at: "2026-08-16T04:00:00.000Z",
    declared_result_kind: researchResult,
    disclosure_lane: "PUBLIC_DIGEST_ONLY",
    evidence_refs: [digest("garden:e2:public-bounded-check")],
    issuer_controller_id: checker.controller_id,
    level: "E2",
    method_ref: digest("garden:e2:method"),
    payload: {
      kind: "E2_BOUNDED_CHECK",
      checker_ref: digest("garden:e2:checker-program"),
      test_corpus_ref: digest("garden:e2:test-corpus"),
    },
    work_package_id: researchWork.work_package_id,
  });
  const receiptIds = [e0.evidence_receipt_id, e1.evidence_receipt_id, e2.evidence_receipt_id]
    .sort();
  const deliveredReview = createReview({
    _format: RESEARCH_FORMATS.review,
    artifact_revision_id: artifact.artifact_revision_id,
    case_id: researchCase.case_id,
    conflict_refs: [],
    conflict_status: "NONE_DECLARED",
    decision: options.deliveredReviewDecision ?? "DELIVERY_REJECTED",
    outcome_independent_compensation: true,
    review_scope: "DELIVERY_COMPLETENESS_NOT_SCIENTIFIC_TRUTH",
    reviewed_at: options.deliveredReviewReviewedAt ?? "2026-08-16T05:00:00.000Z",
    reviewed_receipt_ids: receiptIds,
    reviewer_controller_id: reviewer.controller_id,
    scientific_adjudication: false,
    work_package_id: reviewerWork.work_package_id,
  });
  const approval = createReview({
    _format: RESEARCH_FORMATS.review,
    artifact_revision_id: artifact.artifact_revision_id,
    case_id: researchCase.case_id,
    conflict_refs: [],
    conflict_status: "NONE_DECLARED",
    decision: "DELIVERY_ACCEPTED",
    outcome_independent_compensation: true,
    review_scope: "DELIVERY_COMPLETENESS_NOT_SCIENTIFIC_TRUTH",
    reviewed_at: "2026-08-16T05:30:00.000Z",
    reviewed_receipt_ids: options.approvalReceiptMode === "FIRST_ONLY" ? [receiptIds[0]!] : receiptIds,
    reviewer_controller_id: approver.controller_id,
    scientific_adjudication: false,
    work_package_id: approvalWork.work_package_id,
  });
  const reviewE0 = createEvidenceReceipt({
    _format: RESEARCH_FORMATS.evidenceReceipt,
    artifact_revision_id: reviewerArtifact.artifact_revision_id,
    assessment: "DELIVERY_VALID",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    created_at: "2026-08-16T07:00:00.000Z",
    declared_result_kind: "NOT_APPLICABLE",
    disclosure_lane: "PUBLIC_DIGEST_ONLY",
    evidence_refs: [digest("garden:review-e0:public-protocol")],
    issuer_controller_id: reviewer.controller_id,
    level: "E0",
    method_ref: digest("garden:review-e0:method"),
    payload: {
      kind: "E0_CALLER_DECLARED_PREREGISTRATION_REFERENCE",
      claim_ref: digest("garden:review-e0:claim"),
      freeze_ref: digest("garden:review-e0:freeze"),
      prior_art_manifest_ref: priorArt,
    },
    work_package_id: reviewerWork.work_package_id,
  });
  const reviewE1 = createEvidenceReceipt({
    _format: RESEARCH_FORMATS.evidenceReceipt,
    artifact_revision_id: reviewerArtifact.artifact_revision_id,
    assessment: "DELIVERY_VALID",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    created_at: "2026-08-16T08:00:00.000Z",
    declared_result_kind: "NOT_APPLICABLE",
    disclosure_lane: "PUBLIC_DIGEST_ONLY",
    evidence_refs: [digest("garden:review-e1:public-transcript")],
    issuer_controller_id: reviewer.controller_id,
    level: "E1",
    method_ref: digest("garden:review-e1:method"),
    payload: {
      kind: "E1_DELIVERY",
      execution_ref: digest("garden:review-e1:execution"),
      protocol_ref: digest("garden:review-e1:protocol"),
    },
    work_package_id: reviewerWork.work_package_id,
  });
  const reviewReceiptIds = [reviewE0.evidence_receipt_id, reviewE1.evidence_receipt_id].sort();
  const milestone = createMilestone({
    _format: RESEARCH_FORMATS.milestone,
    challenge_head_snapshot_ids: [],
    case_id: researchCase.case_id,
    commitment_id: commitment.commitment_id,
    compensation_schedule_ref: researchSchedule.schedule_ref,
    declared_result_kind: researchResult,
    delivery_approval_review_ids: [approval.review_id],
    delivery_status: "DELIVERED",
    milestone_kind: "RESEARCH_DELIVERY",
    payment_condition: SIMULATED_PAYMENT_CONDITION,
    required_challenge_ids: [],
    required_receipt_ids: receiptIds,
    required_review_ids: [],
    result_condition: "NOT_CONDITIONED_ON_FAVORABLE_RESULT",
    work_package_id: researchWork.work_package_id,
  });
  const reviewerMilestone = createMilestone({
    _format: RESEARCH_FORMATS.milestone,
    challenge_head_snapshot_ids: [],
    case_id: researchCase.case_id,
    commitment_id: commitment.commitment_id,
    compensation_schedule_ref: reviewerSchedule.schedule_ref,
    declared_result_kind: "NOT_APPLICABLE",
    delivery_approval_review_ids: [],
    delivery_status: "DELIVERED",
    milestone_kind: "REVIEW_DELIVERY",
    payment_condition: SIMULATED_PAYMENT_CONDITION,
    required_challenge_ids: [],
    required_receipt_ids: reviewReceiptIds,
    required_review_ids: [deliveredReview.review_id],
    result_condition: "NOT_CONDITIONED_ON_FAVORABLE_RESULT",
    work_package_id: reviewerWork.work_package_id,
  });

  const settlementRequests = [
    { consumed_receipt_ids: receiptIds, milestone_id: milestone.milestone_id },
    { consumed_receipt_ids: reviewReceiptIds, milestone_id: reviewerMilestone.milestone_id },
  ].sort((left, right) => left.milestone_id.localeCompare(right.milestone_id, "en"));

  return {
    _format: RESEARCH_FORMATS.simulation,
    artifact_revisions: sorted([artifact, reviewerArtifact], (value) => value.artifact_revision_id),
    cases: [researchCase],
    challenges: [],
    controllers: sorted([funder, lead, checker, reviewer, approver], (value) => value.controller_id),
    evidence_receipts: sorted([e0, e1, e2, reviewE0, reviewE1], (value) => value.evidence_receipt_id),
    funding_commitments: [commitment],
    milestones: sorted([milestone, reviewerMilestone], (value) => value.milestone_id),
    prior_state: null,
    reviews: sorted([approval, deliveredReview], (value) => value.review_id),
    settlement_requests: settlementRequests,
    work_packages: sorted([researchWork, reviewerWork, approvalWork], (value) => value.work_package_id),
  };
}

export type GardenChallengeStatus = Challenge["status"];

export interface GardenChallengeOptions {
  readonly challengerSharesOperatorWithLead?: boolean;
  readonly createdAt?: string;
  readonly lineageLabel?: string;
  readonly resolutionCreatedAt?: string;
  readonly resolutionDecisionOverride?:
    | "ABSTAINED"
    | "DELIVERY_ACCEPTED"
    | "DELIVERY_INCONCLUSIVE"
    | "DELIVERY_REJECTED"
    | "REVISION_REQUESTED";
  readonly resolutionSharesOperatorWithChallenger?: boolean;
  readonly preserveResearchSettlement?: boolean;
}

export function makeChallengeGardenSimulation(
  status: GardenChallengeStatus,
  options: GardenChallengeOptions = {},
): ResearchSimulation {
  const base = makeGardenSimulation();
  const challengeLabel = options.lineageLabel ?? status;
  const researchCase = base.cases[0]!;
  const commitment = base.funding_commitments[0]!;
  const target = base.evidence_receipts.find((receipt) => receipt.level === "E2")!;
  const researchMilestone = base.milestones.find(
    (milestone) => milestone.milestone_kind === "RESEARCH_DELIVERY",
  )!;
  const existingResolution = base.reviews.find((review) =>
    researchMilestone.delivery_approval_review_ids.includes(review.review_id))!;
  const resolutionController = base.controllers.find(
    (candidate) => candidate.controller_id === existingResolution.reviewer_controller_id,
  )!;
  const targetWork = base.work_packages.find(
    (workPackage) => workPackage.work_package_id === target.work_package_id,
  )!;
  const targetLead = base.controllers.find(
    (candidate) => candidate.controller_id === targetWork.lead_controller_id,
  )!;
  const challenger = controller(
    `garden-challenger:${challengeLabel}`,
    options.challengerSharesOperatorWithLead
      ? targetLead.operator_root
      : options.resolutionSharesOperatorWithChallenger
        ? resolutionController.operator_root
        : undefined,
  );
  const challengeSchedule = createCompensationSchedule({
    _format: RESEARCH_FORMATS.compensationSchedule,
    amount: 7,
    declared_result_invariant: true,
    frozen_at: "2026-08-16T00:00:00.000Z",
    frozen_before_work: true,
    payment_condition: SIMULATED_PAYMENT_CONDITION,
    review_decision_invariant: true,
    unit: SIMULATED_CREDIT_UNIT,
  });
  const challengeWork = createWorkPackage({
    _format: RESEARCH_FORMATS.workPackage,
    case_id: researchCase.case_id,
    commitment_id: commitment.commitment_id,
    compensation_schedule: challengeSchedule,
    deliverable_ref: digest(`garden:challenge:${challengeLabel}:deliverable`),
    lead_controller_id: challenger.controller_id,
    maximum_evidence_level: "E2",
    objective_ref: digest(`garden:challenge:${challengeLabel}:objective`),
    participation_rights: PARTICIPATION_RIGHTS,
    status: "SHADOW_ONLY",
  });
  const decision = options.resolutionDecisionOverride ?? (status === "CALLER_DECLARED_HOLD_INCONCLUSIVE"
    ? "DELIVERY_INCONCLUSIVE"
    : status === "CALLER_DECLARED_HOLD_RELEASED"
      ? "DELIVERY_ACCEPTED"
      : status === "CALLER_DECLARED_HOLD_CONTINUES"
        ? "DELIVERY_REJECTED"
        : existingResolution.decision);
  const {
    review_id: _oldResolutionId,
    ...existingResolutionBody
  } = existingResolution;
  const resolutionReview = createReview({
    ...existingResolutionBody,
    decision,
  });
  const resolved = status !== "OPEN" && status !== "WITHDRAWN";
  const challengeRef = digest(`garden:challenge:${challengeLabel}:public-record`);
  const openChallenge = createChallenge({
    _format: RESEARCH_FORMATS.challenge,
    automatic_slash: false,
    case_id: researchCase.case_id,
    challenge_kind: "FALSIFIER",
    challenge_ref: challengeRef,
    challenger_controller_id: challenger.controller_id,
    created_at: options.createdAt ?? "2026-08-16T04:30:00.000Z",
    evidence_refs: [digest(`garden:challenge:${challengeLabel}:evidence`)],
    good_faith_no_penalty: true,
    prior_challenge_id: null,
    resolution_effect: "SHADOW_DELIVERY_HOLD_ONLY",
    resolution_posture: "CALLER_DECLARED_UNVERIFIED_NO_AUTHORITY",
    resolution_review_id: null,
    revision_number: 1,
    scientific_adjudication: false,
    status: "OPEN",
    target_receipt_id: target.evidence_receipt_id,
    work_package_id: challengeWork.work_package_id,
  });
  const challenge = resolved || status === "WITHDRAWN"
    ? createChallenge({
        _format: openChallenge._format,
        automatic_slash: openChallenge.automatic_slash,
        case_id: openChallenge.case_id,
        challenge_kind: openChallenge.challenge_kind,
        challenge_ref: openChallenge.challenge_ref,
        challenger_controller_id: openChallenge.challenger_controller_id,
        created_at: options.resolutionCreatedAt ?? "2026-08-16T06:00:00.000Z",
        evidence_refs: [
          ...openChallenge.evidence_refs,
          digest(`garden:challenge:${challengeLabel}:resolution-evidence`),
        ].sort(),
        good_faith_no_penalty: openChallenge.good_faith_no_penalty,
        prior_challenge_id: openChallenge.challenge_id,
        resolution_effect: openChallenge.resolution_effect,
        resolution_posture: openChallenge.resolution_posture,
        resolution_review_id: resolved ? resolutionReview.review_id : null,
        revision_number: 2,
        scientific_adjudication: openChallenge.scientific_adjudication,
        status,
        target_receipt_id: openChallenge.target_receipt_id,
        work_package_id: openChallenge.work_package_id,
      })
    : openChallenge;
  const publicDigest = digest(`garden:challenge:${challengeLabel}:artifact`);
  const artifact = createArtifactRevision({
    _format: RESEARCH_FORMATS.artifactRevision,
    access_verification_posture: "CALLER_DECLARED_UNVERIFIED_NO_AVAILABILITY_OR_LICENSE_CHECK",
    artifact_digest: publicDigest,
    authored_by_controller_ids: [challenger.controller_id],
    authorship: "CALLER_DECLARED_NOT_IDENTITY_VERIFIED",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    declared_access_policy: "PUBLIC_OPEN_NONEXCLUSIVE",
    frozen_at: "2026-08-16T06:30:00.000Z",
    manifest_digest: digest(`garden:challenge:${challengeLabel}:manifest`),
    ownership_transfer: false,
    payment_buys: "WORK_DELIVERY_ONLY_NOT_ACCESS_OWNERSHIP_OR_TRUTH",
    prior_art_manifest_ref: researchCase.prior_art_manifest_ref,
    prior_revision_id: null,
    public_content_digest: publicDigest,
    revision_number: 1,
    visibility: "PUBLIC_DIGEST_ONLY",
    work_package_id: challengeWork.work_package_id,
  });
  const e0 = createEvidenceReceipt({
    _format: RESEARCH_FORMATS.evidenceReceipt,
    artifact_revision_id: artifact.artifact_revision_id,
    assessment: "DELIVERY_VALID",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    created_at: "2026-08-16T07:30:00.000Z",
    declared_result_kind: "NOT_APPLICABLE",
    disclosure_lane: "PUBLIC_DIGEST_ONLY",
    evidence_refs: [digest(`garden:challenge:${challengeLabel}:e0-evidence`)],
    issuer_controller_id: challenger.controller_id,
    level: "E0",
    method_ref: digest(`garden:challenge:${challengeLabel}:e0-method`),
    payload: {
      kind: "E0_CALLER_DECLARED_PREREGISTRATION_REFERENCE",
      claim_ref: digest(`garden:challenge:${challengeLabel}:e0-claim`),
      freeze_ref: digest(`garden:challenge:${challengeLabel}:e0-freeze`),
      prior_art_manifest_ref: researchCase.prior_art_manifest_ref,
    },
    work_package_id: challengeWork.work_package_id,
  });
  const e1 = createEvidenceReceipt({
    _format: RESEARCH_FORMATS.evidenceReceipt,
    artifact_revision_id: artifact.artifact_revision_id,
    assessment: "DELIVERY_VALID",
    case_id: researchCase.case_id,
    contains_private_locator: false,
    contains_raw_evidence: false,
    created_at: "2026-08-16T08:30:00.000Z",
    declared_result_kind: "NOT_APPLICABLE",
    disclosure_lane: "PUBLIC_DIGEST_ONLY",
    evidence_refs: [digest(`garden:challenge:${challengeLabel}:e1-evidence`)],
    issuer_controller_id: challenger.controller_id,
    level: "E1",
    method_ref: digest(`garden:challenge:${challengeLabel}:e1-method`),
    payload: {
      kind: "E1_DELIVERY",
      execution_ref: digest(`garden:challenge:${challengeLabel}:e1-execution`),
      protocol_ref: digest(`garden:challenge:${challengeLabel}:e1-protocol`),
    },
    work_package_id: challengeWork.work_package_id,
  });
  const receiptIds = [e0.evidence_receipt_id, e1.evidence_receipt_id].sort();
  const milestone = createMilestone({
    _format: RESEARCH_FORMATS.milestone,
    challenge_head_snapshot_ids: [],
    case_id: researchCase.case_id,
    commitment_id: commitment.commitment_id,
    compensation_schedule_ref: challengeSchedule.schedule_ref,
    declared_result_kind: "NOT_APPLICABLE",
    delivery_approval_review_ids: [],
    delivery_status: "DELIVERED",
    milestone_kind: "CHALLENGE_DELIVERY",
    payment_condition: SIMULATED_PAYMENT_CONDITION,
    required_challenge_ids: [challenge.challenge_id],
    required_receipt_ids: receiptIds,
    required_review_ids: [],
    result_condition: "NOT_CONDITIONED_ON_FAVORABLE_RESULT",
    work_package_id: challengeWork.work_package_id,
  });
  const {
    milestone_id: _oldResearchMilestoneId,
    ...researchMilestoneBody
  } = researchMilestone;
  const restedResearch = createMilestone({
    ...researchMilestoneBody,
    challenge_head_snapshot_ids: [],
    delivery_approval_review_ids: [],
    delivery_status: "RESTED",
    required_challenge_ids: [],
    required_receipt_ids: [],
    required_review_ids: [],
  });
  const reviewerMilestone = base.milestones.find(
    (candidate) => candidate.milestone_kind === "REVIEW_DELIVERY",
  )!;
  const reviewerRequest = base.settlement_requests.find(
    (request) => request.milestone_id === reviewerMilestone.milestone_id,
  )!;
  const reviews = base.reviews
    .filter((review) => review.review_id !== existingResolution.review_id)
    .concat(resolutionReview);
  const milestones = options.preserveResearchSettlement
    ? [...base.milestones, milestone]
    : [restedResearch, reviewerMilestone, milestone];
  const settlementRequests = options.preserveResearchSettlement
    ? [
        ...base.settlement_requests,
        { consumed_receipt_ids: receiptIds, milestone_id: milestone.milestone_id },
      ]
    : [
        reviewerRequest,
        { consumed_receipt_ids: receiptIds, milestone_id: milestone.milestone_id },
      ];
  return {
    ...base,
    artifact_revisions: sorted([...base.artifact_revisions, artifact], (value) => value.artifact_revision_id),
    challenges: sorted(
      challenge.challenge_id === openChallenge.challenge_id
        ? [openChallenge]
        : [openChallenge, challenge],
      (value) => value.challenge_id,
    ),
    controllers: sorted([...base.controllers, challenger], (value) => value.controller_id),
    evidence_receipts: sorted([...base.evidence_receipts, e0, e1], (value) => value.evidence_receipt_id),
    milestones: sorted(milestones, (value) => value.milestone_id),
    reviews: sorted(reviews, (value) => value.review_id),
    settlement_requests: settlementRequests
      .sort((left, right) => left.milestone_id.localeCompare(right.milestone_id, "en")),
    work_packages: sorted([...base.work_packages, challengeWork], (value) => value.work_package_id),
  };
}
