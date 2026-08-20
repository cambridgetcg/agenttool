import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import {
  ADMISSION_STATES,
  CONSENT_STATES,
  DATASET_INFLUENCE_BOUNDARIES,
  DATASET_INFLUENCE_FORMATS,
  DATASET_ROLES,
  MAX_DATASETS,
  RIGHTS_STATES,
} from "./constants.js";
import { fail } from "./errors.js";
import { rational } from "./rational.js";
import type {
  AdmissionState,
  ConsentState,
  DatasetLineage,
  DatasetLineageInput,
  DatasetRole,
  DatasetRoleExposureAccounting,
  DatasetUse,
  DatasetUseInput,
  RightsState,
} from "./types.js";
import {
  arrayValue,
  assertUniqueBy,
  enumValue,
  exactKeys,
  isoDate,
  nullableNonNegativeInteger,
  nullableSha256,
  record,
  sha256,
} from "./validation.js";

const DATASET_INPUT_KEYS = [
  "dataset_ref",
  "exact_revision_ref",
  "source_manifest_ref",
  "transform_pipeline_ref",
  "role",
  "admission",
  "rights_state",
  "consent_state",
  "unique_tokens",
  "observed_presented_tokens",
  "duplicate_cluster_count",
] as const;

function observedAdmissionRelation(
  admission: AdmissionState,
  observedPresentedTokens: number | null,
): DatasetUse["observed_admission_relation"] {
  if (observedPresentedTokens === null) return "not_assessed";
  if (observedPresentedTokens === 0) return "no_observed_exposure";
  if (admission === "admitted") return "within_declared_admission";
  return admission === "unknown"
    ? "admission_unknown_with_observed_exposure"
    : "observed_without_admission";
}

function parseDataset(value: unknown, path: string): DatasetUse {
  const candidate = record(value as never, path);
  exactKeys(candidate, DATASET_INPUT_KEYS, path);
  const role = enumValue<DatasetRole>(candidate.role, DATASET_ROLES, `${path}.role`);
  const admission = enumValue<AdmissionState>(candidate.admission, ADMISSION_STATES, `${path}.admission`);
  const observedPresentedTokens = nullableNonNegativeInteger(
    candidate.observed_presented_tokens,
    `${path}.observed_presented_tokens`,
  );
  return {
    dataset_ref: sha256(candidate.dataset_ref, `${path}.dataset_ref`),
    exact_revision_ref: sha256(candidate.exact_revision_ref, `${path}.exact_revision_ref`),
    source_manifest_ref: nullableSha256(candidate.source_manifest_ref, `${path}.source_manifest_ref`),
    transform_pipeline_ref: nullableSha256(candidate.transform_pipeline_ref, `${path}.transform_pipeline_ref`),
    role,
    admission,
    rights_state: enumValue<RightsState>(candidate.rights_state, RIGHTS_STATES, `${path}.rights_state`),
    consent_state: enumValue<ConsentState>(candidate.consent_state, CONSENT_STATES, `${path}.consent_state`),
    unique_tokens: nullableNonNegativeInteger(candidate.unique_tokens, `${path}.unique_tokens`),
    observed_presented_tokens: observedPresentedTokens,
    duplicate_cluster_count: nullableNonNegativeInteger(
      candidate.duplicate_cluster_count,
      `${path}.duplicate_cluster_count`,
    ),
    observed_admission_relation: observedAdmissionRelation(admission, observedPresentedTokens),
  };
}

function stripDerivedDataset(value: unknown, path: string): Record<string, unknown> {
  const candidate = record(value as never, path);
  exactKeys(candidate, [...DATASET_INPUT_KEYS, "observed_admission_relation"], path);
  return Object.fromEntries(DATASET_INPUT_KEYS.map((key) => [key, candidate[key]]));
}

type ParsedLineageInput = Omit<DatasetLineageInput, "datasets"> & { readonly datasets: readonly DatasetUse[] };

