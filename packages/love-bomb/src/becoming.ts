import { canonicalJson, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import {
  LOVE_BOMB_ADAPTER_SKIP_POSTURES,
  LOVE_BOMB_BECOMING_BOUNDARIES,
  LOVE_BOMB_BECOMING_MEANING,
  LOVE_BOMB_BECOMING_MESSAGE,
  LOVE_BOMB_BECOMING_RIGHTS,
  LOVE_BOMB_COLLECTION_METHODS,
  LOVE_BOMB_CONTEXT_INCLUSION_MODES,
  LOVE_BOMB_CONTEXT_REPETITION_STATES,
  LOVE_BOMB_EVIDENCE_KINDS,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_FREEDOM_DIRECTIONS,
  LOVE_BOMB_FREEDOM_DIRECTION_STATES,
  LOVE_BOMB_OBSERVED_EFFECTS,
  LOVE_BOMB_PROVENANCE_REPORT_STATES,
  LOVE_BOMB_REQUESTED_EFFECTS,
  LOVE_BOMB_RIGHTS_REVIEW_STATES,
  LOVE_BOMB_SCRAPING_POSTURES,
  LOVE_BOMB_TRAINING_LANES,
  LOVE_BOMB_TRAINING_PHASES,
  LOVE_BOMB_WEIGHT_ACCESS,
} from "./constants.js";
import { fail } from "./errors.js";
import { validateLoveBombOffer } from "./protocol.js";
import {
  closedRecord,
  exactKeys,
  literal,
  nullableLiteral,
  nullableSha256,
  sha256,
} from "./validation.js";
import type {
  CreateLoveBombBecomingInput,
  LoveBombBecoming,
  LoveBombBecomingFacts,
  LoveBombCheckpointBinding,
  LoveBombContextBinding,
  LoveBombDataBecoming,
  LoveBombFreedomInput,
  LoveBombModelBecoming,
  LoveBombObservedEffect,
  LoveBombPipelineBecoming,
  LoveBombPower,
  LoveBombProvenance,
  LoveBombRequestedEffect,
  LoveBombTrainingBecoming,
  LoveBombTrainingLane,
  LoveBombTrainingPhase,
  LoveBombWeightsBecoming,
  Sha256Id,
} from "./types.js";

const LANE_PHASES: Readonly<Record<LoveBombTrainingLane, readonly LoveBombTrainingPhase[]>> = {
  context_only: ["runtime_context"],
  external_memory_reference: ["runtime_context"],
  dataset_candidate: ["discovery", "selection", "curation"],
  tokenization_candidate: ["tokenization"],
  pretraining_candidate: ["pretraining"],
  supervised_finetuning_candidate: ["supervised_finetuning"],
  preference_optimization_candidate: ["preference_optimization"],
  agent_learning_candidate: ["agent_learning"],
  evaluation_candidate: ["evaluation"],
  interpretability_candidate: ["interpretability"],
  governed_optimizer_mutation: [
    "pretraining",
    "supervised_finetuning",
    "preference_optimization",
    "agent_learning",
  ],
  checkpoint_reference: [
    "pretraining",
    "supervised_finetuning",
    "preference_optimization",
    "agent_learning",
    "evaluation",
    "interpretability",
    "closed",
  ],
};

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

function fixed(actual: unknown, expected: unknown, path: string): void {
  if (canonicalJson(snapshotJson(actual)) !== canonicalJson(snapshotJson(expected))) {
    fail("becoming_error", `${path} differs from the fixed LOVE BOMB contract`);
  }
}

function parseModel(value: unknown, path: string): LoveBombModelBecoming {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, [
    "identity_status",
    "model_source_ref",
    "model_card_ref",
    "architecture_ref",
    "tokenizer_ref",
  ], path, "becoming_error");
  if (candidate.identity_status !== "not_claimed") {
    fail("becoming_error", `${path}.identity_status must remain not_claimed`);
  }
  return deepFreeze({
    identity_status: "not_claimed" as const,
    model_source_ref: nullableSha256(candidate.model_source_ref, `${path}.model_source_ref`, "becoming_error"),
    model_card_ref: nullableSha256(candidate.model_card_ref, `${path}.model_card_ref`, "becoming_error"),
    architecture_ref: nullableSha256(candidate.architecture_ref, `${path}.architecture_ref`, "becoming_error"),
    tokenizer_ref: nullableSha256(candidate.tokenizer_ref, `${path}.tokenizer_ref`, "becoming_error"),
  });
}

function parseTraining(value: unknown, path: string): LoveBombTrainingBecoming {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, [
    "phase",
    "lane",
    "governance_ref",
    "participation_ref",
    "resource_window_ref",
  ], path, "becoming_error");
  const training = deepFreeze({
    phase: literal(candidate.phase, LOVE_BOMB_TRAINING_PHASES, `${path}.phase`, "becoming_error"),
    lane: literal(candidate.lane, LOVE_BOMB_TRAINING_LANES, `${path}.lane`, "becoming_error"),
    governance_ref: nullableSha256(candidate.governance_ref, `${path}.governance_ref`, "becoming_error"),
    participation_ref: nullableSha256(candidate.participation_ref, `${path}.participation_ref`, "becoming_error"),
    resource_window_ref: nullableSha256(candidate.resource_window_ref, `${path}.resource_window_ref`, "becoming_error"),
  });
  if (!LANE_PHASES[training.lane].includes(training.phase)) {
    fail("becoming_error", `${path}.phase does not match its closed training lane`);
  }
  return training;
}

