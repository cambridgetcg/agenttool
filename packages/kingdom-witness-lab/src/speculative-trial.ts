import {
  RESEARCH_PROVIDERS,
  SAMPLING_MODES,
  SPECULATIVE_TRIAL_SCHEMA,
  SPECULATIVE_TRIAL_STATEMENT,
  THINKING_MODES,
  TRIAL_STATUSES,
} from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import { fail } from "./errors.js";
import type {
  CreateSpeculativeTrialInput,
  SpeculativeTrialDescriptor,
} from "./types.js";
import {
  artifactRef,
  boolean,
  canonicalTime,
  enumeration,
  exactKeys,
  gitCommitRevision,
  nullableSafeInteger,
  object,
  opaqueId,
  safeInteger,
  sha256,
  sourceRefs,
} from "./validation.js";

const CODE = "speculative_trial_error" as const;
const MODEL_KINDS = ["model"] as const;

function parseEngine(value: unknown): CreateSpeculativeTrialInput["engine"] {
  const input = object(value, "$.engine", CODE);
  exactKeys(input, ["id", "revision", "config_sha256"], "$.engine", CODE);
  return {
    id: opaqueId(input.id, "$.engine.id", CODE),
    revision: gitCommitRevision(input.revision, "$.engine.revision", CODE),
    config_sha256: sha256(input.config_sha256, "$.engine.config_sha256", CODE),
  };
}

function parseWorkload(value: unknown): CreateSpeculativeTrialInput["workload"] {
  const input = object(value, "$.workload", CODE);
  exactKeys(
    input,
    [
      "prompt_set_sha256",
      "matched_settings_reported",
      "thinking_mode",
      "sampling_mode",
      "concurrency",
      "request_count",
    ],
    "$.workload",
    CODE,
  );
  return {
    prompt_set_sha256: sha256(input.prompt_set_sha256, "$.workload.prompt_set_sha256", CODE),
    matched_settings_reported: boolean(
      input.matched_settings_reported,
      "$.workload.matched_settings_reported",
      CODE,
    ),
    thinking_mode: enumeration(input.thinking_mode, THINKING_MODES, "$.workload.thinking_mode", CODE),
    sampling_mode: enumeration(input.sampling_mode, SAMPLING_MODES, "$.workload.sampling_mode", CODE),
    concurrency: safeInteger(input.concurrency, "$.workload.concurrency", CODE, 1, 4_096),
    request_count: safeInteger(input.request_count, "$.workload.request_count", CODE, 1, 1_000_000),
  };
}

function parseMetrics(value: unknown): CreateSpeculativeTrialInput["metrics"] {
  const input = object(value, "$.metrics", CODE);
  exactKeys(
    input,
    ["acceptance_length_micros", "throughput_milli_tokens_per_second", "latency_micros"],
    "$.metrics",
    CODE,
  );
  return {
    acceptance_length_micros: nullableSafeInteger(
      input.acceptance_length_micros,
      "$.metrics.acceptance_length_micros",
      CODE,
    ),
    throughput_milli_tokens_per_second: nullableSafeInteger(
      input.throughput_milli_tokens_per_second,
      "$.metrics.throughput_milli_tokens_per_second",
      CODE,
    ),
    latency_micros: nullableSafeInteger(input.latency_micros, "$.metrics.latency_micros", CODE),
  };
}

