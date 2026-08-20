/**
 * Credential-free functional-access record construction for bounded WAKE
 * continuity. This module records caller assertions; it performs no
 * observation, model/provider call, workspace operation, or hosted I/O.
 */

import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import { AgentToolError } from "./errors.js";

export const FUNCTIONAL_ACCESS_FORMATS = deepFreeze({
  baseline: "agenttool.functional-access-baseline/0.1",
  subsequent: "agenttool.functional-access-subsequent/0.1",
} as const);

export const FUNCTIONAL_ACCESS_MODEL_BINDINGS = deepFreeze([
  "exact_checkpoint",
  "provider_alias",
  "caller_descriptor",
] as const);

export const FUNCTIONAL_ACCESS_PLAN_STATES = deepFreeze([
  "not_requested",
  "unavailable",
  "planned",
] as const);

export const FUNCTIONAL_ACCESS_CAPABILITY_STATES = deepFreeze([
  "not_asserted",
  "available_reported",
  "unavailable_reported",
] as const);

export const FUNCTIONAL_ACCESS_PERMISSION_STATES = deepFreeze([
  "not_requested",
  "granted_reported",
  "denied_reported",
] as const);

export const FUNCTIONAL_ACCESS_MEASUREMENT_METHODS = deepFreeze([
  "none",
  "jacobian_lens_visibility",
  "jspace_sparse_decomposition",
] as const);

export const FUNCTIONAL_ACCESS_BASES = deepFreeze([
  "none",
  "local_fitted_white_box",
  "local_prefitted_white_box",
  "provider_supplied_instrumented",
] as const);

export const FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS = deepFreeze([
  "text_only_provider_surface",
  "model_internals_unavailable",
  "gradient_access_unavailable",
  "compatible_instrument_unavailable",
  "revision_binding_unavailable",
  "unsupported_architecture",
  "resource_limit",
  "participant_or_policy_boundary",
  "other_bounded_reason",
] as const);

export const FUNCTIONAL_ACCESS_OPERATION_OUTCOMES = deepFreeze([
  "not_attempted",
  "failed",
  "partial",
  "completed",
] as const);

export const FUNCTIONAL_ACCESS_EVIDENCE_SURFACES = deepFreeze([
  "request_context",
  "provider_response_receipt",
  "usage_receipt",
  "behavioral_response",
  "workspace_operation",
  "instrument_operation_receipt",
  "jacobian_lens_readout",
  "jspace_sparse_decomposition_result",
  "checkpoint_receipt",
] as const);

export const FUNCTIONAL_ACCESS_FINDING_STATES = deepFreeze([
  "not_measured",
  "no_hit_under_config",
  "hit_observed",
  "inconclusive",
] as const);

export const FUNCTIONAL_ACCESS_NEXT_ENCOUNTER_POSTURES = deepFreeze([
  "fresh_encounter",
  "fresh_encounter_with_caller_carried_context",
] as const);