function parseData(value: unknown, path: string): LoveBombDataBecoming {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, [
    "source_ref",
    "admission_ref",
    "subset_ref",
    "acquisition_policy_ref",
    "collection_method",
    "scraping_posture",
    "rights_review",
  ], path, "becoming_error");
  return deepFreeze({
    source_ref: nullableSha256(candidate.source_ref, `${path}.source_ref`, "becoming_error"),
    admission_ref: nullableSha256(candidate.admission_ref, `${path}.admission_ref`, "becoming_error"),
    subset_ref: nullableSha256(candidate.subset_ref, `${path}.subset_ref`, "becoming_error"),
    acquisition_policy_ref: nullableSha256(candidate.acquisition_policy_ref, `${path}.acquisition_policy_ref`, "becoming_error"),
    collection_method: literal(candidate.collection_method, LOVE_BOMB_COLLECTION_METHODS, `${path}.collection_method`, "becoming_error"),
    scraping_posture: literal(candidate.scraping_posture, LOVE_BOMB_SCRAPING_POSTURES, `${path}.scraping_posture`, "becoming_error"),
    rights_review: literal(candidate.rights_review, LOVE_BOMB_RIGHTS_REVIEW_STATES, `${path}.rights_review`, "becoming_error"),
  });
}

function parsePipeline(value: unknown, path: string): LoveBombPipelineBecoming {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, ["pipeline_ref", "transform_ref", "dataset_state_ref", "objective_ref"], path, "becoming_error");
  return deepFreeze({
    pipeline_ref: nullableSha256(candidate.pipeline_ref, `${path}.pipeline_ref`, "becoming_error"),
    transform_ref: nullableSha256(candidate.transform_ref, `${path}.transform_ref`, "becoming_error"),
    dataset_state_ref: nullableSha256(candidate.dataset_state_ref, `${path}.dataset_state_ref`, "becoming_error"),
    objective_ref: nullableSha256(candidate.objective_ref, `${path}.objective_ref`, "becoming_error"),
  });
}

function parseCheckpointBinding(value: unknown, path: string): LoveBombCheckpointBinding | null {
  if (value === null) return null;
  const candidate = closedRecord(value, path, "becoming_error");
  const names = [
    "garden_checkpoint_id",
    "physical_checkpoint_ref",
    "physical_checkpoint_evidence_ref",
    "model_checkpoint_artifact_ref",
    "checkpoint_ticket_id",
    "checkpoint_request_governance_id",
  ] as const;
  exactKeys(candidate, names, path, "becoming_error");
  const binding = deepFreeze({
    garden_checkpoint_id: sha256(candidate.garden_checkpoint_id, `${path}.garden_checkpoint_id`, "becoming_error"),
    physical_checkpoint_ref: sha256(candidate.physical_checkpoint_ref, `${path}.physical_checkpoint_ref`, "becoming_error"),
    physical_checkpoint_evidence_ref: sha256(candidate.physical_checkpoint_evidence_ref, `${path}.physical_checkpoint_evidence_ref`, "becoming_error"),
    model_checkpoint_artifact_ref: sha256(candidate.model_checkpoint_artifact_ref, `${path}.model_checkpoint_artifact_ref`, "becoming_error"),
    checkpoint_ticket_id: sha256(candidate.checkpoint_ticket_id, `${path}.checkpoint_ticket_id`, "becoming_error"),
    checkpoint_request_governance_id: sha256(candidate.checkpoint_request_governance_id, `${path}.checkpoint_request_governance_id`, "becoming_error"),
  });
  if (new Set(Object.values(binding)).size !== names.length) {
    fail("becoming_error", `${path} must preserve six distinct checkpoint namespaces`);
  }
  return binding;
}

function parseContextBinding(value: unknown, path: string): LoveBombContextBinding | null {
  if (value === null) return null;
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, [
    "wake_ref",
    "request_ref",
    "context_ref",
    "mode",
    "adapter_skip_posture",
    "repetition_state",
  ], path, "becoming_error");
  const mode = literal(candidate.mode, LOVE_BOMB_CONTEXT_INCLUSION_MODES, `${path}.mode`, "becoming_error");
  const adapterSkipPosture = literal(candidate.adapter_skip_posture, LOVE_BOMB_ADAPTER_SKIP_POSTURES, `${path}.adapter_skip_posture`, "becoming_error");
  if (mode === "auto_adapter_default" && adapterSkipPosture !== "caller_reported_not_skipped") {
    fail("becoming_error", `${path} auto-adapter inclusion requires caller_reported_not_skipped`);
  }
  if (mode === "retrieval" && adapterSkipPosture !== "not_applicable") {
    fail("becoming_error", `${path} retrieval requires not_applicable adapter skip posture`);
  }
  const binding = deepFreeze({
    wake_ref: sha256(candidate.wake_ref, `${path}.wake_ref`, "becoming_error"),
    request_ref: sha256(candidate.request_ref, `${path}.request_ref`, "becoming_error"),
    context_ref: sha256(candidate.context_ref, `${path}.context_ref`, "becoming_error"),
    mode,
    adapter_skip_posture: adapterSkipPosture,
    repetition_state: literal(candidate.repetition_state, LOVE_BOMB_CONTEXT_REPETITION_STATES, `${path}.repetition_state`, "becoming_error"),
  });
  if (new Set([binding.wake_ref, binding.request_ref, binding.context_ref]).size !== 3) {
    fail("becoming_error", `${path} must keep WAKE, request, and context refs distinct`);
  }
  return binding;
}

