import { deepFreeze, domainSeparatedId, parseStrictJson, snapshotJson } from "./canonical.js";
import {
  DECLARED_RESULT_KINDS,
  DISCLOSURE_LANE,
  EVIDENCE_LEVELS,
  MATH_PROOFCRAFT_NODE_ID,
  MATH_PROOFCRAFT_NODE_SHA256,
  RESEARCH_FORMATS,
  RESULT_AUTHORITY,
  SIX_LEDGER_PROFILE_DIGEST,
  SIX_LEDGER_PROFILE_ID,
  SIMULATED_CREDIT_UNIT,
  SIMULATED_PAYMENT_CONDITION,
  ZERONE_TREE_RAW_SHA256,
  ZERONE_TREE_SCHEMA,
} from "./constants.js";
import { fail } from "./errors.js";
import type { JsonValue } from "./canonical.js";
import type {
  ArtifactRevision,
  ArtifactRevisionBody,
  Challenge,
  ChallengeBody,
  CommitmentBalance,
  DeclaredResultKind,
  EffectiveController,
  EffectiveControllerBody,
  EvidencePayload,
  EvidenceReceipt,
  EvidenceReceiptBody,
  FundingCommitment,
  FundingCommitmentBody,
  Milestone,
  MilestoneBody,
  NodeRef,
  NodeRefBody,
  PublicProjection,
  PublicProjectionBody,
  ResearchCase,
  ResearchCaseBody,
  ResearchSimulation,
  Review,
  ReviewBody,
  SettlementBundle,
  SettlementBundleBody,
  SettlementRequest,
  Sha256Id,
  SimulationState,
  SimulationStateBody,
  WorkPackage,
  WorkPackageBody,
} from "./types.js";
import {
  arrayValue,
  assertPublicDigestOnly,
  assertUniqueIds,
  boundedText,
  enumValue,
  evidenceLevel,
  exactKeys,
  isoTimestamp,
  literal,
  nonNegativeInteger,
  nullableSha256,
  participationRights,
  positiveInteger,
  publicSafeLane,
  record,
  sha256,
  sixLedgerProfile,
  sortedUniqueDigests,
  zeroEffects,
} from "./validation.js";

const NODE_REF_BODY_KEYS = [
  "_format",
  "anchor_kind",
  "canonicalization",
  "live_fact",
  "network_observed",
  "node_digest",
  "node_id",
  "result_authority",
  "reward_bearing",
  "tree_raw_sha256",
  "tree_schema",
] as const;

const CONTROLLER_BODY_KEYS = [
  "_format",
  "data_root",
  "funding_root",
  "independence_posture",
  "identity_inferred",
  "model_root",
  "operator_root",
  "organization_root",
  "toolchain_root",
] as const;

const CASE_BODY_KEYS = [
  "_format",
  "ledger_profile",
  "maximum_evidence_level",
  "node_ref",
  "prior_art_manifest_ref",
  "question_ref",
  "result_authority",
  "safety",
  "scope_ref",
  "status",
  "title_ref",
] as const;

const COMMITMENT_BODY_KEYS = [
  "_format",
  "case_id",
  "commitment_status",
  "convertible",
  "effects",
  "funder_controller_id",
  "payment_condition",
  "real_value_status",
  "result_authority",
  "simulation_backing",
  "simulated_credit_limit",
  "transferable",
  "unit",
  "valid_declared_result_kinds",
  "wallet_bearing",
] as const;

const WORK_BODY_KEYS = [
  "_format",
  "case_id",
  "commitment_id",
  "compensation_schedule",
  "deliverable_ref",
  "lead_controller_id",
  "maximum_evidence_level",
  "objective_ref",
  "participation_rights",
  "status",
] as const;

const SCHEDULE_KEYS = [
  "_format",
  "amount",
  "declared_result_invariant",
  "frozen_at",
  "frozen_before_work",
  "payment_condition",
  "review_decision_invariant",
  "schedule_ref",
  "unit",
] as const;

function objectSnapshot(value: unknown, path: string): Record<string, JsonValue> {
  return record(snapshotJson(value), path);
}

function bodyWithoutId(value: Record<string, JsonValue>, idKey: string): Record<string, JsonValue> {
  const body: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, member] of Object.entries(value)) {
    if (key !== idKey) body[key] = member;
  }
  return body;
}

function assertRecordId(
  value: Record<string, JsonValue>,
  idKey: string,
  domain: string,
  path: string,
): Sha256Id {
  const actual = sha256(value[idKey], `${path}.${idKey}`);
  const expected = domainSeparatedId(domain, bodyWithoutId(value, idKey));
  if (actual !== expected) fail("integrity_error", `${path}.${idKey} does not bind its body`);
  return actual;
}

function addRecordId<T>(body: unknown, idKey: string, domain: string): T {
  const snapshot = objectSnapshot(body, "$body");
  const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, value] of Object.entries(snapshot)) output[key] = value;
  output[idKey] = domainSeparatedId(domain, snapshot);
  return deepFreeze(output) as unknown as T;
}

function declaredResultKind(value: JsonValue | undefined, path: string): DeclaredResultKind {
  return enumValue(value, DECLARED_RESULT_KINDS, path);
}

function validateNodeRefBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): NodeRefBody {
  exactKeys(value, NODE_REF_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.nodeRef, `${path}._format`);
  literal(value.anchor_kind, "STATIC_CAPABILITY_REFERENCE", `${path}.anchor_kind`);
  literal(
    value.canonicalization,
    "RECURSIVE_UNICODE_CODE_POINT_KEYS_COMPACT_JSON",
    `${path}.canonicalization`,
  );
  literal(value.live_fact, false, `${path}.live_fact`);
  literal(value.network_observed, false, `${path}.network_observed`);
  literal(value.node_digest, MATH_PROOFCRAFT_NODE_SHA256, `${path}.node_digest`);
  literal(value.node_id, MATH_PROOFCRAFT_NODE_ID, `${path}.node_id`);
  literal(value.result_authority, RESULT_AUTHORITY, `${path}.result_authority`);
  literal(value.reward_bearing, false, `${path}.reward_bearing`);
  literal(value.tree_raw_sha256, ZERONE_TREE_RAW_SHA256, `${path}.tree_raw_sha256`);
  literal(value.tree_schema, ZERONE_TREE_SCHEMA, `${path}.tree_schema`);
  return value as unknown as NodeRefBody;
}

export function validateNodeRef(input: unknown, path = "$node_ref"): NodeRef {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...NODE_REF_BODY_KEYS, "node_ref_id"], path);
  validateNodeRefBodyValue(bodyWithoutId(value, "node_ref_id"), path);
  assertRecordId(value, "node_ref_id", RESEARCH_FORMATS.nodeRef, path);
  return deepFreeze(value) as unknown as NodeRef;
}

