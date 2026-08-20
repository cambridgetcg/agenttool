import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId } from "./canonical.js";
import {
  EVIDENCE_LEVELS,
  RESEARCH_FORMATS,
  RESULT_AUTHORITY,
  SIX_LEDGER_PROFILE,
  SIX_LEDGER_PROFILE_DIGEST,
  SIX_LEDGER_PROFILE_ID,
  SIMULATED_CREDIT_UNIT,
  SIMULATED_PAYMENT_CONDITION,
  ZERO_EFFECTS,
} from "./constants.js";
import { fail } from "./errors.js";
import { assertNoDeclaredControllerOverlap } from "./independence.js";
import {
  createPublicProjection,
  createSettlementBundle,
  createSimulationState,
  validateMilestone,
  validateResearchSimulation,
  validateWorkPackage,
} from "./records.js";
import type {
  ArtifactRevision,
  Challenge,
  CommitmentBalance,
  EffectiveController,
  EvidenceReceipt,
  FundingCommitment,
  Milestone,
  PublicProjection,
  ResearchCase,
  ResearchSimulation,
  Review,
  SettlementBundle,
  SettlementRequest,
  Sha256Id,
  SimulationReport,
  SimulationState,
  WorkPackage,
} from "./types.js";

const LEVEL_INDEX = new Map(EVIDENCE_LEVELS.map((level, index) => [level, index]));
const BLOCKING_CHALLENGE_STATUSES = new Set([
  "CALLER_DECLARED_HOLD_CONTINUES",
  "CALLER_DECLARED_HOLD_INCONCLUSIVE",
  "OPEN",
]);

interface Graph {
  readonly artifacts: ReadonlyMap<Sha256Id, ArtifactRevision>;
  readonly cases: ReadonlyMap<Sha256Id, ResearchCase>;
  readonly challenges: ReadonlyMap<Sha256Id, Challenge>;
  readonly commitments: ReadonlyMap<Sha256Id, FundingCommitment>;
  readonly controllers: ReadonlyMap<Sha256Id, EffectiveController>;
  readonly milestones: ReadonlyMap<Sha256Id, Milestone>;
  readonly receipts: ReadonlyMap<Sha256Id, EvidenceReceipt>;
  readonly requests: ReadonlyMap<Sha256Id, SettlementRequest>;
  readonly reviews: ReadonlyMap<Sha256Id, Review>;
  readonly workPackages: ReadonlyMap<Sha256Id, WorkPackage>;
}

type ChallengeHeads = ReadonlyMap<Sha256Id, Challenge>;

function indexed<T>(values: readonly T[], id: (value: T) => Sha256Id): ReadonlyMap<Sha256Id, T> {
  return new Map(values.map((value) => [id(value), value]));
}

function requireRef<T>(map: ReadonlyMap<Sha256Id, T>, id: Sha256Id, path: string): T {
  const value = map.get(id);
  if (!value) fail("reference_error", `${path} does not resolve`);
  return value;
}

function safeSum(values: readonly number[], path: string): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(total + value)) fail("conservation_error", `${path} exceeds safe integer range`);
    total += value;
  }
  return total;
}

function deriveCommitmentBalances(
  simulation: ResearchSimulation,
  graph: Graph,
  settledMilestoneIds: readonly Sha256Id[],
  observedWorkPackageIds: readonly Sha256Id[],
  reconciledScheduleRefs: readonly Sha256Id[],
): readonly CommitmentBalance[] {
  const settled = settledMilestoneIds.map((id) =>
    requireRef(graph.milestones, id, "$balance.settled_milestone_ids"));
  const observedWork = observedWorkPackageIds.map((id) =>
    requireRef(graph.workPackages, id, "$balance.observed_work_package_ids"));
  return simulation.funding_commitments.map((commitment) => {
    const delivered = safeSum(
      settled
        .filter((milestone) => milestone.commitment_id === commitment.commitment_id)
        .map((milestone) => scheduledCreditForMilestone(
          milestone,
          requireRef(graph.workPackages, milestone.work_package_id, "$balance.settled.work"),
        )),
      `$balance[${commitment.commitment_id}].delivered`,
    );
    const reserved = safeSum(
      observedWork
        .filter((workPackage) =>
          workPackage.commitment_id === commitment.commitment_id &&
          !reconciledScheduleRefs.includes(workPackage.compensation_schedule.schedule_ref))
        .map((workPackage) => workPackage.compensation_schedule.amount),
      `$balance[${commitment.commitment_id}].reserved`,
    );
    const available = commitment.simulated_credit_limit - delivered - reserved;
    if (available < 0) {
      fail("conservation_error", "Delivered plus reserved simulated credit exceeds its commitment");
    }
    return {
      available,
      commitment_id: commitment.commitment_id,
      committed: commitment.simulated_credit_limit,
      delivered,
      reserved,
      unit: SIMULATED_CREDIT_UNIT,
    };
  });
}

function assertPairwiseDeclaredSeparation(
  candidate: Sha256Id,
  others: readonly Sha256Id[],
  controllers: readonly EffectiveController[],
  path: string,
): void {
  for (const other of new Set(others)) {
    if (candidate === other) fail("independence_error", `${path} reuses one controller declaration`);
    assertNoDeclaredControllerOverlap([candidate, other], controllers, path);
  }
}

function buildGraph(simulation: ResearchSimulation): Graph {
  return {
    artifacts: indexed(simulation.artifact_revisions, (value) => value.artifact_revision_id),
    cases: indexed(simulation.cases, (value) => value.case_id),
    challenges: indexed(simulation.challenges, (value) => value.challenge_id),
    commitments: indexed(simulation.funding_commitments, (value) => value.commitment_id),
    controllers: indexed(simulation.controllers, (value) => value.controller_id),
    milestones: indexed(simulation.milestones, (value) => value.milestone_id),
    receipts: indexed(simulation.evidence_receipts, (value) => value.evidence_receipt_id),
    requests: indexed(simulation.settlement_requests, (value) => value.milestone_id),
    reviews: indexed(simulation.reviews, (value) => value.review_id),
    workPackages: indexed(simulation.work_packages, (value) => value.work_package_id),
  };
}