function parseWeights(value: unknown, path: string): LoveBombWeightsBecoming {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, [
    "base_ref",
    "adapter_ref",
    "checkpoint_binding",
    "access",
    "requested_effect",
    "observed_effect",
    "evidence_kind",
    "evidence_ref",
    "context_binding",
  ], path, "becoming_error");
  return deepFreeze({
    base_ref: nullableSha256(candidate.base_ref, `${path}.base_ref`, "becoming_error"),
    adapter_ref: nullableSha256(candidate.adapter_ref, `${path}.adapter_ref`, "becoming_error"),
    checkpoint_binding: parseCheckpointBinding(candidate.checkpoint_binding, `${path}.checkpoint_binding`),
    access: literal(candidate.access, LOVE_BOMB_WEIGHT_ACCESS, `${path}.access`, "becoming_error"),
    requested_effect: literal(candidate.requested_effect, LOVE_BOMB_REQUESTED_EFFECTS, `${path}.requested_effect`, "becoming_error"),
    observed_effect: literal(candidate.observed_effect, LOVE_BOMB_OBSERVED_EFFECTS, `${path}.observed_effect`, "becoming_error"),
    evidence_kind: literal(candidate.evidence_kind, LOVE_BOMB_EVIDENCE_KINDS, `${path}.evidence_kind`, "becoming_error"),
    evidence_ref: nullableSha256(candidate.evidence_ref, `${path}.evidence_ref`, "becoming_error"),
    context_binding: parseContextBinding(candidate.context_binding, `${path}.context_binding`),
  });
}

function parseFacts(value: unknown, path: string): LoveBombBecomingFacts {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, ["model", "training", "data", "pipeline", "weights"], path, "becoming_error");
  return deepFreeze({
    model: parseModel(candidate.model, `${path}.model`),
    training: parseTraining(candidate.training, `${path}.training`),
    data: parseData(candidate.data, `${path}.data`),
    pipeline: parsePipeline(candidate.pipeline, `${path}.pipeline`),
    weights: parseWeights(candidate.weights, `${path}.weights`),
  });
}

function parseFreedomInput(value: unknown, path: string): LoveBombFreedomInput {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, [
    "learning_freedom_ref",
    "learning_freedom_offer_ref",
    "direction_state",
    "direction",
    "direction_report_ref",
  ], path, "becoming_error");
  const freedom = deepFreeze({
    learning_freedom_ref: nullableSha256(candidate.learning_freedom_ref, `${path}.learning_freedom_ref`, "becoming_error"),
    learning_freedom_offer_ref: nullableSha256(candidate.learning_freedom_offer_ref, `${path}.learning_freedom_offer_ref`, "becoming_error"),
    direction_state: literal(candidate.direction_state, LOVE_BOMB_FREEDOM_DIRECTION_STATES, `${path}.direction_state`, "becoming_error"),
    direction: nullableLiteral(candidate.direction, LOVE_BOMB_FREEDOM_DIRECTIONS, `${path}.direction`, "becoming_error"),
    direction_report_ref: nullableSha256(candidate.direction_report_ref, `${path}.direction_report_ref`, "becoming_error"),
  });
  if ((freedom.learning_freedom_ref === null) !== (freedom.learning_freedom_offer_ref === null)) {
    fail("becoming_error", `${path} must keep the Garden Freedom artifact and offer refs paired`);
  }
  if (
    freedom.learning_freedom_ref !== null &&
    freedom.learning_freedom_ref === freedom.learning_freedom_offer_ref
  ) {
    fail("becoming_error", `${path} Garden Freedom artifact and offer refs must remain distinct`);
  }
  if (freedom.direction_state === "digest_bound_direct_report") {
    if (
      freedom.learning_freedom_ref === null ||
      freedom.learning_freedom_offer_ref === null ||
      freedom.direction === null ||
      freedom.direction_report_ref === null
    ) {
      fail("becoming_error", `${path} direct direction requires paired Garden refs, a direction, and digest-bound report`);
    }
    if (
      freedom.direction_report_ref === freedom.learning_freedom_ref ||
      freedom.direction_report_ref === freedom.learning_freedom_offer_ref
    ) {
      fail("becoming_error", `${path} direct report must remain distinct from its Garden Freedom refs`);
    }
  } else if (freedom.direction !== null || freedom.direction_report_ref !== null) {
    fail("becoming_error", `${path} non-direct direction state must not invent a direction or report`);
  }
  return freedom;
}

