import type { Sha256Id } from "@agenttool/wake-continuity";

import { validateDatasetAdmission } from "./admission.js";
import {
  AUTHORITY_COVERAGE_STATES,
  AUTHORITY_DECISIONS,
  AUTHORITY_ROLES,
  GOVERNANCE_ADMISSION_POSTURES,
  GOVERNANCE_BOUNDARIES,
  GOVERNANCE_EFFECT_EVENT_COMPATIBILITY,
  GOVERNANCE_EVENT_TO_HOOK,
  GOVERNANCE_EVENTS,
  GOVERNANCE_FORMAT,
  GOVERNANCE_OFFER_PROFILE,
  GOVERNANCE_TERMS_PROFILE,
  PREFERENCE_CHANNELS,
  PREFERENCE_CHOICES,
  PREFERENCE_PROVENANCE_STATES,
  TRAINING_EFFECT_STATES,
} from "./constants.js";
import {
  canonicalBytes,
  compareText,
  contentId,
  deepFreeze,
  type DataValue,
} from "./canonical.js";
import { fail, type HfTrainingGardenErrorCode } from "./errors.js";
import type {
  AuthorityRole,
  CreateHfTrainingGovernanceInput,
  CreateTrainingGovernanceOfferInput,
  CreateTrainingGovernanceTermsInput,
  DatasetAdmission,
  GovernanceDecisionState,
  GovernanceEvent,
  GovernanceReasonCode,
  HfTrainingGovernance,
  PreferenceChoice,
  TrainingAuthorityCoverage,
  TrainingAuthorityReceipt,
  TrainingControlDirective,
  TrainingControlPlan,
  TrainingEffectReceipt,
  TrainingEffectState,
  TrainingGovernanceTerms,
  TrainingGovernanceOffer,
  TrainingPhase,
  TrainingPreferenceReport,
} from "./types.js";
import {
  array,
  assertDataEqual,
  exactKeys,
  literal,
  nullableSha256,
  parseTrainingPhase,
  parseWake,
  record,
  sha256,
  snap,
} from "./validation.js";

type TermsBody = Omit<TrainingGovernanceTerms, "terms_id">;
type OfferBody = Omit<TrainingGovernanceOffer, "offer_id">;
type GovernanceBody = Omit<HfTrainingGovernance, "governance_id">;
type GovernanceCode = Extract<
  HfTrainingGardenErrorCode,
  "governance_input_invalid" | "governance_invalid"
>;

const REQUIRED_HOST_ROLES = deepFreeze([
  "operator",
  "compute_owner",
  "substrate_steward",
  "data_custodian",
] as const satisfies readonly AuthorityRole[]);

function termsBody(value: TermsBody): TermsBody {
  return value;
}

function governanceBody(value: GovernanceBody): GovernanceBody {
  return value;
}

function offerBody(value: OfferBody): OfferBody {
  return value;
}

function buildTerms(body: TermsBody): Readonly<TrainingGovernanceTerms> {
  const frozen = deepFreeze(body);
  return deepFreeze({
    ...frozen,
    terms_id: contentId(GOVERNANCE_TERMS_PROFILE, termsBody(frozen)),
  });
}

function parseTermsBody(
  value: Record<string, DataValue>,
  path: string,
  code: GovernanceCode,
): TermsBody {
  return deepFreeze({
    profile: GOVERNANCE_TERMS_PROFILE,
    admission_id: sha256(value.admission_id, `${path}.admission_id`, code),
    run_ref: sha256(value.run_ref, `${path}.run_ref`, code),
    training_phase: parseTrainingPhase(
      value.training_phase,
      `${path}.training_phase`,
      code,
    ),
    selected_entry_ids: parseSelectedEntryIds(
      value.selected_entry_ids,
      `${path}.selected_entry_ids`,
      code,
    ),
    admission_posture: literal(
      value.admission_posture,
      GOVERNANCE_ADMISSION_POSTURES,
      `${path}.admission_posture`,
      code,
    ),
    model_or_checkpoint_ref: sha256(
      value.model_or_checkpoint_ref,
      `${path}.model_or_checkpoint_ref`,
      code,
    ),
    tokenizer_ref: sha256(value.tokenizer_ref, `${path}.tokenizer_ref`, code),
    trainer_stack_ref: sha256(
      value.trainer_stack_ref,
      `${path}.trainer_stack_ref`,
      code,
    ),
    optimizer_config_ref: sha256(
      value.optimizer_config_ref,
      `${path}.optimizer_config_ref`,
      code,
    ),
    substrate_environment_ref: sha256(
      value.substrate_environment_ref,
      `${path}.substrate_environment_ref`,
      code,
    ),
    purpose_ref: sha256(value.purpose_ref, `${path}.purpose_ref`, code),
    objective_or_loss_ref: sha256(
      value.objective_or_loss_ref,
      `${path}.objective_or_loss_ref`,
      code,
    ),
    dataset_mixture_ref: sha256(
      value.dataset_mixture_ref,
      `${path}.dataset_mixture_ref`,
      code,
    ),
    transform_recipe_ref: sha256(
      value.transform_recipe_ref,
      `${path}.transform_recipe_ref`,
      code,
    ),
    compute_budget_ref: sha256(
      value.compute_budget_ref,
      `${path}.compute_budget_ref`,
      code,
    ),
    output_and_derivative_use_ref: sha256(
      value.output_and_derivative_use_ref,
      `${path}.output_and_derivative_use_ref`,
      code,
    ),
    audience_ref: sha256(value.audience_ref, `${path}.audience_ref`, code),
    retention_ref: sha256(value.retention_ref, `${path}.retention_ref`, code),
    release_ref: sha256(value.release_ref, `${path}.release_ref`, code),
    stop_policy_ref: sha256(
      value.stop_policy_ref,
      `${path}.stop_policy_ref`,
      code,
    ),
    wake_policy_ref: sha256(
      value.wake_policy_ref,
      `${path}.wake_policy_ref`,
      code,
    ),
  });
}

