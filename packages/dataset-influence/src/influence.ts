import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import {
  CLAIM_SCOPES,
  DATASET_INFLUENCE_BOUNDARIES,
  DATASET_INFLUENCE_FORMATS,
  EFFECT_FAMILIES,
  INFLUENCE_ESTIMATORS,
  MAX_EFFECTS,
  STUDY_DESIGNS,
} from "./constants.js";
import { fail } from "./errors.js";
import { compareRational, parseRational } from "./rational.js";
import type {
  ClaimScope,
  DatasetInfluenceStudy,
  DatasetInfluenceStudyInput,
  EffectFamily,
  InfluenceEffectInput,
  InfluenceEstimator,
  InfluenceInterval,
  StudyDesign,
} from "./types.js";
import {
  arrayValue,
  assertUniqueBy,
  enumValue,
  exactKeys,
  nonNegativeInteger,
  nullableSha256,
  positiveInteger,
  record,
  sha256,
  sha256Set,
} from "./validation.js";

const ESTIMATORS_BY_DESIGN: Readonly<Record<StudyDesign, readonly InfluenceEstimator[]>> = {
  observational_checkpoint_comparison: ["difference_in_means"],
  paired_ablation: ["paired_difference"],
  randomized_dataset_inclusion: ["difference_in_means", "paired_difference"],
  matched_reweighting: ["difference_in_means", "paired_difference"],
  local_hessian_approximation: ["influence_function"],
  checkpoint_gradient_trace: ["tracin"],
  projected_gradient_attribution: ["trak"],
  subset_datamodel: ["datamodel", "exact_finite_shapley"],
  representation_probe: ["probe_projection"],
  not_available: ["not_available"],
};

function parseInterval(value: unknown, path: string): InfluenceInterval {
  const candidate = record(value as never, path);
  exactKeys(candidate, ["lower", "upper", "level_basis_points", "method_ref"], path);
  const lower = parseRational(candidate.lower, `${path}.lower`);
  const upper = parseRational(candidate.upper, `${path}.upper`);
  if (compareRational(lower, upper) > 0) fail("invalid_input", `${path}.lower must not exceed upper`);
  const level = positiveInteger(candidate.level_basis_points, `${path}.level_basis_points`);
  if (level >= 10_000) fail("invalid_input", `${path}.level_basis_points must be below 10000`);
  return {
    lower,
    upper,
    level_basis_points: level,
    method_ref: sha256(candidate.method_ref, `${path}.method_ref`),
  };
}

function parseEffect(value: unknown, path: string): InfluenceEffectInput {
  const candidate = record(value as never, path);
  exactKeys(candidate, [
    "facet_ref",
    "operationalization_ref",
    "effect_family",
    "estimate",
    "interval",
    "unit_ref",
    "claim_scope",
    "evidence_refs",
    "assumption_refs",
    "limitation_refs",
  ], path);
  const estimate = candidate.estimate === null ? null : parseRational(candidate.estimate, `${path}.estimate`);
  const interval = candidate.interval === null ? null : parseInterval(candidate.interval, `${path}.interval`);
  const claimScope = enumValue<ClaimScope>(candidate.claim_scope, CLAIM_SCOPES, `${path}.claim_scope`);
  const evidenceRefs = sha256Set(candidate.evidence_refs, `${path}.evidence_refs`);
  const assumptionRefs = sha256Set(candidate.assumption_refs, `${path}.assumption_refs`);
  const limitationRefs = sha256Set(candidate.limitation_refs, `${path}.limitation_refs`);
  if (limitationRefs.length === 0) fail("invalid_input", `${path}.limitation_refs must make a boundary visible`);
  if (claimScope === "unavailable") {
    if (estimate !== null || interval !== null) {
      fail("invalid_input", `${path} cannot carry an estimate or interval when unavailable`);
    }
  } else {
    if (estimate === null || evidenceRefs.length === 0) {
      fail("invalid_input", `${path} requires an estimate and evidence for ${claimScope}`);
    }
    if (interval !== null && (
      compareRational(interval.lower, estimate) > 0 || compareRational(interval.upper, estimate) < 0
    )) {
      fail("invalid_input", `${path}.interval must contain the estimate`);
    }
  }
  if (claimScope !== "unavailable" && assumptionRefs.length === 0) {
    fail("invalid_input", `${path} requires explicit assumptions for every available estimate`);
  }
  if (claimScope === "causal_under_declared_assumptions" && interval === null) {
    fail("invalid_input", `${path} requires a digest-bound uncertainty interval for a bounded causal claim`);
  }
  return {
    facet_ref: sha256(candidate.facet_ref, `${path}.facet_ref`),
    operationalization_ref: sha256(candidate.operationalization_ref, `${path}.operationalization_ref`),
    effect_family: enumValue<EffectFamily>(candidate.effect_family, EFFECT_FAMILIES, `${path}.effect_family`),
    estimate,
    interval,
    unit_ref: sha256(candidate.unit_ref, `${path}.unit_ref`),
    claim_scope: claimScope,
    evidence_refs: evidenceRefs,
    assumption_refs: assumptionRefs,
    limitation_refs: limitationRefs,
  };
}