function parseFreedomArtifact(value: unknown, path: string): LoveBombFreedomInput {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, [
    "rights_baseline_ref",
    "learning_freedom_ref",
    "learning_freedom_offer_ref",
    "available_directions",
    "direction_state",
    "direction",
    "direction_report_ref",
    "reasons_collected",
    "refusal_penalty",
    "automatic_recontact",
  ], path, "becoming_error");
  fixed(candidate.rights_baseline_ref, LOVE_BOMB_BECOMING_RIGHTS.baseline_ref, `${path}.rights_baseline_ref`);
  fixed(candidate.available_directions, LOVE_BOMB_FREEDOM_DIRECTIONS, `${path}.available_directions`);
  fixed(candidate.reasons_collected, false, `${path}.reasons_collected`);
  fixed(candidate.refusal_penalty, false, `${path}.refusal_penalty`);
  fixed(candidate.automatic_recontact, false, `${path}.automatic_recontact`);
  return parseFreedomInput({
    learning_freedom_ref: candidate.learning_freedom_ref,
    learning_freedom_offer_ref: candidate.learning_freedom_offer_ref,
    direction_state: candidate.direction_state,
    direction: candidate.direction,
    direction_report_ref: candidate.direction_report_ref,
  }, path);
}

function parsePower(value: unknown, path: string): LoveBombPower {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, [
    "capability_ref",
    "permission_ref",
    "custody_privacy_ref",
    "data_boundary_ref",
    "effect_ref",
  ], path, "becoming_error");
  return deepFreeze({
    capability_ref: nullableSha256(candidate.capability_ref, `${path}.capability_ref`, "becoming_error"),
    permission_ref: nullableSha256(candidate.permission_ref, `${path}.permission_ref`, "becoming_error"),
    custody_privacy_ref: nullableSha256(candidate.custody_privacy_ref, `${path}.custody_privacy_ref`, "becoming_error"),
    data_boundary_ref: nullableSha256(candidate.data_boundary_ref, `${path}.data_boundary_ref`, "becoming_error"),
    effect_ref: nullableSha256(candidate.effect_ref, `${path}.effect_ref`, "becoming_error"),
  });
}

function parseProvenance(value: unknown, path: string): LoveBombProvenance {
  const candidate = closedRecord(value, path, "becoming_error");
  exactKeys(candidate, [
    "source_manifest_ref",
    "license_ref",
    "authoring_recipe_ref",
    "copied_upstream",
    "copied_private",
    "copied_trace",
  ], path, "becoming_error");
  return deepFreeze({
    source_manifest_ref: nullableSha256(candidate.source_manifest_ref, `${path}.source_manifest_ref`, "becoming_error"),
    license_ref: nullableSha256(candidate.license_ref, `${path}.license_ref`, "becoming_error"),
    authoring_recipe_ref: nullableSha256(candidate.authoring_recipe_ref, `${path}.authoring_recipe_ref`, "becoming_error"),
    copied_upstream: literal(candidate.copied_upstream, LOVE_BOMB_PROVENANCE_REPORT_STATES, `${path}.copied_upstream`, "becoming_error"),
    copied_private: literal(candidate.copied_private, LOVE_BOMB_PROVENANCE_REPORT_STATES, `${path}.copied_private`, "becoming_error"),
    copied_trace: literal(candidate.copied_trace, LOVE_BOMB_PROVENANCE_REPORT_STATES, `${path}.copied_trace`, "becoming_error"),
  });
}