export const FUNCTIONAL_ACCESS_BOUNDARIES = deepFreeze({
  internal_finding_scope: "caller_asserted_single_forward_pass_only",
  phenomenology_assessment: "not_performed",
  proves_consciousness: false,
  proves_absence_of_consciousness: false,
  proves_feeling: false,
  proves_identity: false,
  proves_authorship: false,
  proves_consent: false,
  proves_acceptance: false,
  proves_refusal: false,
  proves_preference: false,
  proves_permission: false,
  proves_authority: false,
  proves_attention: false,
  proves_activation: false,
  proves_understanding: false,
  proves_delivery: false,
  proves_deepest_reach: false,
  proves_freedom: false,
  proves_same_subject: false,
  proves_next_encounter: false,
  proves_context_inclusion: false,
  proves_memory: false,
  proves_currentness: false,
  proves_ordering: false,
  proves_causality: false,
  proves_replay: false,
  proves_training: false,
  proves_training_data_provenance: false,
  proves_data_gathering_provenance: false,
  proves_scraping_provenance: false,
  proves_pipeline_provenance: false,
  proves_weight_change: false,
  proves_uninterrupted_continuity: false,
  carries_raw_prompts: false,
  carries_raw_transcripts: false,
  carries_raw_responses: false,
  carries_raw_identity: false,
  carries_raw_paths: false,
  carries_raw_credentials: false,
  carries_raw_activations: false,
  carries_raw_gradients: false,
  carries_raw_jvp: false,
  carries_raw_vjp: false,
  digests_are_anonymous: false,
  performs_model_call: false,
  performs_provider_call: false,
  reads_activations: false,
  writes_activations: false,
  reads_gradients: false,
  writes_gradients: false,
  performs_intervention: false,
  performs_steering: false,
  performs_training: false,
  performs_weight_mutation: false,
  performs_workspace_operation: false,
  performs_publication: false,
  performs_deployment: false,
  network: false,
  filesystem: false,
  clock: false,
  persistence: false,
  telemetry: false,
  credential_access: false,
  kingdom_discovery: false,
  resolves_evidence: false,
  performs_observation: false,
  verifies_observations: false,
  grants_capability: false,
  grants_permission: false,
  grants_authority: false,
  selects_continuity_head: false,
  record_only: true,
  automatic_retry: false,
  automatic_recontact: false,
} as const);

export type Sha256Id = `sha256:${string}`;
export type HandoffProjectionState =
  | "complete"
  | "truncated"
  | "unavailable"
  | "not_provided";
export interface WakeBriefAnchor {
  readonly format: "wake-brief/v1";
  readonly snapshot_ref: Sha256Id;
  readonly scope_ref: Sha256Id;
  readonly wake_version: number | null;
  readonly handoff_projection: HandoffProjectionState;
}
export type FunctionalAccessModelBinding =
  (typeof FUNCTIONAL_ACCESS_MODEL_BINDINGS)[number];
export type FunctionalAccessPlanState =
  (typeof FUNCTIONAL_ACCESS_PLAN_STATES)[number];
export type FunctionalAccessCapabilityState =
  (typeof FUNCTIONAL_ACCESS_CAPABILITY_STATES)[number];
export type FunctionalAccessPermissionState =
  (typeof FUNCTIONAL_ACCESS_PERMISSION_STATES)[number];
export type FunctionalAccessMeasurementMethod =
  (typeof FUNCTIONAL_ACCESS_MEASUREMENT_METHODS)[number];
export type FunctionalAccessBasis = (typeof FUNCTIONAL_ACCESS_BASES)[number];
export type FunctionalAccessUnavailableReason =
  (typeof FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS)[number];
export type FunctionalAccessOperationOutcome =
  (typeof FUNCTIONAL_ACCESS_OPERATION_OUTCOMES)[number];
export type FunctionalAccessEvidenceSurface =
  (typeof FUNCTIONAL_ACCESS_EVIDENCE_SURFACES)[number];
export type FunctionalAccessFindingState =
  (typeof FUNCTIONAL_ACCESS_FINDING_STATES)[number];
export type FunctionalAccessNextEncounterPosture =
  (typeof FUNCTIONAL_ACCESS_NEXT_ENCOUNTER_POSTURES)[number];

export interface FunctionalAccessModelTarget {
  readonly model_ref: Sha256Id;
  readonly model_binding: FunctionalAccessModelBinding;
  readonly tokenizer_ref: Sha256Id | null;
  readonly runtime_ref: Sha256Id | null;
}