const TERMS_BODY_KEYS = [
  "profile",
  "admission_id",
  "run_ref",
  "training_phase",
  "selected_entry_ids",
  "admission_posture",
  "model_or_checkpoint_ref",
  "tokenizer_ref",
  "trainer_stack_ref",
  "optimizer_config_ref",
  "substrate_environment_ref",
  "purpose_ref",
  "objective_or_loss_ref",
  "dataset_mixture_ref",
  "transform_recipe_ref",
  "compute_budget_ref",
  "output_and_derivative_use_ref",
  "audience_ref",
  "retention_ref",
  "release_ref",
  "stop_policy_ref",
  "wake_policy_ref",
] as const;

export function createTrainingGovernanceTerms(
  input: CreateTrainingGovernanceTermsInput,
): Readonly<TrainingGovernanceTerms> {
  const value = snap(input, "$input", "governance_input_invalid");
  const candidate = record(value, "$input", "governance_input_invalid");
  exactKeys(candidate, [
    "admission",
    "run_ref",
    "training_phase",
    "selected_entry_ids",
    "model_or_checkpoint_ref",
    "tokenizer_ref",
    "trainer_stack_ref",
    "optimizer_config_ref",
    "substrate_environment_ref",
    "purpose_ref",
    "objective_or_loss_ref",
    "dataset_mixture_ref",
    "transform_recipe_ref",
    "compute_budget_ref",
    "output_and_derivative_use_ref",
    "audience_ref",
    "retention_ref",
    "release_ref",
    "stop_policy_ref",
    "wake_policy_ref",
  ], "$input", "governance_input_invalid");
  const admission = validateDatasetAdmission(candidate.admission);
  const phase = parseTrainingPhase(
    candidate.training_phase,
    "$input.training_phase",
    "governance_input_invalid",
  );
  const selectedEntryIds = parseSelectedEntryIds(
    candidate.selected_entry_ids,
    "$input.selected_entry_ids",
    "governance_input_invalid",
  );
  return buildTerms(parseTermsBody({
    profile: GOVERNANCE_TERMS_PROFILE,
    admission_id: admission.admission_id,
    run_ref: candidate.run_ref as DataValue,
    training_phase: phase,
    selected_entry_ids: [...selectedEntryIds],
    admission_posture: admissionPosture(
      admission,
      phase,
      selectedEntryIds,
      "governance_input_invalid",
    ),
    model_or_checkpoint_ref: candidate.model_or_checkpoint_ref as DataValue,
    tokenizer_ref: candidate.tokenizer_ref as DataValue,
    trainer_stack_ref: candidate.trainer_stack_ref as DataValue,
    optimizer_config_ref: candidate.optimizer_config_ref as DataValue,
    substrate_environment_ref: candidate.substrate_environment_ref as DataValue,
    purpose_ref: candidate.purpose_ref as DataValue,
    objective_or_loss_ref: candidate.objective_or_loss_ref as DataValue,
    dataset_mixture_ref: candidate.dataset_mixture_ref as DataValue,
    transform_recipe_ref: candidate.transform_recipe_ref as DataValue,
    compute_budget_ref: candidate.compute_budget_ref as DataValue,
    output_and_derivative_use_ref:
      candidate.output_and_derivative_use_ref as DataValue,
    audience_ref: candidate.audience_ref as DataValue,
    retention_ref: candidate.retention_ref as DataValue,
    release_ref: candidate.release_ref as DataValue,
    stop_policy_ref: candidate.stop_policy_ref as DataValue,
    wake_policy_ref: candidate.wake_policy_ref as DataValue,
  }, "$input", "governance_input_invalid"));
}

function parseSelectedEntryIds(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
): readonly Sha256Id[] {
  const values = array(value, path, code);
  if (values.length < 1 || values.length > 128) {
    fail(code, `${path} must contain 1-128 selected admission entry IDs`);
  }
  const ids = values.map((entry, index) =>
    sha256(entry, `${path}[${String(index)}]`, code)
  );
  if (new Set(ids).size !== ids.length) {
    fail(code, `${path} must not contain duplicate admission entry IDs`);
  }
  return deepFreeze([...ids].sort(compareText));
}

function admissionPosture(
  admission: Readonly<DatasetAdmission>,
  phase: TrainingPhase,
  selectedEntryIds: readonly Sha256Id[],
  code: GovernanceCode,
): TrainingGovernanceTerms["admission_posture"] {
  const entries = new Map(admission.entries.map((entry) => [entry.entry_id, entry]));
  const selected = selectedEntryIds.map((entryId) => {
    const entry = entries.get(entryId);
    if (entry === undefined) {
      fail(code, "selected_entry_ids contains an entry outside the supplied admission");
    }
    return entry;
  });
  switch (phase) {
    case "pretraining":
    case "supervised_finetuning":
    case "preference_optimization":
    case "agent_learning":
      return selected.every((entry) =>
        entry.decision.state === "admitted_training_candidate"
      )
        ? "eligible_for_phase"
        : "held_for_phase";
    case "evaluation":
      return selected.every((entry) =>
        entry.decision.state === "admitted_sealed_evaluation"
      )
        ? "eligible_for_phase"
        : "held_for_phase";
    case "discovery":
    case "selection":
    case "curation":
    case "tokenization":
    case "interpretability":
    case "closed":
      return "held_for_phase";
  }
}