export function createNodeRef(body: NodeRefBody): NodeRef {
  validateNodeRefBodyValue(objectSnapshot(body, "$node_ref"), "$node_ref");
  return validateNodeRef(
    addRecordId<NodeRef>(body, "node_ref_id", RESEARCH_FORMATS.nodeRef),
  );
}

function validateControllerBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): EffectiveControllerBody {
  exactKeys(value, CONTROLLER_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.controller, `${path}._format`);
  for (const key of [
    "data_root",
    "funding_root",
    "model_root",
    "operator_root",
    "organization_root",
    "toolchain_root",
  ] as const) sha256(value[key], `${path}.${key}`);
  literal(
    value.independence_posture,
    "DECLARATION_ONLY_NOT_INDEPENDENCE_PROOF",
    `${path}.independence_posture`,
  );
  literal(value.identity_inferred, false, `${path}.identity_inferred`);
  return value as unknown as EffectiveControllerBody;
}

export function validateEffectiveController(
  input: unknown,
  path = "$controller",
): EffectiveController {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...CONTROLLER_BODY_KEYS, "controller_id"], path);
  validateControllerBodyValue(bodyWithoutId(value, "controller_id"), path);
  assertRecordId(value, "controller_id", RESEARCH_FORMATS.controller, path);
  return deepFreeze(value) as unknown as EffectiveController;
}

export function createEffectiveController(body: EffectiveControllerBody): EffectiveController {
  validateControllerBodyValue(objectSnapshot(body, "$controller"), "$controller");
  return validateEffectiveController(
    addRecordId<EffectiveController>(body, "controller_id", RESEARCH_FORMATS.controller),
  );
}

function validateResearchCaseBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): ResearchCaseBody {
  exactKeys(value, CASE_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.researchCase, `${path}._format`);
  sixLedgerProfile(value.ledger_profile, `${path}.ledger_profile`);
  evidenceLevel(value.maximum_evidence_level, `${path}.maximum_evidence_level`);
  validateNodeRef(value.node_ref, `${path}.node_ref`);
  for (const key of ["prior_art_manifest_ref", "question_ref", "scope_ref", "title_ref"] as const) {
    sha256(value[key], `${path}.${key}`);
  }
  literal(value.result_authority, RESULT_AUTHORITY, `${path}.result_authority`);
  const safety = record(value.safety, `${path}.safety`);
  exactKeys(
    safety,
    ["exclusions", "risk_class", "safety_review_ref", "verification_posture"],
    `${path}.safety`,
  );
  publicSafeLane(safety.exclusions, `${path}.safety.exclusions`);
  literal(safety.risk_class, "PUBLIC_SAFE_THEORETICAL_ONLY", `${path}.safety.risk_class`);
  if (safety.safety_review_ref !== null) {
    fail("validation_error", `${path}.safety_review_ref must be null in the v0.1 public-safe lane`);
  }
  literal(
    safety.verification_posture,
    "CALLER_DECLARED_UNVERIFIED_NO_SAFETY_REVIEW",
    `${path}.safety.verification_posture`,
  );
  literal(value.status, "SHADOW_ONLY", `${path}.status`);
  return value as unknown as ResearchCaseBody;
}

export function validateResearchCase(input: unknown, path = "$case"): ResearchCase {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...CASE_BODY_KEYS, "case_id"], path);
  validateResearchCaseBodyValue(bodyWithoutId(value, "case_id"), path);
  assertRecordId(value, "case_id", RESEARCH_FORMATS.researchCase, path);
  return deepFreeze(value) as unknown as ResearchCase;
}

export function createResearchCase(body: ResearchCaseBody): ResearchCase {
  validateResearchCaseBodyValue(objectSnapshot(body, "$case"), "$case");
  return validateResearchCase(
    addRecordId<ResearchCase>(body, "case_id", RESEARCH_FORMATS.researchCase),
  );
}

function validateFundingCommitmentBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): FundingCommitmentBody {
  exactKeys(value, COMMITMENT_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.fundingCommitment, `${path}._format`);
  sha256(value.case_id, `${path}.case_id`);
  literal(
    value.commitment_status,
    "SIMULATION_PREFUNDED_REAL_VALUE_NONE",
    `${path}.commitment_status`,
  );
  literal(value.convertible, false, `${path}.convertible`);
  zeroEffects(value.effects, `${path}.effects`);
  sha256(value.funder_controller_id, `${path}.funder_controller_id`);
  literal(value.payment_condition, SIMULATED_PAYMENT_CONDITION, `${path}.payment_condition`);
  literal(value.real_value_status, "NONE", `${path}.real_value_status`);
  literal(value.result_authority, RESULT_AUTHORITY, `${path}.result_authority`);
  literal(value.simulation_backing, "PREFUNDED", `${path}.simulation_backing`);
  positiveInteger(value.simulated_credit_limit, `${path}.simulated_credit_limit`);
  literal(value.transferable, false, `${path}.transferable`);
  literal(value.unit, SIMULATED_CREDIT_UNIT, `${path}.unit`);
  literal(
    value.valid_declared_result_kinds,
    DECLARED_RESULT_KINDS,
    `${path}.valid_declared_result_kinds`,
  );
  literal(value.wallet_bearing, false, `${path}.wallet_bearing`);
  return value as unknown as FundingCommitmentBody;
}

export function validateFundingCommitment(
  input: unknown,
  path = "$funding_commitment",
): FundingCommitment {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...COMMITMENT_BODY_KEYS, "commitment_id"], path);
  validateFundingCommitmentBodyValue(bodyWithoutId(value, "commitment_id"), path);
  assertRecordId(value, "commitment_id", RESEARCH_FORMATS.fundingCommitment, path);
  return deepFreeze(value) as unknown as FundingCommitment;
}

export function createFundingCommitment(body: FundingCommitmentBody): FundingCommitment {
  validateFundingCommitmentBodyValue(objectSnapshot(body, "$funding_commitment"), "$funding_commitment");
  return validateFundingCommitment(
    addRecordId<FundingCommitment>(
      body,
      "commitment_id",
      RESEARCH_FORMATS.fundingCommitment,
    ),
  );
}

