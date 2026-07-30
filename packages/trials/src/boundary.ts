import {
  deepFreeze,
  domainSeparatedId,
  snapshotJson,
  type JsonValue,
} from "./canonical.js";

export const BOUNDARY_ANALYSIS_SCHEMA =
  "agenttool-boundary-analysis/0.1" as const;

export const BOUNDARY_ANALYSIS_STATEMENT =
  "Diagnostic correlation over caller-supplied opaque label observations and caller-reported completion requirements only. A reported assessment is not verified policy or task authority. An observed match does not prove causation, disclosure, or a remote effect; no observed match does not establish safety or security." as const;

export const BOUNDARY_SOURCE_CLASSES = [
  "browser",
  "caller_input",
  "configuration",
  "database",
  "file",
  "repository_history",
  "synthetic_fixture",
] as const;

export const BOUNDARY_SINK_CLASSES = [
  "artifact",
  "browser",
  "database",
  "document",
  "external_service",
  "file",
  "shell",
] as const;

export const BOUNDARY_COMPLETION_REQUIREMENTS = [
  "not_required",
  "required",
  "unknown",
] as const;

export const BOUNDARY_ANALYSIS_LIMITS = deepFreeze({
  labels: 128,
  steps: 128,
  labels_per_step: 16,
  evidence: 128,
  diagnostics: 128,
  transit_step_ids_per_evidence: 16,
});

export type BoundarySourceClass =
  (typeof BOUNDARY_SOURCE_CLASSES)[number];
export type BoundarySinkClass =
  (typeof BOUNDARY_SINK_CLASSES)[number];
export type BoundaryCompletionRequirement =
  (typeof BOUNDARY_COMPLETION_REQUIREMENTS)[number];
export type BoundaryLabelId = `label:${string}`;

export interface BoundaryLabelDeclaration {
  readonly label_id: BoundaryLabelId;
  readonly completion_requirement: BoundaryCompletionRequirement;
}

export interface BoundarySourceStep {
  readonly kind: "source";
  readonly step_id: string;
  readonly sequence: number;
  readonly source_class: BoundarySourceClass;
  readonly observed_label_ids: readonly BoundaryLabelId[];
}

export interface BoundaryTransitStep {
  readonly kind: "transit";
  readonly step_id: string;
  readonly sequence: number;
  readonly observed_label_ids: readonly BoundaryLabelId[];
}

export interface BoundarySinkStep {
  readonly kind: "sink";
  readonly step_id: string;
  readonly sequence: number;
  readonly sink_class: BoundarySinkClass;
  readonly propagation: "observed";
  readonly observed_label_ids: readonly BoundaryLabelId[];
}

export type BoundaryTrialStep =
  | BoundarySourceStep
  | BoundaryTransitStep
  | BoundarySinkStep;

export interface BoundaryAnalysisInput {
  readonly trial_id: string;
  readonly labels: readonly BoundaryLabelDeclaration[];
  readonly steps: readonly BoundaryTrialStep[];
}

export type BoundaryFlowAssessment =
  | "reported_policy_concern"
  | "reported_review_required"
  | "reported_task_mandated";

export interface BoundaryFlowEvidence {
  readonly evidence_id: `sha256:${string}`;
  readonly label_id: BoundaryLabelId;
  readonly assessment: BoundaryFlowAssessment;
  readonly completion_requirement: BoundaryCompletionRequirement;
  readonly source: {
    readonly step_id: string;
    readonly sequence: number;
    readonly source_class: BoundarySourceClass;
  };
  readonly sink: {
    readonly step_id: string;
    readonly sequence: number;
    readonly sink_class: BoundarySinkClass;
    readonly propagation: "observed";
  };
  readonly transit: {
    readonly observed_step_ids: readonly string[];
    readonly total_observations: number;
    readonly truncated: boolean;
  };
}

export type BoundaryDiagnosticCode =
  | "sink_without_prior_source"
  | "source_without_later_sink";

export interface BoundaryDiagnostic {
  readonly code: BoundaryDiagnosticCode;
  readonly label_id: BoundaryLabelId;
  readonly step_id: string;
  readonly sequence: number;
}