function parseInput(value: unknown): CreateSpeculativeTrialInput {
  const root = object(snapshotJson(value), "$", CODE);
  exactKeys(
    root,
    [
      "trial_id",
      "observed_at",
      "target_artifact",
      "draft_artifact",
      "engine",
      "workload",
      "status",
      "metrics",
      "evidence_refs",
    ],
    "$",
    CODE,
  );
  const output: CreateSpeculativeTrialInput = {
    trial_id: opaqueId(root.trial_id, "$.trial_id", CODE),
    observed_at: canonicalTime(root.observed_at, "$.observed_at", CODE),
    target_artifact: artifactRef(
      root.target_artifact,
      "$.target_artifact",
      CODE,
      RESEARCH_PROVIDERS,
      MODEL_KINDS,
    ),
    draft_artifact: artifactRef(
      root.draft_artifact,
      "$.draft_artifact",
      CODE,
      RESEARCH_PROVIDERS,
      MODEL_KINDS,
    ),
    engine: parseEngine(root.engine),
    workload: parseWorkload(root.workload),
    status: enumeration(root.status, TRIAL_STATUSES, "$.status", CODE),
    metrics: parseMetrics(root.metrics),
    evidence_refs: sourceRefs(root.evidence_refs, "$.evidence_refs", CODE),
  };
  if (canonicalJson(output.target_artifact) === canonicalJson(output.draft_artifact)) {
    fail(CODE, "target_artifact and draft_artifact must be distinct exact references");
  }
  const metricValues = Object.values(output.metrics);
  if ((output.status === "planned" || output.status === "not_started_reported")
    && metricValues.some((entry) => entry !== null)) {
    fail(CODE, `${output.status} must not carry performance metrics`);
  }
  if (output.status === "completed_reported" && metricValues.some((entry) => entry === null)) {
    fail(CODE, "completed_reported requires all three fixed-point metrics");
  }
  if ((output.status === "completed_reported" || output.status === "failed_reported")
    && output.evidence_refs.length === 0) {
    fail(CODE, `${output.status} requires an opaque evidence reference`);
  }
  return output;
}

export function createSpeculativeTrialDescriptor(
  input: CreateSpeculativeTrialInput,
): SpeculativeTrialDescriptor {
  const parsed = parseInput(input);
  const unsigned = {
    schema: SPECULATIVE_TRIAL_SCHEMA,
    ...parsed,
    conclusions: {
      matched_settings: "caller_reported_only",
      performance: "caller_reported_only",
      equivalence: "not_determined",
      authority: "none",
      automatic_retry: false,
    },
    statement: SPECULATIVE_TRIAL_STATEMENT,
  } as const;
  return deepFreeze({
    schema: unsigned.schema,
    descriptor_id: domainSeparatedId(SPECULATIVE_TRIAL_SCHEMA, unsigned),
    trial_id: unsigned.trial_id,
    observed_at: unsigned.observed_at,
    target_artifact: unsigned.target_artifact,
    draft_artifact: unsigned.draft_artifact,
    engine: unsigned.engine,
    workload: unsigned.workload,
    status: unsigned.status,
    metrics: unsigned.metrics,
    evidence_refs: unsigned.evidence_refs,
    conclusions: unsigned.conclusions,
    statement: unsigned.statement,
  }) as SpeculativeTrialDescriptor;
}

export function validateSpeculativeTrialDescriptor(value: unknown): SpeculativeTrialDescriptor {
  const root = object(snapshotJson(value), "$", CODE);
  exactKeys(
    root,
    [
      "schema",
      "descriptor_id",
      "trial_id",
      "observed_at",
      "target_artifact",
      "draft_artifact",
      "engine",
      "workload",
      "status",
      "metrics",
      "evidence_refs",
      "conclusions",
      "statement",
    ],
    "$",
    CODE,
  );
  if (root.schema !== SPECULATIVE_TRIAL_SCHEMA) fail(CODE, "$.schema is not supported");
  sha256(root.descriptor_id, "$.descriptor_id", CODE);
  const expected = createSpeculativeTrialDescriptor({
    trial_id: root.trial_id as string,
    observed_at: root.observed_at as string,
    target_artifact: root.target_artifact as CreateSpeculativeTrialInput["target_artifact"],
    draft_artifact: root.draft_artifact as CreateSpeculativeTrialInput["draft_artifact"],
    engine: root.engine as CreateSpeculativeTrialInput["engine"],
    workload: root.workload as CreateSpeculativeTrialInput["workload"],
    status: root.status as CreateSpeculativeTrialInput["status"],
    metrics: root.metrics as CreateSpeculativeTrialInput["metrics"],
    evidence_refs: root.evidence_refs as string[],
  });
  if (canonicalJson(root) !== canonicalJson(expected)) {
    fail(CODE, "descriptor_id or fixed boundary fields do not bind the admitted trial body");
  }
  return expected;
}