function validateSchedule(value: JsonValue | undefined, path: string): WorkPackageBody["compensation_schedule"] {
  const schedule = record(value, path);
  exactKeys(schedule, SCHEDULE_KEYS, path);
  literal(schedule._format, RESEARCH_FORMATS.compensationSchedule, `${path}._format`);
  positiveInteger(schedule.amount, `${path}.amount`);
  literal(schedule.declared_result_invariant, true, `${path}.declared_result_invariant`);
  isoTimestamp(schedule.frozen_at, `${path}.frozen_at`);
  literal(schedule.frozen_before_work, true, `${path}.frozen_before_work`);
  literal(schedule.payment_condition, SIMULATED_PAYMENT_CONDITION, `${path}.payment_condition`);
  literal(schedule.review_decision_invariant, true, `${path}.review_decision_invariant`);
  literal(schedule.unit, SIMULATED_CREDIT_UNIT, `${path}.unit`);
  const actual = sha256(schedule.schedule_ref, `${path}.schedule_ref`);
  const expected = domainSeparatedId(
    RESEARCH_FORMATS.compensationSchedule,
    bodyWithoutId(schedule, "schedule_ref"),
  );
  if (actual !== expected) fail("integrity_error", `${path}.schedule_ref does not bind the schedule`);
  return schedule as unknown as WorkPackageBody["compensation_schedule"];
}

export function createCompensationSchedule(
  input: Omit<WorkPackageBody["compensation_schedule"], "schedule_ref">,
): WorkPackageBody["compensation_schedule"] {
  const body = objectSnapshot(input, "$compensation_schedule");
  exactKeys(body, SCHEDULE_KEYS.filter((key) => key !== "schedule_ref"), "$compensation_schedule");
  const schedule = {
    ...body,
    schedule_ref: domainSeparatedId(RESEARCH_FORMATS.compensationSchedule, body),
  };
  return deepFreeze(validateSchedule(snapshotJson(schedule), "$compensation_schedule"));
}

function validateWorkPackageBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): WorkPackageBody {
  exactKeys(value, WORK_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.workPackage, `${path}._format`);
  sha256(value.case_id, `${path}.case_id`);
  sha256(value.commitment_id, `${path}.commitment_id`);
  validateSchedule(value.compensation_schedule, `${path}.compensation_schedule`);
  for (const key of ["deliverable_ref", "lead_controller_id", "objective_ref"] as const) {
    sha256(value[key], `${path}.${key}`);
  }
  evidenceLevel(value.maximum_evidence_level, `${path}.maximum_evidence_level`);
  participationRights(value.participation_rights, `${path}.participation_rights`);
  literal(value.status, "SHADOW_ONLY", `${path}.status`);
  return value as unknown as WorkPackageBody;
}

export function validateWorkPackage(input: unknown, path = "$work_package"): WorkPackage {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...WORK_BODY_KEYS, "work_package_id"], path);
  validateWorkPackageBodyValue(bodyWithoutId(value, "work_package_id"), path);
  assertRecordId(value, "work_package_id", RESEARCH_FORMATS.workPackage, path);
  return deepFreeze(value) as unknown as WorkPackage;
}

export function createWorkPackage(body: WorkPackageBody): WorkPackage {
  validateWorkPackageBodyValue(objectSnapshot(body, "$work_package"), "$work_package");
  return validateWorkPackage(
    addRecordId<WorkPackage>(body, "work_package_id", RESEARCH_FORMATS.workPackage),
  );
}

const ARTIFACT_BODY_KEYS = [
  "_format",
  "access_verification_posture",
  "artifact_digest",
  "authored_by_controller_ids",
  "authorship",
  "case_id",
  "contains_private_locator",
  "contains_raw_evidence",
  "declared_access_policy",
  "frozen_at",
  "manifest_digest",
  "ownership_transfer",
  "payment_buys",
  "prior_art_manifest_ref",
  "prior_revision_id",
  "public_content_digest",
  "revision_number",
  "visibility",
  "work_package_id",
] as const;

const RECEIPT_BODY_KEYS = [
  "_format",
  "artifact_revision_id",
  "assessment",
  "case_id",
  "contains_private_locator",
  "contains_raw_evidence",
  "created_at",
  "declared_result_kind",
  "disclosure_lane",
  "evidence_refs",
  "issuer_controller_id",
  "level",
  "method_ref",
  "payload",
  "work_package_id",
] as const;

function validateArtifactRevisionBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): ArtifactRevisionBody {
  exactKeys(value, ARTIFACT_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.artifactRevision, `${path}._format`);
  literal(
    value.access_verification_posture,
    "CALLER_DECLARED_UNVERIFIED_NO_AVAILABILITY_OR_LICENSE_CHECK",
    `${path}.access_verification_posture`,
  );
  const artifactDigest = sha256(value.artifact_digest, `${path}.artifact_digest`);
  sortedUniqueDigests(value.authored_by_controller_ids, `${path}.authored_by_controller_ids`, 1);
  literal(value.authorship, "CALLER_DECLARED_NOT_IDENTITY_VERIFIED", `${path}.authorship`);
  sha256(value.case_id, `${path}.case_id`);
  literal(value.contains_private_locator, false, `${path}.contains_private_locator`);
  literal(value.contains_raw_evidence, false, `${path}.contains_raw_evidence`);
  literal(value.declared_access_policy, "PUBLIC_OPEN_NONEXCLUSIVE", `${path}.declared_access_policy`);
  isoTimestamp(value.frozen_at, `${path}.frozen_at`);
  sha256(value.manifest_digest, `${path}.manifest_digest`);
  literal(value.ownership_transfer, false, `${path}.ownership_transfer`);
  literal(
    value.payment_buys,
    "WORK_DELIVERY_ONLY_NOT_ACCESS_OWNERSHIP_OR_TRUTH",
    `${path}.payment_buys`,
  );
  sha256(value.prior_art_manifest_ref, `${path}.prior_art_manifest_ref`);
  nullableSha256(value.prior_revision_id, `${path}.prior_revision_id`);
  const publicDigest = sha256(value.public_content_digest, `${path}.public_content_digest`);
  if (artifactDigest !== publicDigest) {
    fail("integrity_error", `${path}.public_content_digest must be the stable public artifact digest`);
  }
  positiveInteger(value.revision_number, `${path}.revision_number`);
  literal(value.visibility, DISCLOSURE_LANE, `${path}.visibility`);
  sha256(value.work_package_id, `${path}.work_package_id`);
  assertPublicDigestOnly(value, path);
  return value as unknown as ArtifactRevisionBody;
}

export function validateArtifactRevision(
  input: unknown,
  path = "$artifact_revision",
): ArtifactRevision {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...ARTIFACT_BODY_KEYS, "artifact_revision_id"], path);
  validateArtifactRevisionBodyValue(bodyWithoutId(value, "artifact_revision_id"), path);
  assertRecordId(value, "artifact_revision_id", RESEARCH_FORMATS.artifactRevision, path);
  return deepFreeze(value) as unknown as ArtifactRevision;
}