function parseInput(input: unknown): DatasetInfluenceStudyInput {
  const candidate = record(snapshotJson(input), "$study_input");
  exactKeys(candidate, [
    "lineage_id",
    "baseline_checkpoint_ref",
    "target_checkpoint_ref",
    "intervention_ref",
    "comparator_ref",
    "evaluation_population_ref",
    "metric_suite_ref",
    "contamination_report_ref",
    "design",
    "estimator",
    "sample_count",
    "seed_refs",
    "effects",
  ], "$study_input");
  const design = enumValue<StudyDesign>(candidate.design, STUDY_DESIGNS, "$study_input.design");
  const estimator = enumValue<InfluenceEstimator>(
    candidate.estimator,
    INFLUENCE_ESTIMATORS,
    "$study_input.estimator",
  );
  if (!ESTIMATORS_BY_DESIGN[design].includes(estimator)) {
    fail("invalid_input", `Estimator ${estimator} is incompatible with design ${design}`);
  }
  const effects = arrayValue(candidate.effects, MAX_EFFECTS, "$study_input.effects")
    .map((entry, index) => parseEffect(entry, `$study_input.effects[${index}]`))
    .sort((left, right) => compareUnicode(left.facet_ref, right.facet_ref));
  if (effects.length === 0) fail("invalid_input", "$study_input.effects must not be empty");
  assertUniqueBy(effects, (entry) => entry.facet_ref, "$study_input.effects.facet_ref");
  const causal = effects.some((entry) => entry.claim_scope === "causal_under_declared_assumptions");
  if (causal && design !== "randomized_dataset_inclusion") {
    fail("invalid_input", "Causal claims require randomized_dataset_inclusion design");
  }
  if (design === "not_available" && effects.some((entry) => entry.claim_scope !== "unavailable")) {
    fail("invalid_input", "not_available design requires unavailable effects");
  }
  const contaminationReportRef = nullableSha256(
    candidate.contamination_report_ref,
    "$study_input.contamination_report_ref",
  );
  const sampleCount = nonNegativeInteger(candidate.sample_count, "$study_input.sample_count");
  const seedRefs = sha256Set(candidate.seed_refs, "$study_input.seed_refs");
  if (design === "not_available") {
    if (sampleCount !== 0 || seedRefs.length !== 0 || contaminationReportRef !== null) {
      fail("invalid_input", "not_available design requires zero samples, no seed refs, and no contamination report");
    }
  } else if (sampleCount === 0) {
    fail("invalid_input", `${design} requires at least one supplied observation or run`);
  }
  if (["paired_ablation", "randomized_dataset_inclusion"].includes(design) && seedRefs.length !== sampleCount) {
    fail("invalid_input", `${design} requires one unique seed reference per supplied pair or randomized run`);
  }
  if (causal) {
    if (sampleCount < 2) fail("invalid_input", "A bounded causal claim requires at least two randomized runs");
    if (contaminationReportRef === null) {
      fail("invalid_input", "A bounded causal claim requires an explicit contamination report reference");
    }
  }
  const interventionRef = sha256(candidate.intervention_ref, "$study_input.intervention_ref");
  const comparatorRef = sha256(candidate.comparator_ref, "$study_input.comparator_ref");
  if (design !== "not_available" && interventionRef === comparatorRef) {
    fail("invalid_input", "Available studies require distinct intervention and comparator references");
  }
  return {
    lineage_id: sha256(candidate.lineage_id, "$study_input.lineage_id"),
    baseline_checkpoint_ref: sha256(candidate.baseline_checkpoint_ref, "$study_input.baseline_checkpoint_ref"),
    target_checkpoint_ref: sha256(candidate.target_checkpoint_ref, "$study_input.target_checkpoint_ref"),
    intervention_ref: interventionRef,
    comparator_ref: comparatorRef,
    evaluation_population_ref: sha256(candidate.evaluation_population_ref, "$study_input.evaluation_population_ref"),
    metric_suite_ref: sha256(candidate.metric_suite_ref, "$study_input.metric_suite_ref"),
    contamination_report_ref: contaminationReportRef,
    design,
    estimator,
    sample_count: sampleCount,
    seed_refs: seedRefs,
    effects,
  };
}

