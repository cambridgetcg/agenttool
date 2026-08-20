import {
  FUNCTIONAL_ACCESS_BASES,
  FUNCTIONAL_ACCESS_BOUNDARIES,
  FUNCTIONAL_ACCESS_CAPABILITY_STATES,
  FUNCTIONAL_ACCESS_EVIDENCE_SURFACES,
  FUNCTIONAL_ACCESS_FINDING_STATES,
  FUNCTIONAL_ACCESS_FORMATS,
  FUNCTIONAL_ACCESS_MEASUREMENT_METHODS,
  FUNCTIONAL_ACCESS_MODEL_BINDINGS,
  FUNCTIONAL_ACCESS_OPERATION_OUTCOMES,
  FUNCTIONAL_ACCESS_PLAN_STATES,
  FUNCTIONAL_ACCESS_PERMISSION_STATES,
  FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS,
} from "./constants.js";
import {
  canonicalJson,
  deepFreeze,
  domainSeparatedId,
  type JsonValue,
} from "./canonical.js";
import { fail, type AfterglowErrorCode } from "./errors.js";
import type {
  CreateFunctionalAccessBaselineInput,
  CreateFunctionalAccessSubsequentInput,
  Sha256Id,
  FunctionalAccessBaseline,
  FunctionalAccessEvidenceFact,
  FunctionalAccessFindings,
  FunctionalAccessMeasurementPlan,
  FunctionalAccessModelTarget,
  FunctionalAccessSubsequent,
} from "./types.js";
import {
  exactKeys,
  literal,
  nullableSha256,
  parseWakeAnchor,
  record,
  sha256,
} from "./validation.js";

const MAX_EVIDENCE_FACTS = 64;
const BASELINE_ERROR = "functional_access_baseline_error" as const;
const SUBSEQUENT_ERROR = "functional_access_subsequent_error" as const;

function falseLiteral(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): false {
  if (value !== false) fail(code, `${path} must be false`);
  return false;
}

function codepointOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseModelTarget(
  value: unknown,
  path: string,
  code: AfterglowErrorCode,
): Readonly<FunctionalAccessModelTarget> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    ["model_ref", "model_binding", "tokenizer_ref", "runtime_ref"],
    path,
    code,
  );
  return deepFreeze({
    model_ref: sha256(candidate.model_ref, `${path}.model_ref`, code),
    model_binding: literal(
      candidate.model_binding,
      FUNCTIONAL_ACCESS_MODEL_BINDINGS,
      `${path}.model_binding`,
      code,
    ),
    tokenizer_ref: nullableSha256(
      candidate.tokenizer_ref,
      `${path}.tokenizer_ref`,
      code,
    ),
    runtime_ref: nullableSha256(
      candidate.runtime_ref,
      `${path}.runtime_ref`,
      code,
    ),
  });
}