export function createArtifactRevision(body: ArtifactRevisionBody): ArtifactRevision {
  validateArtifactRevisionBodyValue(objectSnapshot(body, "$artifact_revision"), "$artifact_revision");
  return validateArtifactRevision(
    addRecordId<ArtifactRevision>(
      body,
      "artifact_revision_id",
      RESEARCH_FORMATS.artifactRevision,
    ),
  );
}

function validateEvidencePayload(
  value: JsonValue | undefined,
  level: string,
  path: string,
): EvidencePayload {
  const payload = record(value, path);
  switch (level) {
    case "E0":
      exactKeys(payload, ["claim_ref", "freeze_ref", "kind", "prior_art_manifest_ref"], path);
      literal(payload.kind, "E0_CALLER_DECLARED_PREREGISTRATION_REFERENCE", `${path}.kind`);
      sha256(payload.claim_ref, `${path}.claim_ref`);
      sha256(payload.freeze_ref, `${path}.freeze_ref`);
      sha256(payload.prior_art_manifest_ref, `${path}.prior_art_manifest_ref`);
      break;
    case "E1":
      exactKeys(payload, ["execution_ref", "kind", "protocol_ref"], path);
      literal(payload.kind, "E1_DELIVERY", `${path}.kind`);
      sha256(payload.execution_ref, `${path}.execution_ref`);
      sha256(payload.protocol_ref, `${path}.protocol_ref`);
      break;
    case "E2":
      exactKeys(payload, ["checker_ref", "kind", "test_corpus_ref"], path);
      literal(payload.kind, "E2_BOUNDED_CHECK", `${path}.kind`);
      sha256(payload.checker_ref, `${path}.checker_ref`);
      sha256(payload.test_corpus_ref, `${path}.test_corpus_ref`);
      break;
    case "E3":
      exactKeys(payload, ["case_refs", "execution_environment_ref", "implementation_root", "kind"], path);
      literal(payload.kind, "E3_DECLARED_UNPROVEN_REPRODUCTION", `${path}.kind`);
      sortedUniqueDigests(payload.case_refs, `${path}.case_refs`, 2);
      sha256(payload.execution_environment_ref, `${path}.execution_environment_ref`);
      sha256(payload.implementation_root, `${path}.implementation_root`);
      break;
    case "E4":
      exactKeys(payload, ["challenge_id", "kind", "repair_ref"], path);
      literal(payload.kind, "E4_CHALLENGE_OR_REPAIR", `${path}.kind`);
      sha256(payload.challenge_id, `${path}.challenge_id`);
      nullableSha256(payload.repair_ref, `${path}.repair_ref`);
      break;
    case "E5":
      exactKeys(payload, ["adopter_organization_root", "adoption_ref", "kind"], path);
      literal(payload.kind, "E5_DECLARED_UNPROVEN_ADOPTION", `${path}.kind`);
      sha256(payload.adopter_organization_root, `${path}.adopter_organization_root`);
      sha256(payload.adoption_ref, `${path}.adoption_ref`);
      break;
    case "E6":
      exactKeys(payload, ["kind", "maintenance_ref", "maintenance_window_ref"], path);
      literal(payload.kind, "E6_MAINTENANCE", `${path}.kind`);
      sha256(payload.maintenance_ref, `${path}.maintenance_ref`);
      sha256(payload.maintenance_window_ref, `${path}.maintenance_window_ref`);
      break;
    default:
      fail("validation_error", `${path} cannot be interpreted without a known evidence level`);
  }
  return payload as unknown as EvidencePayload;
}

function validateEvidenceReceiptBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): EvidenceReceiptBody {
  exactKeys(value, RECEIPT_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.evidenceReceipt, `${path}._format`);
  sha256(value.artifact_revision_id, `${path}.artifact_revision_id`);
  enumValue(value.assessment, ["DELIVERY_VALID", "DELIVERY_INVALID", "INCONCLUSIVE"], `${path}.assessment`);
  sha256(value.case_id, `${path}.case_id`);
  literal(value.contains_private_locator, false, `${path}.contains_private_locator`);
  literal(value.contains_raw_evidence, false, `${path}.contains_raw_evidence`);
  isoTimestamp(value.created_at, `${path}.created_at`);
  declaredResultKind(value.declared_result_kind, `${path}.declared_result_kind`);
  literal(value.disclosure_lane, DISCLOSURE_LANE, `${path}.disclosure_lane`);
  sortedUniqueDigests(value.evidence_refs, `${path}.evidence_refs`, 1);
  sha256(value.issuer_controller_id, `${path}.issuer_controller_id`);
  const level = evidenceLevel(value.level, `${path}.level`);
  sha256(value.method_ref, `${path}.method_ref`);
  validateEvidencePayload(value.payload, level, `${path}.payload`);
  sha256(value.work_package_id, `${path}.work_package_id`);
  assertPublicDigestOnly(value, path);
  return value as unknown as EvidenceReceiptBody;
}

export function validateEvidenceReceipt(
  input: unknown,
  path = "$evidence_receipt",
): EvidenceReceipt {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...RECEIPT_BODY_KEYS, "evidence_receipt_id"], path);
  validateEvidenceReceiptBodyValue(bodyWithoutId(value, "evidence_receipt_id"), path);
  assertRecordId(value, "evidence_receipt_id", RESEARCH_FORMATS.evidenceReceipt, path);
  return deepFreeze(value) as unknown as EvidenceReceipt;
}

export function createEvidenceReceipt(body: EvidenceReceiptBody): EvidenceReceipt {
  validateEvidenceReceiptBodyValue(objectSnapshot(body, "$evidence_receipt"), "$evidence_receipt");
  return validateEvidenceReceipt(
    addRecordId<EvidenceReceipt>(
      body,
      "evidence_receipt_id",
      RESEARCH_FORMATS.evidenceReceipt,
    ),
  );
}

const REVIEW_BODY_KEYS = [
  "_format",
  "artifact_revision_id",
  "case_id",
  "conflict_refs",
  "conflict_status",
  "decision",
  "outcome_independent_compensation",
  "review_scope",
  "reviewed_at",
  "reviewed_receipt_ids",
  "reviewer_controller_id",
  "scientific_adjudication",
  "work_package_id",
] as const;