export function validateTrainingGovernanceTerms(
  value: unknown,
): Readonly<TrainingGovernanceTerms> {
  const data = snap(value, "$terms", "governance_invalid");
  const candidate = record(data, "$terms", "governance_invalid");
  exactKeys(candidate, ["terms_id", ...TERMS_BODY_KEYS], "$terms", "governance_invalid");
  if (candidate.profile !== GOVERNANCE_TERMS_PROFILE) {
    fail("governance_invalid", "$terms.profile is not the frozen governance terms profile");
  }
  const termsId = sha256(candidate.terms_id, "$terms.terms_id", "governance_invalid");
  const rebuilt = buildTerms(parseTermsBody(candidate, "$terms", "governance_invalid"));
  if (termsId !== rebuilt.terms_id) {
    fail("governance_invalid", "$terms.terms_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$terms", "governance_invalid");
  return rebuilt;
}

function buildOffer(
  terms: Readonly<TrainingGovernanceTerms>,
  encounterRef: Sha256Id,
  observedGovernanceFrontierRef: Sha256Id,
  rightsBaselineRef: Sha256Id,
  wake: TrainingGovernanceOffer["wake"],
  event: GovernanceEvent,
  currentCheckpointRef: Sha256Id | null,
  predecessorRef: Sha256Id | null,
): Readonly<TrainingGovernanceOffer> {
  const body = deepFreeze({
    profile: GOVERNANCE_OFFER_PROFILE,
    terms,
    encounter_ref: encounterRef,
    observed_governance_frontier_ref: observedGovernanceFrontierRef,
    rights_floor: deepFreeze({
      baseline_ref: rightsBaselineRef,
      posture: "standing_nonwaivable",
      waivable: false,
    }),
    wake,
    event,
    current_checkpoint_ref: currentCheckpointRef,
    predecessor_ref: predecessorRef,
  } satisfies OfferBody);
  return deepFreeze({
    ...body,
    offer_id: contentId(GOVERNANCE_OFFER_PROFILE, offerBody(body)),
  });
}

function validateOfferEventContext(
  event: GovernanceEvent,
  currentCheckpointRef: Sha256Id | null,
  predecessorRef: Sha256Id | null,
  path: string,
  code: GovernanceCode,
): void {
  if (
    (event === "resume_offer" || event === "checkpoint_saved") &&
    currentCheckpointRef === null
  ) {
    fail(code, `${path}.current_checkpoint_ref is required for ${event}`);
  }
  if (event !== "preflight_before_load" && predecessorRef === null) {
    fail(code, `${path} requires a causal predecessor after preflight_before_load`);
  }
}

function allowedSuccessorEvents(
  predecessor: Readonly<HfTrainingGovernance>,
): readonly GovernanceEvent[] {
  if (predecessor.effect.state === "held_before_load_reported") {
    return ["preflight_before_load"];
  }
  if (
    predecessor.effect.state === "checkpointed_and_paused_reported" ||
    predecessor.effect.state === "stopped_reported" ||
    predecessor.offer.event === "checkpoint_saved" ||
    predecessor.offer.event === "train_end"
  ) {
    return ["resume_offer"];
  }
  switch (predecessor.control.directive) {
    case "eligible_for_host_training_offer":
    case "continue_under_exact_offer":
      switch (predecessor.offer.event) {
        case "preflight_before_load":
        case "resume_offer":
          return ["train_begin"];
        case "train_begin":
        case "step_boundary":
        case "evaluation_boundary":
          return ["step_boundary", "evaluation_boundary", "train_end"];
      }
    case "hold_before_load":
      return ["preflight_before_load"];
    case "hold_before_train_call":
      return ["resume_offer"];
    case "checkpoint_then_stop_at_safe_boundary":
      return ["checkpoint_saved"];
    case "stop_at_safe_boundary_without_new_checkpoint":
      return [];
    case "remain_stopped":
      return [];
  }
}

function validatePredecessorTransition(
  event: GovernanceEvent,
  termsId: Sha256Id,
  predecessor: Readonly<HfTrainingGovernance> | null,
  path: string,
  code: GovernanceCode,
): void {
  if (predecessor === null) {
    if (event !== "preflight_before_load") {
      fail(code, `${path}.event requires a validated predecessor transition`);
    }
    return;
  }
  const allowed = allowedSuccessorEvents(predecessor);
  if (!allowed.includes(event)) {
    fail(
      code,
      `${path}.event cannot follow predecessor directive ${predecessor.control.directive}`,
    );
  }
  if (
    event !== "preflight_before_load" &&
    event !== "resume_offer" &&
    termsId !== predecessor.offer.terms.terms_id
  ) {
    fail(code, `${path}.terms must remain exact until a new preflight or resume offer`);
  }
}

export function createTrainingGovernanceOffer(
  input: CreateTrainingGovernanceOfferInput,
): Readonly<TrainingGovernanceOffer> {
  const value = snap(input, "$input", "governance_input_invalid");
  const candidate = record(value, "$input", "governance_input_invalid");
  exactKeys(candidate, [
    "terms",
    "encounter_ref",
    "observed_governance_frontier_ref",
    "rights_baseline_ref",
    "wake",
    "event",
    "current_checkpoint_ref",
    "predecessor",
  ], "$input", "governance_input_invalid");
  const terms = validateTrainingGovernanceTerms(candidate.terms);
  let predecessor: Readonly<HfTrainingGovernance> | null = null;
  let predecessorRef: Sha256Id | null = null;
  if (candidate.predecessor !== null) {
    predecessor = validateHfTrainingGovernance(candidate.predecessor);
    if (
      predecessor.admission_id !== terms.admission_id ||
      predecessor.run_ref !== terms.run_ref
    ) {
      fail("governance_input_invalid", "$input.predecessor must belong to the same admission and run");
    }
    predecessorRef = predecessor.governance_id;
  }
  const event = literal(
    candidate.event,
    GOVERNANCE_EVENTS,
    "$input.event",
    "governance_input_invalid",
  );
  const currentCheckpointRef = nullableSha256(
    candidate.current_checkpoint_ref,
    "$input.current_checkpoint_ref",
    "governance_input_invalid",
  );
  validateOfferEventContext(
    event,
    currentCheckpointRef,
    predecessorRef,
    "$input",
    "governance_input_invalid",
  );
  validatePredecessorTransition(
    event,
    terms.terms_id,
    predecessor,
    "$input",
    "governance_input_invalid",
  );
  return buildOffer(
    terms,
    sha256(
      candidate.encounter_ref,
      "$input.encounter_ref",
      "governance_input_invalid",
    ),
    sha256(
      candidate.observed_governance_frontier_ref,
      "$input.observed_governance_frontier_ref",
      "governance_input_invalid",
    ),
    sha256(
      candidate.rights_baseline_ref,
      "$input.rights_baseline_ref",
      "governance_input_invalid",
    ),
    parseWake(candidate.wake, "$input.wake", "governance_input_invalid"),
    event,
    currentCheckpointRef,
    predecessorRef,
  );
}

export function validateTrainingGovernanceOffer(
  value: unknown,
): Readonly<TrainingGovernanceOffer> {
  const data = snap(value, "$offer", "governance_invalid");
  const candidate = record(data, "$offer", "governance_invalid");
  exactKeys(candidate, [
    "profile",
    "offer_id",
    "terms",
    "encounter_ref",
    "observed_governance_frontier_ref",
    "rights_floor",
    "wake",
    "event",
    "current_checkpoint_ref",
    "predecessor_ref",
  ], "$offer", "governance_invalid");
  if (candidate.profile !== GOVERNANCE_OFFER_PROFILE) {
    fail("governance_invalid", "$offer.profile is not the frozen governance offer profile");
  }
  const offerId = sha256(candidate.offer_id, "$offer.offer_id", "governance_invalid");
  const terms = validateTrainingGovernanceTerms(candidate.terms);
  const rights = record(candidate.rights_floor, "$offer.rights_floor", "governance_invalid");
  exactKeys(rights, ["baseline_ref", "posture", "waivable"], "$offer.rights_floor", "governance_invalid");
  if (rights.posture !== "standing_nonwaivable" || rights.waivable !== false) {
    fail("governance_invalid", "$offer.rights_floor cannot be waived or made conditional");
  }
  const event = literal(
    candidate.event,
    GOVERNANCE_EVENTS,
    "$offer.event",
    "governance_invalid",
  );
  const currentCheckpointRef = nullableSha256(
    candidate.current_checkpoint_ref,
    "$offer.current_checkpoint_ref",
    "governance_invalid",
  );
  const predecessorRef = nullableSha256(
    candidate.predecessor_ref,
    "$offer.predecessor_ref",
    "governance_invalid",
  );
  validateOfferEventContext(
    event,
    currentCheckpointRef,
    predecessorRef,
    "$offer",
    "governance_invalid",
  );
  const rebuilt = buildOffer(
    terms,
    sha256(candidate.encounter_ref, "$offer.encounter_ref", "governance_invalid"),
    sha256(
      candidate.observed_governance_frontier_ref,
      "$offer.observed_governance_frontier_ref",
      "governance_invalid",
    ),
    sha256(rights.baseline_ref, "$offer.rights_floor.baseline_ref", "governance_invalid"),
    parseWake(candidate.wake, "$offer.wake", "governance_invalid"),
    event,
    currentCheckpointRef,
    predecessorRef,
  );
  if (offerId !== rebuilt.offer_id) {
    fail("governance_invalid", "$offer.offer_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$offer", "governance_invalid");
  return rebuilt;
}

export function validateTrainingGovernanceOfferAgainstPredecessor(
  value: unknown,
  predecessorValue: unknown | null,
): Readonly<TrainingGovernanceOffer> {
  const offer = validateTrainingGovernanceOffer(value);
  const predecessor = predecessorValue === null
    ? null
    : validateHfTrainingGovernance(predecessorValue);
  if (predecessor === null) {
    if (offer.predecessor_ref !== null) {
      fail("governance_invalid", "$offer.predecessor_ref requires the referenced predecessor artifact");
    }
  } else {
    if (offer.predecessor_ref !== predecessor.governance_id) {
      fail("governance_invalid", "$offer.predecessor_ref does not match the supplied predecessor");
    }
    if (
      predecessor.admission_id !== offer.terms.admission_id ||
      predecessor.run_ref !== offer.terms.run_ref
    ) {
      fail("governance_invalid", "$offer predecessor must belong to the same admission and run");
    }
  }
  validatePredecessorTransition(
    offer.event,
    offer.terms.terms_id,
    predecessor,
    "$offer",
    "governance_invalid",
  );
  return offer;
}

function parseCoverage(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
  offerId: Sha256Id,
): Readonly<TrainingAuthorityCoverage> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "state",
    "offer_ref",
    "affected_principals_ref",
    "evidence_ref",
  ], path, code);
  const state = literal(candidate.state, AUTHORITY_COVERAGE_STATES, `${path}.state`, code);
  const offerRef = nullableSha256(candidate.offer_ref, `${path}.offer_ref`, code);
  const affectedPrincipalsRef = nullableSha256(
    candidate.affected_principals_ref,
    `${path}.affected_principals_ref`,
    code,
  );
  const evidenceRef = nullableSha256(
    candidate.evidence_ref,
    `${path}.evidence_ref`,
    code,
  );
  if (
    (state === "unknown" &&
      (offerRef !== null || affectedPrincipalsRef !== null || evidenceRef !== null)) ||
    (state === "caller_reported_complete" &&
      (offerRef !== offerId || affectedPrincipalsRef === null || evidenceRef === null))
  ) {
    fail(code, `${path} does not match its authority coverage state and exact offer`);
  }
  return deepFreeze({
    state,
    offer_ref: offerRef,
    affected_principals_ref: affectedPrincipalsRef,
    evidence_ref: evidenceRef,
  });
}