export function createDatasetInfluenceStudy(input: DatasetInfluenceStudyInput): Readonly<DatasetInfluenceStudy>;
export function createDatasetInfluenceStudy(input: unknown): Readonly<DatasetInfluenceStudy>;
export function createDatasetInfluenceStudy(input: unknown): Readonly<DatasetInfluenceStudy> {
  const parsed = parseInput(input);
  const causalStatus = parsed.design === "not_available"
    ? "unavailable" as const
    : parsed.effects.some((effect) => effect.claim_scope === "causal_under_declared_assumptions")
      ? "bounded_claim_under_declared_randomization_and_assumptions" as const
      : "not_claimed" as const;
  const body = {
    _format: DATASET_INFLUENCE_FORMATS.study,
    ...parsed,
    causal_status: causalStatus,
    subject_scope: "artifact_checkpoint_or_runtime_not_a_being_by_default" as const,
    declarations: "caller_reported_not_independently_verified" as const,
    boundaries: DATASET_INFLUENCE_BOUNDARIES,
  };
  return deepFreeze({ ...body, study_id: domainSeparatedId(DATASET_INFLUENCE_FORMATS.study, body) });
}

export function validateDatasetInfluenceStudy(input: unknown): Readonly<DatasetInfluenceStudy> {
  const candidate = record(snapshotJson(input), "$study");
  exactKeys(candidate, [
    "_format",
    "study_id",
    "lineage_id",
    "baseline_checkpoint_ref",
    "target_checkpoint_ref",
    "intervention_ref",
    "comparator_ref",
    "evaluation_population_ref",
    "metric_suite_ref",
    "contamination_report_ref",
    "design",
    "estimator",
    "sample_count",
    "seed_refs",
    "effects",
    "causal_status",
    "subject_scope",
    "declarations",
    "boundaries",
  ], "$study");
  if (candidate._format !== DATASET_INFLUENCE_FORMATS.study) {
    fail("invalid_artifact", "Dataset influence study format is unsupported");
  }
  const expected = createDatasetInfluenceStudy({
    lineage_id: candidate.lineage_id as never,
    baseline_checkpoint_ref: candidate.baseline_checkpoint_ref as never,
    target_checkpoint_ref: candidate.target_checkpoint_ref as never,
    intervention_ref: candidate.intervention_ref as never,
    comparator_ref: candidate.comparator_ref as never,
    evaluation_population_ref: candidate.evaluation_population_ref as never,
    metric_suite_ref: candidate.metric_suite_ref as never,
    contamination_report_ref: candidate.contamination_report_ref as never,
    design: candidate.design as never,
    estimator: candidate.estimator as never,
    sample_count: candidate.sample_count as never,
    seed_refs: candidate.seed_refs as never,
    effects: candidate.effects as never,
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail("invalid_artifact", "Dataset influence study differs from canonical reconstruction");
  }
  return expected;
}