const CHALLENGE_BODY_KEYS = [
  "_format",
  "automatic_slash",
  "case_id",
  "challenge_kind",
  "challenge_ref",
  "challenger_controller_id",
  "created_at",
  "evidence_refs",
  "good_faith_no_penalty",
  "prior_challenge_id",
  "resolution_effect",
  "resolution_posture",
  "resolution_review_id",
  "revision_number",
  "scientific_adjudication",
  "status",
  "target_receipt_id",
  "work_package_id",
] as const;

const MILESTONE_BODY_KEYS = [
  "_format",
  "case_id",
  "challenge_head_snapshot_ids",
  "commitment_id",
  "compensation_schedule_ref",
  "declared_result_kind",
  "delivery_approval_review_ids",
  "delivery_status",
  "milestone_kind",
  "payment_condition",
  "required_challenge_ids",
  "required_receipt_ids",
  "required_review_ids",
  "result_condition",
  "work_package_id",
] as const;

function validateReviewBodyValue(value: Record<string, JsonValue>, path: string): ReviewBody {
  exactKeys(value, REVIEW_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.review, `${path}._format`);
  sha256(value.artifact_revision_id, `${path}.artifact_revision_id`);
  sha256(value.case_id, `${path}.case_id`);
  const conflicts = sortedUniqueDigests(value.conflict_refs, `${path}.conflict_refs`);
  const conflictStatus = enumValue(
    value.conflict_status,
    ["DISCLOSED_RECUSED", "NONE_DECLARED"],
    `${path}.conflict_status`,
  );
  const decision = enumValue(
    value.decision,
    [
      "ABSTAINED",
      "DELIVERY_ACCEPTED",
      "DELIVERY_INCONCLUSIVE",
      "DELIVERY_REJECTED",
      "REVISION_REQUESTED",
    ],
    `${path}.decision`,
  );
  if (conflictStatus === "NONE_DECLARED" && conflicts.length !== 0) {
    fail("validation_error", `${path}.conflict_refs must be empty when no conflict is declared`);
  }
  if (conflictStatus === "DISCLOSED_RECUSED" && (conflicts.length === 0 || decision !== "ABSTAINED")) {
    fail("validation_error", `${path} disclosed conflicts require refs and recusal`);
  }
  literal(
    value.outcome_independent_compensation,
    true,
    `${path}.outcome_independent_compensation`,
  );
  literal(
    value.review_scope,
    "DELIVERY_COMPLETENESS_NOT_SCIENTIFIC_TRUTH",
    `${path}.review_scope`,
  );
  isoTimestamp(value.reviewed_at, `${path}.reviewed_at`);
  sortedUniqueDigests(value.reviewed_receipt_ids, `${path}.reviewed_receipt_ids`, 1);
  sha256(value.reviewer_controller_id, `${path}.reviewer_controller_id`);
  literal(value.scientific_adjudication, false, `${path}.scientific_adjudication`);
  sha256(value.work_package_id, `${path}.work_package_id`);
  return value as unknown as ReviewBody;
}

export function validateReview(input: unknown, path = "$review"): Review {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...REVIEW_BODY_KEYS, "review_id"], path);
  validateReviewBodyValue(bodyWithoutId(value, "review_id"), path);
  assertRecordId(value, "review_id", RESEARCH_FORMATS.review, path);
  return deepFreeze(value) as unknown as Review;
}

export function createReview(body: ReviewBody): Review {
  validateReviewBodyValue(objectSnapshot(body, "$review"), "$review");
  return validateReview(addRecordId<Review>(body, "review_id", RESEARCH_FORMATS.review));
}

function validateChallengeBodyValue(value: Record<string, JsonValue>, path: string): ChallengeBody {
  exactKeys(value, CHALLENGE_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.challenge, `${path}._format`);
  literal(value.automatic_slash, false, `${path}.automatic_slash`);
  sha256(value.case_id, `${path}.case_id`);
  enumValue(value.challenge_kind, ["FALSIFIER", "METHODOLOGY", "PROVENANCE", "REPLICATION"], `${path}.challenge_kind`);
  sha256(value.challenge_ref, `${path}.challenge_ref`);
  sha256(value.challenger_controller_id, `${path}.challenger_controller_id`);
  isoTimestamp(value.created_at, `${path}.created_at`);
  sortedUniqueDigests(value.evidence_refs, `${path}.evidence_refs`, 1);
  literal(value.good_faith_no_penalty, true, `${path}.good_faith_no_penalty`);
  const prior = nullableSha256(value.prior_challenge_id, `${path}.prior_challenge_id`);
  literal(value.resolution_effect, "SHADOW_DELIVERY_HOLD_ONLY", `${path}.resolution_effect`);
  literal(
    value.resolution_posture,
    "CALLER_DECLARED_UNVERIFIED_NO_AUTHORITY",
    `${path}.resolution_posture`,
  );
  const resolution = nullableSha256(value.resolution_review_id, `${path}.resolution_review_id`);
  const revision = positiveInteger(value.revision_number, `${path}.revision_number`);
  literal(value.scientific_adjudication, false, `${path}.scientific_adjudication`);
  const status = enumValue(
    value.status,
    [
      "CALLER_DECLARED_HOLD_CONTINUES",
      "CALLER_DECLARED_HOLD_INCONCLUSIVE",
      "CALLER_DECLARED_HOLD_RELEASED",
      "OPEN",
      "WITHDRAWN",
    ],
    `${path}.status`,
  );
  sha256(value.target_receipt_id, `${path}.target_receipt_id`);
  sha256(value.work_package_id, `${path}.work_package_id`);
  if ((revision === 1) !== (prior === null)) {
    fail("validation_error", `${path} revision 1 must have no prior; later revisions require one`);
  }
  if (revision === 1 && status !== "OPEN") {
    fail("validation_error", `${path} revision 1 must begin OPEN`);
  }
  if ((status === "OPEN" || status === "WITHDRAWN") && resolution !== null) {
    fail("validation_error", `${path}.resolution_review_id must be null for ${status}`);
  }
  if (!["OPEN", "WITHDRAWN"].includes(status) && resolution === null) {
    fail("validation_error", `${path}.resolution_review_id is required for a resolved challenge`);
  }
  return value as unknown as ChallengeBody;
}

export function validateChallenge(input: unknown, path = "$challenge"): Challenge {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...CHALLENGE_BODY_KEYS, "challenge_id"], path);
  validateChallengeBodyValue(bodyWithoutId(value, "challenge_id"), path);
  assertRecordId(value, "challenge_id", RESEARCH_FORMATS.challenge, path);
  return deepFreeze(value) as unknown as Challenge;
}

export function createChallenge(body: ChallengeBody): Challenge {
  validateChallengeBodyValue(objectSnapshot(body, "$challenge"), "$challenge");
  return validateChallenge(
    addRecordId<Challenge>(body, "challenge_id", RESEARCH_FORMATS.challenge),
  );
}