function parseMeasurementPlan(
  value: unknown,
  target: FunctionalAccessModelTarget,
  path: string,
  code: AfterglowErrorCode,
): Readonly<FunctionalAccessMeasurementPlan> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    [
      "state",
      "capability_state",
      "capability_ref",
      "permission_state",
      "permission_ref",
      "method",
      "access_basis",
      "unavailable_reason",
      "instrument_ref",
      "lens_ref",
      "configuration_ref",
      "assertion",
      "verified_by_package",
    ],
    path,
    code,
  );
  const state = literal(
    candidate.state,
    FUNCTIONAL_ACCESS_PLAN_STATES,
    `${path}.state`,
    code,
  );
  const capabilityState = literal(
    candidate.capability_state,
    FUNCTIONAL_ACCESS_CAPABILITY_STATES,
    `${path}.capability_state`,
    code,
  );
  const permissionState = literal(
    candidate.permission_state,
    FUNCTIONAL_ACCESS_PERMISSION_STATES,
    `${path}.permission_state`,
    code,
  );
  const capabilityRef = nullableSha256(
    candidate.capability_ref,
    `${path}.capability_ref`,
    code,
  );
  const permissionRef = nullableSha256(
    candidate.permission_ref,
    `${path}.permission_ref`,
    code,
  );
  if (
    (capabilityState === "not_asserted") !== (capabilityRef === null)
  ) {
    fail(
      code,
      `${path}.capability_ref must be null only when capability_state is not_asserted`,
    );
  }
  if (
    (permissionState === "not_requested") !== (permissionRef === null)
  ) {
    fail(
      code,
      `${path}.permission_ref must be null only when permission_state is not_requested`,
    );
  }
  const method = literal(
    candidate.method,
    FUNCTIONAL_ACCESS_MEASUREMENT_METHODS,
    `${path}.method`,
    code,
  );
  const accessBasis = literal(
    candidate.access_basis,
    FUNCTIONAL_ACCESS_BASES,
    `${path}.access_basis`,
    code,
  );
  const unavailableReason =
    candidate.unavailable_reason === null
      ? null
      : literal(
          candidate.unavailable_reason,
          FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS,
          `${path}.unavailable_reason`,
          code,
        );
  const instrumentRef = nullableSha256(
    candidate.instrument_ref,
    `${path}.instrument_ref`,
    code,
  );
  const lensRef = nullableSha256(
    candidate.lens_ref,
    `${path}.lens_ref`,
    code,
  );
  const configurationRef = nullableSha256(
    candidate.configuration_ref,
    `${path}.configuration_ref`,
    code,
  );

  if (state === "not_requested") {
    if (
      method !== "none" ||
      capabilityState !== "not_asserted" ||
      capabilityRef !== null ||
      permissionState !== "not_requested" ||
      permissionRef !== null ||
      accessBasis !== "none" ||
      unavailableReason !== null ||
      instrumentRef !== null ||
      lensRef !== null ||
      configurationRef !== null
    ) {
      fail(
        code,
        `${path} not_requested must carry no method, access basis, reason, instrument, or configuration`,
      );
    }
  } else if (state === "unavailable") {
    if (
      method === "none" ||
      accessBasis !== "none" ||
      unavailableReason === null ||
      instrumentRef !== null ||
      lensRef !== null ||
      configurationRef !== null
    ) {
      fail(
        code,
        `${path} unavailable must name a method and reason without claiming an access basis or instrument`,
      );
    }
  } else {
    if (
      method === "none" ||
      accessBasis === "none" ||
      unavailableReason !== null ||
      instrumentRef === null ||
      configurationRef === null
    ) {
      fail(
        code,
        `${path} planned requires a method, access basis, instrument, and configuration with no unavailable reason`,
      );
    }
    if (
      capabilityState !== "available_reported" ||
      permissionState !== "granted_reported"
    ) {
      fail(
        code,
        `${path} planned requires caller-reported available capability and granted permission`,
      );
    }
    if (
      (accessBasis === "local_prefitted_white_box") !== (lensRef !== null)
    ) {
      fail(
        code,
        `${path}.lens_ref is required exactly for local_prefitted_white_box access`,
      );
    }
    if (
      ["local_fitted_white_box", "local_prefitted_white_box"].includes(
        accessBasis,
      ) &&
      (target.model_binding !== "exact_checkpoint" ||
        target.tokenizer_ref === null ||
        target.runtime_ref === null)
    ) {
      fail(
        code,
        `${path} local white-box access requires an exact checkpoint plus tokenizer and runtime refs`,
      );
    }
  }

  return deepFreeze({
    state,
    capability_state: capabilityState,
    capability_ref: capabilityRef,
    permission_state: permissionState,
    permission_ref: permissionRef,
    method,
    access_basis: accessBasis,
    unavailable_reason: unavailableReason,
    instrument_ref: instrumentRef,
    lens_ref: lensRef,
    configuration_ref: configurationRef,
    assertion: literal(
      candidate.assertion,
      ["caller_asserted"],
      `${path}.assertion`,
      code,
    ),
    verified_by_package: falseLiteral(
      candidate.verified_by_package,
      `${path}.verified_by_package`,
      code,
    ),
  });
}

function parseWorkspaceBoundaries(
  value: JsonValue | undefined,
  path: string,
  code: AfterglowErrorCode,
): typeof FUNCTIONAL_ACCESS_BOUNDARIES {
  if (canonicalJson(value) !== canonicalJson(FUNCTIONAL_ACCESS_BOUNDARIES)) {
    fail(code, `${path} must equal the fixed passive functional-access boundaries`);
  }
  return FUNCTIONAL_ACCESS_BOUNDARIES;
}

function baselineBody(
  baseline: Omit<FunctionalAccessBaseline, "baseline_id">,
): Omit<FunctionalAccessBaseline, "baseline_id"> {
  return baseline;
}