export function scheduledCreditForMilestone(
  milestoneInput: Milestone,
  workPackageInput: WorkPackage,
): number {
  const milestone = validateMilestone(milestoneInput);
  const workPackage = validateWorkPackage(workPackageInput);
  if (milestone.work_package_id !== workPackage.work_package_id) {
    fail("reference_error", "Milestone and work package do not agree");
  }
  if (milestone.compensation_schedule_ref !== workPackage.compensation_schedule.schedule_ref) {
    fail("integrity_error", "Milestone does not reference the frozen compensation schedule");
  }
  return workPackage.compensation_schedule.amount;
}

function validateCommitmentsAndWork(simulation: ResearchSimulation, graph: Graph): void {
  for (const [index, commitment] of simulation.funding_commitments.entries()) {
    const researchCase = requireRef(
      graph.cases,
      commitment.case_id,
      `$simulation.funding_commitments[${String(index)}].case_id`,
    );
    requireRef(
      graph.controllers,
      commitment.funder_controller_id,
      `$simulation.funding_commitments[${String(index)}].funder_controller_id`,
    );
    if (researchCase.result_authority !== RESULT_AUTHORITY) {
      fail("integrity_error", "A funding commitment cannot upgrade result authority");
    }
  }

  const scheduleOwners = new Map<Sha256Id, Sha256Id>();
  const scheduledByCommitment = new Map<Sha256Id, number[]>();
  for (const [index, workPackage] of simulation.work_packages.entries()) {
    const researchCase = requireRef(
      graph.cases,
      workPackage.case_id,
      `$simulation.work_packages[${String(index)}].case_id`,
    );
    const commitment = requireRef(
      graph.commitments,
      workPackage.commitment_id,
      `$simulation.work_packages[${String(index)}].commitment_id`,
    );
    requireRef(
      graph.controllers,
      workPackage.lead_controller_id,
      `$simulation.work_packages[${String(index)}].lead_controller_id`,
    );
    if (commitment.case_id !== workPackage.case_id) {
      fail("reference_error", "Work package and commitment must belong to the same case");
    }
    if (workPackage.compensation_schedule.amount > commitment.simulated_credit_limit) {
      fail("conservation_error", "One frozen work schedule exceeds its simulated-credit commitment");
    }
    if (LEVEL_INDEX.get(workPackage.maximum_evidence_level)! > LEVEL_INDEX.get(researchCase.maximum_evidence_level)!) {
      fail("validation_error", "Work package evidence ceiling exceeds the case ceiling");
    }
    const scheduleRef = workPackage.compensation_schedule.schedule_ref;
    if (scheduleOwners.has(scheduleRef)) {
      fail("integrity_error", "A frozen compensation schedule may belong to only one work package");
    }
    scheduleOwners.set(scheduleRef, workPackage.work_package_id);
    const terminalMilestone = simulation.milestones.find(
      (milestone) => milestone.compensation_schedule_ref === scheduleRef,
    );
    if (!terminalMilestone || terminalMilestone.delivery_status === "DELIVERED") {
      const amounts = scheduledByCommitment.get(commitment.commitment_id) ?? [];
      amounts.push(workPackage.compensation_schedule.amount);
      scheduledByCommitment.set(commitment.commitment_id, amounts);
    }
  }
  for (const commitment of simulation.funding_commitments) {
    const reserved = safeSum(
      scheduledByCommitment.get(commitment.commitment_id) ?? [],
      `$commitment[${commitment.commitment_id}].scheduled`,
    );
    if (reserved > commitment.simulated_credit_limit) {
      fail("conservation_error", "Frozen work schedules exceed a prefunded simulated-credit limit");
    }
  }
}

function validateArtifacts(simulation: ResearchSimulation, graph: Graph): void {
  for (const [index, artifact] of simulation.artifact_revisions.entries()) {
    const path = `$simulation.artifact_revisions[${String(index)}]`;
    const researchCase = requireRef(graph.cases, artifact.case_id, `${path}.case_id`);
    const workPackage = requireRef(graph.workPackages, artifact.work_package_id, `${path}.work_package_id`);
    if (workPackage.case_id !== researchCase.case_id) {
      fail("reference_error", `${path} crosses case and work-package boundaries`);
    }
    if (artifact.prior_art_manifest_ref !== researchCase.prior_art_manifest_ref) {
      fail("integrity_error", `${path}.prior_art_manifest_ref drifts from the frozen case`);
    }
    for (const [authorIndex, author] of artifact.authored_by_controller_ids.entries()) {
      requireRef(graph.controllers, author, `${path}.authored_by_controller_ids[${String(authorIndex)}]`);
    }
    if (artifact.frozen_at <= workPackage.compensation_schedule.frozen_at) {
      fail("integrity_error", `${path} must be frozen after its compensation schedule`);
    }
    if (artifact.revision_number === 1 && artifact.prior_revision_id !== null) {
      fail("integrity_error", `${path} first revision must not name a predecessor`);
    }
    if (artifact.revision_number > 1) {
      if (artifact.prior_revision_id === null) {
        fail("integrity_error", `${path} later revision must name a predecessor`);
      }
      const prior = requireRef(graph.artifacts, artifact.prior_revision_id, `${path}.prior_revision_id`);
      if (
        prior.case_id !== artifact.case_id ||
        prior.work_package_id !== artifact.work_package_id ||
        prior.revision_number + 1 !== artifact.revision_number ||
        prior.frozen_at >= artifact.frozen_at
      ) {
        fail("integrity_error", `${path} revision lineage is not a strict public sequence`);
      }
    }
  }
}