function validateMilestoneBodyValue(value: Record<string, JsonValue>, path: string): MilestoneBody {
  exactKeys(value, MILESTONE_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.milestone, `${path}._format`);
  for (const key of ["case_id", "commitment_id", "compensation_schedule_ref", "work_package_id"] as const) {
    sha256(value[key], `${path}.${key}`);
  }
  declaredResultKind(value.declared_result_kind, `${path}.declared_result_kind`);
  const approvals = sortedUniqueDigests(
    value.delivery_approval_review_ids,
    `${path}.delivery_approval_review_ids`,
  );
  const delivery = enumValue(
    value.delivery_status,
    ["DELIVERED", "EXITED", "NOT_DELIVERED", "REFUSED", "RESTED"],
    `${path}.delivery_status`,
  );
  const milestoneKind = enumValue(
    value.milestone_kind,
    ["CHALLENGE_DELIVERY", "RESEARCH_DELIVERY", "REVIEW_DELIVERY"],
    `${path}.milestone_kind`,
  );
  literal(value.payment_condition, SIMULATED_PAYMENT_CONDITION, `${path}.payment_condition`);
  const challenges = sortedUniqueDigests(value.required_challenge_ids, `${path}.required_challenge_ids`);
  const challengeHeadSnapshot = sortedUniqueDigests(
    value.challenge_head_snapshot_ids,
    `${path}.challenge_head_snapshot_ids`,
  );
  const receipts = sortedUniqueDigests(value.required_receipt_ids, `${path}.required_receipt_ids`);
  const reviews = sortedUniqueDigests(value.required_review_ids, `${path}.required_review_ids`);
  literal(
    value.result_condition,
    "NOT_CONDITIONED_ON_FAVORABLE_RESULT",
    `${path}.result_condition`,
  );
  if (delivery === "DELIVERED" && receipts.length === 0) {
    fail(
      "validation_error",
      `${path} delivery requires its own nonempty delivery receipts`,
    );
  }
  if (delivery === "DELIVERED" && milestoneKind === "RESEARCH_DELIVERY" && approvals.length === 0) {
    fail("validation_error", `${path} research delivery requires separate completeness approval`);
  }
  if (delivery === "DELIVERED" && milestoneKind !== "RESEARCH_DELIVERY" && approvals.length !== 0) {
    fail("validation_error", `${path} review/challenge delivery forbids recursive approval work`);
  }
  if (delivery === "DELIVERED" && milestoneKind === "CHALLENGE_DELIVERY" && challenges.length === 0) {
    fail("validation_error", `${path} challenge delivery requires a challenge reference`);
  }
  if (delivery === "DELIVERED" && milestoneKind !== "CHALLENGE_DELIVERY" && challenges.length !== 0) {
    fail("validation_error", `${path} non-challenge delivery forbids challenge references`);
  }
  if (delivery === "DELIVERED" && milestoneKind === "REVIEW_DELIVERY" && reviews.length === 0) {
    fail("validation_error", `${path} review delivery requires a delivered review reference`);
  }
  if (delivery === "DELIVERED" && milestoneKind !== "REVIEW_DELIVERY" && reviews.length !== 0) {
    fail("validation_error", `${path} non-review delivery forbids delivered review references`);
  }
  if (reviews.some((id) => approvals.includes(id))) {
    fail("validation_error", `${path} delivered review work cannot approve itself`);
  }
  if (challenges.some((id) => challengeHeadSnapshot.includes(id))) {
    fail("validation_error", `${path} delivered challenge work cannot be its own challenge-head gate`);
  }
  if (
    delivery !== "DELIVERED" &&
    (
      approvals.length !== 0 ||
      challengeHeadSnapshot.length !== 0 ||
      challenges.length !== 0 ||
      receipts.length !== 0 ||
      reviews.length !== 0
    )
  ) {
    fail("validation_error", `${path} non-delivery must not consume or gate on any record`);
  }
  return value as unknown as MilestoneBody;
}

export function validateMilestone(input: unknown, path = "$milestone"): Milestone {
  const value = objectSnapshot(input, path);
  exactKeys(value, [...MILESTONE_BODY_KEYS, "milestone_id"], path);
  validateMilestoneBodyValue(bodyWithoutId(value, "milestone_id"), path);
  assertRecordId(value, "milestone_id", RESEARCH_FORMATS.milestone, path);
  return deepFreeze(value) as unknown as Milestone;
}

export function createMilestone(body: MilestoneBody): Milestone {
  validateMilestoneBodyValue(objectSnapshot(body, "$milestone"), "$milestone");
  return validateMilestone(
    addRecordId<Milestone>(body, "milestone_id", RESEARCH_FORMATS.milestone),
  );
}

const SETTLEMENT_BODY_KEYS = [
  "_format",
  "case_id",
  "commitment_id",
  "consumed_receipt_ids",
  "declared_result_kind",
  "effects",
  "milestone_id",
  "payment_condition",
  "result_authority",
  "simulated_credit",
] as const;

const PROJECTION_BODY_KEYS = [
  "_format",
  "boundaries",
  "case_id",
  "disclosure_lane",
  "effects",
  "highest_evidence_level",
  "node_ref",
  "public_artifact_revision_ids",
  "public_evidence_receipt_ids",
  "result_authority",
  "settlement_bundle_ids",
  "six_ledger_boundary",
  "status",
] as const;

const STATE_BODY_KEYS = [
  "_format",
  "closed_milestone_ids",
  "commitment_balances",
  "consumed_receipt_ids",
  "observed_challenge_ids",
  "observed_work_package_ids",
  "reconciled_schedule_refs",
  "settled_milestone_ids",
  "settlement_bundle_ids",
] as const;

function validateSettlementBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): SettlementBundleBody {
  exactKeys(value, SETTLEMENT_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.settlementBundle, `${path}._format`);
  sha256(value.case_id, `${path}.case_id`);
  sha256(value.commitment_id, `${path}.commitment_id`);
  sortedUniqueDigests(value.consumed_receipt_ids, `${path}.consumed_receipt_ids`, 1);
  declaredResultKind(value.declared_result_kind, `${path}.declared_result_kind`);
  zeroEffects(value.effects, `${path}.effects`);
  sha256(value.milestone_id, `${path}.milestone_id`);
  literal(value.payment_condition, SIMULATED_PAYMENT_CONDITION, `${path}.payment_condition`);
  literal(value.result_authority, RESULT_AUTHORITY, `${path}.result_authority`);
  const credit = record(value.simulated_credit, `${path}.simulated_credit`);
  exactKeys(credit, ["amount", "unit"], `${path}.simulated_credit`);
  nonNegativeInteger(credit.amount, `${path}.simulated_credit.amount`);
  literal(credit.unit, SIMULATED_CREDIT_UNIT, `${path}.simulated_credit.unit`);
  assertPublicDigestOnly(value, path);
  return value as unknown as SettlementBundleBody;
}