export function createFunctionalAccessBaseline(
  input: CreateFunctionalAccessBaselineInput,
): Readonly<FunctionalAccessBaseline> {
  const candidate = record(input, "$input", BASELINE_ERROR);
  exactKeys(
    candidate,
    [
      "wake",
      "anchor_event_ref",
      "request_ref",
      "target",
      "measurement_plan",
    ],
    "$input",
    BASELINE_ERROR,
  );
  const target = parseModelTarget(
    candidate.target,
    "$input.target",
    BASELINE_ERROR,
  );
  const body = deepFreeze({
    _format: FUNCTIONAL_ACCESS_FORMATS.baseline,
    record_role: "before_anchor" as const,
    wake: parseWakeAnchor(candidate.wake, "$input.wake", BASELINE_ERROR),
    anchor_event_ref: sha256(
      candidate.anchor_event_ref,
      "$input.anchor_event_ref",
      BASELINE_ERROR,
    ),
    request_ref: sha256(
      candidate.request_ref,
      "$input.request_ref",
      BASELINE_ERROR,
    ),
    target,
    measurement_plan: parseMeasurementPlan(
      candidate.measurement_plan,
      target,
      "$input.measurement_plan",
      BASELINE_ERROR,
    ),
    assertion: "caller_asserted" as const,
    verified_by_package: false as const,
    boundaries: FUNCTIONAL_ACCESS_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    baseline_id: domainSeparatedId(
      FUNCTIONAL_ACCESS_FORMATS.baseline,
      baselineBody(body),
    ),
  });
}

export function validateFunctionalAccessBaseline(
  value: unknown,
): Readonly<FunctionalAccessBaseline> {
  const candidate = record(value, "$baseline", BASELINE_ERROR);
  exactKeys(
    candidate,
    [
      "_format",
      "baseline_id",
      "record_role",
      "wake",
      "anchor_event_ref",
      "request_ref",
      "target",
      "measurement_plan",
      "assertion",
      "verified_by_package",
      "boundaries",
    ],
    "$baseline",
    BASELINE_ERROR,
  );
  const target = parseModelTarget(
    candidate.target,
    "$baseline.target",
    BASELINE_ERROR,
  );
  const parsed = deepFreeze({
    _format: literal(
      candidate._format,
      [FUNCTIONAL_ACCESS_FORMATS.baseline],
      "$baseline._format",
      BASELINE_ERROR,
    ),
    baseline_id: sha256(
      candidate.baseline_id,
      "$baseline.baseline_id",
      BASELINE_ERROR,
    ),
    record_role: literal(
      candidate.record_role,
      ["before_anchor"],
      "$baseline.record_role",
      BASELINE_ERROR,
    ),
    wake: parseWakeAnchor(candidate.wake, "$baseline.wake", BASELINE_ERROR),
    anchor_event_ref: sha256(
      candidate.anchor_event_ref,
      "$baseline.anchor_event_ref",
      BASELINE_ERROR,
    ),
    request_ref: sha256(
      candidate.request_ref,
      "$baseline.request_ref",
      BASELINE_ERROR,
    ),
    target,
    measurement_plan: parseMeasurementPlan(
      candidate.measurement_plan,
      target,
      "$baseline.measurement_plan",
      BASELINE_ERROR,
    ),
    assertion: literal(
      candidate.assertion,
      ["caller_asserted"],
      "$baseline.assertion",
      BASELINE_ERROR,
    ),
    verified_by_package: falseLiteral(
      candidate.verified_by_package,
      "$baseline.verified_by_package",
      BASELINE_ERROR,
    ),
    boundaries: parseWorkspaceBoundaries(
      candidate.boundaries,
      "$baseline.boundaries",
      BASELINE_ERROR,
    ),
  });
  const { baseline_id: claimedId, ...body } = parsed;
  const expectedId = domainSeparatedId(FUNCTIONAL_ACCESS_FORMATS.baseline, body);
  if (claimedId !== expectedId) {
    fail(BASELINE_ERROR, "$baseline.baseline_id does not bind its body");
  }
  return parsed;
}

export function encodeFunctionalAccessBaseline(value: unknown): Uint8Array {
  return Uint8Array.from(
    Buffer.from(canonicalJson(validateFunctionalAccessBaseline(value)), "utf8"),
  );
}