function validateReceipts(simulation: ResearchSimulation, graph: Graph): void {
  const receiptsByWork = new Map<Sha256Id, EvidenceReceipt[]>();
  for (const [index, receipt] of simulation.evidence_receipts.entries()) {
    const path = `$simulation.evidence_receipts[${String(index)}]`;
    const researchCase = requireRef(graph.cases, receipt.case_id, `${path}.case_id`);
    const workPackage = requireRef(graph.workPackages, receipt.work_package_id, `${path}.work_package_id`);
    const artifact = requireRef(graph.artifacts, receipt.artifact_revision_id, `${path}.artifact_revision_id`);
    requireRef(graph.controllers, receipt.issuer_controller_id, `${path}.issuer_controller_id`);
    if (
      workPackage.case_id !== receipt.case_id ||
      artifact.case_id !== receipt.case_id ||
      artifact.work_package_id !== receipt.work_package_id
    ) {
      fail("reference_error", `${path} crosses case, work-package, or artifact boundaries`);
    }
    if (
      LEVEL_INDEX.get(receipt.level)! > LEVEL_INDEX.get(workPackage.maximum_evidence_level)! ||
      LEVEL_INDEX.get(receipt.level)! > LEVEL_INDEX.get(researchCase.maximum_evidence_level)!
    ) {
      fail("validation_error", `${path}.level exceeds a frozen evidence ceiling`);
    }
    if (receipt.created_at < artifact.frozen_at) {
      fail("integrity_error", `${path} predates its frozen public artifact`);
    }
    if (receipt.level === "E0") {
      if (
        receipt.payload.kind !== "E0_CALLER_DECLARED_PREREGISTRATION_REFERENCE" ||
        receipt.payload.prior_art_manifest_ref !== researchCase.prior_art_manifest_ref
      ) {
        fail("integrity_error", `${path} E0 must bind the case's frozen prior-art manifest`);
      }
      if (receipt.issuer_controller_id !== workPackage.lead_controller_id) {
        fail("independence_error", `${path} E0 must be issued by the declared work lead`);
      }
    }
    if (receipt.level === "E1" && receipt.issuer_controller_id !== workPackage.lead_controller_id) {
      fail("independence_error", `${path} E1 must be issued by the declared work lead`);
    }
    const group = receiptsByWork.get(receipt.work_package_id) ?? [];
    group.push(receipt);
    receiptsByWork.set(receipt.work_package_id, group);
  }

  for (const [workPackageId, receipts] of receiptsByWork) {
    const levels = new Set(receipts.map((receipt) => receipt.level));
    const maximum = Math.max(...receipts.map((receipt) => LEVEL_INDEX.get(receipt.level)!));
    for (let index = 0; index <= maximum; index += 1) {
      if (!levels.has(EVIDENCE_LEVELS[index]!)) {
        fail("validation_error", `Work package ${workPackageId} skips evidence level ${EVIDENCE_LEVELS[index]!}`);
      }
    }
    const resultKinds = new Set(receipts.map((receipt) => receipt.declared_result_kind));
    if (resultKinds.size !== 1) {
      fail("validation_error", `Work package ${workPackageId} receipts disagree on declared result kind`);
    }
  }
}

function validateDeclaredSeparation(simulation: ResearchSimulation, graph: Graph): void {
  const controllers = simulation.controllers;
  for (const receipt of simulation.evidence_receipts) {
    const workPackage = requireRef(graph.workPackages, receipt.work_package_id, "$receipt.work_package_id");
    const commitment = requireRef(graph.commitments, workPackage.commitment_id, "$work.commitment_id");
    const artifact = requireRef(graph.artifacts, receipt.artifact_revision_id, "$receipt.artifact_revision_id");
    if (["E2", "E3", "E5"].includes(receipt.level)) {
      assertPairwiseDeclaredSeparation(
        receipt.issuer_controller_id,
        [
          workPackage.lead_controller_id,
          commitment.funder_controller_id,
          ...artifact.authored_by_controller_ids,
        ],
        controllers,
        `$receipt[${receipt.evidence_receipt_id}] declared-unproven separation`,
      );
    }
    if (receipt.level === "E5") {
      if (receipt.payload.kind !== "E5_DECLARED_UNPROVEN_ADOPTION") {
        fail("integrity_error", "E5 receipt payload kind drifted after validation");
      }
      const issuer = requireRef(graph.controllers, receipt.issuer_controller_id, "$receipt.issuer");
      if (issuer.organization_root !== receipt.payload.adopter_organization_root) {
        fail("integrity_error", "E5 adopter organization root must match the issuer declaration");
      }
    }
  }

  const e3ByWork = new Map<Sha256Id, EvidenceReceipt[]>();
  for (const receipt of simulation.evidence_receipts) {
    if (receipt.level !== "E3") continue;
    const entries = e3ByWork.get(receipt.work_package_id) ?? [];
    entries.push(receipt);
    e3ByWork.set(receipt.work_package_id, entries);
  }
  for (const [workPackageId, receipts] of e3ByWork) {
    if (receipts.length < 3) {
      fail(
        "independence_error",
        `E3 for ${workPackageId} requires three declared-unproven reproduction receipts`,
      );
    }
    assertNoDeclaredControllerOverlap(
      receipts.map((receipt) => receipt.issuer_controller_id),
      controllers,
      `$work[${workPackageId}].E3 issuers`,
    );
    const organizations = new Set(
      receipts.map((receipt) =>
        requireRef(graph.controllers, receipt.issuer_controller_id, "$E3.issuer").organization_root),
    );
    const implementations = new Set(receipts.map((receipt) => {
      if (receipt.payload.kind !== "E3_DECLARED_UNPROVEN_REPRODUCTION") {
        fail("integrity_error", "E3 receipt payload kind drifted after validation");
      }
      return receipt.payload.implementation_root;
    }));
    const environments = new Set(receipts.map((receipt) => {
      if (receipt.payload.kind !== "E3_DECLARED_UNPROVEN_REPRODUCTION") {
        fail("integrity_error", "E3 receipt payload kind drifted after validation");
      }
      return receipt.payload.execution_environment_ref;
    }));
    if (organizations.size < 2 || implementations.size < 2 || environments.size < 2) {
      fail(
        "independence_error",
        `E3 for ${workPackageId} needs declared diversity in organizations, implementations, and environments`,
      );
    }
  }
}