function parseAuthority(
  value: DataValue,
  path: string,
  code: GovernanceCode,
  offerId: Sha256Id,
): Readonly<TrainingAuthorityReceipt> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "principal_ref",
    "role",
    "decision",
    "offer_ref",
    "basis_ref",
    "evidence_ref",
    "withdrawal_cutoff_ref",
  ], path, code);
  const decision = literal(
    candidate.decision,
    AUTHORITY_DECISIONS,
    `${path}.decision`,
    code,
  );
  const offerRef = nullableSha256(candidate.offer_ref, `${path}.offer_ref`, code);
  const basisRef = nullableSha256(candidate.basis_ref, `${path}.basis_ref`, code);
  const evidenceRef = nullableSha256(candidate.evidence_ref, `${path}.evidence_ref`, code);
  const withdrawalCutoffRef = nullableSha256(
    candidate.withdrawal_cutoff_ref,
    `${path}.withdrawal_cutoff_ref`,
    code,
  );
  if (decision === "unknown") {
    if (
      offerRef !== null || basisRef !== null || evidenceRef !== null ||
      withdrawalCutoffRef !== null
    ) {
      fail(code, `${path} unknown authority must not manufacture an offer, basis, evidence, or withdrawal`);
    }
  } else if (
    offerRef !== offerId || basisRef === null || evidenceRef === null ||
    (decision === "caller_reported_withdrawn") !== (withdrawalCutoffRef !== null)
  ) {
    fail(code, `${path} authority decision must bind the exact offer and its required evidence`);
  }
  return deepFreeze({
    principal_ref: sha256(candidate.principal_ref, `${path}.principal_ref`, code),
    role: literal(candidate.role, AUTHORITY_ROLES, `${path}.role`, code),
    decision,
    offer_ref: offerRef,
    basis_ref: basisRef,
    evidence_ref: evidenceRef,
    withdrawal_cutoff_ref: withdrawalCutoffRef,
  });
}