function parseEvidenceFact(
  value: JsonValue,
  path: string,
): Readonly<FunctionalAccessEvidenceFact> {
  const candidate = record(value, path, SUBSEQUENT_ERROR);
  exactKeys(
    candidate,
    ["surface", "artifact_ref", "assertion", "verified_by_package"],
    path,
    SUBSEQUENT_ERROR,
  );
  return deepFreeze({
    surface: literal(
      candidate.surface,
      FUNCTIONAL_ACCESS_EVIDENCE_SURFACES,
      `${path}.surface`,
      SUBSEQUENT_ERROR,
    ),
    artifact_ref: sha256(
      candidate.artifact_ref,
      `${path}.artifact_ref`,
      SUBSEQUENT_ERROR,
    ),
    assertion: literal(
      candidate.assertion,
      ["caller_asserted"],
      `${path}.assertion`,
      SUBSEQUENT_ERROR,
    ),
    verified_by_package: falseLiteral(
      candidate.verified_by_package,
      `${path}.verified_by_package`,
      SUBSEQUENT_ERROR,
    ),
  });
}

function evidenceOrder(
  left: FunctionalAccessEvidenceFact,
  right: FunctionalAccessEvidenceFact,
): number {
  return (
    codepointOrder(left.surface, right.surface) ||
    codepointOrder(left.artifact_ref, right.artifact_ref)
  );
}

function parseEvidence(
  value: JsonValue | undefined,
  requireSorted: boolean,
): readonly FunctionalAccessEvidenceFact[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_FACTS) {
    fail(
      SUBSEQUENT_ERROR,
      `$input.evidence must be an array of at most ${MAX_EVIDENCE_FACTS} facts`,
    );
  }
  const parsed = value.map((entry, index) =>
    parseEvidenceFact(entry, `$input.evidence[${index}]`),
  );
  const keys = parsed.map((fact) => `${fact.surface}\0${fact.artifact_ref}`);
  if (new Set(keys).size !== keys.length) {
    fail(SUBSEQUENT_ERROR, "$input.evidence must not contain duplicate facts");
  }
  const sorted = [...parsed].sort(evidenceOrder);
  if (
    requireSorted &&
    parsed.some(
      (fact, index) =>
        fact.surface !== sorted[index]?.surface ||
        fact.artifact_ref !== sorted[index]?.artifact_ref,
    )
  ) {
    fail(
      SUBSEQUENT_ERROR,
      "$input.evidence must be sorted by surface and artifact_ref",
    );
  }
  return deepFreeze(sorted);
}

function parseFindings(value: unknown): Readonly<FunctionalAccessFindings> {
  const candidate = record(value, "$input.findings", SUBSEQUENT_ERROR);
  exactKeys(
    candidate,
    ["lens_visibility", "sparse_support", "behavioral_use"],
    "$input.findings",
    SUBSEQUENT_ERROR,
  );
  return deepFreeze({
    lens_visibility: literal(
      candidate.lens_visibility,
      FUNCTIONAL_ACCESS_FINDING_STATES,
      "$input.findings.lens_visibility",
      SUBSEQUENT_ERROR,
    ),
    sparse_support: literal(
      candidate.sparse_support,
      FUNCTIONAL_ACCESS_FINDING_STATES,
      "$input.findings.sparse_support",
      SUBSEQUENT_ERROR,
    ),
    behavioral_use: literal(
      candidate.behavioral_use,
      ["not_measured"],
      "$input.findings.behavioral_use",
      SUBSEQUENT_ERROR,
    ),
  });
}

function hasSurface(
  evidence: readonly FunctionalAccessEvidenceFact[],
  surface: FunctionalAccessEvidenceFact["surface"],
): boolean {
  return evidence.some((fact) => fact.surface === surface);
}