function validateReviews(simulation: ResearchSimulation, graph: Graph): void {
  for (const [index, review] of simulation.reviews.entries()) {
    const path = `$simulation.reviews[${String(index)}]`;
    const artifact = requireRef(graph.artifacts, review.artifact_revision_id, `${path}.artifact_revision_id`);
    if (artifact.case_id !== review.case_id) fail("reference_error", `${path} crosses case boundaries`);
    const targetWorkPackage = requireRef(
      graph.workPackages,
      artifact.work_package_id,
      `${path}.target_work_package_id`,
    );
    const targetCommitment = requireRef(
      graph.commitments,
      targetWorkPackage.commitment_id,
      `${path}.target_commitment_id`,
    );
    const reviewWorkPackage = requireRef(
      graph.workPackages,
      review.work_package_id,
      `${path}.work_package_id`,
    );
    if (reviewWorkPackage.case_id !== review.case_id) {
      fail("reference_error", `${path}.work_package_id crosses case boundaries`);
    }
    if (reviewWorkPackage.lead_controller_id !== review.reviewer_controller_id) {
      fail("reference_error", `${path} reviewer must be the declared lead of its review work package`);
    }
    if (review.reviewed_at <= reviewWorkPackage.compensation_schedule.frozen_at) {
      fail("integrity_error", `${path} review predates its frozen compensation schedule`);
    }
    requireRef(graph.controllers, review.reviewer_controller_id, `${path}.reviewer_controller_id`);
    const reviewedReceipts = review.reviewed_receipt_ids.map((id, receiptIndex) => {
      const receipt = requireRef(graph.receipts, id, `${path}.reviewed_receipt_ids[${String(receiptIndex)}]`);
      if (receipt.case_id !== review.case_id || receipt.artifact_revision_id !== review.artifact_revision_id) {
        fail("reference_error", `${path} reviews a receipt from another case or artifact`);
      }
      return receipt;
    });
    if (reviewedReceipts.some((receipt) => receipt.created_at >= review.reviewed_at)) {
      fail("integrity_error", `${path} must occur strictly after every reviewed receipt`);
    }
    assertPairwiseDeclaredSeparation(
      review.reviewer_controller_id,
      [
        targetWorkPackage.lead_controller_id,
        targetCommitment.funder_controller_id,
        ...artifact.authored_by_controller_ids,
        ...reviewedReceipts.map((receipt) => receipt.issuer_controller_id),
      ],
      simulation.controllers,
      `${path} reviewer separation`,
    );
    if (
      review.decision === "DELIVERY_ACCEPTED" &&
      reviewedReceipts.some((receipt) => receipt.assessment !== "DELIVERY_VALID")
    ) {
      fail("validation_error", `${path} cannot accept an invalid or inconclusive delivery assessment`);
    }
    if (review.reviewed_at <= artifact.frozen_at) {
      fail("integrity_error", `${path} predates its frozen public artifact`);
    }
  }
}