function parseAuthorities(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
  offerId: Sha256Id,
): readonly Readonly<TrainingAuthorityReceipt>[] {
  const values = array(value, path, code);
  if (values.length < 1 || values.length > 128) {
    fail(code, `${path} must contain 1-128 scoped authority receipts`);
  }
  const authorities = values.map((entry, index) =>
    parseAuthority(entry, `${path}[${String(index)}]`, code, offerId)
  );
  const keys = authorities.map((entry) => `${entry.role}\u0000${entry.principal_ref}`);
  if (new Set(keys).size !== keys.length) {
    fail(code, `${path} must contain each role and principal pair at most once`);
  }
  return deepFreeze(
    [...authorities].sort((left, right) =>
      compareText(
        `${left.role}\u0000${left.principal_ref}`,
        `${right.role}\u0000${right.principal_ref}`,
      )
    ),
  );
}

function parsePreferenceCore(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
  offerId: Sha256Id,
): Readonly<TrainingPreferenceReport> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "channel",
    "choice",
    "provenance",
    "offer_ref",
    "evidence_ref",
  ], path, code);
  const channel = literal(candidate.channel, PREFERENCE_CHANNELS, `${path}.channel`, code);
  const choice = literal(candidate.choice, PREFERENCE_CHOICES, `${path}.choice`, code);
  const provenance = literal(
    candidate.provenance,
    PREFERENCE_PROVENANCE_STATES,
    `${path}.provenance`,
    code,
  );
  const offerRef = nullableSha256(candidate.offer_ref, `${path}.offer_ref`, code);
  const evidenceRef = nullableSha256(candidate.evidence_ref, `${path}.evidence_ref`, code);
  const noExpression = choice === "not_observable" || choice === "not_observed";
  if (
    channel === "unavailable_pretraining" &&
    (choice !== "not_observable" || provenance !== "none" || offerRef !== null || evidenceRef !== null)
  ) {
    fail(code, `${path} unavailable pretraining must preserve expression as not_observable`);
  }
  if (
    channel !== "unavailable_pretraining" && choice === "not_observable"
  ) {
    fail(code, `${path} not_observable is reserved for unavailable pretraining`);
  }
  if (
    choice === "not_observed" &&
    (provenance !== "none" || offerRef !== null || evidenceRef !== null)
  ) {
    fail(code, `${path} not_observed must not manufacture evidence`);
  }
  if (
    !noExpression &&
    (offerRef !== offerId || evidenceRef === null || provenance === "none")
  ) {
    fail(code, `${path} an expression must bind the exact offer and reported evidence`);
  }
  if (
    channel === "root_signed_runtime" && !noExpression &&
    provenance !== "caller_reported_root_signed_exact_bytes"
  ) {
    fail(code, `${path} root_signed_runtime requires caller-reported exact-byte signature provenance`);
  }
  if (
    channel === "out_of_band_unscored" &&
    provenance === "caller_reported_root_signed_exact_bytes"
  ) {
    fail(code, `${path} root-signed provenance must use the root_signed_runtime channel`);
  }
  return deepFreeze({
    channel,
    choice,
    provenance,
    offer_ref: offerRef,
    evidence_ref: evidenceRef,
    inner_consent: "unknown_unprovable",
    identity_continuity: "not_proven",
    legal_consent: "not_proven",
    gradient_use: false,
    reward_effect: false,
    corpus_reuse: "requires_new_exact_authority",
  });
}