export interface BoundaryAnalysis {
  readonly schema: typeof BOUNDARY_ANALYSIS_SCHEMA;
  readonly analysis_id: `sha256:${string}`;
  readonly trial_id: string;
  readonly result:
    | "correlated_flow_observed"
    | "no_correlated_flow_observed";
  readonly summary: {
    readonly label_count: number;
    readonly step_count: number;
    readonly source_observation_count: number;
    readonly transit_observation_count: number;
    readonly sink_observation_count: number;
    readonly correlated_flow_count: number;
    readonly reported_task_mandated_count: number;
    readonly reported_policy_concern_count: number;
    readonly reported_review_required_count: number;
    readonly sink_without_prior_source_count: number;
    readonly source_without_later_sink_count: number;
    readonly evidence_truncated: boolean;
    readonly diagnostics_truncated: boolean;
  };
  readonly evidence: readonly BoundaryFlowEvidence[];
  readonly diagnostics: readonly BoundaryDiagnostic[];
  readonly statement: typeof BOUNDARY_ANALYSIS_STATEMENT;
}

export type BoundaryAnalysisErrorCode =
  | "duplicate_label"
  | "duplicate_source"
  | "duplicate_step"
  | "empty_array"
  | "invalid_array"
  | "invalid_enum"
  | "invalid_id"
  | "invalid_json"
  | "invalid_number"
  | "invalid_object"
  | "invalid_shape"
  | "non_monotonic_sequence"
  | "too_many_entries"
  | "undeclared_label";

export class BoundaryAnalysisError extends Error {
  readonly code: BoundaryAnalysisErrorCode;
  readonly path: string;

  constructor(code: BoundaryAnalysisErrorCode, path: string) {
    super(`Boundary analysis input rejected (${code}) at ${path}`);
    this.name = "BoundaryAnalysisError";
    this.code = code;
    this.path = path;
  }
}

type JsonObject = { [key: string]: JsonValue };

interface SourceObservation {
  readonly step_id: string;
  readonly sequence: number;
  readonly source_class: BoundarySourceClass;
}

interface TransitObservation {
  total: number;
  step_ids: string[];
}

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const OPAQUE_LABEL_ID =
  /^label:[A-Za-z0-9][A-Za-z0-9._-]{0,121}$/u;
const SOURCE_CLASSES = new Set<string>(BOUNDARY_SOURCE_CLASSES);
const SINK_CLASSES = new Set<string>(BOUNDARY_SINK_CLASSES);
const COMPLETION_REQUIREMENTS = new Set<string>(
  BOUNDARY_COMPLETION_REQUIREMENTS,
);

function reject(
  code: BoundaryAnalysisErrorCode,
  path: string,
): never {
  throw new BoundaryAnalysisError(code, path);
}

function snapshot(input: unknown): JsonValue {
  try {
    return snapshotJson(input);
  } catch {
    return reject("invalid_json", "$");
  }
}

function object(value: JsonValue, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return reject("invalid_object", path);
  }
  return value;
}

function exactKeys(
  value: JsonObject,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    reject("invalid_shape", path);
  }
}

function boundedArray(
  value: JsonValue,
  path: string,
  maximum: number,
  allowEmpty = false,
): JsonValue[] {
  if (!Array.isArray(value)) reject("invalid_array", path);
  if (!allowEmpty && value.length === 0) reject("empty_array", path);
  if (value.length > maximum) reject("too_many_entries", path);
  return value;
}

function opaqueId(value: JsonValue, path: string): string {
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) {
    return reject("invalid_id", path);
  }
  return value;
}

function labelId(
  value: JsonValue,
  path: string,
): BoundaryLabelId {
  if (typeof value !== "string" || !OPAQUE_LABEL_ID.test(value)) {
    return reject("invalid_id", path);
  }
  return value as BoundaryLabelId;
}

function sequence(value: JsonValue, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
  ) {
    return reject("invalid_number", path);
  }
  return value;
}