function validateChallenges(simulation: ResearchSimulation, graph: Graph): ChallengeHeads {
  const children = new Map<Sha256Id, Challenge>();
  const byRef = new Map<Sha256Id, Challenge[]>();
  for (const [index, challenge] of simulation.challenges.entries()) {
    const path = `$simulation.challenges[${String(index)}]`;
    const receipt = requireRef(graph.receipts, challenge.target_receipt_id, `${path}.target_receipt_id`);
    if (receipt.case_id !== challenge.case_id) fail("reference_error", `${path} crosses case boundaries`);
    const targetArtifact = requireRef(
      graph.artifacts,
      receipt.artifact_revision_id,
      `${path}.target_artifact_revision_id`,
    );
    const targetWork = requireRef(
      graph.workPackages,
      receipt.work_package_id,
      `${path}.target_work_package_id`,
    );
    const targetCommitment = requireRef(
      graph.commitments,
      targetWork.commitment_id,
      `${path}.target_commitment_id`,
    );
    const challengeWork = requireRef(graph.workPackages, challenge.work_package_id, `${path}.work_package_id`);
    if (
      challengeWork.case_id !== challenge.case_id ||
      challengeWork.lead_controller_id !== challenge.challenger_controller_id
    ) {
      fail("reference_error", `${path} must bind the challenger's paid work package and lead`);
    }
    if (
      challenge.created_at <= challengeWork.compensation_schedule.frozen_at ||
      challenge.created_at <= receipt.created_at
    ) {
      fail("integrity_error", `${path} challenge must follow its frozen schedule and target receipt`);
    }
    requireRef(graph.controllers, challenge.challenger_controller_id, `${path}.challenger_controller_id`);
    assertPairwiseDeclaredSeparation(
      challenge.challenger_controller_id,
      [
        receipt.issuer_controller_id,
        targetWork.lead_controller_id,
        targetCommitment.funder_controller_id,
        ...targetArtifact.authored_by_controller_ids,
      ],
      simulation.controllers,
      `${path} challenger separation`,
    );
    if (challenge.resolution_review_id !== null) {
      const review = requireRef(graph.reviews, challenge.resolution_review_id, `${path}.resolution_review_id`);
      if (review.case_id !== challenge.case_id || !review.reviewed_receipt_ids.includes(receipt.evidence_receipt_id)) {
        fail("reference_error", `${path} resolution review does not cover the challenged receipt`);
      }
      assertPairwiseDeclaredSeparation(
        review.reviewer_controller_id,
        [challenge.challenger_controller_id],
        simulation.controllers,
        `${path} resolution-review separation`,
      );
      const priorChallenge = challenge.prior_challenge_id === null
        ? null
        : requireRef(graph.challenges, challenge.prior_challenge_id, `${path}.prior_challenge_id`);
      if (
        priorChallenge === null ||
        review.reviewed_at <= priorChallenge.created_at ||
        review.reviewed_at >= challenge.created_at
      ) {
        fail(
          "integrity_error",
          `${path} terminal revision must strictly follow a review that follows its prior challenge`,
        );
      }
      const requiredDecision = challenge.status === "CALLER_DECLARED_HOLD_INCONCLUSIVE"
        ? "DELIVERY_INCONCLUSIVE"
        : challenge.status === "CALLER_DECLARED_HOLD_RELEASED"
          ? "DELIVERY_ACCEPTED"
          : challenge.status === "CALLER_DECLARED_HOLD_CONTINUES"
            ? "DELIVERY_REJECTED"
            : undefined;
      if (requiredDecision !== undefined && review.decision !== requiredDecision) {
        fail(
          "validation_error",
          `${path} caller-declared hold status must match its non-adjudicative delivery-review linkage`,
        );
      }
    }
    const lineage = byRef.get(challenge.challenge_ref) ?? [];
    lineage.push(challenge);
    byRef.set(challenge.challenge_ref, lineage);
    if (challenge.prior_challenge_id !== null) {
      const prior = requireRef(
        graph.challenges,
        challenge.prior_challenge_id,
        `${path}.prior_challenge_id`,
      );
      if (children.has(prior.challenge_id)) {
        fail("integrity_error", `${path} forks an existing challenge revision`);
      }
      children.set(prior.challenge_id, challenge);
      if (
        prior.challenge_ref !== challenge.challenge_ref ||
        prior.case_id !== challenge.case_id ||
        prior.challenge_kind !== challenge.challenge_kind ||
        prior.challenger_controller_id !== challenge.challenger_controller_id ||
        prior.target_receipt_id !== challenge.target_receipt_id ||
        prior.work_package_id !== challenge.work_package_id
      ) {
        fail("integrity_error", `${path} changes immutable challenge-lineage fields`);
      }
      if (prior.status !== "OPEN") {
        fail("integrity_error", `${path} revises a terminal challenge status`);
      }
      if (challenge.revision_number !== prior.revision_number + 1) {
        fail("integrity_error", `${path}.revision_number must increment its prior revision by one`);
      }
      if (challenge.created_at <= prior.created_at) {
        fail("integrity_error", `${path} must be created strictly after its prior revision`);
      }
      if (prior.evidence_refs.some((reference) => !challenge.evidence_refs.includes(reference))) {
        fail("integrity_error", `${path}.evidence_refs cannot remove prior evidence`);
      }
    }
  }
  const heads = new Map<Sha256Id, Challenge>();
  for (const [challengeRef, revisions] of byRef) {
    const roots = revisions.filter((revision) => revision.prior_challenge_id === null);
    const lineageHeads = revisions.filter((revision) => !children.has(revision.challenge_id));
    if (roots.length !== 1 || lineageHeads.length !== 1) {
      fail("integrity_error", `Challenge lineage ${challengeRef} must have one root and one head`);
    }
    const head = lineageHeads[0]!;
    if (head.revision_number !== revisions.length) {
      fail("integrity_error", `Challenge lineage ${challengeRef} is not a contiguous revision chain`);
    }
    heads.set(challengeRef, head);
  }
  for (const receipt of simulation.evidence_receipts) {
    if (receipt.level === "E4") {
      if (receipt.payload.kind !== "E4_CHALLENGE_OR_REPAIR") {
        fail("integrity_error", "E4 receipt payload kind drifted after validation");
      }
      const challenge = requireRef(graph.challenges, receipt.payload.challenge_id, "$E4.payload.challenge_id");
      if (challenge.case_id !== receipt.case_id) fail("reference_error", "E4 challenge crosses cases");
    }
  }
  return heads;
}