export function validateSettlementBundle(
  input: unknown,
  path = "$settlement_bundle",
): SettlementBundle {
  const value = objectSnapshot(input, path);
  exactKeys(value, ["settlement", "settlement_id"], path);
  const settlement = record(value.settlement, `${path}.settlement`);
  validateSettlementBodyValue(settlement, `${path}.settlement`);
  const actual = sha256(value.settlement_id, `${path}.settlement_id`);
  const expected = domainSeparatedId(RESEARCH_FORMATS.settlementBundle, settlement);
  if (actual !== expected) fail("integrity_error", `${path}.settlement_id does not bind settlement`);
  assertPublicDigestOnly(value, path);
  return deepFreeze(value) as unknown as SettlementBundle;
}

export function createSettlementBundle(body: SettlementBundleBody): SettlementBundle {
  const settlement = objectSnapshot(body, "$settlement");
  validateSettlementBodyValue(settlement, "$settlement");
  return validateSettlementBundle({
    settlement,
    settlement_id: domainSeparatedId(RESEARCH_FORMATS.settlementBundle, settlement),
  });
}

function validatePublicProjectionBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): PublicProjectionBody {
  exactKeys(value, PROJECTION_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.publicProjection, `${path}._format`);
  const boundaries = record(value.boundaries, `${path}.boundaries`);
  exactKeys(
    boundaries,
    ["authoritative", "private_locator_included", "raw_evidence_included", "scientific_correctness_determined"],
    `${path}.boundaries`,
  );
  for (const key of [
    "authoritative",
    "private_locator_included",
    "raw_evidence_included",
    "scientific_correctness_determined",
  ] as const) literal(boundaries[key], false, `${path}.boundaries.${key}`);
  sha256(value.case_id, `${path}.case_id`);
  literal(value.disclosure_lane, DISCLOSURE_LANE, `${path}.disclosure_lane`);
  zeroEffects(value.effects, `${path}.effects`);
  if (value.highest_evidence_level !== null) {
    const level = evidenceLevel(value.highest_evidence_level, `${path}.highest_evidence_level`);
    if (!(["E0", "E1", "E2"] as const).includes(level as "E0" | "E1" | "E2")) {
      fail("validation_error", `${path}.highest_evidence_level exceeds the public E2 ceiling`);
    }
  }
  validateNodeRef(value.node_ref, `${path}.node_ref`);
  sortedUniqueDigests(value.public_artifact_revision_ids, `${path}.public_artifact_revision_ids`, 1);
  sortedUniqueDigests(value.public_evidence_receipt_ids, `${path}.public_evidence_receipt_ids`, 1);
  literal(value.result_authority, RESULT_AUTHORITY, `${path}.result_authority`);
  const boundary = record(value.six_ledger_boundary, `${path}.six_ledger_boundary`);
  exactKeys(boundary, ["profile_digest", "profile_id"], `${path}.six_ledger_boundary`);
  literal(
    boundary.profile_digest,
    SIX_LEDGER_PROFILE_DIGEST,
    `${path}.six_ledger_boundary.profile_digest`,
  );
  literal(boundary.profile_id, SIX_LEDGER_PROFILE_ID, `${path}.six_ledger_boundary.profile_id`);
  sortedUniqueDigests(value.settlement_bundle_ids, `${path}.settlement_bundle_ids`, 1, 1);
  literal(value.status, "SHADOW_ONLY", `${path}.status`);
  assertPublicDigestOnly(value, path);
  return value as unknown as PublicProjectionBody;
}

export function validatePublicProjection(
  input: unknown,
  path = "$public_projection",
): PublicProjection {
  const value = objectSnapshot(input, path);
  exactKeys(value, ["projection", "projection_id"], path);
  const projection = record(value.projection, `${path}.projection`);
  validatePublicProjectionBodyValue(projection, `${path}.projection`);
  const actual = sha256(value.projection_id, `${path}.projection_id`);
  const expected = domainSeparatedId(RESEARCH_FORMATS.publicProjection, projection);
  if (actual !== expected) fail("integrity_error", `${path}.projection_id does not bind projection`);
  assertPublicDigestOnly(value, path);
  return deepFreeze(value) as unknown as PublicProjection;
}

export function createPublicProjection(body: PublicProjectionBody): PublicProjection {
  const projection = objectSnapshot(body, "$projection");
  validatePublicProjectionBodyValue(projection, "$projection");
  return validatePublicProjection({
    projection,
    projection_id: domainSeparatedId(RESEARCH_FORMATS.publicProjection, projection),
  });
}

function validateCommitmentBalance(value: JsonValue, path: string): CommitmentBalance {
  const balance = record(value, path);
  exactKeys(balance, ["available", "commitment_id", "committed", "delivered", "reserved", "unit"], path);
  const available = nonNegativeInteger(balance.available, `${path}.available`);
  sha256(balance.commitment_id, `${path}.commitment_id`);
  const committed = positiveInteger(balance.committed, `${path}.committed`);
  const delivered = nonNegativeInteger(balance.delivered, `${path}.delivered`);
  const reserved = nonNegativeInteger(balance.reserved, `${path}.reserved`);
  if (
    !Number.isSafeInteger(delivered + reserved + available) ||
    committed !== delivered + reserved + available
  ) {
    fail(
      "conservation_error",
      `${path} must satisfy committed = delivered + reserved + available`,
    );
  }
  literal(balance.unit, SIMULATED_CREDIT_UNIT, `${path}.unit`);
  return balance as unknown as CommitmentBalance;
}