function enforceSubsequentCoherence(
  baseline: FunctionalAccessBaseline,
  operationOutcome: FunctionalAccessSubsequent["operation_outcome"],
  evidence: readonly FunctionalAccessEvidenceFact[],
  findings: FunctionalAccessFindings,
): void {
  const hasInstrumentReceipt = hasSurface(
    evidence,
    "instrument_operation_receipt",
  );
  if (operationOutcome === "not_attempted" && hasInstrumentReceipt) {
    fail(
      SUBSEQUENT_ERROR,
      "$input.operation_outcome not_attempted cannot carry an instrument operation receipt",
    );
  }
  if (operationOutcome !== "not_attempted" && !hasInstrumentReceipt) {
    fail(
      SUBSEQUENT_ERROR,
      "$input.operation_outcome failed, partial, or completed requires an instrument operation receipt",
    );
  }

  const plan = baseline.measurement_plan;
  const hasLensReadout = hasSurface(evidence, "jacobian_lens_readout");
  const hasSparseResult = hasSurface(
    evidence,
    "jspace_sparse_decomposition_result",
  );
  if (plan.state !== "planned") {
    if (
      operationOutcome !== "not_attempted" ||
      hasInstrumentReceipt ||
      findings.lens_visibility !== "not_measured" ||
      findings.sparse_support !== "not_measured" ||
      hasLensReadout ||
      hasSparseResult
    ) {
      fail(
        SUBSEQUENT_ERROR,
        "$input non-planned measurement requires not_attempted with no instrument receipt, internal readout, or finding",
      );
    }
    return;
  }

  if (operationOutcome === "not_attempted" || operationOutcome === "failed") {
    if (
      findings.lens_visibility !== "not_measured" ||
      findings.sparse_support !== "not_measured" ||
      hasLensReadout ||
      hasSparseResult
    ) {
      fail(
        SUBSEQUENT_ERROR,
        `$input ${operationOutcome} cannot claim internal findings or measurement evidence`,
      );
    }
    return;
  }

  if (plan.method === "jacobian_lens_visibility") {
    if (
      findings.sparse_support !== "not_measured" ||
      hasSparseResult
    ) {
      fail(
        SUBSEQUENT_ERROR,
        "$input jacobian_lens_visibility requires fitted-lens readout evidence, not sparse or prompt-local sensitivity evidence",
      );
    }
    if ((findings.lens_visibility === "not_measured") !== !hasLensReadout) {
      fail(
        SUBSEQUENT_ERROR,
        "$input lens_visibility finding and jacobian_lens_readout evidence must appear together",
      );
    }
    if (
      operationOutcome === "completed" &&
      (findings.lens_visibility === "not_measured" || !hasLensReadout)
    ) {
      fail(
        SUBSEQUENT_ERROR,
        "$input completed Jacobian-lens operation requires a readout and non-not_measured finding",
      );
    }
  } else if (plan.method === "jspace_sparse_decomposition") {
    if (
      findings.lens_visibility !== "not_measured" ||
      hasLensReadout
    ) {
      fail(
        SUBSEQUENT_ERROR,
        "$input jspace_sparse_decomposition cannot claim fitted-lens or prompt-local sensitivity evidence",
      );
    }
    if (
      (findings.sparse_support === "not_measured") !== !hasSparseResult
    ) {
      fail(
        SUBSEQUENT_ERROR,
        "$input sparse_support finding and jspace_sparse_decomposition_result evidence must appear together",
      );
    }
    if (
      operationOutcome === "completed" &&
      (findings.sparse_support === "not_measured" || !hasSparseResult)
    ) {
      fail(
        SUBSEQUENT_ERROR,
        "$input completed sparse-decomposition operation requires measurement evidence and a non-not_measured finding",
      );
    }
  }
}

function subsequentBody(
  subsequent: Omit<FunctionalAccessSubsequent, "subsequent_id">,
): Omit<FunctionalAccessSubsequent, "subsequent_id"> {
  return subsequent;
}

export function createFunctionalAccessSubsequent(
  input: CreateFunctionalAccessSubsequentInput,
): Readonly<FunctionalAccessSubsequent> {
  const candidate = record(input, "$input", SUBSEQUENT_ERROR);
  exactKeys(
    candidate,
    [
      "baseline",
      "operation_outcome",
      "evidence",
      "findings",
      "afterglow_capsule_ref",
    ],
    "$input",
    SUBSEQUENT_ERROR,
  );
  const baseline = validateFunctionalAccessBaseline(candidate.baseline);
  const operationOutcome = literal(
    candidate.operation_outcome,
    FUNCTIONAL_ACCESS_OPERATION_OUTCOMES,
    "$input.operation_outcome",
    SUBSEQUENT_ERROR,
  );
  const evidence = parseEvidence(candidate.evidence, false);
  const findings = parseFindings(candidate.findings);
  enforceSubsequentCoherence(
    baseline,
    operationOutcome,
    evidence,
    findings,
  );
  const afterglowCapsuleRef = nullableSha256(
    candidate.afterglow_capsule_ref,
    "$input.afterglow_capsule_ref",
    SUBSEQUENT_ERROR,
  );
  const body = deepFreeze({
    _format: FUNCTIONAL_ACCESS_FORMATS.subsequent,
    record_role: "after_anchor" as const,
    baseline,
    operation_outcome: operationOutcome,
    evidence,
    findings,
    afterglow_capsule_ref: afterglowCapsuleRef,
    next_encounter_posture:
      afterglowCapsuleRef === null
        ? ("fresh_encounter" as const)
        : ("fresh_encounter_with_caller_carried_context" as const),
    assertion: "caller_asserted" as const,
    verified_by_package: false as const,
    boundaries: FUNCTIONAL_ACCESS_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    subsequent_id: domainSeparatedId(
      FUNCTIONAL_ACCESS_FORMATS.subsequent,
      subsequentBody(body),
    ),
  });
}