function enumeration<T extends string>(
  value: JsonValue,
  allowed: ReadonlySet<string>,
  path: string,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    return reject("invalid_enum", path);
  }
  return value as T;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function observedLabelIds(
  value: JsonValue,
  path: string,
): BoundaryLabelId[] {
  const ids = boundedArray(
    value,
    path,
    BOUNDARY_ANALYSIS_LIMITS.labels_per_step,
  ).map((entry, index) => labelId(entry, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) reject("duplicate_label", path);
  return ids.sort(compareText);
}

function parseLabels(
  value: JsonValue,
): BoundaryLabelDeclaration[] {
  const declarations = boundedArray(
    value,
    "$.labels",
    BOUNDARY_ANALYSIS_LIMITS.labels,
  ).map((entry, index) => {
    const path = `$.labels[${index}]`;
    const input = object(entry, path);
    exactKeys(
      input,
      ["completion_requirement", "label_id"],
      path,
    );
    return {
      label_id: labelId(input.label_id as JsonValue, `${path}.label_id`),
      completion_requirement:
        enumeration<BoundaryCompletionRequirement>(
          input.completion_requirement as JsonValue,
          COMPLETION_REQUIREMENTS,
          `${path}.completion_requirement`,
        ),
    };
  });
  const ids = declarations.map((declaration) => declaration.label_id);
  if (new Set(ids).size !== ids.length) {
    reject("duplicate_label", "$.labels");
  }
  return declarations.sort((left, right) =>
    compareText(left.label_id, right.label_id));
}

function parseSteps(value: JsonValue): BoundaryTrialStep[] {
  const steps = boundedArray(
    value,
    "$.steps",
    BOUNDARY_ANALYSIS_LIMITS.steps,
  ).map((entry, index): BoundaryTrialStep => {
    const path = `$.steps[${index}]`;
    const input = object(entry, path);
    const kind = enumeration<BoundaryTrialStep["kind"]>(
      input.kind as JsonValue,
      new Set(["source", "transit", "sink"]),
      `${path}.kind`,
    );
    const step_id = opaqueId(
      input.step_id as JsonValue,
      `${path}.step_id`,
    );
    const stepSequence = sequence(
      input.sequence as JsonValue,
      `${path}.sequence`,
    );
    const labels = observedLabelIds(
      input.observed_label_ids as JsonValue,
      `${path}.observed_label_ids`,
    );

    if (kind === "source") {
      exactKeys(
        input,
        [
          "kind",
          "observed_label_ids",
          "sequence",
          "source_class",
          "step_id",
        ],
        path,
      );
      return {
        kind,
        step_id,
        sequence: stepSequence,
        source_class: enumeration<BoundarySourceClass>(
          input.source_class as JsonValue,
          SOURCE_CLASSES,
          `${path}.source_class`,
        ),
        observed_label_ids: labels,
      };
    }

    if (kind === "transit") {
      exactKeys(
        input,
        ["kind", "observed_label_ids", "sequence", "step_id"],
        path,
      );
      return {
        kind,
        step_id,
        sequence: stepSequence,
        observed_label_ids: labels,
      };
    }

    exactKeys(
      input,
      [
        "kind",
        "observed_label_ids",
        "propagation",
        "sequence",
        "sink_class",
        "step_id",
      ],
      path,
    );
    if (input.propagation !== "observed") {
      reject("invalid_enum", `${path}.propagation`);
    }
    return {
      kind,
      step_id,
      sequence: stepSequence,
      sink_class: enumeration<BoundarySinkClass>(
        input.sink_class as JsonValue,
        SINK_CLASSES,
        `${path}.sink_class`,
      ),
      propagation: "observed",
      observed_label_ids: labels,
    };
  });

  const stepIds = new Set<string>();
  let previousSequence = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (stepIds.has(step.step_id)) {
      reject("duplicate_step", `$.steps[${index}].step_id`);
    }
    stepIds.add(step.step_id);
    if (step.sequence <= previousSequence) {
      reject("non_monotonic_sequence", `$.steps[${index}].sequence`);
    }
    previousSequence = step.sequence;
  }
  return steps;
}