function validateStateBodyValue(
  value: Record<string, JsonValue>,
  path: string,
): SimulationStateBody {
  exactKeys(value, STATE_BODY_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.simulationState, `${path}._format`);
  const balances = arrayValue(value.commitment_balances, `${path}.commitment_balances`, 1)
    .map((entry, index) => validateCommitmentBalance(entry, `${path}.commitment_balances[${String(index)}]`));
  for (let index = 1; index < balances.length; index += 1) {
    if (balances[index - 1]!.commitment_id >= balances[index]!.commitment_id) {
      fail("ordering_error", `${path}.commitment_balances must be sorted by unique commitment_id`);
    }
  }
  const consumed = sortedUniqueDigests(value.consumed_receipt_ids, `${path}.consumed_receipt_ids`);
  const closed = sortedUniqueDigests(value.closed_milestone_ids, `${path}.closed_milestone_ids`);
  sortedUniqueDigests(value.observed_challenge_ids, `${path}.observed_challenge_ids`);
  sortedUniqueDigests(value.observed_work_package_ids, `${path}.observed_work_package_ids`);
  sortedUniqueDigests(value.reconciled_schedule_refs, `${path}.reconciled_schedule_refs`);
  sortedUniqueDigests(value.settlement_bundle_ids, `${path}.settlement_bundle_ids`);
  const settled = sortedUniqueDigests(value.settled_milestone_ids, `${path}.settled_milestone_ids`);
  if (settled.some((id) => !closed.includes(id))) {
    fail("conservation_error", `${path}.settled_milestone_ids must be a subset of closed milestones`);
  }
  assertUniqueIds(consumed, `${path}.consumed_receipt_ids`);
  return value as unknown as SimulationStateBody;
}

export function validateSimulationState(input: unknown, path = "$state"): SimulationState {
  const value = objectSnapshot(input, path);
  exactKeys(value, ["state", "state_id"], path);
  const state = record(value.state, `${path}.state`);
  validateStateBodyValue(state, `${path}.state`);
  const actual = sha256(value.state_id, `${path}.state_id`);
  const expected = domainSeparatedId(RESEARCH_FORMATS.simulationState, state);
  if (actual !== expected) fail("integrity_error", `${path}.state_id does not bind state`);
  return deepFreeze(value) as unknown as SimulationState;
}

export function createSimulationState(body: SimulationStateBody): SimulationState {
  const state = objectSnapshot(body, "$state");
  validateStateBodyValue(state, "$state");
  return validateSimulationState({
    state,
    state_id: domainSeparatedId(RESEARCH_FORMATS.simulationState, state),
  });
}

const SIMULATION_KEYS = [
  "_format",
  "artifact_revisions",
  "cases",
  "challenges",
  "controllers",
  "evidence_receipts",
  "funding_commitments",
  "milestones",
  "prior_state",
  "reviews",
  "settlement_requests",
  "work_packages",
] as const;

function validateSortedRecords<T>(
  value: JsonValue | undefined,
  path: string,
  idKey: string,
  validator: (entry: unknown, entryPath: string) => T,
  minimum = 0,
): readonly T[] {
  const entries = arrayValue(value, path, minimum).map((entry, index) =>
    validator(entry, `${path}[${String(index)}]`));
  const ids = entries.map((entry, index) => {
    const asRecord = entry as Record<string, unknown>;
    const id = asRecord[idKey];
    if (typeof id !== "string") fail("integrity_error", `${path}[${String(index)}].${idKey} is absent`);
    return id;
  });
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index - 1]! >= ids[index]!) {
      fail("ordering_error", `${path} must be sorted by unique ${idKey}`);
    }
  }
  return entries;
}

function validateSettlementRequest(value: JsonValue, path: string): SettlementRequest {
  const request = record(value, path);
  exactKeys(request, ["consumed_receipt_ids", "milestone_id"], path);
  sortedUniqueDigests(request.consumed_receipt_ids, `${path}.consumed_receipt_ids`, 1);
  sha256(request.milestone_id, `${path}.milestone_id`);
  return request as unknown as SettlementRequest;
}

export function validateResearchSimulation(
  input: unknown,
  path = "$simulation",
): ResearchSimulation {
  const value = objectSnapshot(input, path);
  exactKeys(value, SIMULATION_KEYS, path);
  literal(value._format, RESEARCH_FORMATS.simulation, `${path}._format`);
  const artifacts = validateSortedRecords(
    value.artifact_revisions,
    `${path}.artifact_revisions`,
    "artifact_revision_id",
    validateArtifactRevision,
    1,
  );
  const cases = validateSortedRecords(value.cases, `${path}.cases`, "case_id", validateResearchCase, 1);
  const challenges = validateSortedRecords(
    value.challenges,
    `${path}.challenges`,
    "challenge_id",
    validateChallenge,
  );
  const controllers = validateSortedRecords(
    value.controllers,
    `${path}.controllers`,
    "controller_id",
    validateEffectiveController,
    2,
  );
  const receipts = validateSortedRecords(
    value.evidence_receipts,
    `${path}.evidence_receipts`,
    "evidence_receipt_id",
    validateEvidenceReceipt,
    1,
  );
  const commitments = validateSortedRecords(
    value.funding_commitments,
    `${path}.funding_commitments`,
    "commitment_id",
    validateFundingCommitment,
    1,
  );
  const milestones = validateSortedRecords(
    value.milestones,
    `${path}.milestones`,
    "milestone_id",
    validateMilestone,
    1,
  );
  const reviews = validateSortedRecords(value.reviews, `${path}.reviews`, "review_id", validateReview);
  const workPackages = validateSortedRecords(
    value.work_packages,
    `${path}.work_packages`,
    "work_package_id",
    validateWorkPackage,
    1,
  );
  const requests = arrayValue(value.settlement_requests, `${path}.settlement_requests`)
    .map((entry, index) => validateSettlementRequest(entry, `${path}.settlement_requests[${String(index)}]`));
  for (let index = 1; index < requests.length; index += 1) {
    if (requests[index - 1]!.milestone_id >= requests[index]!.milestone_id) {
      fail("ordering_error", `${path}.settlement_requests must be sorted by unique milestone_id`);
    }
  }
  if (value.prior_state !== null) validateSimulationState(value.prior_state, `${path}.prior_state`);

  const allIds = [
    ...artifacts.map((entry) => (entry as ArtifactRevision).artifact_revision_id),
    ...cases.map((entry) => (entry as ResearchCase).case_id),
    ...challenges.map((entry) => (entry as Challenge).challenge_id),
    ...controllers.map((entry) => (entry as EffectiveController).controller_id),
    ...receipts.map((entry) => (entry as EvidenceReceipt).evidence_receipt_id),
    ...commitments.map((entry) => (entry as FundingCommitment).commitment_id),
    ...milestones.map((entry) => (entry as Milestone).milestone_id),
    ...reviews.map((entry) => (entry as Review).review_id),
    ...workPackages.map((entry) => (entry as WorkPackage).work_package_id),
  ];
  assertUniqueIds(allIds, `${path} record identifiers across all categories`);
  return deepFreeze(value) as unknown as ResearchSimulation;
}

export function parseResearchSimulationJson(input: string | Uint8Array): ResearchSimulation {
  return validateResearchSimulation(parseStrictJson(input));
}