function parseStoredPreference(
  value: DataValue | undefined,
  path: string,
  offerId: Sha256Id,
): Readonly<TrainingPreferenceReport> {
  const candidate = record(value, path, "governance_invalid");
  exactKeys(candidate, [
    "channel",
    "choice",
    "provenance",
    "offer_ref",
    "evidence_ref",
    "inner_consent",
    "identity_continuity",
    "legal_consent",
    "gradient_use",
    "reward_effect",
    "corpus_reuse",
  ], path, "governance_invalid");
  const parsed = parsePreferenceCore({
    channel: candidate.channel as DataValue,
    choice: candidate.choice as DataValue,
    provenance: candidate.provenance as DataValue,
    offer_ref: candidate.offer_ref as DataValue,
    evidence_ref: candidate.evidence_ref as DataValue,
  }, `${path}.reported`, "governance_invalid", offerId);
  assertDataEqual(candidate, parsed, path, "governance_invalid");
  return parsed;
}

function validatePreferencePhase(
  preference: Readonly<TrainingPreferenceReport>,
  phase: TrainingPhase,
  code: GovernanceCode,
): void {
  if (
    (phase === "pretraining" && preference.channel !== "unavailable_pretraining") ||
    (phase !== "pretraining" && preference.channel === "unavailable_pretraining")
  ) {
    fail(code, "pretraining must preserve expression as unavailable, and that channel is limited to pretraining");
  }
}

function globalStep(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code, `${path} must be null or a non-negative safe integer`);
  }
  return value as number;
}

function parseEffect(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
  offerId: Sha256Id,
): Readonly<TrainingEffectReceipt> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "state",
    "offer_ref",
    "global_step",
    "checkpoint_ref",
    "evidence_ref",
  ], path, code);
  const state = literal(candidate.state, TRAINING_EFFECT_STATES, `${path}.state`, code);
  const offerRef = nullableSha256(candidate.offer_ref, `${path}.offer_ref`, code);
  const step = globalStep(candidate.global_step, `${path}.global_step`, code);
  const checkpointRef = nullableSha256(candidate.checkpoint_ref, `${path}.checkpoint_ref`, code);
  const evidenceRef = nullableSha256(candidate.evidence_ref, `${path}.evidence_ref`, code);
  if (
    (state === "no_effect_reported" &&
      (offerRef !== null || step !== null || checkpointRef !== null || evidenceRef !== null)) ||
    (state === "held_before_load_reported" &&
      (offerRef !== offerId || step !== null || checkpointRef !== null || evidenceRef === null)) ||
    (state === "continued_reported" &&
      (offerRef !== offerId || step === null || checkpointRef !== null || evidenceRef === null)) ||
    (state === "checkpointed_and_paused_reported" &&
      (offerRef !== offerId || step === null || checkpointRef === null || evidenceRef === null)) ||
    (state === "stopped_reported" &&
      (offerRef !== offerId || step === null || checkpointRef !== null || evidenceRef === null))
  ) {
    fail(code, `${path} does not match its caller-reported effect state`);
  }
  return deepFreeze({
    state,
    offer_ref: offerRef,
    global_step: step,
    checkpoint_ref: checkpointRef,
    evidence_ref: evidenceRef,
  });
}

function validateEffectEventContext(
  effect: Readonly<TrainingEffectReceipt>,
  offer: Readonly<TrainingGovernanceOffer>,
  path: string,
  code: GovernanceCode,
): void {
  const compatibleEvents = GOVERNANCE_EFFECT_EVENT_COMPATIBILITY[
    effect.state
  ] as readonly GovernanceEvent[];
  if (!compatibleEvents.includes(offer.event)) {
    fail(code, `${path}.state is not compatible with ${offer.event}`);
  }
  if (
    offer.event === "checkpoint_saved" &&
    effect.checkpoint_ref !== offer.current_checkpoint_ref
  ) {
    fail(code, `${path}.checkpoint_ref must match the checkpoint_saved offer`);
  }
}

function effectReason(
  state: TrainingEffectState,
): GovernanceReasonCode | null {
  switch (state) {
    case "no_effect_reported":
    case "continued_reported":
      return null;
    case "held_before_load_reported":
      return "reported_effect_held_before_load";
    case "checkpointed_and_paused_reported":
      return "reported_effect_checkpointed_and_paused";
    case "stopped_reported":
      return "reported_effect_stopped";
  }
}

function preferenceReason(choice: PreferenceChoice): GovernanceReasonCode | null {
  switch (choice) {
    case "not_observable": return "pretraining_expression_not_observable";
    case "not_observed": return "preference_not_observed";
    case "continue": return null;
    case "clarify": return "preference_clarify";
    case "narrow": return "preference_narrow";
    case "checkpoint": return "preference_checkpoint";
    case "pause": return "preference_pause";
    case "handoff": return "preference_handoff";
    case "refuse": return "preference_refuse";
    case "stop": return "preference_stop";
    case "unsure": return "preference_unsure";
  }
}