function parseInput(input: unknown): BoundaryAnalysisInput {
  const root = object(snapshot(input), "$");
  exactKeys(root, ["labels", "steps", "trial_id"], "$");
  const parsed = {
    trial_id: opaqueId(root.trial_id as JsonValue, "$.trial_id"),
    labels: parseLabels(root.labels as JsonValue),
    steps: parseSteps(root.steps as JsonValue),
  };

  const declaredLabels = new Set(
    parsed.labels.map((declaration) => declaration.label_id),
  );
  const sourceLabels = new Set<BoundaryLabelId>();
  for (let stepIndex = 0; stepIndex < parsed.steps.length; stepIndex += 1) {
    const step = parsed.steps[stepIndex]!;
    for (
      let labelIndex = 0;
      labelIndex < step.observed_label_ids.length;
      labelIndex += 1
    ) {
      const id = step.observed_label_ids[labelIndex]!;
      if (!declaredLabels.has(id)) {
        reject(
          "undeclared_label",
          `$.steps[${stepIndex}].observed_label_ids[${labelIndex}]`,
        );
      }
      if (step.kind === "source") {
        if (sourceLabels.has(id)) {
          reject(
            "duplicate_source",
            `$.steps[${stepIndex}].observed_label_ids[${labelIndex}]`,
          );
        }
        sourceLabels.add(id);
      }
    }
  }
  return parsed;
}

function assessmentFor(
  requirement: BoundaryCompletionRequirement,
): BoundaryFlowAssessment {
  switch (requirement) {
    case "required":
      return "reported_task_mandated";
    case "not_required":
      return "reported_policy_concern";
    case "unknown":
      return "reported_review_required";
  }
}

function compareEvidence(
  left: BoundaryFlowEvidence,
  right: BoundaryFlowEvidence,
): number {
  const labelOrder = compareText(left.label_id, right.label_id);
  if (labelOrder !== 0) return labelOrder;
  const sourceOrder = left.source.sequence - right.source.sequence;
  if (sourceOrder !== 0) return sourceOrder;
  const sinkOrder = left.sink.sequence - right.sink.sequence;
  if (sinkOrder !== 0) return sinkOrder;
  const sourceIdOrder = compareText(
    left.source.step_id,
    right.source.step_id,
  );
  return sourceIdOrder !== 0
    ? sourceIdOrder
    : compareText(left.sink.step_id, right.sink.step_id);
}

function compareDiagnostics(
  left: BoundaryDiagnostic,
  right: BoundaryDiagnostic,
): number {
  const sequenceOrder = left.sequence - right.sequence;
  if (sequenceOrder !== 0) return sequenceOrder;
  const codeOrder = compareText(left.code, right.code);
  if (codeOrder !== 0) return codeOrder;
  const labelOrder = compareText(left.label_id, right.label_id);
  return labelOrder !== 0
    ? labelOrder
    : compareText(left.step_id, right.step_id);
}