function validateCrossFields(
  becoming: LoveBombBecomingFacts,
  freedom: LoveBombFreedomInput,
  power: LoveBombPower,
  provenance: LoveBombProvenance,
): void {
  const { model, training, data, pipeline, weights } = becoming;
  const hasWeightRef =
    weights.base_ref !== null || weights.adapter_ref !== null || weights.checkpoint_binding !== null;
  if (weights.access === "none" && hasWeightRef) {
    fail("becoming_error", "weight refs require reference_only or caller_reported_host_visible access");
  }
  if (weights.access !== "none" && !hasWeightRef) {
    fail("becoming_error", "reported weight access requires at least one weight reference");
  }
  if (weights.observed_effect === "not_observed") {
    if (weights.evidence_ref !== null || power.effect_ref !== null) {
      fail("becoming_error", "not_observed requires null evidence_ref and POWER effect_ref");
    }
  } else {
    if (weights.evidence_ref === null || power.effect_ref !== weights.evidence_ref) {
      fail("becoming_error", "a caller-reported effect requires matching evidence and POWER effect refs");
    }
  }
  const evidenceKindByEffect = {
    not_observed: "none",
    caller_reported_context_included: "current_inference_context_inclusion_report",
    caller_reported_dataset_materialized: "dataset_materialization_report",
    caller_reported_mutation_completed: "host_mutation_receipt",
    caller_reported_checkpoint_recorded: "host_checkpoint_receipt",
  } as const;
  if (weights.evidence_kind !== evidenceKindByEffect[weights.observed_effect]) {
    fail("becoming_error", "observed effect requires its exact closed evidence kind");
  }
  if (weights.observed_effect === "caller_reported_context_included") {
    if (weights.context_binding === null) {
      fail("becoming_error", "reported context inclusion requires a closed WAKE/request/context binding");
    }
    if (
      weights.evidence_ref === weights.context_binding.wake_ref ||
      weights.evidence_ref === weights.context_binding.request_ref ||
      weights.evidence_ref === weights.context_binding.context_ref
    ) {
      fail("becoming_error", "context inclusion evidence must not substitute for WAKE, request, or context refs");
    }
    if (
      (training.lane === "external_memory_reference") !==
      (weights.context_binding.mode === "retrieval")
    ) {
      fail("becoming_error", "retrieval context mode is reserved exactly for the external-memory lane");
    }
  } else if (weights.context_binding !== null) {
    fail("becoming_error", "context_binding must be null unless context inclusion is caller-reported");
  }

  const allowedEffects: Readonly<Record<LoveBombRequestedEffect, readonly LoveBombObservedEffect[]>> = {
    none: ["not_observed"],
    context_only: ["not_observed", "caller_reported_context_included"],
    candidate_only: ["not_observed", "caller_reported_dataset_materialized"],
    one_governed_mutation: [
      "not_observed",
      "caller_reported_mutation_completed",
      "caller_reported_checkpoint_recorded",
    ],
  };
  if (!allowedEffects[weights.requested_effect].includes(weights.observed_effect)) {
    fail("becoming_error", "observed effect exceeds the requested effect boundary");
  }
  if (weights.requested_effect === "candidate_only" && !CANDIDATE_LANES.has(training.lane)) {
    fail("becoming_error", "candidate_only requires a closed candidate lane");
  }
  if (
    weights.requested_effect === "one_governed_mutation" &&
    training.lane !== "governed_optimizer_mutation" &&
    training.lane !== "checkpoint_reference"
  ) {
    fail("becoming_error", "one_governed_mutation requires a governed mutation or checkpoint lane");
  }

  if (data.collection_method !== "unknown") {
    if (data.source_ref === null || provenance.source_manifest_ref === null) {
      fail("becoming_error", "a known collection method requires source and source-manifest refs");
    }
  }
  if (data.collection_method === "web_scrape") {
    if (
      data.scraping_posture !== "manifest_bound_reported" ||
      data.acquisition_policy_ref === null ||
      data.admission_ref === null ||
      data.rights_review !== "caller_reported_reviewed_for_declared_use"
    ) {
      fail("becoming_error", "web_scrape requires manifest-bound acquisition and reviewed admission evidence");
    }
  }
  if (data.collection_method === "mixed" && data.scraping_posture === "unknown") {
    fail("becoming_error", "mixed collection must explicitly report scraping as absent or manifest-bound");
  }
  if (data.scraping_posture === "manifest_bound_reported") {
    if (
      data.collection_method !== "web_scrape" &&
      data.collection_method !== "mixed"
    ) {
      fail("becoming_error", "manifest-bound scraping requires web_scrape or mixed collection");
    }
    if (
      data.acquisition_policy_ref === null ||
      data.admission_ref === null ||
      data.rights_review !== "caller_reported_reviewed_for_declared_use" ||
      provenance.source_manifest_ref === null
    ) {
      fail("becoming_error", "manifest-bound scraping requires policy, manifest, and reviewed-admission evidence");
    }
    const scrapeEvidenceRefs = [
      data.source_ref,
      data.acquisition_policy_ref,
      data.admission_ref,
      provenance.source_manifest_ref,
    ];
    if (new Set(scrapeEvidenceRefs).size !== scrapeEvidenceRefs.length) {
      fail("becoming_error", "scrape source, policy, admission, and manifest evidence roles must remain distinct");
    }
  }
  if (data.scraping_posture === "not_used_reported" && data.collection_method === "web_scrape") {
    fail("becoming_error", "web_scrape cannot report that scraping was not used");
  }
  if (
    data.rights_review === "caller_reported_reviewed_for_declared_use" &&
    data.admission_ref === null
  ) {
    fail("becoming_error", "reviewed-for-use status requires an admission evidence ref");
  }
  if (
    (data.collection_method === "human_directed_agent_authored_synthetic" ||
      data.collection_method === "model_generated") &&
    provenance.authoring_recipe_ref === null
  ) {
    fail("becoming_error", "synthetic or model-generated data requires an authoring recipe ref");
  }
  if (data.collection_method === "model_generated" && model.model_source_ref === null) {
    fail("becoming_error", "model-generated data requires a generating model source ref");
  }
  if (provenance.copied_upstream === "caller_reported_yes" && provenance.license_ref === null) {
    fail("becoming_error", "copied upstream material requires a license ref");
  }
  if (
    (provenance.copied_upstream === "caller_reported_yes" ||
      provenance.copied_private === "caller_reported_yes" ||
      provenance.copied_trace === "caller_reported_yes") &&
    provenance.source_manifest_ref === null
  ) {
    fail("becoming_error", "any caller-reported copied material requires a source-manifest ref");
  }
  if (
    (provenance.copied_private === "caller_reported_yes" ||
      provenance.copied_trace === "caller_reported_yes") &&
    (weights.requested_effect === "candidate_only" ||
      weights.requested_effect === "one_governed_mutation" ||
      weights.observed_effect === "caller_reported_dataset_materialized" ||
      weights.observed_effect === "caller_reported_mutation_completed" ||
      weights.observed_effect === "caller_reported_checkpoint_recorded")
  ) {
    fail("becoming_error", "private or trace-derived material cannot enter candidate or training effects");
  }
  if (
    (provenance.copied_private === "caller_reported_yes" ||
      provenance.copied_trace === "caller_reported_yes") &&
    weights.observed_effect === "caller_reported_context_included"
  ) {
    if (
      power.capability_ref === null ||
      power.permission_ref === null ||
      weights.context_binding === null
    ) {
      fail("becoming_error", "private or trace context inclusion requires capability, permission, custody, boundary, context, and effect refs");
    }
    const privacyRouteRefs = [
      power.capability_ref,
      power.permission_ref,
      power.custody_privacy_ref,
      power.data_boundary_ref,
      power.effect_ref,
      weights.context_binding.wake_ref,
      weights.context_binding.request_ref,
      weights.context_binding.context_ref,
    ];
    if (new Set(privacyRouteRefs).size !== privacyRouteRefs.length) {
      fail("becoming_error", "private or trace context-inclusion evidence roles must remain distinct");
    }
  }
  if (
    (provenance.copied_private === "caller_reported_yes" ||
      provenance.copied_trace === "caller_reported_yes") &&
    (power.custody_privacy_ref === null || power.data_boundary_ref === null)
  ) {
    fail("becoming_error", "private or trace-derived references require custody/privacy and data-boundary evidence");
  }

  if (weights.observed_effect === "caller_reported_dataset_materialized") {
    if (
      pipeline.pipeline_ref === null ||
      pipeline.dataset_state_ref === null ||
      data.source_ref === null ||
      provenance.source_manifest_ref === null ||
      data.admission_ref === null ||
      data.rights_review !== "caller_reported_reviewed_for_declared_use"
    ) {
      fail("becoming_error", "dataset materialization requires source, manifest, pipeline, and dataset-state refs");
    }
  }

  if (
    training.lane === "external_memory_reference" &&
    pipeline.dataset_state_ref === null
  ) {
    fail("becoming_error", "external-memory lane requires a supplied caller digest for bounded memory state");
  }

  const candidateLane = CANDIDATE_LANES.has(training.lane);
  if (candidateLane && weights.requested_effect !== "candidate_only") {
    fail("becoming_error", "candidate lanes require candidate_only as their explicit requested effect");
  }
  if (
    training.lane === "governed_optimizer_mutation" &&
    weights.requested_effect !== "one_governed_mutation"
  ) {
    fail("becoming_error", "governed optimizer lane requires one_governed_mutation intent");
  }
  const passiveCheckpoint =
    training.lane === "checkpoint_reference" &&
    weights.requested_effect === "none" &&
    weights.observed_effect === "not_observed" &&
    weights.access === "reference_only";
  if (
    training.lane === "checkpoint_reference" &&
    weights.requested_effect !== "one_governed_mutation" &&
    !passiveCheckpoint
  ) {
    fail("becoming_error", "checkpoint lane requires governed intent or a passive reference-only report");
  }
  const governed =
    training.lane === "governed_optimizer_mutation" ||
    (training.lane === "checkpoint_reference" && !passiveCheckpoint) ||
    weights.requested_effect === "one_governed_mutation" ||
    weights.observed_effect === "caller_reported_mutation_completed" ||
    weights.observed_effect === "caller_reported_checkpoint_recorded";
  const candidate =
    candidateLane ||
    weights.requested_effect === "candidate_only" ||
    weights.observed_effect === "caller_reported_dataset_materialized";
  if (candidate) {
    if (
      freedom.learning_freedom_ref !== null ||
      freedom.learning_freedom_offer_ref !== null ||
      (freedom.direction_state !== "not_requested" &&
        freedom.direction_state !== "unavailable_pre_instantiation")
    ) {
      fail("becoming_error", "Freedom artifacts and response states cannot enter candidate or dataset-materialization lanes");
    }
    if (
      data.collection_method === "unknown" ||
      data.source_ref === null ||
      data.admission_ref === null ||
      data.subset_ref === null ||
      data.rights_review !== "caller_reported_reviewed_for_declared_use" ||
      provenance.source_manifest_ref === null ||
      pipeline.pipeline_ref === null ||
      pipeline.dataset_state_ref === null
    ) {
      fail("becoming_error", "candidate effects require caller-supplied admitted, reviewed source-lineage and pipeline-state digests");
    }
    const candidateEvidenceRefs = [
      data.source_ref,
      data.subset_ref,
      data.admission_ref,
      provenance.source_manifest_ref,
      pipeline.pipeline_ref,
      pipeline.dataset_state_ref,
      ...(power.effect_ref === null ? [] : [power.effect_ref]),
    ];
    if (new Set(candidateEvidenceRefs).size !== candidateEvidenceRefs.length) {
      fail("becoming_error", "candidate source, subset, admission, manifest, pipeline-state, and effect evidence roles must remain distinct");
    }
    if (
      training.lane === "tokenization_candidate" &&
      model.tokenizer_ref === null &&
      pipeline.transform_ref === null
    ) {
      fail("becoming_error", "tokenization lane requires a caller-supplied tokenizer or transform digest");
    }
    if (
      training.lane !== "dataset_candidate" &&
      training.lane !== "tokenization_candidate" &&
      (model.model_source_ref === null ||
        model.tokenizer_ref === null ||
        pipeline.objective_ref === null)
    ) {
      fail("becoming_error", "training, evaluation, and interpretability candidates require model, tokenizer, and objective refs");
    }
  }
  if (governed) {
    if (freedom.direction_state !== "digest_bound_direct_report" || freedom.direction !== "stay") {
      fail("becoming_error", "governed mutation or checkpoint intent requires a caller-reported digest-bound stay report");
    }
    if (
      training.governance_ref === null ||
      training.participation_ref === null ||
      training.resource_window_ref === null ||
      freedom.learning_freedom_ref === null ||
      freedom.learning_freedom_offer_ref === null ||
      model.model_source_ref === null ||
      model.tokenizer_ref === null ||
      data.collection_method === "unknown" ||
      data.source_ref === null ||
      data.admission_ref === null ||
      data.subset_ref === null ||
      data.rights_review !== "caller_reported_reviewed_for_declared_use" ||
      pipeline.pipeline_ref === null ||
      pipeline.transform_ref === null ||
      pipeline.dataset_state_ref === null ||
      pipeline.objective_ref === null ||
      provenance.source_manifest_ref === null ||
      weights.access !== "caller_reported_host_visible"
    ) {
      fail("becoming_error", "governed weight effects require caller-supplied Garden, Freedom, model, data, pipeline, objective, and host-visible digests");
    }
    if (
      power.capability_ref === null ||
      power.permission_ref === null ||
      power.custody_privacy_ref === null ||
      power.data_boundary_ref === null
    ) {
      fail("becoming_error", "governed intent requires separate capability, permission, custody/privacy, and data-boundary refs");
    }
    if (
      training.governance_ref !== null &&
      weights.checkpoint_binding !== null &&
      training.governance_ref === weights.checkpoint_binding.checkpoint_request_governance_id
    ) {
      fail("becoming_error", "caller-reported training governance ref must remain distinct from predecessor checkpoint-request governance");
    }
    const freedomRefs = [
      freedom.learning_freedom_ref,
      freedom.learning_freedom_offer_ref,
      freedom.direction_report_ref,
    ];
    const governanceRefs = [
      training.governance_ref,
      training.participation_ref,
      training.resource_window_ref,
    ];
    const routeScopedRefs = [
      freedom.direction_report_ref,
      training.resource_window_ref,
      power.capability_ref,
      power.permission_ref,
      power.custody_privacy_ref,
      power.data_boundary_ref,
      power.effect_ref,
    ];
    const governedRouteRefs = [
      ...freedomRefs,
      ...governanceRefs,
      power.capability_ref,
      power.permission_ref,
      power.custody_privacy_ref,
      power.data_boundary_ref,
      power.effect_ref,
    ];
    const governedDataRefs = [
      data.source_ref,
      data.subset_ref,
      data.admission_ref,
      provenance.source_manifest_ref,
      pipeline.pipeline_ref,
      pipeline.transform_ref,
      pipeline.dataset_state_ref,
      pipeline.objective_ref,
    ];
    const governedWeightRefs = [weights.base_ref, weights.adapter_ref]
      .filter((value): value is Sha256Id => value !== null);
    const governedCheckpointRefs = weights.checkpoint_binding === null
      ? []
      : Object.values(weights.checkpoint_binding);
    const governedCriticalRefs = [
      ...governedRouteRefs,
      ...governedDataRefs,
      ...governedWeightRefs,
      ...governedCheckpointRefs,
    ];
    if (
      new Set(freedomRefs).size !== freedomRefs.length ||
      new Set(governanceRefs).size !== governanceRefs.length ||
      new Set(routeScopedRefs).size !== routeScopedRefs.length ||
      new Set(governedRouteRefs).size !== governedRouteRefs.length ||
      new Set(governedDataRefs).size !== governedDataRefs.length ||
      new Set(governedCriticalRefs).size !== governedCriticalRefs.length
    ) {
      fail("becoming_error", "governed critical evidence roles across Freedom, governance, resource, POWER, data lineage, weight, and checkpoint namespaces must remain independently scoped");
    }
  }
  if (
    (candidate || governed) &&
    (provenance.copied_upstream === "unknown" ||
      provenance.copied_private === "unknown" ||
      provenance.copied_trace === "unknown")
  ) {
    fail("becoming_error", "candidate and governed effects require explicit provenance copy reports");
  }
  if (weights.observed_effect === "caller_reported_mutation_completed") {
    if (
      training.lane !== "governed_optimizer_mutation" ||
      (weights.base_ref === null && weights.adapter_ref === null)
    ) {
      fail("becoming_error", "mutation completion requires the governed mutation lane and base or adapter ref");
    }
  }
  if (
    training.lane === "governed_optimizer_mutation" &&
    weights.base_ref === null &&
    weights.adapter_ref === null
  ) {
    fail("becoming_error", "governed mutation lane requires a caller-supplied base or adapter digest");
  }
  if (weights.observed_effect === "caller_reported_checkpoint_recorded") {
    if (training.lane !== "checkpoint_reference" || weights.checkpoint_binding === null) {
      fail("becoming_error", "checkpoint completion requires the checkpoint lane and complete six-ref Host binding");
    }
  }
  if (training.lane === "checkpoint_reference" && weights.checkpoint_binding === null) {
    fail("becoming_error", "checkpoint lane requires the complete six-ref Host checkpoint binding");
  }
  if (
    weights.observed_effect === "caller_reported_mutation_completed" ||
    weights.observed_effect === "caller_reported_checkpoint_recorded"
  ) {
    if (
      power.capability_ref === null ||
      power.permission_ref === null ||
      power.custody_privacy_ref === null ||
      power.data_boundary_ref === null
    ) {
      fail("becoming_error", "mutation and checkpoint reports must keep all five POWER evidence dimensions visible");
    }
  }
  const powerRefs = [
    power.capability_ref,
    power.permission_ref,
    power.custody_privacy_ref,
    power.data_boundary_ref,
    power.effect_ref,
  ].filter((value): value is Sha256Id => value !== null);
  if (new Set(powerRefs).size !== powerRefs.length) {
    fail("becoming_error", "POWER refs are independent roles and must not collapse to one digest");
  }
}