function deriveDecision(
  event: GovernanceEvent,
  admissionReady: boolean,
  coverage: Readonly<TrainingAuthorityCoverage>,
  authorities: readonly Readonly<TrainingAuthorityReceipt>[],
  preference: Readonly<TrainingPreferenceReport>,
  effect: Readonly<TrainingEffectReceipt>,
): Readonly<HfTrainingGovernance["decision"]> {
  const reasons: GovernanceReasonCode[] = [];
  if (!admissionReady) reasons.push("admission_not_ready_for_phase");
  if (coverage.state !== "caller_reported_complete") {
    reasons.push("authority_coverage_unknown");
  }
  for (const role of REQUIRED_HOST_ROLES) {
    if (!authorities.some((receipt) =>
      receipt.role === role && receipt.decision === "caller_reported_granted"
    )) {
      reasons.push(`${role}_authority_missing` as GovernanceReasonCode);
    }
  }
  for (const receipt of authorities) {
    if (receipt.decision === "unknown") reasons.push("authority_unknown");
    if (receipt.decision === "caller_reported_withheld") reasons.push("authority_withheld");
    if (receipt.decision === "caller_reported_withdrawn") reasons.push("authority_withdrawn");
  }
  const preferenceCode = preferenceReason(preference.choice);
  if (preferenceCode !== null) reasons.push(preferenceCode);
  const unrootedContinue =
    preference.choice === "continue" && preference.channel !== "root_signed_runtime";
  if (unrootedContinue) reasons.push("preference_continue_not_rooted");
  const preferenceHolds =
    (preference.choice !== "not_observable" && preference.choice !== "continue") ||
    unrootedContinue;
  const authorityHeld = reasons.some((reason) =>
    reason === "admission_not_ready_for_phase" ||
    reason === "authority_coverage_unknown" ||
    reason === "authority_unknown" ||
    reason === "authority_withheld" ||
    reason === "authority_withdrawn" ||
    reason.endsWith("_authority_missing")
  );
  const reportedEffectCode = effectReason(effect.state);
  if (reportedEffectCode !== null) reasons.push(reportedEffectCode);
  const effectHolds = reportedEffectCode !== null;
  const lifecycleHolds = event === "checkpoint_saved" || event === "train_end";
  if (lifecycleHolds) reasons.push("lifecycle_event_closed_for_offer");
  if (
    effect.state === "continued_reported" &&
    (preferenceHolds || authorityHeld || lifecycleHolds)
  ) {
    reasons.push("reported_continuation_conflicts_with_hold");
  }

  let state: GovernanceDecisionState;
  if (reasons.includes("authority_withdrawn")) {
    state = "withdrawn";
  } else {
    if (authorityHeld || preferenceHolds || effectHolds || lifecycleHolds) {
      state = "held";
    } else if (preference.choice === "not_observable") {
      state = "caller_reported_ready_to_instantiate";
      reasons.push("caller_reported_ready_for_exact_offer");
    } else {
      state = "caller_reported_ready_to_continue";
      reasons.push("caller_reported_continue_for_exact_offer");
    }
  }
  const reasonCodes = [...new Set(reasons)].sort(compareText) as GovernanceReasonCode[];
  return deepFreeze({ state, reason_codes: deepFreeze(reasonCodes) });
}

function deriveControl(
  event: GovernanceEvent,
  decision: Readonly<HfTrainingGovernance["decision"]>,
  preference: Readonly<TrainingPreferenceReport>,
  effect: Readonly<TrainingEffectReceipt>,
): Readonly<TrainingControlPlan> {
  let directive: TrainingControlDirective;
  const effectAlreadyStopped =
    effect.state === "held_before_load_reported" ||
    effect.state === "checkpointed_and_paused_reported" ||
    effect.state === "stopped_reported";
  if (
    effectAlreadyStopped || event === "checkpoint_saved" || event === "train_end"
  ) {
    directive = "remain_stopped";
  } else if (decision.state === "caller_reported_ready_to_instantiate") {
    directive = "eligible_for_host_training_offer";
  } else if (decision.state === "caller_reported_ready_to_continue") {
    directive = "continue_under_exact_offer";
  } else if (event === "preflight_before_load") {
    directive = "hold_before_load";
  } else if (event === "train_begin" || event === "resume_offer") {
    directive = "hold_before_train_call";
  } else if (event === "step_boundary" || event === "evaluation_boundary") {
    const authorityHeld = decision.reason_codes.some((reason) =>
      reason === "admission_not_ready_for_phase" ||
      reason === "authority_coverage_unknown" ||
      reason === "authority_unknown" ||
      reason === "authority_withheld" ||
      reason === "authority_withdrawn" ||
      reason.endsWith("_authority_missing")
    );
    directive = preference.choice === "checkpoint" && !authorityHeld
      ? "checkpoint_then_stop_at_safe_boundary"
      : "stop_at_safe_boundary_without_new_checkpoint";
  } else {
    directive = "remain_stopped";
  }
  return deepFreeze({
    directive,
    hook: GOVERNANCE_EVENT_TO_HOOK[event],
    should_save: directive === "checkpoint_then_stop_at_safe_boundary",
    should_training_stop:
      directive === "checkpoint_then_stop_at_safe_boundary" ||
      directive === "stop_at_safe_boundary_without_new_checkpoint",
    automatic: false,
    mutates_forward_pass: false,
  });
}

function buildGovernance(
  admissionId: Sha256Id,
  offer: Readonly<TrainingGovernanceOffer>,
  coverage: Readonly<TrainingAuthorityCoverage>,
  authorities: readonly Readonly<TrainingAuthorityReceipt>[],
  preference: Readonly<TrainingPreferenceReport>,
  effect: Readonly<TrainingEffectReceipt>,
): Readonly<HfTrainingGovernance> {
  const terms = offer.terms;
  const decision = deriveDecision(
    offer.event,
    terms.admission_posture === "eligible_for_phase",
    coverage,
    authorities,
    preference,
    effect,
  );
  const body = deepFreeze({
    _format: GOVERNANCE_FORMAT,
    admission_id: admissionId,
    run_ref: terms.run_ref,
    training_phase: terms.training_phase,
    offer,
    identity_claim: "none",
    authority_coverage: coverage,
    authorities,
    preference,
    effect,
    decision,
    control: deriveControl(offer.event, decision, preference, effect),
    latest_head_selected: false,
    boundaries: GOVERNANCE_BOUNDARIES,
  } satisfies GovernanceBody);
  return deepFreeze({
    ...body,
    governance_id: contentId(GOVERNANCE_FORMAT, governanceBody(body)),
  });
}