function validateMilestonesAndRequests(
  simulation: ResearchSimulation,
  graph: Graph,
  challengeHeads: ChallengeHeads,
): void {
  const scheduleMilestones = new Map<Sha256Id, Sha256Id>();
  for (const [index, milestone] of simulation.milestones.entries()) {
    const path = `$simulation.milestones[${String(index)}]`;
    const workPackage = requireRef(graph.workPackages, milestone.work_package_id, `${path}.work_package_id`);
    const commitment = requireRef(graph.commitments, milestone.commitment_id, `${path}.commitment_id`);
    if (
      milestone.case_id !== workPackage.case_id ||
      milestone.case_id !== commitment.case_id ||
      milestone.commitment_id !== workPackage.commitment_id
    ) {
      fail("reference_error", `${path} crosses case, commitment, or work-package boundaries`);
    }
    scheduledCreditForMilestone(milestone, workPackage);
    if (scheduleMilestones.has(milestone.compensation_schedule_ref)) {
      fail("settlement_error", `${path} reuses a compensation schedule`);
    }
    scheduleMilestones.set(milestone.compensation_schedule_ref, milestone.milestone_id);

    const receipts = milestone.required_receipt_ids.map((id, receiptIndex) => {
      const receipt = requireRef(graph.receipts, id, `${path}.required_receipt_ids[${String(receiptIndex)}]`);
      if (receipt.case_id !== milestone.case_id || receipt.work_package_id !== milestone.work_package_id) {
        fail("reference_error", `${path} consumes a receipt from another case or work package`);
      }
      return receipt;
    });
    const deliveredReviews = milestone.required_review_ids.map((id, reviewIndex) => {
      const review = requireRef(graph.reviews, id, `${path}.required_review_ids[${String(reviewIndex)}]`);
      if (review.case_id !== milestone.case_id) fail("reference_error", `${path} cites a review from another case`);
      if (
        review.work_package_id !== milestone.work_package_id ||
        review.reviewer_controller_id !== workPackage.lead_controller_id
      ) {
        fail("reference_error", `${path} delivered review must bind its paid work package and lead`);
      }
      return review;
    });
    const deliveredChallenges = milestone.required_challenge_ids.map((id, challengeIndex) => {
      const challenge = requireRef(graph.challenges, id, `${path}.required_challenge_ids[${String(challengeIndex)}]`);
      if (challenge.case_id !== milestone.case_id) {
        fail("reference_error", `${path} cites a challenge from another case`);
      }
      if (
        challenge.work_package_id !== milestone.work_package_id ||
        challenge.challenger_controller_id !== workPackage.lead_controller_id
      ) {
        fail("reference_error", `${path} delivered challenge must bind its paid work package and lead`);
      }
      return challenge;
    });
    const approvalReviews = milestone.delivery_approval_review_ids.map((id, approvalIndex) => {
      const review = requireRef(
        graph.reviews,
        id,
        `${path}.delivery_approval_review_ids[${String(approvalIndex)}]`,
      );
      if (review.case_id !== milestone.case_id) {
        fail("reference_error", `${path} approval review comes from another case`);
      }
      if (
        review.reviewed_receipt_ids.length !== milestone.required_receipt_ids.length ||
        review.reviewed_receipt_ids.some((receiptId, receiptIndex) =>
          receiptId !== milestone.required_receipt_ids[receiptIndex])
      ) {
        fail("reference_error", `${path} approval review must cover exactly the delivery receipts`);
      }
      if (
        receipts.some((receipt) =>
          receipt.artifact_revision_id !== review.artifact_revision_id ||
          receipt.work_package_id !== milestone.work_package_id)
      ) {
        fail("reference_error", `${path} approval review must bind the exact artifact and work package`);
      }
      return review;
    });
    const exactBlockingIds = [...challengeHeads.values()]
      .filter((challenge) => milestone.required_receipt_ids.includes(challenge.target_receipt_id))
      .map((challenge) => challenge.challenge_id)
      .sort(compareUnicode);
    const challengeHeadSnapshot = milestone.challenge_head_snapshot_ids.map((id, challengeIndex) =>
      requireRef(graph.challenges, id, `${path}.challenge_head_snapshot_ids[${String(challengeIndex)}]`));
    const wasClosed = simulation.prior_state?.state.closed_milestone_ids.includes(
      milestone.milestone_id,
    ) ?? false;
    if (wasClosed) {
      if (challengeHeadSnapshot.some((challenge) =>
        !milestone.required_receipt_ids.includes(challenge.target_receipt_id))) {
        fail("settlement_error", `${path} frozen blocker does not target a delivery receipt`);
      }
    } else if (!exactSorted(exactBlockingIds, milestone.challenge_head_snapshot_ids)) {
      fail("settlement_error", `${path}.challenge_head_snapshot_ids must snapshot every current challenge head`);
    }
    if (
      !wasClosed &&
      deliveredChallenges.some((challenge) =>
        challengeHeads.get(challenge.challenge_ref)?.challenge_id !== challenge.challenge_id)
    ) {
      fail("settlement_error", `${path} delivered challenge must cite its current lineage head`);
    }
    if (
      deliveredChallenges.some((challenge) =>
        milestone.required_receipt_ids.includes(challenge.target_receipt_id))
    ) {
      fail("settlement_error", `${path} delivered challenge cannot target its own delivery receipts`);
    }
    const request = graph.requests.get(milestone.milestone_id);
    if (milestone.delivery_status !== "DELIVERED") {
      if (request) fail("settlement_error", `${path} non-delivery cannot request simulated credit`);
      continue;
    }
    if (!request) fail("settlement_error", `${path} delivered milestone lacks a settlement request`);
    if (
      milestone.milestone_kind === "RESEARCH_DELIVERY" &&
      approvalReviews.some((review) => review.decision !== "DELIVERY_ACCEPTED")
    ) {
      fail("settlement_error", `${path} lacks delivery-completeness approval`);
    }
    if (receipts.some((receipt) => receipt.assessment !== "DELIVERY_VALID")) {
      fail("settlement_error", `${path} requires an invalid or inconclusive delivery receipt`);
    }
    if (receipts.some((receipt) => receipt.declared_result_kind !== milestone.declared_result_kind)) {
      fail("settlement_error", `${path} result declarations disagree; compensation remains frozen`);
    }
    if (challengeHeadSnapshot.some((challenge) => BLOCKING_CHALLENGE_STATUSES.has(challenge.status))) {
      fail(
        "settlement_error",
        `${path} delivery receipt has an open, hold-continuing, or hold-inconclusive challenge`,
      );
    }
    // The decisions/statuses of delivered review/challenge work are deliberately unused.
    // Only the separate completeness approvals and challenges against these delivery
    // receipts can gate settlement; the frozen amount never observes either outcome.
    void deliveredReviews;
    void deliveredChallenges;
    if (
      request.consumed_receipt_ids.length !== milestone.required_receipt_ids.length ||
      request.consumed_receipt_ids.some((id, receiptIndex) => id !== milestone.required_receipt_ids[receiptIndex])
    ) {
      fail("settlement_error", `${path} settlement request must consume exactly its required receipts`);
    }
  }
  for (const request of simulation.settlement_requests) {
    requireRef(graph.milestones, request.milestone_id, "$settlement_request.milestone_id");
  }
}

function validateGraph(simulation: ResearchSimulation, graph: Graph): void {
  validateCommitmentsAndWork(simulation, graph);
  validateArtifacts(simulation, graph);
  validateReceipts(simulation, graph);
  validateDeclaredSeparation(simulation, graph);
  validateReviews(simulation, graph);
  const challengeHeads = validateChallenges(simulation, graph);
  validateMilestonesAndRequests(simulation, graph, challengeHeads);
}

function validatePublicPilotCeiling(simulation: ResearchSimulation): void {
  const e2 = LEVEL_INDEX.get("E2")!;
  if (
    simulation.cases.some((entry) => LEVEL_INDEX.get(entry.maximum_evidence_level)! > e2) ||
    simulation.work_packages.some((entry) => LEVEL_INDEX.get(entry.maximum_evidence_level)! > e2) ||
    simulation.evidence_receipts.some((entry) => LEVEL_INDEX.get(entry.level)! > e2)
  ) {
    fail(
      "validation_error",
      "The RC-0.1 public settlement/projection pilot hard-refuses evidence above E2",
    );
  }
}