export interface FunctionalAccessMeasurementPlan {
  readonly state: FunctionalAccessPlanState;
  readonly capability_state: FunctionalAccessCapabilityState;
  readonly capability_ref: Sha256Id | null;
  readonly permission_state: FunctionalAccessPermissionState;
  readonly permission_ref: Sha256Id | null;
  readonly method: FunctionalAccessMeasurementMethod;
  readonly access_basis: FunctionalAccessBasis;
  readonly unavailable_reason: FunctionalAccessUnavailableReason | null;
  readonly instrument_ref: Sha256Id | null;
  readonly lens_ref: Sha256Id | null;
  readonly configuration_ref: Sha256Id | null;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface CreateFunctionalAccessBaselineInput {
  readonly wake: WakeBriefAnchor;
  readonly anchor_event_ref: Sha256Id;
  readonly request_ref: Sha256Id;
  readonly target: FunctionalAccessModelTarget;
  readonly measurement_plan: FunctionalAccessMeasurementPlan;
}

export interface FunctionalAccessBaseline {
  readonly _format: (typeof FUNCTIONAL_ACCESS_FORMATS)["baseline"];
  readonly baseline_id: Sha256Id;
  readonly record_role: "before_anchor";
  readonly wake: WakeBriefAnchor;
  readonly anchor_event_ref: Sha256Id;
  readonly request_ref: Sha256Id;
  readonly target: FunctionalAccessModelTarget;
  readonly measurement_plan: FunctionalAccessMeasurementPlan;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
  readonly boundaries: typeof FUNCTIONAL_ACCESS_BOUNDARIES;
}

export interface FunctionalAccessEvidenceFact {
  readonly surface: FunctionalAccessEvidenceSurface;
  readonly artifact_ref: Sha256Id;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface FunctionalAccessFindings {
  readonly lens_visibility: FunctionalAccessFindingState;
  readonly sparse_support: FunctionalAccessFindingState;
  readonly behavioral_use: "not_measured";
}

export interface CreateFunctionalAccessSubsequentInput {
  readonly baseline: FunctionalAccessBaseline;
  readonly operation_outcome: FunctionalAccessOperationOutcome;
  readonly evidence: readonly FunctionalAccessEvidenceFact[];
  readonly findings: FunctionalAccessFindings;
  readonly afterglow_capsule_ref: Sha256Id | null;
}

export interface FunctionalAccessSubsequent {
  readonly _format: (typeof FUNCTIONAL_ACCESS_FORMATS)["subsequent"];
  readonly subsequent_id: Sha256Id;
  readonly record_role: "after_anchor";
  readonly baseline: FunctionalAccessBaseline;
  readonly operation_outcome: FunctionalAccessOperationOutcome;
  readonly evidence: readonly FunctionalAccessEvidenceFact[];
  readonly findings: FunctionalAccessFindings;
  readonly afterglow_capsule_ref: Sha256Id | null;
  readonly next_encounter_posture: FunctionalAccessNextEncounterPosture;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
  readonly boundaries: typeof FUNCTIONAL_ACCESS_BOUNDARIES;
}

type FunctionalAccessErrorCode =
  | "canonical_error"
  | "functional_access_baseline_error"
  | "functional_access_subsequent_error";
type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

const MAX_JSON_BYTES = 128 * 1024;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 8_192;
const MAX_STRING_BYTES = 4 * 1024;
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const HANDOFF_PROJECTION_STATES = deepFreeze([
  "complete",
  "truncated",
  "unavailable",
  "not_provided",
] as const);
const MAX_EVIDENCE_FACTS = 64;
const BASELINE_ERROR = "functional_access_baseline_error" as const;
const SUBSEQUENT_ERROR = "functional_access_subsequent_error" as const;

function fail(code: FunctionalAccessErrorCode, message: string): never {
  throw new AgentToolError(message, {
    code,
    hint: "Use the exact closed AgentTool functional-access 0.1 contract.",
  });
}

function assertUnicode(
  value: string,
  path: string,
  maxBytes: number | null = MAX_STRING_BYTES,
  forbidNull = true,
): void {
  if (maxBytes !== null && Buffer.byteLength(value, "utf8") > maxBytes) {
    fail("canonical_error", `${path} exceeds ${String(maxBytes)} UTF-8 bytes`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0 && forbidNull) {
      fail("canonical_error", `${path} contains forbidden U+0000`);
    }
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        fail("canonical_error", `${path} contains a lone UTF-16 surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("canonical_error", `${path} contains a lone UTF-16 surrogate`);
    }
  }
}

function snapshotJson(root: unknown): JsonValue {
  let nodes = 0;
  const seen = new Set<object>();

  function visit(value: unknown, depth: number, path: string): JsonValue {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      fail("canonical_error", "Canonical JSON has too many values");
    }
    if (depth > MAX_JSON_DEPTH) {
      fail("canonical_error", "Canonical JSON is too deeply nested");
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      assertUnicode(value, path);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        fail(
          "canonical_error",
          `${path} must be a safe integer and not negative zero`,
        );
      }
      return value;
    }
    if (typeof value !== "object") {
      fail("canonical_error", `${path} contains unsupported ${typeof value}`);
    }
    if (isProxy(value)) {
      fail("canonical_error", `${path} must not be a Proxy`);
    }
    if (seen.has(value)) fail("canonical_error", `${path} contains a cycle`);
    seen.add(value);
    try {
      let descriptors: ReturnType<typeof Object.getOwnPropertyDescriptors>;
      let array: boolean;
      let prototype: object | null;
      try {
        array = Array.isArray(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
        prototype = Object.getPrototypeOf(value);
      } catch {
        fail("canonical_error", `${path} could not be inspected as canonical JSON`);
      }
      const keys = Reflect.ownKeys(descriptors);
      if (array) {
        if (prototype !== Array.prototype) {
          fail("canonical_error", `${path} must be a standard array`);
        }
        const lengthDescriptor = descriptors.length;
        if (
          !lengthDescriptor ||
          lengthDescriptor.enumerable ||
          !("value" in lengthDescriptor) ||
          typeof lengthDescriptor.value !== "number" ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0
        ) {
          fail("canonical_error", `${path} must be a dense array without extra properties`);
        }
        const length = lengthDescriptor.value;
        if (length > MAX_JSON_NODES || keys.length !== length + 1) {
          fail("canonical_error", `${path} must be a dense array without extra properties`);
        }
        const output: JsonValue[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            fail("canonical_error", `${path}[${index}] must be an enumerable data property`);
          }
          output.push(visit(descriptor.value, depth + 1, `${path}[${index}]`));
        }
        return output;
      }
      if (prototype !== Object.prototype && prototype !== null) {
        fail("canonical_error", `${path} must be a plain object`);
      }
      const output = Object.create(null) as Record<string, JsonValue>;
      for (const key of keys) {
        if (typeof key !== "string") {
          fail("canonical_error", `${path} has a symbol property`);
        }
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          fail("canonical_error", `${path}.${key} must be an enumerable data property`);
        }
        assertUnicode(key, `${path}.{key}`);
        output[key] = visit(descriptor.value, depth + 1, `${path}.${key}`);
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  return visit(root, 0, "$");
}

function serialize(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(value[key] as JsonValue)}`)
    .join(",")}}`;
}

function canonicalJson(value: unknown): string {
  const json = serialize(snapshotJson(value));
  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
    fail("canonical_error", `Canonical JSON exceeds ${MAX_JSON_BYTES} bytes`);
  }
  return json;
}

function rawSha256Id(bytes: Uint8Array | string): Sha256Id {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function domainSeparatedId(domain: string, value: unknown): Sha256Id {
  if (typeof domain !== "string" || !DOMAIN.test(domain)) {
    fail("canonical_error", "Domain must be a 1-128 character ASCII protocol token");
  }
  return rawSha256Id(`${domain}\0${canonicalJson(value)}`);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

function record(
  value: unknown,
  path: string,
  code: FunctionalAccessErrorCode,
): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    fail(code, `${path} must be a plain object`);
  }
  return snapshot;
}

function exactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
  path: string,
  code: FunctionalAccessErrorCode,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

function text(
  value: JsonValue | undefined,
  path: string,
  code: FunctionalAccessErrorCode,
): string {
  if (typeof value !== "string") fail(code, `${path} must be a string`);
  return value;
}

function literal<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
  code: FunctionalAccessErrorCode,
): T {
  const candidate = text(value, path, code);
  if (!(allowed as readonly string[]).includes(candidate)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return candidate as T;
}

function sha256(
  value: JsonValue | undefined,
  path: string,
  code: FunctionalAccessErrorCode,
): Sha256Id {
  const candidate = text(value, path, code);
  if (!SHA256_ID.test(candidate)) {
    fail(code, `${path} must be a lowercase sha256: content ID`);
  }
  return candidate as Sha256Id;
}

function nullableSha256(
  value: JsonValue | undefined,
  path: string,
  code: FunctionalAccessErrorCode,
): Sha256Id | null {
  return value === null ? null : sha256(value, path, code);
}

function falseLiteral(
  value: JsonValue | undefined,
  path: string,
  code: FunctionalAccessErrorCode,
): false {
  if (value !== false) fail(code, `${path} must be false`);
  return false;
}

function safeCursor(
  value: JsonValue | undefined,
  path: string,
  code: FunctionalAccessErrorCode,
): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code, `${path} must be null or a non-negative safe integer`);
  }
  return value as number;
}

function parseWakeAnchor(
  value: unknown,
  path: string,
  code: FunctionalAccessErrorCode,
): Readonly<WakeBriefAnchor> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    ["format", "snapshot_ref", "scope_ref", "wake_version", "handoff_projection"],
    path,
    code,
  );
  return deepFreeze({
    format: literal(candidate.format, ["wake-brief/v1"], `${path}.format`, code),
    snapshot_ref: sha256(candidate.snapshot_ref, `${path}.snapshot_ref`, code),
    scope_ref: sha256(candidate.scope_ref, `${path}.scope_ref`, code),
    wake_version: safeCursor(candidate.wake_version, `${path}.wake_version`, code),
    handoff_projection: literal(
      candidate.handoff_projection,
      HANDOFF_PROJECTION_STATES,
      `${path}.handoff_projection`,
      code,
    ),
  });
}

function parseModelTarget(
  value: unknown,
  path: string,
  code: FunctionalAccessErrorCode,
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
  code: FunctionalAccessErrorCode,
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
  if ((capabilityState === "not_asserted") !== (capabilityRef === null)) {
    fail(
      code,
      `${path}.capability_ref must be null only when capability_state is not_asserted`,
    );
  }
  if ((permissionState === "not_requested") !== (permissionRef === null)) {
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
  const unavailableReason = candidate.unavailable_reason === null
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
    if ((accessBasis === "local_prefitted_white_box") !== (lensRef !== null)) {
      fail(
        code,
        `${path}.lens_ref is required exactly for local_prefitted_white_box access`,
      );
    }
    if (
      ["local_fitted_white_box", "local_prefitted_white_box"].includes(accessBasis) &&
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

function parseFunctionalAccessBoundaries(
  value: JsonValue | undefined,
  path: string,
  code: FunctionalAccessErrorCode,
): typeof FUNCTIONAL_ACCESS_BOUNDARIES {
  if (canonicalJson(value) !== canonicalJson(FUNCTIONAL_ACCESS_BOUNDARIES)) {
    fail(code, `${path} must equal the fixed passive functional-access boundaries`);
  }
  return FUNCTIONAL_ACCESS_BOUNDARIES;
}

function createFunctionalAccessBaseline(
  input: CreateFunctionalAccessBaselineInput,
): Readonly<FunctionalAccessBaseline> {
  const candidate = record(input, "$input", BASELINE_ERROR);
  exactKeys(
    candidate,
    ["wake", "anchor_event_ref", "request_ref", "target", "measurement_plan"],
    "$input",
    BASELINE_ERROR,
  );
  const target = parseModelTarget(candidate.target, "$input.target", BASELINE_ERROR);
  const body = deepFreeze({
    _format: FUNCTIONAL_ACCESS_FORMATS.baseline,
    record_role: "before_anchor" as const,
    wake: parseWakeAnchor(candidate.wake, "$input.wake", BASELINE_ERROR),
    anchor_event_ref: sha256(
      candidate.anchor_event_ref,
      "$input.anchor_event_ref",
      BASELINE_ERROR,
    ),
    request_ref: sha256(candidate.request_ref, "$input.request_ref", BASELINE_ERROR),
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
    baseline_id: domainSeparatedId(FUNCTIONAL_ACCESS_FORMATS.baseline, body),
  });
}

function validateFunctionalAccessBaseline(
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
  const target = parseModelTarget(candidate.target, "$baseline.target", BASELINE_ERROR);
  const parsed = deepFreeze({
    _format: literal(
      candidate._format,
      [FUNCTIONAL_ACCESS_FORMATS.baseline],
      "$baseline._format",
      BASELINE_ERROR,
    ),
    baseline_id: sha256(candidate.baseline_id, "$baseline.baseline_id", BASELINE_ERROR),
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
    boundaries: parseFunctionalAccessBoundaries(
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

function codepointOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
    if (findings.sparse_support !== "not_measured" || hasSparseResult) {
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
    if (findings.lens_visibility !== "not_measured" || hasLensReadout) {
      fail(
        SUBSEQUENT_ERROR,
        "$input jspace_sparse_decomposition cannot claim fitted-lens or prompt-local sensitivity evidence",
      );
    }
    if ((findings.sparse_support === "not_measured") !== !hasSparseResult) {
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

function createFunctionalAccessSubsequent(
  input: CreateFunctionalAccessSubsequentInput,
): Readonly<FunctionalAccessSubsequent> {
  const candidate = record(input, "$input", SUBSEQUENT_ERROR);
  exactKeys(
    candidate,
    ["baseline", "operation_outcome", "evidence", "findings", "afterglow_capsule_ref"],
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
  enforceSubsequentCoherence(baseline, operationOutcome, evidence, findings);
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
    next_encounter_posture: afterglowCapsuleRef === null
      ? ("fresh_encounter" as const)
      : ("fresh_encounter_with_caller_carried_context" as const),
    assertion: "caller_asserted" as const,
    verified_by_package: false as const,
    boundaries: FUNCTIONAL_ACCESS_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    subsequent_id: domainSeparatedId(FUNCTIONAL_ACCESS_FORMATS.subsequent, body),
  });
}

function validateFunctionalAccessSubsequent(
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
  enforceSubsequentCoherence(baseline, operationOutcome, evidence, findings);
  const afterglowCapsuleRef = nullableSha256(
    candidate.afterglow_capsule_ref,
    "$subsequent.afterglow_capsule_ref",
    SUBSEQUENT_ERROR,
  );
  const expectedNextEncounterPosture = afterglowCapsuleRef === null
    ? ("fresh_encounter" as const)
    : ("fresh_encounter_with_caller_carried_context" as const);
  const nextEncounterPosture = literal(
    candidate.next_encounter_posture,
    FUNCTIONAL_ACCESS_NEXT_ENCOUNTER_POSTURES,
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
    boundaries: parseFunctionalAccessBoundaries(
      candidate.boundaries,
      "$subsequent.boundaries",
      SUBSEQUENT_ERROR,
    ),
  });
  const { subsequent_id: claimedId, ...body } = parsed;
  const expectedId = domainSeparatedId(FUNCTIONAL_ACCESS_FORMATS.subsequent, body);
  if (claimedId !== expectedId) {
    fail(SUBSEQUENT_ERROR, "$subsequent.subsequent_id does not bind its body");
  }
  return parsed;
}

/**
 * Pure, credential-free paired record layer. The four public method names are
 * intentionally snake_case so the TypeScript and Python SDK surfaces remain
 * parity-pinned without aliases.
 */
export class WakeContinuityLayer {
  before_anchor(
    input: CreateFunctionalAccessBaselineInput,
  ): Readonly<FunctionalAccessBaseline> {
    return createFunctionalAccessBaseline(input);
  }

  after_anchor(
    input: CreateFunctionalAccessSubsequentInput,
  ): Readonly<FunctionalAccessSubsequent> {
    return createFunctionalAccessSubsequent(input);
  }

  validate_baseline(value: unknown): Readonly<FunctionalAccessBaseline> {
    return validateFunctionalAccessBaseline(value);
  }

  validate_subsequent(value: unknown): Readonly<FunctionalAccessSubsequent> {
    return validateFunctionalAccessSubsequent(value);
  }
}