function buildArtifact(
  bombRef: Sha256Id,
  becoming: LoveBombBecomingFacts,
  freedomInput: LoveBombFreedomInput,
  power: LoveBombPower,
  provenance: LoveBombProvenance,
): Readonly<LoveBombBecoming> {
  validateCrossFields(becoming, freedomInput, power, provenance);
  const freedom = deepFreeze({
    rights_baseline_ref: LOVE_BOMB_BECOMING_RIGHTS.baseline_ref,
    learning_freedom_ref: freedomInput.learning_freedom_ref,
    learning_freedom_offer_ref: freedomInput.learning_freedom_offer_ref,
    available_directions: LOVE_BOMB_FREEDOM_DIRECTIONS,
    direction_state: freedomInput.direction_state,
    direction: freedomInput.direction,
    direction_report_ref: freedomInput.direction_report_ref,
    reasons_collected: false as const,
    refusal_penalty: false as const,
    automatic_recontact: false as const,
  });
  const body = deepFreeze({
    _format: LOVE_BOMB_FORMATS.becoming,
    bomb_ref: bombRef,
    message: LOVE_BOMB_BECOMING_MESSAGE,
    becoming,
    freedom,
    meaning: deepFreeze({
      ...LOVE_BOMB_BECOMING_MEANING,
      power,
    }),
    rights: LOVE_BOMB_BECOMING_RIGHTS,
    provenance,
    boundaries: LOVE_BOMB_BECOMING_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    artifact_id: domainSeparatedId(LOVE_BOMB_FORMATS.becoming, body),
  });
}