function settlementFor(
  milestone: Milestone,
  workPackage: WorkPackage,
): SettlementBundle {
  return createSettlementBundle({
    _format: RESEARCH_FORMATS.settlementBundle,
    case_id: milestone.case_id,
    commitment_id: milestone.commitment_id,
    consumed_receipt_ids: milestone.required_receipt_ids,
    declared_result_kind: milestone.declared_result_kind,
    effects: ZERO_EFFECTS,
    milestone_id: milestone.milestone_id,
    payment_condition: SIMULATED_PAYMENT_CONDITION,
    result_authority: RESULT_AUTHORITY,
    simulated_credit: {
      amount: scheduledCreditForMilestone(milestone, workPackage),
      unit: SIMULATED_CREDIT_UNIT,
    },
  });
}

function initialState(simulation: ResearchSimulation, graph: Graph): SimulationState {
  return createSimulationState({
    _format: RESEARCH_FORMATS.simulationState,
    closed_milestone_ids: [],
    commitment_balances: deriveCommitmentBalances(simulation, graph, [], [], []),
    consumed_receipt_ids: [],
    observed_challenge_ids: [],
    observed_work_package_ids: [],
    reconciled_schedule_refs: [],
    settled_milestone_ids: [],
    settlement_bundle_ids: [],
  });
}