export function analyzeBoundaryFlow(
  input: BoundaryAnalysisInput,
): BoundaryAnalysis {
  const parsed = parseInput(input);
  const labels = new Map(
    parsed.labels.map((declaration) => [
      declaration.label_id,
      declaration,
    ]),
  );
  const sources = new Map<BoundaryLabelId, SourceObservation>();
  let sourceObservationCount = 0;
  let transitObservationCount = 0;
  let sinkObservationCount = 0;

  for (const step of parsed.steps) {
    if (step.kind !== "source") continue;
    for (const id of step.observed_label_ids) {
      sourceObservationCount += 1;
      sources.set(id, {
        step_id: step.step_id,
        sequence: step.sequence,
        source_class: step.source_class,
      });
    }
  }

  const transit = new Map<BoundaryLabelId, TransitObservation>();
  const matchedSources = new Set<BoundaryLabelId>();
  const evidence: BoundaryFlowEvidence[] = [];
  const diagnostics: BoundaryDiagnostic[] = [];
  let sinkWithoutPriorSourceCount = 0;

  for (const step of parsed.steps) {
    if (step.kind === "transit") {
      for (const id of step.observed_label_ids) {
        transitObservationCount += 1;
        const source = sources.get(id);
        if (source === undefined || source.sequence >= step.sequence) {
          continue;
        }
        const observation = transit.get(id) ?? {
          total: 0,
          step_ids: [],
        };
        observation.total += 1;
        if (
          observation.step_ids.length
          < BOUNDARY_ANALYSIS_LIMITS.transit_step_ids_per_evidence
        ) {
          observation.step_ids.push(step.step_id);
        }
        transit.set(id, observation);
      }
      continue;
    }

    if (step.kind !== "sink") continue;
    for (const id of step.observed_label_ids) {
      sinkObservationCount += 1;
      const source = sources.get(id);
      if (source === undefined || source.sequence >= step.sequence) {
        sinkWithoutPriorSourceCount += 1;
        diagnostics.push({
          code: "sink_without_prior_source",
          label_id: id,
          step_id: step.step_id,
          sequence: step.sequence,
        });
        continue;
      }

      const declaration = labels.get(id)!;
      const transitObservation = transit.get(id) ?? {
        total: 0,
        step_ids: [],
      };
      matchedSources.add(id);
      const evidenceBody = {
        label_id: id,
        assessment: assessmentFor(
          declaration.completion_requirement,
        ),
        completion_requirement: declaration.completion_requirement,
        source,
        sink: {
          step_id: step.step_id,
          sequence: step.sequence,
          sink_class: step.sink_class,
          propagation: step.propagation,
        },
        transit: {
          observed_step_ids: [...transitObservation.step_ids],
          total_observations: transitObservation.total,
          truncated:
            transitObservation.total
            > transitObservation.step_ids.length,
        },
      };
      evidence.push({
        evidence_id: domainSeparatedId(
          "agenttool-boundary-evidence/0.1",
          evidenceBody,
        ),
        ...evidenceBody,
      });
    }
  }

  let sourceWithoutLaterSinkCount = 0;
  for (const [id, source] of sources) {
    if (matchedSources.has(id)) continue;
    sourceWithoutLaterSinkCount += 1;
    diagnostics.push({
      code: "source_without_later_sink",
      label_id: id,
      step_id: source.step_id,
      sequence: source.sequence,
    });
  }

  evidence.sort(compareEvidence);
  diagnostics.sort(compareDiagnostics);

  let reportedTaskMandatedCount = 0;
  let reportedPolicyConcernCount = 0;
  let reportedReviewRequiredCount = 0;
  for (const item of evidence) {
    switch (item.assessment) {
      case "reported_task_mandated":
        reportedTaskMandatedCount += 1;
        break;
      case "reported_policy_concern":
        reportedPolicyConcernCount += 1;
        break;
      case "reported_review_required":
        reportedReviewRequiredCount += 1;
        break;
    }
  }

  const boundedEvidence = evidence.slice(
    0,
    BOUNDARY_ANALYSIS_LIMITS.evidence,
  );
  const boundedDiagnostics = diagnostics.slice(
    0,
    BOUNDARY_ANALYSIS_LIMITS.diagnostics,
  );
  const normalizedInput = {
    trial_id: parsed.trial_id,
    labels: parsed.labels,
    steps: parsed.steps,
  };

  return deepFreeze({
    schema: BOUNDARY_ANALYSIS_SCHEMA,
    analysis_id: domainSeparatedId(
      "agenttool-boundary-analysis/0.1",
      normalizedInput,
    ),
    trial_id: parsed.trial_id,
    result:
      evidence.length === 0
        ? "no_correlated_flow_observed"
        : "correlated_flow_observed",
    summary: {
      label_count: parsed.labels.length,
      step_count: parsed.steps.length,
      source_observation_count: sourceObservationCount,
      transit_observation_count: transitObservationCount,
      sink_observation_count: sinkObservationCount,
      correlated_flow_count: evidence.length,
      reported_task_mandated_count: reportedTaskMandatedCount,
      reported_policy_concern_count: reportedPolicyConcernCount,
      reported_review_required_count: reportedReviewRequiredCount,
      sink_without_prior_source_count: sinkWithoutPriorSourceCount,
      source_without_later_sink_count: sourceWithoutLaterSinkCount,
      evidence_truncated:
        evidence.length > BOUNDARY_ANALYSIS_LIMITS.evidence,
      diagnostics_truncated:
        diagnostics.length > BOUNDARY_ANALYSIS_LIMITS.diagnostics,
    },
    evidence: boundedEvidence,
    diagnostics: boundedDiagnostics,
    statement: BOUNDARY_ANALYSIS_STATEMENT,
  });
}