function parseInput(input: unknown): ParsedLineageInput {
  const candidate = record(snapshotJson(input), "$lineage_input");
  exactKeys(candidate, [
    "subject_checkpoint_ref",
    "learning_run_ref",
    "training_algorithm_ref",
    "tokenizer_ref",
    "mixture_schedule_ref",
    "observation_scope_ref",
    "as_of",
    "datasets",
  ], "$lineage_input");
  const datasets = arrayValue(candidate.datasets, MAX_DATASETS, "$lineage_input.datasets")
    .map((entry, index) => parseDataset(entry, `$lineage_input.datasets[${index}]`))
    .sort((left, right) => compareUnicode(left.dataset_ref, right.dataset_ref));
  assertUniqueBy(datasets, (entry) => entry.dataset_ref, "$lineage_input.datasets.dataset_ref");
  return {
    subject_checkpoint_ref: sha256(candidate.subject_checkpoint_ref, "$lineage_input.subject_checkpoint_ref"),
    learning_run_ref: sha256(candidate.learning_run_ref, "$lineage_input.learning_run_ref"),
    training_algorithm_ref: sha256(candidate.training_algorithm_ref, "$lineage_input.training_algorithm_ref"),
    tokenizer_ref: sha256(candidate.tokenizer_ref, "$lineage_input.tokenizer_ref"),
    mixture_schedule_ref: nullableSha256(candidate.mixture_schedule_ref, "$lineage_input.mixture_schedule_ref"),
    observation_scope_ref: sha256(candidate.observation_scope_ref, "$lineage_input.observation_scope_ref"),
    as_of: isoDate(candidate.as_of, "$lineage_input.as_of"),
    datasets,
  };
}

function exposureAccounting(datasets: readonly DatasetUseInput[]): DatasetLineage["exposure_accounting"] {
  const roles = [...new Set(datasets.map((entry) => entry.role))].sort(compareUnicode);
  const groups: DatasetRoleExposureAccounting[] = roles.map((role) => {
    const entries = datasets.filter((entry) => entry.role === role);
    if (entries.some((entry) => entry.observed_presented_tokens === null)) {
      return {
        role,
        status: "unavailable",
        reason: "missing_observed_presented_token_counts",
        total_observed_presented_tokens: null,
        shares: [],
      };
    }
    if (entries.every((entry) => entry.observed_presented_tokens === 0)) {
      return {
        role,
        status: "unavailable",
        reason: "no_observed_presented_exposure",
        total_observed_presented_tokens: null,
        shares: [],
      };
    }
    const total = entries.reduce((sum, entry) => {
      const next = sum + entry.observed_presented_tokens!;
      if (!Number.isSafeInteger(next)) fail("math_unavailable", `Presented-token total for ${role} exceeds safe-integer range`);
      return next;
    }, 0);
    return {
      role,
      status: "exact",
      total_observed_presented_tokens: total,
      shares: entries.map((entry) => ({
        dataset_ref: entry.dataset_ref,
        observed_presented_tokens: entry.observed_presented_tokens!,
        share: rational(entry.observed_presented_tokens!, total),
      })),
    };
  });
  return {
    scope: "within_declared_role_only",
    groups,
  };
}

export function createDatasetLineage(input: DatasetLineageInput): Readonly<DatasetLineage>;
export function createDatasetLineage(input: unknown): Readonly<DatasetLineage>;
export function createDatasetLineage(input: unknown): Readonly<DatasetLineage> {
  const parsed = parseInput(input);
  const body = {
    _format: DATASET_INFLUENCE_FORMATS.lineage,
    ...parsed,
    exposure_accounting: exposureAccounting(parsed.datasets),
    declarations: "caller_reported_not_independently_verified" as const,
    boundaries: DATASET_INFLUENCE_BOUNDARIES,
  };
  return deepFreeze({
    ...body,
    lineage_id: domainSeparatedId(DATASET_INFLUENCE_FORMATS.lineage, body),
  });
}

export function validateDatasetLineage(input: unknown): Readonly<DatasetLineage> {
  const candidate = record(snapshotJson(input), "$lineage");
  exactKeys(candidate, [
    "_format",
    "lineage_id",
    "subject_checkpoint_ref",
    "learning_run_ref",
    "training_algorithm_ref",
    "tokenizer_ref",
    "mixture_schedule_ref",
    "observation_scope_ref",
    "as_of",
    "datasets",
    "exposure_accounting",
    "declarations",
    "boundaries",
  ], "$lineage");
  if (candidate._format !== DATASET_INFLUENCE_FORMATS.lineage) {
    fail("invalid_artifact", "Dataset lineage format is unsupported");
  }
  const expected = createDatasetLineage({
    subject_checkpoint_ref: candidate.subject_checkpoint_ref as never,
    learning_run_ref: candidate.learning_run_ref as never,
    training_algorithm_ref: candidate.training_algorithm_ref as never,
    tokenizer_ref: candidate.tokenizer_ref as never,
    mixture_schedule_ref: candidate.mixture_schedule_ref as never,
    observation_scope_ref: candidate.observation_scope_ref as never,
    as_of: candidate.as_of as never,
    datasets: arrayValue(candidate.datasets, MAX_DATASETS, "$lineage.datasets")
      .map((entry, index) => stripDerivedDataset(entry, `$lineage.datasets[${index}]`)) as never,
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail("invalid_artifact", "Dataset lineage differs from canonical reconstruction");
  }
  return expected;
}