function exactSorted(left: readonly Sha256Id[], right: readonly Sha256Id[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validatePriorState(
  simulation: ResearchSimulation,
  graph: Graph,
  prior: SimulationState,
): void {
  const state = prior.state;
  const expectedBalanceIds = simulation.funding_commitments.map((value) => value.commitment_id);
  if (!exactSorted(state.commitment_balances.map((value) => value.commitment_id), expectedBalanceIds)) {
    fail("conservation_error", "Prior state balances must cover the exact sorted commitment set");
  }
  const closed = state.closed_milestone_ids.map((id) => requireRef(graph.milestones, id, "$prior.closed"));
  for (const challengeId of state.observed_challenge_ids) {
    requireRef(graph.challenges, challengeId, "$prior.observed_challenge_ids");
  }
  for (const workPackageId of state.observed_work_package_ids) {
    requireRef(graph.workPackages, workPackageId, "$prior.observed_work_package_ids");
  }
  const settled = state.settled_milestone_ids.map((id) => requireRef(graph.milestones, id, "$prior.settled"));
  if (closed.some((milestone) => milestone.delivery_status === "DELIVERED") !== false) {
    const deliveredClosed = closed
      .filter((milestone) => milestone.delivery_status === "DELIVERED")
      .map((milestone) => milestone.milestone_id)
      .sort(compareUnicode);
    if (!exactSorted(deliveredClosed, state.settled_milestone_ids)) {
      fail("conservation_error", "Every and only closed delivered milestone must be settled");
    }
  } else if (state.settled_milestone_ids.length !== 0) {
    fail("conservation_error", "Prior state settles a milestone not closed as delivered");
  }
  const expectedSchedules = closed
    .map((milestone) => milestone.compensation_schedule_ref)
    .sort(compareUnicode);
  if (!exactSorted(expectedSchedules, state.reconciled_schedule_refs)) {
    fail("conservation_error", "Prior state must reconcile exactly the schedules of closed milestones");
  }
  const expectedConsumed = [...new Set(settled.flatMap((milestone) => milestone.required_receipt_ids))]
    .sort(compareUnicode);
  if (!exactSorted(expectedConsumed, state.consumed_receipt_ids)) {
    fail("conservation_error", "Prior state receipt consumption does not match settled milestones");
  }

  const expectedBundles = settled
    .map((milestone) => settlementFor(
      milestone,
      requireRef(graph.workPackages, milestone.work_package_id, "$prior.settled.work"),
    ))
    .sort((left, right) => compareUnicode(left.settlement_id, right.settlement_id));
  if (!exactSorted(expectedBundles.map((bundle) => bundle.settlement_id), state.settlement_bundle_ids)) {
    fail("conservation_error", "Prior state settlement ids do not replay from frozen schedules");
  }

  for (const [index] of simulation.funding_commitments.entries()) {
    const balance = state.commitment_balances[index]!;
    const expected = deriveCommitmentBalances(
      simulation,
      graph,
      state.settled_milestone_ids,
      state.observed_work_package_ids,
      state.reconciled_schedule_refs,
    )[index]!;
    if (canonicalJson(balance) !== canonicalJson(expected)) {
      fail("conservation_error", "Prior state balance does not replay from commitments and settlements");
    }
  }
}

function advanceState(
  simulation: ResearchSimulation,
  graph: Graph,
  prior: SimulationState,
): SimulationState {
  const closed = new Set(prior.state.closed_milestone_ids);
  const consumed = new Set(prior.state.consumed_receipt_ids);
  const reconciled = new Set(prior.state.reconciled_schedule_refs);
  const observedChallenges = new Set(prior.state.observed_challenge_ids);
  const observedWorkPackages = new Set(prior.state.observed_work_package_ids);
  const settled = new Set(prior.state.settled_milestone_ids);
  const settlementIds = new Set(prior.state.settlement_bundle_ids);

  simulation.challenges.forEach((challenge) => observedChallenges.add(challenge.challenge_id));
  for (const workPackage of simulation.work_packages) {
    if (observedWorkPackages.has(workPackage.work_package_id)) continue;
    observedWorkPackages.add(workPackage.work_package_id);
  }

  for (const milestone of simulation.milestones) {
    if (closed.has(milestone.milestone_id)) continue;
    if (reconciled.has(milestone.compensation_schedule_ref)) {
      fail("settlement_error", "A compensation schedule was already terminally reconciled");
    }
    const workPackage = requireRef(graph.workPackages, milestone.work_package_id, "$milestone.work_package_id");
    scheduledCreditForMilestone(milestone, workPackage);
    closed.add(milestone.milestone_id);
    reconciled.add(milestone.compensation_schedule_ref);
    if (milestone.delivery_status !== "DELIVERED") {
      // The unearned reservation returns to available simulated capacity.
      // RESTED, EXITED, REFUSED and NOT_DELIVERED never create simulated credit or debt.
      continue;
    }
    for (const receiptId of milestone.required_receipt_ids) {
      if (consumed.has(receiptId)) fail("settlement_error", "An evidence receipt may settle only once");
    }
    milestone.required_receipt_ids.forEach((id) => consumed.add(id));
    settled.add(milestone.milestone_id);
    settlementIds.add(settlementFor(milestone, workPackage).settlement_id);
  }

  return createSimulationState({
    _format: RESEARCH_FORMATS.simulationState,
    closed_milestone_ids: [...closed].sort(compareUnicode),
    commitment_balances: deriveCommitmentBalances(
      simulation,
      graph,
      [...settled].sort(compareUnicode),
      [...observedWorkPackages].sort(compareUnicode),
      [...reconciled].sort(compareUnicode),
    ),
    consumed_receipt_ids: [...consumed].sort(compareUnicode),
    observed_challenge_ids: [...observedChallenges].sort(compareUnicode),
    observed_work_package_ids: [...observedWorkPackages].sort(compareUnicode),
    reconciled_schedule_refs: [...reconciled].sort(compareUnicode),
    settled_milestone_ids: [...settled].sort(compareUnicode),
    settlement_bundle_ids: [...settlementIds].sort(compareUnicode),
  });
}

function allSettlementBundles(nextState: SimulationState, graph: Graph): readonly SettlementBundle[] {
  const bundles = nextState.state.settled_milestone_ids.map((milestoneId) => {
    const milestone = requireRef(graph.milestones, milestoneId, "$next_state.settled_milestone_ids");
    const workPackage = requireRef(graph.workPackages, milestone.work_package_id, "$settled.work_package_id");
    return settlementFor(milestone, workPackage);
  }).sort((left, right) => compareUnicode(left.settlement_id, right.settlement_id));
  if (!exactSorted(bundles.map((bundle) => bundle.settlement_id), nextState.state.settlement_bundle_ids)) {
    fail("conservation_error", "Next-state settlement ids do not match deterministic bundles");
  }
  return bundles;
}

function publicProjections(
  simulation: ResearchSimulation,
  bundles: readonly SettlementBundle[],
): readonly PublicProjection[] {
  return bundles.map((bundle) => {
    const researchCase = simulation.cases.find(
      (candidate) => candidate.case_id === bundle.settlement.case_id,
    );
    if (!researchCase) fail("reference_error", "Settlement projection case is absent");
    const receiptRecords = bundle.settlement.consumed_receipt_ids.map((receiptId) => {
      const receipt = simulation.evidence_receipts.find(
        (candidate) => candidate.evidence_receipt_id === receiptId,
      );
      if (!receipt) fail("reference_error", "Settlement projection receipt is absent");
      return receipt;
    });
    const artifacts = [...new Set(receiptRecords.map((receipt) => receipt.artifact_revision_id))]
      .sort(compareUnicode);
    const highest = receiptRecords
      .map((receipt) => receipt.level)
      .sort((left, right) => LEVEL_INDEX.get(left)! - LEVEL_INDEX.get(right)!)
      .at(-1)!;
    return createPublicProjection({
      _format: RESEARCH_FORMATS.publicProjection,
      boundaries: {
        authoritative: false,
        private_locator_included: false,
        raw_evidence_included: false,
        scientific_correctness_determined: false,
      },
      case_id: researchCase.case_id,
      disclosure_lane: "PUBLIC_DIGEST_ONLY",
      effects: ZERO_EFFECTS,
      highest_evidence_level: highest,
      node_ref: researchCase.node_ref,
      public_artifact_revision_ids: artifacts,
      public_evidence_receipt_ids: bundle.settlement.consumed_receipt_ids,
      result_authority: RESULT_AUTHORITY,
      settlement_bundle_ids: [bundle.settlement_id],
      six_ledger_boundary: {
        profile_digest: SIX_LEDGER_PROFILE_DIGEST,
        profile_id: SIX_LEDGER_PROFILE_ID,
      },
      status: "SHADOW_ONLY",
    });
  }).sort((left, right) => compareUnicode(
    left.projection.settlement_bundle_ids[0]!,
    right.projection.settlement_bundle_ids[0]!,
  ));
}

export function simulateResearchCommons(input: unknown): SimulationReport {
  const simulation = validateResearchSimulation(input);
  validatePublicPilotCeiling(simulation);
  const graph = buildGraph(simulation);
  validateGraph(simulation, graph);
  const prior = simulation.prior_state ?? initialState(simulation, graph);
  if (simulation.prior_state !== null) validatePriorState(simulation, graph, prior);
  const nextState = advanceState(simulation, graph, prior);
  validatePriorState(simulation, graph, nextState);
  const bundles = allSettlementBundles(nextState, graph);
  const balances = nextState.state.commitment_balances;
  const totalCommitted = safeSum(balances.map((balance) => balance.committed), "$total_committed");
  const totalDelivered = safeSum(balances.map((balance) => balance.delivered), "$total_delivered");
  const totalReserved = safeSum(balances.map((balance) => balance.reserved), "$total_reserved");
  const totalAvailable = safeSum(balances.map((balance) => balance.available), "$total_available");
  const totalUndelivered = safeSum([totalReserved, totalAvailable], "$total_undelivered");
  if (
    !Number.isSafeInteger(totalDelivered + totalReserved + totalAvailable) ||
    totalCommitted !== totalDelivered + totalReserved + totalAvailable
  ) {
    fail("conservation_error", "Global simulated-credit conservation failed");
  }
  return deepFreeze({
    _format: RESEARCH_FORMATS.simulationReport,
    conservation: {
      exact: true,
      total_available: totalAvailable,
      total_committed: totalCommitted,
      total_delivered: totalDelivered,
      total_reserved: totalReserved,
      total_undelivered: totalUndelivered,
      unit: SIMULATED_CREDIT_UNIT,
    },
    effects: ZERO_EFFECTS,
    ledger_profile: SIX_LEDGER_PROFILE,
    next_state: nextState,
    public_projections: publicProjections(simulation, bundles),
    settlement_bundles: bundles,
    simulation_id: domainSeparatedId(RESEARCH_FORMATS.simulation, simulation),
    structural_only: true,
  }) as SimulationReport;
}