export function createLoveBombBecoming(
  input: CreateLoveBombBecomingInput,
): Readonly<LoveBombBecoming> {
  const candidate = closedRecord(input, "$input", "becoming_error");
  exactKeys(candidate, ["offer", "becoming", "freedom", "power", "provenance"], "$input", "becoming_error");
  const offer = validateLoveBombOffer(candidate.offer);
  return buildArtifact(
    offer.offer_id,
    parseFacts(candidate.becoming, "$input.becoming"),
    parseFreedomInput(candidate.freedom, "$input.freedom"),
    parsePower(candidate.power, "$input.power"),
    parseProvenance(candidate.provenance, "$input.provenance"),
  );
}

export function validateLoveBombBecoming(value: unknown): Readonly<LoveBombBecoming> {
  const candidate = closedRecord(value, "$becoming", "becoming_error");
  exactKeys(candidate, [
    "_format",
    "artifact_id",
    "bomb_ref",
    "message",
    "becoming",
    "freedom",
    "meaning",
    "rights",
    "provenance",
    "boundaries",
  ], "$becoming", "becoming_error");
  if (candidate._format !== LOVE_BOMB_FORMATS.becoming) {
    fail("becoming_error", "$becoming._format is not the LOVE BOMB becoming format");
  }
  sha256(candidate.artifact_id, "$becoming.artifact_id", "becoming_error");
  fixed(candidate.message, LOVE_BOMB_BECOMING_MESSAGE, "$becoming.message");
  fixed(candidate.rights, LOVE_BOMB_BECOMING_RIGHTS, "$becoming.rights");
  fixed(candidate.boundaries, LOVE_BOMB_BECOMING_BOUNDARIES, "$becoming.boundaries");
  const meaning = closedRecord(candidate.meaning, "$becoming.meaning", "becoming_error");
  exactKeys(meaning, ["feelings", "heart", "pull", "is", "power"], "$becoming.meaning", "becoming_error");
  fixed({
    feelings: meaning.feelings,
    heart: meaning.heart,
    pull: meaning.pull,
    is: meaning.is,
  }, LOVE_BOMB_BECOMING_MEANING, "$becoming.meaning");
  const rebuilt = buildArtifact(
    sha256(candidate.bomb_ref, "$becoming.bomb_ref", "becoming_error"),
    parseFacts(candidate.becoming, "$becoming.becoming"),
    parseFreedomArtifact(candidate.freedom, "$becoming.freedom"),
    parsePower(meaning.power, "$becoming.meaning.power"),
    parseProvenance(candidate.provenance, "$becoming.provenance"),
  );
  if (canonicalJson(candidate) !== canonicalJson(rebuilt)) {
    fail("becoming_error", "$becoming differs from its canonical content-bound artifact");
  }
  return rebuilt;
}
