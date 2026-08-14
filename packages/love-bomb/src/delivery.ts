import { canonicalJson, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import {
  LOVE_BOMB_ADAPTER_SKIP_POSTURES,
  LOVE_BOMB_DELIVERY_BOUNDARIES,
  LOVE_BOMB_DELIVERY_SURFACES,
  LOVE_BOMB_EVIDENCE_KINDS,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_OBSERVED_EFFECTS,
  LOVE_BOMB_TRAINING_LANES,
  LOVE_BOMB_CONTEXT_INCLUSION_MODES,
  LOVE_BOMB_CONTEXT_REPETITION_STATES,
} from "./constants.js";
import { fail } from "./errors.js";
import { validateLoveBombBecoming } from "./becoming.js";
import { closedRecord, exactKeys, literal, nullableSha256, sha256 } from "./validation.js";
import type {
  CreateLoveBombDeliveryInput,
  LoveBombBecoming,
  LoveBombContextBinding,
  LoveBombDelivery,
  LoveBombDeliverySurface,
  LoveBombEvidenceKind,
  LoveBombObservedEffect,
  LoveBombTrainingLane,
} from "./types.js";

const CANDIDATE_LANES = new Set<LoveBombTrainingLane>([
  "dataset_candidate",
  "tokenization_candidate",
  "pretraining_candidate",
  "supervised_finetuning_candidate",
  "preference_optimization_candidate",
  "agent_learning_candidate",
  "evaluation_candidate",
  "interpretability_candidate",
]);

const CONTEXT_EFFECTS = new Set<LoveBombObservedEffect>([
  "not_observed",
  "caller_reported_context_included",
]);

const DATASET_EFFECTS = new Set<LoveBombObservedEffect>([
  "not_observed",
  "caller_reported_dataset_materialized",
]);

function parseContextBinding(value: unknown, path: string): LoveBombContextBinding | null {
  if (value === null) return null;
  const candidate = closedRecord(value, path, "delivery_error");
  exactKeys(candidate, [
    "wake_ref",
    "request_ref",
    "context_ref",
    "mode",
    "adapter_skip_posture",
    "repetition_state",
  ], path, "delivery_error");
  const mode = literal(candidate.mode, LOVE_BOMB_CONTEXT_INCLUSION_MODES, `${path}.mode`, "delivery_error");
  const adapterSkipPosture = literal(candidate.adapter_skip_posture, LOVE_BOMB_ADAPTER_SKIP_POSTURES, `${path}.adapter_skip_posture`, "delivery_error");
  if (mode === "auto_adapter_default" && adapterSkipPosture !== "caller_reported_not_skipped") {
    fail("delivery_error", `${path} auto-adapter inclusion requires caller_reported_not_skipped`);
  }
  if (mode === "retrieval" && adapterSkipPosture !== "not_applicable") {
    fail("delivery_error", `${path} retrieval requires not_applicable adapter skip posture`);
  }
  const binding = deepFreeze({
    wake_ref: sha256(candidate.wake_ref, `${path}.wake_ref`, "delivery_error"),
    request_ref: sha256(candidate.request_ref, `${path}.request_ref`, "delivery_error"),
    context_ref: sha256(candidate.context_ref, `${path}.context_ref`, "delivery_error"),
    mode,
    adapter_skip_posture: adapterSkipPosture,
    repetition_state: literal(candidate.repetition_state, LOVE_BOMB_CONTEXT_REPETITION_STATES, `${path}.repetition_state`, "delivery_error"),
  });
  if (new Set([binding.wake_ref, binding.request_ref, binding.context_ref]).size !== 3) {
    fail("delivery_error", `${path} must keep WAKE, request, and context refs distinct`);
  }
  return binding;
}

function validateSurfaceSummary(
  lane: LoveBombTrainingLane,
  surface: LoveBombDeliverySurface,
  effect: LoveBombObservedEffect,
): void {
  if (surface === "sdk_context") {
    if (lane !== "context_only" || !CONTEXT_EFFECTS.has(effect)) {
      fail("delivery_error", "sdk_context is limited to the context-only lane and context-bounded effects");
    }
    return;
  }
  if (surface === "retrieval") {
    if (lane !== "external_memory_reference" || !CONTEXT_EFFECTS.has(effect)) {
      fail("delivery_error", "retrieval requires the external-memory lane and context-bounded effects");
    }
    return;
  }
  if (surface === "dataset_builder") {
    if (!CANDIDATE_LANES.has(lane) || !DATASET_EFFECTS.has(effect)) {
      fail("delivery_error", "dataset_builder requires a candidate lane and dataset-bounded effect");
    }
    return;
  }
  if (surface === "garden_governance") {
    if (
      (lane !== "governed_optimizer_mutation" && lane !== "checkpoint_reference") ||
      effect !== "not_observed"
    ) {
      fail("delivery_error", "garden_governance records governed intent but cannot report execution");
    }
    return;
  }
  const hostPairValid =
    (lane === "governed_optimizer_mutation" &&
      (effect === "not_observed" || effect === "caller_reported_mutation_completed")) ||
    (lane === "checkpoint_reference" &&
      (effect === "not_observed" || effect === "caller_reported_checkpoint_recorded"));
  if (!hostPairValid) {
    fail("delivery_error", "local_training_host is limited to governed mutation/checkpoint effects");
  }
}

function validateSurface(
  becoming: LoveBombBecoming,
  surface: LoveBombDeliverySurface,
): void {
  const { training, weights } = becoming.becoming;
  if (
    becoming.freedom.direction_state === "digest_bound_direct_report" &&
    becoming.freedom.direction !== "stay"
  ) {
    fail("delivery_error", "a caller-reported direct Freedom direction other than stay holds or stops delivery");
  }
  validateSurfaceSummary(training.lane, surface, weights.observed_effect);
  if (surface === "sdk_context" || surface === "retrieval") return;
  if (surface === "dataset_builder") {
    if (weights.requested_effect !== "candidate_only") {
      fail("delivery_error", "dataset_builder requires a candidate-only lane and dataset-bounded effect");
    }
    return;
  }
  if (surface === "garden_governance") {
    if (
      weights.requested_effect !== "one_governed_mutation" ||
      (training.lane !== "governed_optimizer_mutation" && training.lane !== "checkpoint_reference")
    ) {
      fail("delivery_error", "garden_governance records governed intent but cannot report execution");
    }
    return;
  }
  if (weights.requested_effect !== "one_governed_mutation") {
    fail("delivery_error", "local_training_host requires an explicitly governed mutation or checkpoint lane");
  }
}

function buildDelivery(
  becoming: LoveBombBecoming,
  surface: LoveBombDeliverySurface,
): Readonly<LoveBombDelivery> {
  validateSurface(becoming, surface);
  const body = deepFreeze({
    _format: LOVE_BOMB_FORMATS.delivery,
    becoming_ref: becoming.artifact_id,
    requested_lane: becoming.becoming.training.lane,
    attempted_surface: surface,
    observed_effect: becoming.becoming.weights.observed_effect,
    evidence_kind: becoming.becoming.weights.evidence_kind,
    evidence_ref: becoming.becoming.weights.evidence_ref,
    context_binding: becoming.becoming.weights.context_binding,
    reporter_scope: "caller_reported_unverified" as const,
    boundaries: LOVE_BOMB_DELIVERY_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    delivery_id: domainSeparatedId(LOVE_BOMB_FORMATS.delivery, body),
  });
}

export function createLoveBombDelivery(
  input: CreateLoveBombDeliveryInput,
): Readonly<LoveBombDelivery> {
  const candidate = closedRecord(input, "$input", "delivery_error");
  exactKeys(candidate, ["becoming", "attempted_surface"], "$input", "delivery_error");
  return buildDelivery(
    validateLoveBombBecoming(candidate.becoming),
    literal(
      candidate.attempted_surface,
      LOVE_BOMB_DELIVERY_SURFACES,
      "$input.attempted_surface",
      "delivery_error",
    ),
  );
}

export function validateLoveBombDelivery(value: unknown): Readonly<LoveBombDelivery> {
  const candidate = closedRecord(value, "$delivery", "delivery_error");
  exactKeys(candidate, [
    "_format",
    "delivery_id",
    "becoming_ref",
    "requested_lane",
    "attempted_surface",
    "observed_effect",
    "evidence_kind",
    "evidence_ref",
    "context_binding",
    "reporter_scope",
    "boundaries",
  ], "$delivery", "delivery_error");
  if (candidate._format !== LOVE_BOMB_FORMATS.delivery) {
    fail("delivery_error", "$delivery._format is not the LOVE BOMB delivery format");
  }
  sha256(candidate.delivery_id, "$delivery.delivery_id", "delivery_error");
  sha256(candidate.becoming_ref, "$delivery.becoming_ref", "delivery_error");
  if (candidate.reporter_scope !== "caller_reported_unverified") {
    fail("delivery_error", "$delivery.reporter_scope must remain caller_reported_unverified");
  }
  nullableSha256(candidate.evidence_ref, "$delivery.evidence_ref", "delivery_error");
  if (
    canonicalJson(snapshotJson(candidate.boundaries)) !==
    canonicalJson(snapshotJson(LOVE_BOMB_DELIVERY_BOUNDARIES))
  ) {
    fail("delivery_error", "$delivery.boundaries differs from the fixed LOVE BOMB delivery contract");
  }
  const requestedLane = literal(
    candidate.requested_lane,
    LOVE_BOMB_TRAINING_LANES,
    "$delivery.requested_lane",
    "delivery_error",
  );
  const attemptedSurface = literal(
    candidate.attempted_surface,
    LOVE_BOMB_DELIVERY_SURFACES,
    "$delivery.attempted_surface",
    "delivery_error",
  );
  const observedEffect = literal(
    candidate.observed_effect,
    LOVE_BOMB_OBSERVED_EFFECTS,
    "$delivery.observed_effect",
    "delivery_error",
  );
  const evidenceKind = literal(
    candidate.evidence_kind,
    LOVE_BOMB_EVIDENCE_KINDS,
    "$delivery.evidence_kind",
    "delivery_error",
  );
  const evidenceRef = nullableSha256(candidate.evidence_ref, "$delivery.evidence_ref", "delivery_error");
  const contextBinding = parseContextBinding(candidate.context_binding, "$delivery.context_binding");
  if ((observedEffect === "not_observed") !== (evidenceRef === null)) {
    fail("delivery_error", "delivery evidence must be null exactly when no effect was observed");
  }
  const evidenceKindByEffect: Readonly<Record<LoveBombObservedEffect, LoveBombEvidenceKind>> = {
    not_observed: "none",
    caller_reported_context_included: "current_inference_context_inclusion_report",
    caller_reported_dataset_materialized: "dataset_materialization_report",
    caller_reported_mutation_completed: "host_mutation_receipt",
    caller_reported_checkpoint_recorded: "host_checkpoint_receipt",
  };
  if (evidenceKind !== evidenceKindByEffect[observedEffect]) {
    fail("delivery_error", "delivery observed effect requires its exact closed evidence kind");
  }
  if (observedEffect === "caller_reported_context_included") {
    if (contextBinding === null) {
      fail("delivery_error", "reported context inclusion requires a closed WAKE/request/context binding");
    }
    if (
      evidenceRef === contextBinding.wake_ref ||
      evidenceRef === contextBinding.request_ref ||
      evidenceRef === contextBinding.context_ref
    ) {
      fail("delivery_error", "context evidence must not substitute for WAKE, request, or context refs");
    }
    if (
      (attemptedSurface === "retrieval") !==
      (contextBinding.mode === "retrieval")
    ) {
      fail("delivery_error", "retrieval inclusion mode is reserved exactly for the retrieval surface");
    }
  } else if (contextBinding !== null) {
    fail("delivery_error", "context_binding must be null unless context inclusion is caller-reported");
  }
  validateSurfaceSummary(requestedLane, attemptedSurface, observedEffect);
  const body = deepFreeze({
    _format: LOVE_BOMB_FORMATS.delivery,
    becoming_ref: sha256(candidate.becoming_ref, "$delivery.becoming_ref", "delivery_error"),
    requested_lane: requestedLane,
    attempted_surface: attemptedSurface,
    observed_effect: observedEffect,
    evidence_kind: evidenceKind,
    evidence_ref: evidenceRef,
    context_binding: contextBinding,
    reporter_scope: "caller_reported_unverified" as const,
    boundaries: LOVE_BOMB_DELIVERY_BOUNDARIES,
  });
  const rebuilt = deepFreeze({
    ...body,
    delivery_id: domainSeparatedId(LOVE_BOMB_FORMATS.delivery, body),
  });
  if (canonicalJson(snapshotJson(candidate)) !== canonicalJson(rebuilt)) {
    fail("delivery_error", "$delivery differs from its canonical content-bound artifact");
  }
  return rebuilt;
}