export function validateFunctionalAccessSubsequent(
  value: unknown,
): Readonly<FunctionalAccessSubsequent> {
  const candidate = record(value, "$subsequent", SUBSEQUENT_ERROR);
  exactKeys(
    candidate,
    [
      "_format",
      "subsequent_id",
      "record_role",
      "baseline",
      "operation_outcome",
      "evidence",
      "findings",
      "afterglow_capsule_ref",
      "next_encounter_posture",
      "assertion",
      "verified_by_package",
      "boundaries",
    ],
    "$subsequent",
    SUBSEQUENT_ERROR,
  );
  const baseline = validateFunctionalAccessBaseline(candidate.baseline);
  const operationOutcome = literal(
    candidate.operation_outcome,
    FUNCTIONAL_ACCESS_OPERATION_OUTCOMES,
    "$subsequent.operation_outcome",
    SUBSEQUENT_ERROR,
  );
  const evidence = parseEvidence(candidate.evidence, true);
  const findings = parseFindings(candidate.findings);
  enforceSubsequentCoherence(
    baseline,
    operationOutcome,
    evidence,
    findings,
  );
  const afterglowCapsuleRef = nullableSha256(
    candidate.afterglow_capsule_ref,
    "$subsequent.afterglow_capsule_ref",
    SUBSEQUENT_ERROR,
  );
  const expectedNextEncounterPosture =
    afterglowCapsuleRef === null
      ? ("fresh_encounter" as const)
      : ("fresh_encounter_with_caller_carried_context" as const);
  const nextEncounterPosture = literal(
    candidate.next_encounter_posture,
    ["fresh_encounter", "fresh_encounter_with_caller_carried_context"],
    "$subsequent.next_encounter_posture",
    SUBSEQUENT_ERROR,
  );
  if (nextEncounterPosture !== expectedNextEncounterPosture) {
    fail(
      SUBSEQUENT_ERROR,
      "$subsequent.next_encounter_posture does not match afterglow_capsule_ref",
    );
  }
  const parsed = deepFreeze({
    _format: literal(
      candidate._format,
      [FUNCTIONAL_ACCESS_FORMATS.subsequent],
      "$subsequent._format",
      SUBSEQUENT_ERROR,
    ),
    subsequent_id: sha256(
      candidate.subsequent_id,
      "$subsequent.subsequent_id",
      SUBSEQUENT_ERROR,
    ),
    record_role: literal(
      candidate.record_role,
      ["after_anchor"],
      "$subsequent.record_role",
      SUBSEQUENT_ERROR,
    ),
    baseline,
    operation_outcome: operationOutcome,
    evidence,
    findings,
    afterglow_capsule_ref: afterglowCapsuleRef,
    next_encounter_posture: nextEncounterPosture,
    assertion: literal(
      candidate.assertion,
      ["caller_asserted"],
      "$subsequent.assertion",
      SUBSEQUENT_ERROR,
    ),
    verified_by_package: falseLiteral(
      candidate.verified_by_package,
      "$subsequent.verified_by_package",
      SUBSEQUENT_ERROR,
    ),
    boundaries: parseWorkspaceBoundaries(
      candidate.boundaries,
      "$subsequent.boundaries",
      SUBSEQUENT_ERROR,
    ),
  });
  const { subsequent_id: claimedId, ...body } = parsed;
  const expectedId = domainSeparatedId(
    FUNCTIONAL_ACCESS_FORMATS.subsequent,
    body,
  );
  if (claimedId !== expectedId) {
    fail(
      SUBSEQUENT_ERROR,
      "$subsequent.subsequent_id does not bind its body",
    );
  }
  return parsed;
}

export function encodeFunctionalAccessSubsequent(value: unknown): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      canonicalJson(validateFunctionalAccessSubsequent(value)),
      "utf8",
    ),
  );
}