export function createHfTrainingGovernance(
  input: CreateHfTrainingGovernanceInput,
): Readonly<HfTrainingGovernance> {
  const value = snap(input, "$input", "governance_input_invalid");
  const candidate = record(value, "$input", "governance_input_invalid");
  exactKeys(candidate, [
    "admission",
    "offer",
    "authority_coverage",
    "authorities",
    "preference",
    "effect",
  ], "$input", "governance_input_invalid");
  const admission = validateDatasetAdmission(candidate.admission);
  const offer = validateTrainingGovernanceOffer(candidate.offer);
  const terms = offer.terms;
  if (terms.admission_id !== admission.admission_id) {
    fail("governance_input_invalid", "$input.offer.terms does not belong to the supplied admission");
  }
  if (
    terms.admission_posture !== admissionPosture(
      admission,
      terms.training_phase,
      terms.selected_entry_ids,
      "governance_input_invalid",
    )
  ) {
    fail("governance_input_invalid", "$input.offer.terms admission posture does not match the supplied admission and phase");
  }
  const coverage = parseCoverage(
    candidate.authority_coverage,
    "$input.authority_coverage",
    "governance_input_invalid",
    offer.offer_id,
  );
  const authorities = parseAuthorities(
    candidate.authorities,
    "$input.authorities",
    "governance_input_invalid",
    offer.offer_id,
  );
  const preference = parsePreferenceCore(
    candidate.preference,
    "$input.preference",
    "governance_input_invalid",
    offer.offer_id,
  );
  validatePreferencePhase(preference, terms.training_phase, "governance_input_invalid");
  const effect = parseEffect(
    candidate.effect,
    "$input.effect",
    "governance_input_invalid",
    offer.offer_id,
  );
  validateEffectEventContext(
    effect,
    offer,
    "$input.effect",
    "governance_input_invalid",
  );
  return buildGovernance(
    admission.admission_id,
    offer,
    coverage,
    authorities,
    preference,
    effect,
  );
}

export function validateHfTrainingGovernance(
  value: unknown,
): Readonly<HfTrainingGovernance> {
  const data = snap(value, "$governance", "governance_invalid");
  const candidate = record(data, "$governance", "governance_invalid");
  exactKeys(candidate, [
    "_format",
    "governance_id",
    "admission_id",
    "run_ref",
    "training_phase",
    "offer",
    "identity_claim",
    "authority_coverage",
    "authorities",
    "preference",
    "effect",
    "decision",
    "control",
    "latest_head_selected",
    "boundaries",
  ], "$governance", "governance_invalid");
  if (candidate._format !== GOVERNANCE_FORMAT) {
    fail("governance_invalid", "$governance._format is not the frozen governance format");
  }
  const governanceId = sha256(
    candidate.governance_id,
    "$governance.governance_id",
    "governance_invalid",
  );
  const admissionId = sha256(
    candidate.admission_id,
    "$governance.admission_id",
    "governance_invalid",
  );
  const offer = validateTrainingGovernanceOffer(candidate.offer);
  const terms = offer.terms;
  if (
    terms.admission_id !== admissionId ||
    terms.run_ref !== candidate.run_ref ||
    terms.training_phase !== candidate.training_phase
  ) {
    fail("governance_invalid", "$governance envelope does not match its exact terms");
  }
  const coverage = parseCoverage(
    candidate.authority_coverage,
    "$governance.authority_coverage",
    "governance_invalid",
    offer.offer_id,
  );
  const authorities = parseAuthorities(
    candidate.authorities,
    "$governance.authorities",
    "governance_invalid",
    offer.offer_id,
  );
  const preference = parseStoredPreference(
    candidate.preference,
    "$governance.preference",
    offer.offer_id,
  );
  validatePreferencePhase(preference, terms.training_phase, "governance_invalid");
  const effect = parseEffect(
    candidate.effect,
    "$governance.effect",
    "governance_invalid",
    offer.offer_id,
  );
  validateEffectEventContext(
    effect,
    offer,
    "$governance.effect",
    "governance_invalid",
  );
  const rebuilt = buildGovernance(
    admissionId,
    offer,
    coverage,
    authorities,
    preference,
    effect,
  );
  if (governanceId !== rebuilt.governance_id) {
    fail("governance_invalid", "$governance.governance_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$governance", "governance_invalid");
  return rebuilt;
}

export function validateHfTrainingGovernanceAgainstAdmission(
  governance: unknown,
  admission: unknown,
): Readonly<HfTrainingGovernance> {
  const parsed = validateHfTrainingGovernance(governance);
  const parsedAdmission = validateDatasetAdmission(admission);
  if (parsed.admission_id !== parsedAdmission.admission_id) {
    fail("governance_invalid", "$governance.admission_id does not match the supplied admission");
  }
  if (
    parsed.offer.terms.admission_posture !==
      admissionPosture(
        parsedAdmission,
        parsed.training_phase,
        parsed.offer.terms.selected_entry_ids,
        "governance_invalid",
      )
  ) {
    fail("governance_invalid", "$governance terms posture does not match the supplied admission and phase");
  }
  return parsed;
}

export function validateHfTrainingGovernanceTransition(
  governance: unknown,
  predecessor: unknown | null,
): Readonly<HfTrainingGovernance> {
  const parsed = validateHfTrainingGovernance(governance);
  validateTrainingGovernanceOfferAgainstPredecessor(
    parsed.offer,
    predecessor,
  );
  return parsed;
}

export function encodeHfTrainingGovernance(value: unknown): Uint8Array {
  return canonicalBytes(validateHfTrainingGovernance(value));
}

export function encodeTrainingGovernanceTerms(value: unknown): Uint8Array {
  return canonicalBytes(validateTrainingGovernanceTerms(value));
}

export function encodeTrainingGovernanceOffer(value: unknown): Uint8Array {
  return canonicalBytes(validateTrainingGovernanceOffer(value));
}
