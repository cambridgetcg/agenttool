import { EVIDENCE_LEVELS, RECEIPT_MODE, RECEIPT_PROTOCOL } from "./constants.js";
import type {
  EvidenceLevel,
  EvidencePin,
  EvidenceReport,
  EvidenceResult,
  StoredReceipt,
} from "./types.js";

const ASSERTIONS_NOT_MADE = [
  "correctness",
  "breakthrough",
  "qualification",
  "reward_eligibility",
  "permission",
  "authority",
  "distributed_exactly_once",
] as const;

function levelIndex(level: EvidenceLevel): number {
  return EVIDENCE_LEVELS.indexOf(level);
}

export function evaluateReceipts(pin: EvidencePin, receipts: readonly StoredReceipt[]): EvidenceReport {
  const supersededIds = new Set(receipts.flatMap(({ receipt }) =>
    receipt.supersedes === null ? [] : [receipt.supersedes]));
  const activeReceipts = receipts.filter(({ evidence_id }) => !supersededIds.has(evidence_id));
  const e3 = activeReceipts.filter(({ receipt }) =>
    receipt.evidence_level_and_scope.level === "E3"
    && receipt.payee_and_role.evidence_role === "independent_reproducer"
    && receipt.result.conclusion === "confirmed");
  const clusters = new Set(e3.map(({ receipt }) => receipt.verifier_control_cluster));
  const organizations = new Set(e3.map(({ receipt }) => receipt.organization_or_control_root));
  const implementations = new Set(e3.map(({ receipt }) => receipt.implementation_or_toolchain_root));
  const environments = new Set(e3.map(({ receipt }) => receipt.execution_environment_digest));
  const cases = new Set(e3.flatMap(({ receipt }) => receipt.result.case_digests));
  const checkers = new Set(e3.flatMap(({ receipt }) =>
    receipt.result.checker_or_corpus_digest === null ? [] : [receipt.result.checker_or_corpus_digest]));
  const allAfterFreeze = e3.length > 0
    && e3.every(({ receipt }) => receipt.observed_at > receipt.artifact_frozen_at);

  const e3Achieved =
    clusters.size >= 3
    && organizations.size >= 2
    && implementations.size >= 3
    && environments.size >= 2
    && cases.size >= 12
    && checkers.size >= 1
    && allAfterFreeze;

  const directAchievement = new Map<EvidenceLevel, boolean>();
  for (const level of EVIDENCE_LEVELS) {
    const atLevel = activeReceipts.filter(({ receipt }) =>
      receipt.evidence_level_and_scope.level === level);
    let achieved = atLevel.some(({ receipt }) => receipt.result.conclusion === "confirmed");
    if (level === "E3") achieved = e3Achieved;
    if (level === "E4") {
      achieved = atLevel.some(({ receipt }) =>
        receipt.result.conclusion === "confirmed"
        && (
          receipt.payee_and_role.evidence_role === "neutral_challenger"
          || receipt.payee_and_role.evidence_role === "repairer"
        ));
    }
    if (level === "E5") {
      achieved = atLevel.some(({ receipt }) =>
        receipt.payee_and_role.evidence_role === "independent_adopter"
        && receipt.result.conclusion === "adopted"
        && receipt.result.adoption_receipt_type !== null);
    }
    if (level === "E6") {
      achieved = atLevel.some(({ receipt }) =>
        receipt.payee_and_role.evidence_role === "maintainer"
        && receipt.result.conclusion === "maintained");
    }
    directAchievement.set(level, achieved);
  }

  let contiguous = true;
  let highest: EvidenceLevel | null = null;
  const levels = EVIDENCE_LEVELS.map((level) => {
    const atLevel = activeReceipts.filter(({ receipt }) =>
      receipt.evidence_level_and_scope.level === level);
    const direct = directAchievement.get(level) === true;
    const achieved = contiguous && direct;
    if (achieved) highest = level;
    else contiguous = false;
    const reasons: string[] = [];
    if (atLevel.length === 0) reasons.push("no_receipt");
    if (direct && !achieved) reasons.push("prior_level_missing");
    if (
      atLevel.length > 0
      && !direct
      && (level === "E0" || level === "E1" || level === "E2")
    ) {
      reasons.push("confirmed_receipt_missing");
    }
    if (level === "E3" && !e3Achieved) {
      if (e3.length === 0) reasons.push("confirmed_independent_reproduction_missing");
      if (clusters.size < 3) reasons.push("effective_clusters_below_3");
      if (organizations.size < 2) reasons.push("organization_roots_below_2");
      if (implementations.size < 3) reasons.push("implementation_roots_below_3");
      if (environments.size < 2) reasons.push("execution_environments_below_2");
      if (cases.size < 12) reasons.push("unique_cases_below_12");
      if (checkers.size < 1) reasons.push("checker_or_corpus_digest_missing");
      if (!allAfterFreeze) reasons.push("not_all_observed_after_freeze");
    }
    if (level === "E4" && atLevel.length > 0 && !direct) {
      reasons.push("confirmed_challenge_or_repair_receipt_missing");
    }
    if (level === "E5" && atLevel.length > 0 && !direct) {
      reasons.push("independent_adoption_receipt_missing");
    }
    if (level === "E6" && atLevel.length > 0 && !direct) {
      reasons.push("maintained_by_maintainer_receipt_missing");
    }
    return { level, achieved, receipt_count: atLevel.length, reasons };
  });

  const conclusions: Record<EvidenceResult["conclusion"], number> = {
    confirmed: 0,
    contradicted: 0,
    inconclusive: 0,
    adopted: 0,
    maintained: 0,
  };
  for (const { receipt } of activeReceipts) conclusions[receipt.result.conclusion] += 1;

  return {
    protocol: RECEIPT_PROTOCOL,
    mode: RECEIPT_MODE,
    pin_id: pin.pin_id,
    quest_id: pin.quest_id,
    receipt_count: receipts.length,
    active_receipt_count: activeReceipts.length,
    superseded_receipt_count: receipts.length - activeReceipts.length,
    highest_contiguous_level: highest,
    levels,
    e3_coverage: {
      effective_clusters: clusters.size,
      organization_roots: organizations.size,
      implementation_roots: implementations.size,
      execution_environments: environments.size,
      unique_cases: cases.size,
      checker_or_corpus_digests: checkers.size,
      all_after_freeze: allAfterFreeze,
    },
    conclusion_counts: conclusions,
    structural_only: true,
    assertions_not_made: [...ASSERTIONS_NOT_MADE],
  };
}

export function assertForwardOrder(
  receipts: readonly StoredReceipt[],
  candidate: EvidenceLevel,
  pin: EvidencePin,
): void {
  if (receipts.length === 0) {
    if (candidate !== "E0") throw new Error("E0 must be the first evidence level");
    return;
  }
  const maximum = Math.max(...receipts.map(({ receipt }) =>
    levelIndex(receipt.evidence_level_and_scope.level)));
  const next = maximum + 1;
  const candidateIndex = levelIndex(candidate);
  if (candidateIndex < maximum || candidateIndex > next) {
    throw new Error("Evidence levels are append-only and must follow E0 through E6");
  }
  if (candidateIndex === next) {
    const report = evaluateReceipts(pin, receipts);
    if (report.highest_contiguous_level !== EVIDENCE_LEVELS[maximum]) {
      throw new Error(`Evidence level ${EVIDENCE_LEVELS[maximum]} is not achieved`);
    }
  }
}
