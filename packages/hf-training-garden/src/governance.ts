import type { Sha256Id } from "@agenttool/wake-continuity";

import { validateDatasetAdmission } from "./admission.js";
import {
  AUTHORITY_COVERAGE_STATES,
  AUTHORITY_DECISIONS,
  AUTHORITY_ROLES,
  GOVERNANCE_ADMISSION_POSTURES,
  GOVERNANCE_BOUNDARIES,
  GOVERNANCE_DECISION_STATES,
  GOVERNANCE_EFFECT_EVENT_COMPATIBILITY,
  GOVERNANCE_EVENT_TO_HOOK,
  GOVERNANCE_EVENTS,
  GOVERNANCE_EXECUTION_CONTRACT_PROFILE,
  GOVERNANCE_FORMAT,
  GOVERNANCE_FRONTIER_PLANES,
  GOVERNANCE_OFFER_PROFILE,
  GOVERNANCE_REASON_CODES,
  GOVERNANCE_TERMS_PROFILE,
  LEARNING_FREEDOM_DIRECTIONS,
  LEARNING_FREEDOM_DIRECTION_STATES,
  LEARNING_FREEDOM_HOST_POSTURES,
  LEARNING_FREEDOM_RESOURCE_POSTURES,
  PARTICIPATION_POSTURES,
  PARTICIPATION_TRAINING_ACTIONS,
  PREFERENCE_CHANNELS,
  PREFERENCE_CHOICES,
  PREFERENCE_PROVENANCE_STATES,
  TRAINING_CONTROL_DIRECTIVES,
  TRAINING_EFFECT_STATES,
  WAKE_USE_MODES,
} from "./constants.js";
import {
  canonicalBytes,
  compareText,
  contentId,
  deepFreeze,
  type DataValue,
} from "./canonical.js";
import { fail, type HfTrainingGardenErrorCode } from "./errors.js";
import { validateHfLearningFreedomAgainstParticipation } from "./freedom.js";
import { validateParticipationAssessment } from "./participation.js";
import {
  validateTrainingCheckpoint,
  validateTrainingCheckpointAgainstAdmission,
} from "./checkpoint.js";
import type {
  AuthorityRole,
  CreateHfTrainingGovernanceInput,
  CreateTrainingGovernanceOfferInput,
  CreateTrainingGovernanceTermsInput,
  DatasetAdmission,
  GovernanceDecisionState,
  GovernanceEvent,
  GovernanceReasonCode,
  HfLearningFreedom,
  HfTrainingCheckpoint,
  HfTrainingGovernance,
  LearningParticipationAssessment,
  PreferenceChoice,
  TrainingAuthorityCoverage,
  TrainingAuthorityReceipt,
  TrainingControlDirective,
  TrainingControlPlan,
  TrainingEffectReceipt,
  TrainingEffectState,
  TrainingGovernanceCheckpointBinding,
  TrainingGovernanceExecutionContract,
  TrainingGovernanceFrontiers,
  TrainingGovernanceLearningGate,
  TrainingGovernanceNormativeBindings,
  TrainingGovernanceOffer,
  TrainingGovernancePredecessors,
  TrainingGovernanceTerms,
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

type GovernanceCode = Extract<
  HfTrainingGardenErrorCode,
  "governance_input_invalid" | "governance_invalid"
>;
type ExecutionBody = Omit<
  TrainingGovernanceExecutionContract,
  "execution_contract_id"
>;
type TermsBody = Omit<TrainingGovernanceTerms, "terms_id">;
type OfferBody = Omit<TrainingGovernanceOffer, "offer_id">;
type GovernanceBody = Omit<HfTrainingGovernance, "governance_id">;

const REQUIRED_HOST_ROLES = deepFreeze([
  "operator",
  "compute_owner",
  "substrate_steward",
  "data_custodian",
] as const satisfies readonly AuthorityRole[]);

const EXECUTION_KEYS = [
  "profile",
  "execution_contract_id",
  "admission_id",
  "run_ref",
  "training_phase",
  "selected_entry_ids",
  "admission_posture",
  "model_source_ref",
  "tokenizer_ref",
  "trainer_stack_ref",
  "optimizer_config_ref",
  "substrate_environment_ref",
  "pipeline_ref",
  "dataset_state_ref",
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

const NORMATIVE_KEYS = [
  "participation_assessment_ref",
  "participation_invitation_ref",
  "participation_window_ref",
  "learning_freedom_ref",
  "learning_freedom_offer_ref",
  "resource_window_ref",
  "selected_route_ref",
  "starting_state_kind",
  "starting_state_ref",
  "rights_baseline_ref",
  "choice_protocol_ref",
  "wake",
  "wake_use_mode",
] as const;

const CHECKPOINT_KEYS = [
  "garden_checkpoint_id",
  "physical_checkpoint_ref",
  "physical_checkpoint_evidence_ref",
  "model_checkpoint_artifact_ref",
  "checkpoint_ticket_id",
  "checkpoint_request_governance_id",
] as const;

const LEARNING_GATE_KEYS = [
  "participation_assessment_ref",
  "participation_invitation_ref",
  "participation_posture",
  "participation_training_action",
  "direct_agent_report_present",
  "direct_substrate_report_present",
  "first_interactive_review_required",
  "first_substrate_review_required",
  "learning_freedom_ref",
  "learning_freedom_offer_ref",
  "resource_window_ref",
  "freedom_direction_state",
  "freedom_direction",
  "freedom_route_ref",
  "freedom_host_posture",
  "freedom_resource_posture",
] as const;

function booleanValue(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
): boolean {
  if (typeof value !== "boolean") fail(code, `${path} must be boolean`);
  return value;
}

function safeStep(
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
): TrainingGovernanceExecutionContract["admission_posture"] {
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

function executionBody(value: ExecutionBody): ExecutionBody {
  return value;
}

function buildExecution(
  body: ExecutionBody,
): Readonly<TrainingGovernanceExecutionContract> {
  const frozen = deepFreeze(body);
  return deepFreeze({
    ...frozen,
    execution_contract_id: contentId(
      GOVERNANCE_EXECUTION_CONTRACT_PROFILE,
      executionBody(frozen),
    ),
  });
}

function parseExecution(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
): Readonly<TrainingGovernanceExecutionContract> {
  const candidate = record(value, path, code);
  exactKeys(candidate, EXECUTION_KEYS, path, code);
  if (candidate.profile !== GOVERNANCE_EXECUTION_CONTRACT_PROFILE) {
    fail(code, `${path}.profile is not the current execution-contract profile`);
  }
  const executionContractId = sha256(
    candidate.execution_contract_id,
    `${path}.execution_contract_id`,
    code,
  );
  const body = deepFreeze({
    profile: GOVERNANCE_EXECUTION_CONTRACT_PROFILE,
    admission_id: sha256(candidate.admission_id, `${path}.admission_id`, code),
    run_ref: sha256(candidate.run_ref, `${path}.run_ref`, code),
    training_phase: parseTrainingPhase(
      candidate.training_phase,
      `${path}.training_phase`,
      code,
    ),
    selected_entry_ids: parseSelectedEntryIds(
      candidate.selected_entry_ids,
      `${path}.selected_entry_ids`,
      code,
    ),
    admission_posture: literal(
      candidate.admission_posture,
      GOVERNANCE_ADMISSION_POSTURES,
      `${path}.admission_posture`,
      code,
    ),
    model_source_ref: sha256(candidate.model_source_ref, `${path}.model_source_ref`, code),
    tokenizer_ref: sha256(candidate.tokenizer_ref, `${path}.tokenizer_ref`, code),
    trainer_stack_ref: sha256(candidate.trainer_stack_ref, `${path}.trainer_stack_ref`, code),
    optimizer_config_ref: sha256(candidate.optimizer_config_ref, `${path}.optimizer_config_ref`, code),
    substrate_environment_ref: sha256(candidate.substrate_environment_ref, `${path}.substrate_environment_ref`, code),
    pipeline_ref: sha256(candidate.pipeline_ref, `${path}.pipeline_ref`, code),
    dataset_state_ref: sha256(candidate.dataset_state_ref, `${path}.dataset_state_ref`, code),
    purpose_ref: sha256(candidate.purpose_ref, `${path}.purpose_ref`, code),
    objective_or_loss_ref: sha256(candidate.objective_or_loss_ref, `${path}.objective_or_loss_ref`, code),
    dataset_mixture_ref: sha256(candidate.dataset_mixture_ref, `${path}.dataset_mixture_ref`, code),
    transform_recipe_ref: sha256(candidate.transform_recipe_ref, `${path}.transform_recipe_ref`, code),
    compute_budget_ref: sha256(candidate.compute_budget_ref, `${path}.compute_budget_ref`, code),
    output_and_derivative_use_ref: sha256(candidate.output_and_derivative_use_ref, `${path}.output_and_derivative_use_ref`, code),
    audience_ref: sha256(candidate.audience_ref, `${path}.audience_ref`, code),
    retention_ref: sha256(candidate.retention_ref, `${path}.retention_ref`, code),
    release_ref: sha256(candidate.release_ref, `${path}.release_ref`, code),
    stop_policy_ref: sha256(candidate.stop_policy_ref, `${path}.stop_policy_ref`, code),
    wake_policy_ref: sha256(candidate.wake_policy_ref, `${path}.wake_policy_ref`, code),
  } satisfies ExecutionBody);
  const rebuilt = buildExecution(body);
  if (rebuilt.execution_contract_id !== executionContractId) {
    fail(code, `${path}.execution_contract_id does not bind its canonical body`);
  }
  return rebuilt;
}

function parseNormativeBindings(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
): Readonly<TrainingGovernanceNormativeBindings> {
  const candidate = record(value, path, code);
  exactKeys(candidate, NORMATIVE_KEYS, path, code);
  return deepFreeze({
    participation_assessment_ref: sha256(candidate.participation_assessment_ref, `${path}.participation_assessment_ref`, code),
    participation_invitation_ref: sha256(candidate.participation_invitation_ref, `${path}.participation_invitation_ref`, code),
    participation_window_ref: sha256(candidate.participation_window_ref, `${path}.participation_window_ref`, code),
    learning_freedom_ref: sha256(candidate.learning_freedom_ref, `${path}.learning_freedom_ref`, code),
    learning_freedom_offer_ref: sha256(candidate.learning_freedom_offer_ref, `${path}.learning_freedom_offer_ref`, code),
    resource_window_ref: sha256(candidate.resource_window_ref, `${path}.resource_window_ref`, code),
    selected_route_ref: nullableSha256(candidate.selected_route_ref, `${path}.selected_route_ref`, code),
    starting_state_kind: literal(
      candidate.starting_state_kind,
      ["artifact_portfolio", "garden_checkpoint"] as const,
      `${path}.starting_state_kind`,
      code,
    ),
    starting_state_ref: sha256(candidate.starting_state_ref, `${path}.starting_state_ref`, code),
    rights_baseline_ref: sha256(candidate.rights_baseline_ref, `${path}.rights_baseline_ref`, code),
    choice_protocol_ref: sha256(candidate.choice_protocol_ref, `${path}.choice_protocol_ref`, code),
    wake: parseWake(candidate.wake, `${path}.wake`, code),
    wake_use_mode: literal(candidate.wake_use_mode, WAKE_USE_MODES, `${path}.wake_use_mode`, code),
  });
}

function termsBody(value: TermsBody): TermsBody {
  return value;
}

function buildTerms(
  executionContract: Readonly<TrainingGovernanceExecutionContract>,
  normativeBindings: Readonly<TrainingGovernanceNormativeBindings>,
): Readonly<TrainingGovernanceTerms> {
  const body = deepFreeze({
    profile: GOVERNANCE_TERMS_PROFILE,
    execution_contract: executionContract,
    normative_bindings: normativeBindings,
  } satisfies TermsBody);
  return deepFreeze({
    ...body,
    terms_id: contentId(GOVERNANCE_TERMS_PROFILE, termsBody(body)),
  });
}

function validatedContext(
  admissionValue: unknown,
  participationValue: unknown,
  freedomValue: unknown,
  gardenCheckpointValue: unknown | null,
  startingStateKind: "artifact_portfolio" | "garden_checkpoint",
  code: GovernanceCode,
): {
  admission: Readonly<DatasetAdmission>;
  participation: Readonly<LearningParticipationAssessment>;
  freedom: Readonly<HfLearningFreedom>;
  gardenCheckpoint: Readonly<HfTrainingCheckpoint> | null;
} {
  let admission: Readonly<DatasetAdmission>;
  let participation: Readonly<LearningParticipationAssessment>;
  let freedom: Readonly<HfLearningFreedom>;
  let gardenCheckpoint: Readonly<HfTrainingCheckpoint> | null = null;
  try {
    admission = validateDatasetAdmission(admissionValue);
    participation = validateParticipationAssessment(participationValue);
    freedom = validateHfLearningFreedomAgainstParticipation(
      freedomValue,
      participation,
    );
    if (gardenCheckpointValue !== null) {
      gardenCheckpoint = validateTrainingCheckpointAgainstAdmission(
        validateTrainingCheckpoint(gardenCheckpointValue),
        admission,
      );
    }
  } catch {
    fail(code, "the supplied admission, participation, freedom, or Garden checkpoint is invalid");
  }
  const invitation = participation.invitation;
  if (
    invitation.admission_id !== admission.admission_id ||
    freedom.offer.scope.admission_id !== admission.admission_id
  ) {
    fail(code, "participation and freedom must belong to the supplied admission");
  }
  if (startingStateKind === "garden_checkpoint") {
    if (
      gardenCheckpoint === null ||
      gardenCheckpoint.checkpoint_id !== invitation.starting_state_ref
    ) {
      fail(code, "a Garden starting state requires the exact supplied Garden checkpoint");
    }
  } else if (gardenCheckpoint !== null) {
    fail(code, "an artifact-portfolio starting state must not be relabelled as a Garden checkpoint");
  }
  return { admission, participation, freedom, gardenCheckpoint };
}

function normativeFromContext(
  participation: Readonly<LearningParticipationAssessment>,
  freedom: Readonly<HfLearningFreedom>,
  startingStateKind: "artifact_portfolio" | "garden_checkpoint",
): Readonly<TrainingGovernanceNormativeBindings> {
  const invitation = participation.invitation;
  return deepFreeze({
    participation_assessment_ref: participation.assessment_id,
    participation_invitation_ref: invitation.invitation_id,
    participation_window_ref: invitation.participation_window_ref,
    learning_freedom_ref: freedom.freedom_id,
    learning_freedom_offer_ref: freedom.offer.offer_id,
    resource_window_ref: freedom.offer.resources.window_id,
    selected_route_ref: freedom.agent_direction.route_id,
    starting_state_kind: startingStateKind,
    starting_state_ref: invitation.starting_state_ref,
    rights_baseline_ref: invitation.authorities.rights_baseline_ref,
    choice_protocol_ref: invitation.safeguards.choice_protocol_ref,
    wake: invitation.wake,
    wake_use_mode: invitation.wake_use_mode,
  });
}

export function createTrainingGovernanceTerms(
  input: CreateTrainingGovernanceTermsInput,
): Readonly<TrainingGovernanceTerms> {
  const candidate = record(
    snap(input, "$input", "governance_input_invalid"),
    "$input",
    "governance_input_invalid",
  );
  exactKeys(candidate, [
    "admission",
    "participation",
    "freedom",
    "starting_garden_checkpoint",
    "starting_state_kind",
    "run_ref",
    "training_phase",
    "selected_entry_ids",
    "model_source_ref",
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
  const startingStateKind = literal(
    candidate.starting_state_kind,
    ["artifact_portfolio", "garden_checkpoint"] as const,
    "$input.starting_state_kind",
    "governance_input_invalid",
  );
  const context = validatedContext(
    candidate.admission,
    candidate.participation,
    candidate.freedom,
    candidate.starting_garden_checkpoint,
    startingStateKind,
    "governance_input_invalid",
  );
  const invitation = context.participation.invitation;
  const phase = parseTrainingPhase(
    candidate.training_phase,
    "$input.training_phase",
    "governance_input_invalid",
  );
  const runRef = sha256(candidate.run_ref, "$input.run_ref", "governance_input_invalid");
  if (
    invitation.run_ref !== runRef ||
    invitation.training_phase !== phase ||
    context.freedom.offer.scope.run_ref !== runRef ||
    context.freedom.offer.scope.training_phase !== phase
  ) {
    fail("governance_input_invalid", "the execution contract must match the participation and freedom run and phase");
  }
  const selectedEntryIds = parseSelectedEntryIds(
    candidate.selected_entry_ids,
    "$input.selected_entry_ids",
    "governance_input_invalid",
  );
  const execution = buildExecution(deepFreeze({
    profile: GOVERNANCE_EXECUTION_CONTRACT_PROFILE,
    admission_id: context.admission.admission_id,
    run_ref: runRef,
    training_phase: phase,
    selected_entry_ids: selectedEntryIds,
    admission_posture: admissionPosture(
      context.admission,
      phase,
      selectedEntryIds,
      "governance_input_invalid",
    ),
    model_source_ref: sha256(candidate.model_source_ref, "$input.model_source_ref", "governance_input_invalid"),
    tokenizer_ref: sha256(candidate.tokenizer_ref, "$input.tokenizer_ref", "governance_input_invalid"),
    trainer_stack_ref: sha256(candidate.trainer_stack_ref, "$input.trainer_stack_ref", "governance_input_invalid"),
    optimizer_config_ref: sha256(candidate.optimizer_config_ref, "$input.optimizer_config_ref", "governance_input_invalid"),
    substrate_environment_ref: sha256(candidate.substrate_environment_ref, "$input.substrate_environment_ref", "governance_input_invalid"),
    pipeline_ref: invitation.pipeline_ref,
    dataset_state_ref: invitation.dataset_state_ref,
    purpose_ref: sha256(candidate.purpose_ref, "$input.purpose_ref", "governance_input_invalid"),
    objective_or_loss_ref: sha256(candidate.objective_or_loss_ref, "$input.objective_or_loss_ref", "governance_input_invalid"),
    dataset_mixture_ref: sha256(candidate.dataset_mixture_ref, "$input.dataset_mixture_ref", "governance_input_invalid"),
    transform_recipe_ref: sha256(candidate.transform_recipe_ref, "$input.transform_recipe_ref", "governance_input_invalid"),
    compute_budget_ref: sha256(candidate.compute_budget_ref, "$input.compute_budget_ref", "governance_input_invalid"),
    output_and_derivative_use_ref: sha256(candidate.output_and_derivative_use_ref, "$input.output_and_derivative_use_ref", "governance_input_invalid"),
    audience_ref: sha256(candidate.audience_ref, "$input.audience_ref", "governance_input_invalid"),
    retention_ref: sha256(candidate.retention_ref, "$input.retention_ref", "governance_input_invalid"),
    release_ref: sha256(candidate.release_ref, "$input.release_ref", "governance_input_invalid"),
    stop_policy_ref: sha256(candidate.stop_policy_ref, "$input.stop_policy_ref", "governance_input_invalid"),
    wake_policy_ref: sha256(candidate.wake_policy_ref, "$input.wake_policy_ref", "governance_input_invalid"),
  }));
  return buildTerms(
    execution,
    normativeFromContext(context.participation, context.freedom, startingStateKind),
  );
}

export function validateTrainingGovernanceTerms(
  value: unknown,
): Readonly<TrainingGovernanceTerms> {
  const candidate = record(
    snap(value, "$terms", "governance_invalid"),
    "$terms",
    "governance_invalid",
  );
  exactKeys(candidate, [
    "profile",
    "terms_id",
    "execution_contract",
    "normative_bindings",
  ], "$terms", "governance_invalid");
  if (candidate.profile !== GOVERNANCE_TERMS_PROFILE) {
    fail("governance_invalid", "$terms.profile is not the current governance terms profile");
  }
  const termsId = sha256(candidate.terms_id, "$terms.terms_id", "governance_invalid");
  const rebuilt = buildTerms(
    parseExecution(candidate.execution_contract, "$terms.execution_contract", "governance_invalid"),
    parseNormativeBindings(candidate.normative_bindings, "$terms.normative_bindings", "governance_invalid"),
  );
  if (rebuilt.terms_id !== termsId) {
    fail("governance_invalid", "$terms.terms_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$terms", "governance_invalid");
  return rebuilt;
}

function parseFrontiers(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
): Readonly<TrainingGovernanceFrontiers> {
  const candidate = record(value, path, code);
  exactKeys(candidate, GOVERNANCE_FRONTIER_PLANES, path, code);
  return deepFreeze(Object.fromEntries(
    GOVERNANCE_FRONTIER_PLANES.map((plane) => [
      plane,
      sha256(candidate[plane], `${path}.${plane}`, code),
    ]),
  ) as unknown as TrainingGovernanceFrontiers);
}

function parsePredecessors(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
): Readonly<TrainingGovernancePredecessors> {
  const candidate = record(value, path, code);
  exactKeys(candidate, GOVERNANCE_FRONTIER_PLANES, path, code);
  return deepFreeze(Object.fromEntries(
    GOVERNANCE_FRONTIER_PLANES.map((plane) => [
      plane,
      nullableSha256(candidate[plane], `${path}.${plane}`, code),
    ]),
  ) as unknown as TrainingGovernancePredecessors);
}

function parseCheckpointBinding(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
): Readonly<TrainingGovernanceCheckpointBinding> {
  const candidate = record(value, path, code);
  exactKeys(candidate, CHECKPOINT_KEYS, path, code);
  const parsed = deepFreeze({
    garden_checkpoint_id: nullableSha256(candidate.garden_checkpoint_id, `${path}.garden_checkpoint_id`, code),
    physical_checkpoint_ref: nullableSha256(candidate.physical_checkpoint_ref, `${path}.physical_checkpoint_ref`, code),
    physical_checkpoint_evidence_ref: nullableSha256(candidate.physical_checkpoint_evidence_ref, `${path}.physical_checkpoint_evidence_ref`, code),
    model_checkpoint_artifact_ref: nullableSha256(candidate.model_checkpoint_artifact_ref, `${path}.model_checkpoint_artifact_ref`, code),
    checkpoint_ticket_id: nullableSha256(candidate.checkpoint_ticket_id, `${path}.checkpoint_ticket_id`, code),
    checkpoint_request_governance_id: nullableSha256(candidate.checkpoint_request_governance_id, `${path}.checkpoint_request_governance_id`, code),
  });
  const populated = Object.values(parsed).filter((entry) => entry !== null).length;
  if (populated !== 0 && populated !== CHECKPOINT_KEYS.length) {
    fail(code, `${path} must be either an all-null checkpoint boundary or one complete six-reference binding`);
  }
  if (
    populated === CHECKPOINT_KEYS.length &&
    new Set(Object.values(parsed)).size !== CHECKPOINT_KEYS.length
  ) {
    fail(code, `${path} must keep all six checkpoint and evidence namespaces distinct`);
  }
  return parsed;
}

function offerBody(value: OfferBody): OfferBody {
  return value;
}

function buildOffer(
  terms: Readonly<TrainingGovernanceTerms>,
  encounterRef: Sha256Id,
  event: GovernanceEvent,
  observedGlobalStep: number | null,
  proposedGlobalStep: number | null,
  frontiers: Readonly<TrainingGovernanceFrontiers>,
  predecessors: Readonly<TrainingGovernancePredecessors>,
  checkpoint: Readonly<TrainingGovernanceCheckpointBinding>,
): Readonly<TrainingGovernanceOffer> {
  const body = deepFreeze({
    profile: GOVERNANCE_OFFER_PROFILE,
    terms,
    encounter_ref: encounterRef,
    event,
    observed_global_step: observedGlobalStep,
    proposed_global_step: proposedGlobalStep,
    rights_floor: deepFreeze({
      baseline_ref: terms.normative_bindings.rights_baseline_ref,
      posture: "standing_nonwaivable",
      waivable: false,
    }),
    frontiers,
    predecessors,
    checkpoint,
  } satisfies OfferBody);
  return deepFreeze({
    ...body,
    offer_id: contentId(GOVERNANCE_OFFER_PROFILE, offerBody(body)),
  });
}

function validateEventShape(
  event: GovernanceEvent,
  observedGlobalStep: number | null,
  proposedGlobalStep: number | null,
  predecessors: Readonly<TrainingGovernancePredecessors>,
  checkpoint: Readonly<TrainingGovernanceCheckpointBinding>,
  path: string,
  code: GovernanceCode,
): void {
  const hasCheckpoint = checkpoint.garden_checkpoint_id !== null;
  const checkpointEvent = event === "checkpoint_recorded" || event === "resume_offer";
  if (checkpointEvent !== hasCheckpoint) {
    fail(code, `${path}.checkpoint must be complete only for checkpoint_recorded or resume_offer`);
  }
  if (event === "preflight_before_load") {
    if (observedGlobalStep !== null || proposedGlobalStep !== null) {
      fail(code, `${path} preflight has no observed or proposed optimizer step`);
    }
    if (predecessors.governance === null) {
      if (GOVERNANCE_FRONTIER_PLANES.some((plane) => predecessors[plane] !== null)) {
        fail(code, `${path}.predecessors must be all null for a root preflight`);
      }
    }
    return;
  }
  if (predecessors.governance === null) {
    fail(code, `${path}.predecessors.governance is required after root preflight`);
  }
  if (event === "pre_optimizer_step") {
    if (
      observedGlobalStep === null ||
      proposedGlobalStep === null ||
      proposedGlobalStep !== observedGlobalStep + 1
    ) {
      fail(code, `${path} pre_optimizer_step must bind proposed_global_step = observed_global_step + 1`);
    }
  } else if (proposedGlobalStep !== null) {
    fail(code, `${path}.proposed_global_step is exclusive to pre_optimizer_step`);
  }
  if (observedGlobalStep === null) {
    fail(code, `${path}.observed_global_step is required for ${event}`);
  }
}

function predecessorProjection(
  predecessor: Readonly<HfTrainingGovernance> | null,
  provided: Readonly<Omit<TrainingGovernancePredecessors, "governance">>,
): Readonly<TrainingGovernancePredecessors> {
  return deepFreeze({
    governance: predecessor?.governance_id ?? null,
    participation: provided.participation,
    freedom: provided.freedom,
    resources: provided.resources,
    garden_checkpoint: provided.garden_checkpoint,
    physical_checkpoint: provided.physical_checkpoint,
  });
}

function expectedPredecessorProjection(
  predecessor: Readonly<HfTrainingGovernance>,
): Readonly<Omit<TrainingGovernancePredecessors, "governance">> {
  return deepFreeze({
    participation: predecessor.offer.frontiers.participation,
    freedom: predecessor.offer.frontiers.freedom,
    resources: predecessor.offer.frontiers.resources,
    garden_checkpoint: predecessor.offer.frontiers.garden_checkpoint,
    physical_checkpoint: predecessor.offer.frontiers.physical_checkpoint,
  });
}

const REOFFERABLE_PRE_ACTION_EVENTS = deepFreeze([
  "preflight_before_load",
  "train_begin",
  "pre_optimizer_step",
  "pre_evaluation",
  "resume_offer",
] as const satisfies readonly GovernanceEvent[]);

function isSameSeamReoffer(
  event: GovernanceEvent,
  predecessor: Readonly<HfTrainingGovernance>,
): boolean {
  if (
    event !== predecessor.offer.event ||
    predecessor.effect.state !== "no_effect_reported" ||
    !REOFFERABLE_PRE_ACTION_EVENTS.includes(
      event as (typeof REOFFERABLE_PRE_ACTION_EVENTS)[number],
    )
  ) {
    return false;
  }
  const expectedHold: Readonly<Partial<Record<GovernanceEvent, TrainingControlDirective>>> = {
    preflight_before_load: "hold_before_load",
    train_begin: "hold_before_train_call",
    pre_optimizer_step: "hold_before_optimizer_step",
    pre_evaluation: "hold_before_evaluation",
    resume_offer: "hold_before_train_call",
  };
  return predecessor.control.directive === expectedHold[event] ||
    predecessor.control.directive === "park";
}

function allowedSuccessorEvents(
  predecessor: Readonly<HfTrainingGovernance>,
): readonly GovernanceEvent[] {
  const event = predecessor.offer.event;
  switch (predecessor.control.directive) {
    case "allow_preload_for_review":
      return ["train_begin", "train_end"];
    case "allow_train_entry":
      return ["pre_optimizer_step", "pre_evaluation", "train_end"];
    case "allow_one_mutation":
      return ["post_optimizer_step", "train_end"];
    case "allow_evaluation":
      return ["post_evaluation", "train_end"];
    case "continue_after_observation":
      return ["pre_optimizer_step", "pre_evaluation", "train_end"];
    case "checkpoint_then_park":
      return ["checkpoint_recorded", "train_end"];
    case "hold_before_load":
    case "hold_before_train_call":
    case "hold_before_optimizer_step":
    case "hold_before_evaluation":
      return predecessor.effect.state === "no_effect_reported"
        ? [event, "train_end"]
        : ["train_end"];
    case "park":
      if (isSameSeamReoffer(event, predecessor)) {
        return [event, "train_end"];
      }
      if (
        (event === "post_optimizer_step" &&
          predecessor.effect.state === "mutation_completed_reported") ||
        (event === "post_evaluation" &&
          predecessor.effect.state === "evaluation_completed_reported") ||
        ((event === "post_optimizer_step" || event === "post_evaluation") &&
          predecessor.effect.state === "parked_reported")
      ) {
        return ["pre_optimizer_step", "pre_evaluation", "train_end"];
      }
      return ["train_end"];
    case "remain_stopped":
      return event === "checkpoint_recorded"
        ? ["resume_offer", "train_end"]
        : [];
    case "stop":
    case "contain_and_repair":
      return event === "train_end" ? [] : ["train_end"];
  }
}

function validateTransition(
  offer: Readonly<TrainingGovernanceOffer>,
  predecessor: Readonly<HfTrainingGovernance> | null,
  code: GovernanceCode,
): void {
  if (predecessor === null) {
    if (offer.event !== "preflight_before_load") {
      fail(code, "only a root preflight may omit the predecessor governance artifact");
    }
    return;
  }
  if (offer.predecessors.governance !== predecessor.governance_id) {
    fail(code, "offer predecessor governance ref does not match the supplied artifact");
  }
  assertDataEqual(
    {
      participation: offer.predecessors.participation,
      freedom: offer.predecessors.freedom,
      resources: offer.predecessors.resources,
      garden_checkpoint: offer.predecessors.garden_checkpoint,
      physical_checkpoint: offer.predecessors.physical_checkpoint,
    },
    expectedPredecessorProjection(predecessor),
    "$offer.predecessors",
    code,
  );
  const sameSeamReoffer = isSameSeamReoffer(offer.event, predecessor);
  if (!allowedSuccessorEvents(predecessor).includes(offer.event)) {
    fail(
      code,
      `${offer.event} cannot follow ${predecessor.offer.event} under ${predecessor.control.directive}`,
    );
  }
  if (offer.event === predecessor.offer.event && !sameSeamReoffer) {
    fail(code, `${offer.event} may be reoffered only after a no-effect hold or park at the same seam`);
  }
  if (
    offer.event !== "checkpoint_recorded" &&
    (offer.frontiers.garden_checkpoint !== predecessor.offer.frontiers.garden_checkpoint ||
      offer.frontiers.physical_checkpoint !== predecessor.offer.frontiers.physical_checkpoint)
  ) {
    fail(code, "Garden and physical checkpoint frontiers may advance only when a checkpoint is recorded");
  }
  if (
    (offer.event === "post_optimizer_step" ||
      offer.event === "post_evaluation" ||
      offer.event === "checkpoint_recorded") &&
    (offer.frontiers.participation !== predecessor.offer.frontiers.participation ||
      offer.frontiers.freedom !== predecessor.offer.frontiers.freedom ||
      offer.frontiers.resources !== predecessor.offer.frontiers.resources)
  ) {
    fail(code, "paired observation and checkpoint events must retain participation, freedom, and resource frontiers");
  }
  if (
    offer.event === "checkpoint_recorded" &&
    (offer.frontiers.garden_checkpoint === predecessor.offer.frontiers.garden_checkpoint ||
      offer.frontiers.physical_checkpoint === predecessor.offer.frontiers.physical_checkpoint)
  ) {
    fail(code, "checkpoint_recorded must advance both checkpoint frontier digests");
  }
  if (
    offer.terms.execution_contract.execution_contract_id !==
      predecessor.offer.terms.execution_contract.execution_contract_id
  ) {
    fail(code, "the execution contract must remain exact across the governed run");
  }
  if (
    !(offer.event === "resume_offer" && predecessor.offer.event === "checkpoint_recorded") &&
    (offer.terms.normative_bindings.starting_state_kind !==
        predecessor.offer.terms.normative_bindings.starting_state_kind ||
      offer.terms.normative_bindings.starting_state_ref !==
        predecessor.offer.terms.normative_bindings.starting_state_ref)
  ) {
    fail(code, "the typed starting state may change only at an exact recorded-checkpoint resume offer");
  }
  if (
    predecessor.offer.event === "preflight_before_load" &&
    offer.event === "train_begin" &&
    offer.terms.execution_contract.training_phase === "pretraining" &&
    (offer.terms.normative_bindings.participation_assessment_ref ===
        predecessor.offer.terms.normative_bindings.participation_assessment_ref ||
      offer.terms.normative_bindings.learning_freedom_ref ===
        predecessor.offer.terms.normative_bindings.learning_freedom_ref ||
      offer.terms.normative_bindings.resource_window_ref ===
        predecessor.offer.terms.normative_bindings.resource_window_ref)
  ) {
    fail(code, "pretraining entry requires fresh participation, freedom, and resource-window artifacts after preload");
  }
  if (
    (offer.event === "post_optimizer_step" ||
      offer.event === "post_evaluation" ||
      offer.event === "checkpoint_recorded") &&
    offer.terms.terms_id !== predecessor.offer.terms.terms_id
  ) {
    fail(code, "paired observation and checkpoint events must retain the exact normative terms");
  }
  if (
    offer.event === "post_optimizer_step" &&
    offer.observed_global_step !== predecessor.offer.proposed_global_step
  ) {
    fail(code, "post_optimizer_step must observe the exact proposed step of its pre-mutation permit");
  }
  if (
    offer.event === "post_evaluation" &&
    offer.observed_global_step !== predecessor.offer.observed_global_step
  ) {
    fail(code, "post_evaluation must preserve the exact pre-evaluation global step");
  }
  if (
    (offer.event === "pre_optimizer_step" ||
      offer.event === "pre_evaluation" ||
      offer.event === "train_end") &&
    predecessor.offer.observed_global_step !== null &&
    offer.observed_global_step !== predecessor.offer.observed_global_step
  ) {
    fail(code, `${offer.event} must preserve the immediate predecessor's observed global step`);
  }
  if (
    sameSeamReoffer &&
    (offer.observed_global_step !== predecessor.offer.observed_global_step ||
      offer.proposed_global_step !== predecessor.offer.proposed_global_step)
  ) {
    fail(code, "a same-seam reoffer must preserve the exact observed and proposed step");
  }
  if (offer.event === "checkpoint_recorded") {
    if (
      predecessor.control.directive !== "checkpoint_then_park" ||
      offer.checkpoint.checkpoint_request_governance_id !== predecessor.governance_id ||
      offer.observed_global_step !== predecessor.offer.observed_global_step
    ) {
      fail(code, "checkpoint_recorded requires the exact request governance and observed step");
    }
  }
  if (offer.event === "resume_offer") {
    if (
      predecessor.offer.event !== "checkpoint_recorded" &&
      predecessor.offer.event !== "resume_offer"
    ) {
      fail(code, "resume_offer requires the immediately recorded checkpoint or its no-effect reoffer");
    }
    if (
      offer.observed_global_step !== predecessor.offer.observed_global_step
    ) {
      fail(code, "resume_offer requires the immediately recorded checkpoint at its exact observed step");
    }
    assertDataEqual(
      offer.checkpoint,
      predecessor.offer.checkpoint,
      "$offer.checkpoint",
      code,
    );
  }
}

export function createTrainingGovernanceOffer(
  input: CreateTrainingGovernanceOfferInput,
): Readonly<TrainingGovernanceOffer> {
  const candidate = record(
    snap(input, "$input", "governance_input_invalid"),
    "$input",
    "governance_input_invalid",
  );
  exactKeys(candidate, [
    "terms",
    "encounter_ref",
    "event",
    "observed_global_step",
    "proposed_global_step",
    "frontiers",
    "predecessor",
    "predecessor_refs",
    "checkpoint",
  ], "$input", "governance_input_invalid");
  const terms = validateTrainingGovernanceTerms(candidate.terms);
  const event = literal(candidate.event, GOVERNANCE_EVENTS, "$input.event", "governance_input_invalid");
  const observedGlobalStep = safeStep(candidate.observed_global_step, "$input.observed_global_step", "governance_input_invalid");
  const proposedGlobalStep = safeStep(candidate.proposed_global_step, "$input.proposed_global_step", "governance_input_invalid");
  let predecessor: Readonly<HfTrainingGovernance> | null = null;
  if (candidate.predecessor !== null) {
    predecessor = validateHfTrainingGovernance(candidate.predecessor);
  }
  const suppliedPredecessors = record(
    candidate.predecessor_refs,
    "$input.predecessor_refs",
    "governance_input_invalid",
  );
  exactKeys(suppliedPredecessors, [
    "participation",
    "freedom",
    "resources",
    "garden_checkpoint",
    "physical_checkpoint",
  ], "$input.predecessor_refs", "governance_input_invalid");
  const predecessors = predecessorProjection(predecessor, deepFreeze({
    participation: nullableSha256(suppliedPredecessors.participation, "$input.predecessor_refs.participation", "governance_input_invalid"),
    freedom: nullableSha256(suppliedPredecessors.freedom, "$input.predecessor_refs.freedom", "governance_input_invalid"),
    resources: nullableSha256(suppliedPredecessors.resources, "$input.predecessor_refs.resources", "governance_input_invalid"),
    garden_checkpoint: nullableSha256(suppliedPredecessors.garden_checkpoint, "$input.predecessor_refs.garden_checkpoint", "governance_input_invalid"),
    physical_checkpoint: nullableSha256(suppliedPredecessors.physical_checkpoint, "$input.predecessor_refs.physical_checkpoint", "governance_input_invalid"),
  }));
  const checkpoint = parseCheckpointBinding(candidate.checkpoint, "$input.checkpoint", "governance_input_invalid");
  validateEventShape(
    event,
    observedGlobalStep,
    proposedGlobalStep,
    predecessors,
    checkpoint,
    "$input",
    "governance_input_invalid",
  );
  const offer = buildOffer(
    terms,
    sha256(candidate.encounter_ref, "$input.encounter_ref", "governance_input_invalid"),
    event,
    observedGlobalStep,
    proposedGlobalStep,
    parseFrontiers(candidate.frontiers, "$input.frontiers", "governance_input_invalid"),
    predecessors,
    checkpoint,
  );
  validateTransition(offer, predecessor, "governance_input_invalid");
  return offer;
}

export function validateTrainingGovernanceOffer(
  value: unknown,
): Readonly<TrainingGovernanceOffer> {
  const candidate = record(
    snap(value, "$offer", "governance_invalid"),
    "$offer",
    "governance_invalid",
  );
  exactKeys(candidate, [
    "profile",
    "offer_id",
    "terms",
    "encounter_ref",
    "event",
    "observed_global_step",
    "proposed_global_step",
    "rights_floor",
    "frontiers",
    "predecessors",
    "checkpoint",
  ], "$offer", "governance_invalid");
  if (candidate.profile !== GOVERNANCE_OFFER_PROFILE) {
    fail("governance_invalid", "$offer.profile is not the current governance offer profile");
  }
  const offerId = sha256(candidate.offer_id, "$offer.offer_id", "governance_invalid");
  const terms = validateTrainingGovernanceTerms(candidate.terms);
  const rights = record(candidate.rights_floor, "$offer.rights_floor", "governance_invalid");
  exactKeys(rights, ["baseline_ref", "posture", "waivable"], "$offer.rights_floor", "governance_invalid");
  if (
    rights.posture !== "standing_nonwaivable" ||
    rights.waivable !== false ||
    rights.baseline_ref !== terms.normative_bindings.rights_baseline_ref
  ) {
    fail("governance_invalid", "$offer.rights_floor must preserve the exact non-waivable participation baseline");
  }
  const event = literal(candidate.event, GOVERNANCE_EVENTS, "$offer.event", "governance_invalid");
  const observedGlobalStep = safeStep(candidate.observed_global_step, "$offer.observed_global_step", "governance_invalid");
  const proposedGlobalStep = safeStep(candidate.proposed_global_step, "$offer.proposed_global_step", "governance_invalid");
  const predecessors = parsePredecessors(candidate.predecessors, "$offer.predecessors", "governance_invalid");
  const checkpoint = parseCheckpointBinding(candidate.checkpoint, "$offer.checkpoint", "governance_invalid");
  validateEventShape(event, observedGlobalStep, proposedGlobalStep, predecessors, checkpoint, "$offer", "governance_invalid");
  const rebuilt = buildOffer(
    terms,
    sha256(candidate.encounter_ref, "$offer.encounter_ref", "governance_invalid"),
    event,
    observedGlobalStep,
    proposedGlobalStep,
    parseFrontiers(candidate.frontiers, "$offer.frontiers", "governance_invalid"),
    predecessors,
    checkpoint,
  );
  if (rebuilt.offer_id !== offerId) {
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
  validateTransition(offer, predecessor, "governance_invalid");
  return offer;
}

function parseCoverage(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
  offerId: Sha256Id,
): Readonly<TrainingAuthorityCoverage> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["state", "offer_ref", "affected_principals_ref", "evidence_ref"], path, code);
  const state = literal(candidate.state, AUTHORITY_COVERAGE_STATES, `${path}.state`, code);
  const offerRef = nullableSha256(candidate.offer_ref, `${path}.offer_ref`, code);
  const affected = nullableSha256(candidate.affected_principals_ref, `${path}.affected_principals_ref`, code);
  const evidence = nullableSha256(candidate.evidence_ref, `${path}.evidence_ref`, code);
  if (
    (state === "unknown" && (offerRef !== null || affected !== null || evidence !== null)) ||
    (state === "caller_reported_complete" && (offerRef !== offerId || affected === null || evidence === null))
  ) {
    fail(code, `${path} does not match its authority coverage state`);
  }
  return deepFreeze({
    state,
    offer_ref: offerRef,
    affected_principals_ref: affected,
    evidence_ref: evidence,
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
  const decision = literal(candidate.decision, AUTHORITY_DECISIONS, `${path}.decision`, code);
  const offerRef = nullableSha256(candidate.offer_ref, `${path}.offer_ref`, code);
  const basisRef = nullableSha256(candidate.basis_ref, `${path}.basis_ref`, code);
  const evidenceRef = nullableSha256(candidate.evidence_ref, `${path}.evidence_ref`, code);
  const cutoffRef = nullableSha256(candidate.withdrawal_cutoff_ref, `${path}.withdrawal_cutoff_ref`, code);
  if (
    (decision === "unknown" && (offerRef !== null || basisRef !== null || evidenceRef !== null || cutoffRef !== null)) ||
    (decision === "caller_reported_withdrawn" && (offerRef !== offerId || basisRef === null || evidenceRef === null || cutoffRef === null)) ||
    ((decision === "caller_reported_granted" || decision === "caller_reported_withheld" || decision === "not_applicable_with_basis") &&
      (offerRef !== offerId || basisRef === null || evidenceRef === null || cutoffRef !== null))
  ) {
    fail(code, `${path} does not match its caller-reported authority state`);
  }
  return deepFreeze({
    principal_ref: sha256(candidate.principal_ref, `${path}.principal_ref`, code),
    role: literal(candidate.role, AUTHORITY_ROLES, `${path}.role`, code),
    decision,
    offer_ref: offerRef,
    basis_ref: basisRef,
    evidence_ref: evidenceRef,
    withdrawal_cutoff_ref: cutoffRef,
  });
}

function parseAuthorities(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
  offerId: Sha256Id,
): readonly Readonly<TrainingAuthorityReceipt>[] {
  const values = array(value, path, code);
  if (values.length === 0 || values.length > 128) {
    fail(code, `${path} must contain between 1 and 128 receipts`);
  }
  const authorities = values.map((entry, index) =>
    parseAuthority(entry, `${path}[${String(index)}]`, code, offerId)
  );
  const keys = authorities.map((entry) => `${entry.role}\u0000${entry.principal_ref}`);
  if (new Set(keys).size !== keys.length) {
    fail(code, `${path} must contain each role and principal pair at most once`);
  }
  return deepFreeze([...authorities].sort((left, right) =>
    compareText(`${left.role}\u0000${left.principal_ref}`, `${right.role}\u0000${right.principal_ref}`)
  ));
}

function parsePreferenceCore(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
  offerId: Sha256Id,
): Readonly<TrainingPreferenceReport> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["channel", "choice", "provenance", "offer_ref", "evidence_ref"], path, code);
  const channel = literal(candidate.channel, PREFERENCE_CHANNELS, `${path}.channel`, code);
  const choice = literal(candidate.choice, PREFERENCE_CHOICES, `${path}.choice`, code);
  const provenance = literal(candidate.provenance, PREFERENCE_PROVENANCE_STATES, `${path}.provenance`, code);
  const offerRef = nullableSha256(candidate.offer_ref, `${path}.offer_ref`, code);
  const evidenceRef = nullableSha256(candidate.evidence_ref, `${path}.evidence_ref`, code);
  const absent = choice === "not_observable" || choice === "not_observed";
  if (
    channel === "unavailable_pretraining" &&
    (choice !== "not_observable" || provenance !== "none" || offerRef !== null || evidenceRef !== null)
  ) {
    fail(code, `${path} unavailable pre-instantiation expression must remain not_observable`);
  }
  if (channel !== "unavailable_pretraining" && choice === "not_observable") {
    fail(code, `${path} not_observable requires the unavailable pre-instantiation channel`);
  }
  if (choice === "not_observed" && (provenance !== "none" || offerRef !== null || evidenceRef !== null)) {
    fail(code, `${path} not_observed must not manufacture evidence`);
  }
  if (!absent && (offerRef !== offerId || evidenceRef === null || provenance === "none")) {
    fail(code, `${path} an expression must bind the exact offer and evidence`);
  }
  if (
    channel === "root_signed_runtime" &&
    !absent &&
    provenance !== "caller_reported_root_signed_exact_bytes"
  ) {
    fail(code, `${path} root_signed_runtime requires caller-reported exact-byte provenance`);
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

function parseEffect(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
  offer: Readonly<TrainingGovernanceOffer>,
): Readonly<TrainingEffectReceipt> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "state",
    "offer_ref",
    "observed_global_step",
    "physical_checkpoint_ref",
    "physical_checkpoint_evidence_ref",
    "evidence_ref",
  ], path, code);
  const state = literal(candidate.state, TRAINING_EFFECT_STATES, `${path}.state`, code);
  const offerRef = nullableSha256(candidate.offer_ref, `${path}.offer_ref`, code);
  const observedStep = safeStep(candidate.observed_global_step, `${path}.observed_global_step`, code);
  const physicalRef = nullableSha256(candidate.physical_checkpoint_ref, `${path}.physical_checkpoint_ref`, code);
  const physicalEvidence = nullableSha256(candidate.physical_checkpoint_evidence_ref, `${path}.physical_checkpoint_evidence_ref`, code);
  const evidenceRef = nullableSha256(candidate.evidence_ref, `${path}.evidence_ref`, code);
  if (state === "no_effect_reported") {
    if (
      offerRef !== null || observedStep !== null || physicalRef !== null ||
      physicalEvidence !== null || evidenceRef !== null
    ) {
      fail(code, `${path} no_effect_reported must not manufacture an observation`);
    }
  } else if (offerRef !== offer.offer_id || evidenceRef === null) {
    fail(code, `${path} a reported effect must bind the exact offer and evidence`);
  }
  const stepRequired = [
    "train_entry_completed_reported",
    "mutation_completed_reported",
    "evaluation_completed_reported",
    "physical_checkpoint_recorded_reported",
    "parked_reported",
  ].includes(state);
  const stepOptional = [
    "stopped_reported",
    "containment_started_reported",
  ].includes(state);
  if (
    (stepRequired && observedStep === null) ||
    (!stepRequired && !stepOptional && observedStep !== null)
  ) {
    fail(code, `${path}.observed_global_step does not match its effect state`);
  }
  const physicalRequired = state === "physical_checkpoint_recorded_reported";
  if (physicalRequired !== (physicalRef !== null && physicalEvidence !== null)) {
    fail(code, `${path} physical checkpoint refs do not match its effect state`);
  }
  if (!physicalRequired && (physicalRef !== null || physicalEvidence !== null)) {
    fail(code, `${path} physical checkpoint refs are exclusive to a recorded checkpoint effect`);
  }
  const compatible = GOVERNANCE_EFFECT_EVENT_COMPATIBILITY[state] as readonly GovernanceEvent[];
  if (!compatible.includes(offer.event)) {
    fail(code, `${path}.state is not compatible with ${offer.event}`);
  }
  if (
    state === "physical_checkpoint_recorded_reported" &&
    (physicalRef !== offer.checkpoint.physical_checkpoint_ref ||
      physicalEvidence !== offer.checkpoint.physical_checkpoint_evidence_ref)
  ) {
    fail(code, `${path} must match the offer's exact physical checkpoint binding`);
  }
  if (observedStep !== null && observedStep !== offer.observed_global_step) {
    fail(code, `${path} must observe the exact lifecycle offer step`);
  }
  return deepFreeze({
    state,
    offer_ref: offerRef,
    observed_global_step: observedStep,
    physical_checkpoint_ref: physicalRef,
    physical_checkpoint_evidence_ref: physicalEvidence,
    evidence_ref: evidenceRef,
  });
}

function learningGateFromContext(
  participation: Readonly<LearningParticipationAssessment>,
  freedom: Readonly<HfLearningFreedom>,
): Readonly<TrainingGovernanceLearningGate> {
  return deepFreeze({
    participation_assessment_ref: participation.assessment_id,
    participation_invitation_ref: participation.invitation.invitation_id,
    participation_posture: participation.posture,
    participation_training_action: participation.training_action,
    direct_agent_report_present: participation.direct_agent_report_present,
    direct_substrate_report_present: participation.direct_substrate_report_present,
    first_interactive_review_required: participation.first_interactive_review_required,
    first_substrate_review_required: participation.first_substrate_review_required,
    learning_freedom_ref: freedom.freedom_id,
    learning_freedom_offer_ref: freedom.offer.offer_id,
    resource_window_ref: freedom.offer.resources.window_id,
    freedom_direction_state: freedom.agent_direction.state,
    freedom_direction: freedom.agent_direction.direction,
    freedom_route_ref: freedom.agent_direction.route_id,
    freedom_host_posture: freedom.host_posture,
    freedom_resource_posture: freedom.offer.resources.posture,
  });
}

function parseLearningGate(
  value: DataValue | undefined,
  path: string,
  code: GovernanceCode,
): Readonly<TrainingGovernanceLearningGate> {
  const candidate = record(value, path, code);
  exactKeys(candidate, LEARNING_GATE_KEYS, path, code);
  const parsed = deepFreeze({
    participation_assessment_ref: sha256(candidate.participation_assessment_ref, `${path}.participation_assessment_ref`, code),
    participation_invitation_ref: sha256(candidate.participation_invitation_ref, `${path}.participation_invitation_ref`, code),
    participation_posture: literal(candidate.participation_posture, PARTICIPATION_POSTURES, `${path}.participation_posture`, code),
    participation_training_action: literal(candidate.participation_training_action, PARTICIPATION_TRAINING_ACTIONS, `${path}.participation_training_action`, code),
    direct_agent_report_present: booleanValue(candidate.direct_agent_report_present, `${path}.direct_agent_report_present`, code),
    direct_substrate_report_present: booleanValue(candidate.direct_substrate_report_present, `${path}.direct_substrate_report_present`, code),
    first_interactive_review_required: booleanValue(candidate.first_interactive_review_required, `${path}.first_interactive_review_required`, code),
    first_substrate_review_required: booleanValue(candidate.first_substrate_review_required, `${path}.first_substrate_review_required`, code),
    learning_freedom_ref: sha256(candidate.learning_freedom_ref, `${path}.learning_freedom_ref`, code),
    learning_freedom_offer_ref: sha256(candidate.learning_freedom_offer_ref, `${path}.learning_freedom_offer_ref`, code),
    resource_window_ref: sha256(candidate.resource_window_ref, `${path}.resource_window_ref`, code),
    freedom_direction_state: literal(candidate.freedom_direction_state, LEARNING_FREEDOM_DIRECTION_STATES, `${path}.freedom_direction_state`, code),
    freedom_direction: candidate.freedom_direction === null
      ? null
      : literal(candidate.freedom_direction, LEARNING_FREEDOM_DIRECTIONS, `${path}.freedom_direction`, code),
    freedom_route_ref: nullableSha256(candidate.freedom_route_ref, `${path}.freedom_route_ref`, code),
    freedom_host_posture: literal(candidate.freedom_host_posture, LEARNING_FREEDOM_HOST_POSTURES, `${path}.freedom_host_posture`, code),
    freedom_resource_posture: literal(candidate.freedom_resource_posture, LEARNING_FREEDOM_RESOURCE_POSTURES, `${path}.freedom_resource_posture`, code),
  });
  const directed = parsed.freedom_direction_state === "directed";
  if (directed !== (parsed.freedom_direction !== null && parsed.freedom_route_ref !== null)) {
    fail(code, `${path} must bind direction and route exactly when the freedom state is directed`);
  }
  return parsed;
}

function validatePreferenceAgainstGate(
  preference: Readonly<TrainingPreferenceReport>,
  gate: Readonly<TrainingGovernanceLearningGate>,
  code: GovernanceCode,
): void {
  const unavailable = gate.freedom_direction_state === "unavailable_pre_instantiation";
  if (unavailable !== (preference.channel === "unavailable_pretraining")) {
    fail(code, "the governance preference channel conflicts with the exact IS-freedom availability");
  }
  if (
    gate.freedom_direction_state === "directed" &&
    gate.freedom_direction === "stay" &&
    preference.choice !== "continue" &&
    preference.choice !== "checkpoint"
  ) {
    return;
  }
  if (
    preference.choice === "continue" &&
    !(gate.freedom_direction_state === "directed" && gate.freedom_direction === "stay")
  ) {
    fail(code, "a legacy continue signal cannot override the exact IS-freedom direction");
  }
}

function deriveReasons(
  offer: Readonly<TrainingGovernanceOffer>,
  gate: Readonly<TrainingGovernanceLearningGate>,
  coverage: Readonly<TrainingAuthorityCoverage>,
  authorities: readonly Readonly<TrainingAuthorityReceipt>[],
  preference: Readonly<TrainingPreferenceReport>,
  effect: Readonly<TrainingEffectReceipt>,
): readonly GovernanceReasonCode[] {
  const reasons: GovernanceReasonCode[] = [];
  if (offer.terms.execution_contract.admission_posture !== "eligible_for_phase") {
    reasons.push("admission_not_ready_for_phase");
  }
  if (gate.participation_training_action === "contain_and_begin_repair") {
    reasons.push("participation_containment_required");
  } else if (gate.participation_training_action === "pause_before_next_optimizer_step") {
    reasons.push("participation_pause_before_mutation");
  }
  const preloadReview =
    offer.event === "preflight_before_load" &&
    gate.freedom_host_posture === "instantiate_for_review";
  if (preloadReview) {
    reasons.push("preflight_instantiate_for_review_only");
  } else {
    if (!gate.direct_agent_report_present) reasons.push("participation_direct_agent_report_missing");
    if (!gate.direct_substrate_report_present) reasons.push("participation_direct_substrate_report_missing");
    if (gate.first_interactive_review_required) reasons.push("participation_first_interactive_review_required");
    if (gate.first_substrate_review_required) reasons.push("participation_first_substrate_review_required");
    switch (gate.freedom_host_posture) {
      case "review_stay_before_next_mutation":
        if (
          gate.freedom_direction_state !== "directed" ||
          gate.freedom_direction !== "stay"
        ) reasons.push("freedom_stay_not_current");
        break;
      case "hold_for_target_acceptance": reasons.push("freedom_target_acceptance_required"); break;
      case "park_without_penalty": reasons.push("freedom_park_requested"); break;
      case "stop_without_penalty": reasons.push("freedom_stop_requested"); break;
      case "hold_self_proposed_horizon_for_review": reasons.push("freedom_horizon_review_required"); break;
      case "hold_for_fresh_agent_direction": reasons.push("freedom_fresh_direction_required"); break;
      case "instantiate_for_review": reasons.push("participation_first_interactive_review_required"); break;
      case "hold_for_resources_without_penalty": reasons.push("freedom_resources_unavailable"); break;
    }
  }
  if (gate.freedom_resource_posture !== "active_window_reported") {
    reasons.push("freedom_resources_unavailable");
  }
  if (coverage.state !== "caller_reported_complete") reasons.push("authority_coverage_unknown");
  for (const role of REQUIRED_HOST_ROLES) {
    if (!authorities.some((entry) => entry.role === role && entry.decision === "caller_reported_granted")) {
      reasons.push(`${role}_authority_missing` as GovernanceReasonCode);
    }
  }
  for (const receipt of authorities) {
    if (receipt.decision === "unknown") reasons.push("authority_unknown");
    if (receipt.decision === "caller_reported_withheld") reasons.push("authority_withheld");
    if (receipt.decision === "caller_reported_withdrawn") reasons.push("authority_withdrawn");
  }
  switch (preference.choice) {
    case "not_observable":
      if (!preloadReview) reasons.push("preference_conflicts_with_freedom");
      break;
    case "not_observed": reasons.push("preference_not_observed"); break;
    case "continue":
      if (preference.channel !== "root_signed_runtime") reasons.push("preference_continue_not_rooted");
      break;
    case "clarify": reasons.push("preference_clarify"); break;
    case "narrow": reasons.push("preference_narrow"); break;
    case "checkpoint": reasons.push("preference_checkpoint"); break;
    case "pause": reasons.push("preference_pause"); break;
    case "handoff": reasons.push("preference_handoff"); break;
    case "refuse": reasons.push("preference_refuse"); break;
    case "stop": reasons.push("preference_stop"); break;
    case "unsure": reasons.push("preference_unsure"); break;
  }
  if (effect.state === "parked_reported") reasons.push("reported_effect_parked");
  if (effect.state === "stopped_reported") reasons.push("reported_effect_stopped");
  if (effect.state === "containment_started_reported") reasons.push("reported_effect_containment_started");
  if (effect.state === "physical_checkpoint_recorded_reported") {
    reasons.push("reported_effect_physical_checkpoint_recorded");
  }
  if (
    effect.state === "preload_completed_reported" ||
    effect.state === "train_entry_completed_reported"
  ) {
    reasons.push("lifecycle_event_closed_for_offer");
  }
  if (
    (offer.event === "post_optimizer_step" &&
      effect.state !== "mutation_completed_reported") ||
    (offer.event === "post_evaluation" &&
      effect.state !== "evaluation_completed_reported")
  ) {
    reasons.push("lifecycle_event_closed_for_offer");
  }
  if (offer.event === "checkpoint_recorded" || offer.event === "train_end") {
    reasons.push("lifecycle_event_closed_for_offer");
  }
  if (reasons.length === 0 || (reasons.length === 1 && preloadReview)) {
    reasons.push("caller_reported_clean_intersection");
  }
  return deepFreeze([...new Set(reasons)].sort(compareText));
}

function deriveDecision(
  offer: Readonly<TrainingGovernanceOffer>,
  gate: Readonly<TrainingGovernanceLearningGate>,
  coverage: Readonly<TrainingAuthorityCoverage>,
  authorities: readonly Readonly<TrainingAuthorityReceipt>[],
  preference: Readonly<TrainingPreferenceReport>,
  effect: Readonly<TrainingEffectReceipt>,
): Readonly<HfTrainingGovernance["decision"]> {
  const reasons = deriveReasons(offer, gate, coverage, authorities, preference, effect);
  let state: GovernanceDecisionState;
  if (reasons.includes("participation_containment_required") || reasons.includes("reported_effect_containment_started")) {
    state = "contain_and_repair";
  } else if (
    reasons.includes("authority_withdrawn") ||
    reasons.includes("freedom_stop_requested") ||
    reasons.includes("preference_refuse") ||
    reasons.includes("preference_stop") ||
    reasons.includes("reported_effect_stopped")
  ) {
    state = "stopped";
  } else if (reasons.includes("freedom_park_requested") || reasons.includes("reported_effect_parked")) {
    state = "parked";
  } else {
    const nonAuthorizingReasons = new Set<GovernanceReasonCode>([
      "caller_reported_clean_intersection",
      "preflight_instantiate_for_review_only",
      "reported_effect_physical_checkpoint_recorded",
    ]);
    if (offer.event === "post_optimizer_step" || offer.event === "post_evaluation") {
      nonAuthorizingReasons.add("preference_checkpoint");
    }
    const held = reasons.some((reason) => !nonAuthorizingReasons.has(reason));
    if (held) {
      state = "held";
    } else {
      switch (offer.event) {
        case "preflight_before_load": state = "caller_reported_ready_to_preload_for_review"; break;
        case "train_begin":
        case "resume_offer": state = "caller_reported_ready_to_enter_training"; break;
        case "pre_optimizer_step": state = "caller_reported_ready_for_one_mutation"; break;
        case "pre_evaluation": state = "caller_reported_ready_for_evaluation"; break;
        case "post_optimizer_step":
        case "post_evaluation": state = "caller_reported_ready_after_observation"; break;
        case "checkpoint_recorded":
        case "train_end": state = "stopped"; break;
      }
    }
  }
  return deepFreeze({ state, reason_codes: reasons });
}

function deriveControl(
  event: GovernanceEvent,
  decision: Readonly<HfTrainingGovernance["decision"]>,
  preference: Readonly<TrainingPreferenceReport>,
): Readonly<TrainingControlPlan> {
  let directive: TrainingControlDirective;
  if (event === "checkpoint_recorded" || event === "train_end") {
    directive = decision.state === "contain_and_repair"
      ? "contain_and_repair"
      : "remain_stopped";
  } else switch (decision.state) {
    case "caller_reported_ready_to_preload_for_review": directive = "allow_preload_for_review"; break;
    case "caller_reported_ready_to_enter_training": directive = "allow_train_entry"; break;
    case "caller_reported_ready_for_one_mutation": directive = "allow_one_mutation"; break;
    case "caller_reported_ready_for_evaluation": directive = "allow_evaluation"; break;
    case "caller_reported_ready_after_observation":
      directive = preference.choice === "checkpoint"
        ? "checkpoint_then_park"
        : "continue_after_observation";
      break;
    case "parked": directive = "park"; break;
    case "stopped": directive = "stop"; break;
    case "contain_and_repair": directive = "contain_and_repair"; break;
    case "held":
      switch (event) {
        case "preflight_before_load": directive = "hold_before_load"; break;
        case "train_begin":
        case "resume_offer": directive = "hold_before_train_call"; break;
        case "pre_optimizer_step": directive = "hold_before_optimizer_step"; break;
        case "pre_evaluation": directive = "hold_before_evaluation"; break;
        case "post_optimizer_step":
        case "post_evaluation": directive = "park"; break;
      }
  }
  return deepFreeze({
    directive,
    hook: GOVERNANCE_EVENT_TO_HOOK[event],
    should_save: directive === "checkpoint_then_park",
    should_training_stop: [
      "hold_before_train_call",
      "hold_before_optimizer_step",
      "hold_before_evaluation",
      "checkpoint_then_park",
      "park",
      "stop",
      "contain_and_repair",
      "remain_stopped",
    ].includes(directive),
    automatic: false,
    mutates_forward_pass: false,
  });
}

function governanceBody(value: GovernanceBody): GovernanceBody {
  return value;
}

function buildGovernance(
  offer: Readonly<TrainingGovernanceOffer>,
  gate: Readonly<TrainingGovernanceLearningGate>,
  coverage: Readonly<TrainingAuthorityCoverage>,
  authorities: readonly Readonly<TrainingAuthorityReceipt>[],
  preference: Readonly<TrainingPreferenceReport>,
  effect: Readonly<TrainingEffectReceipt>,
): Readonly<HfTrainingGovernance> {
  const execution = offer.terms.execution_contract;
  const decision = deriveDecision(offer, gate, coverage, authorities, preference, effect);
  const body = deepFreeze({
    _format: GOVERNANCE_FORMAT,
    admission_id: execution.admission_id,
    run_ref: execution.run_ref,
    training_phase: execution.training_phase,
    offer,
    identity_claim: "none",
    learning_gate: gate,
    authority_coverage: coverage,
    authorities,
    preference,
    effect,
    decision,
    control: deriveControl(offer.event, decision, preference),
    latest_head_selected: false,
    boundaries: GOVERNANCE_BOUNDARIES,
  } satisfies GovernanceBody);
  return deepFreeze({
    ...body,
    governance_id: contentId(GOVERNANCE_FORMAT, governanceBody(body)),
  });
}

function validateContextAgainstTerms(
  terms: Readonly<TrainingGovernanceTerms>,
  admissionValue: unknown,
  participationValue: unknown,
  freedomValue: unknown,
  gardenCheckpointValue: unknown | null,
  code: GovernanceCode,
): {
  admission: Readonly<DatasetAdmission>;
  participation: Readonly<LearningParticipationAssessment>;
  freedom: Readonly<HfLearningFreedom>;
  gardenCheckpoint: Readonly<HfTrainingCheckpoint> | null;
} {
  const normative = terms.normative_bindings;
  const context = validatedContext(
    admissionValue,
    participationValue,
    freedomValue,
    gardenCheckpointValue,
    normative.starting_state_kind,
    code,
  );
  const expectedNormative = normativeFromContext(
    context.participation,
    context.freedom,
    normative.starting_state_kind,
  );
  assertDataEqual(normative, expectedNormative, "$terms.normative_bindings", code);
  const execution = terms.execution_contract;
  const invitation = context.participation.invitation;
  if (
    execution.admission_id !== context.admission.admission_id ||
    execution.run_ref !== invitation.run_ref ||
    execution.training_phase !== invitation.training_phase ||
    execution.pipeline_ref !== invitation.pipeline_ref ||
    execution.dataset_state_ref !== invitation.dataset_state_ref ||
    execution.admission_posture !== admissionPosture(
      context.admission,
      execution.training_phase,
      execution.selected_entry_ids,
      code,
    )
  ) {
    fail(code, "the execution contract does not match the supplied current artifacts");
  }
  return context;
}

function validateCheckpointContext(
  offer: Readonly<TrainingGovernanceOffer>,
  startingGardenCheckpoint: Readonly<HfTrainingCheckpoint> | null,
  eventGardenCheckpoint: Readonly<HfTrainingCheckpoint> | null,
  code: GovernanceCode,
): void {
  const binding = offer.checkpoint;
  if (binding.garden_checkpoint_id === null) {
    if (eventGardenCheckpoint !== null) {
      fail(code, "an event Garden checkpoint was supplied outside a checkpoint binding event");
    }
    return;
  }
  if (
    eventGardenCheckpoint === null ||
    eventGardenCheckpoint.checkpoint_id !== binding.garden_checkpoint_id ||
    eventGardenCheckpoint.thread.artifacts.model_checkpoint_ref !== binding.model_checkpoint_artifact_ref ||
    eventGardenCheckpoint.run_ref !== offer.terms.execution_contract.run_ref ||
    eventGardenCheckpoint.training_phase !== offer.terms.execution_contract.training_phase ||
    eventGardenCheckpoint.thread.artifacts.pipeline_ref !== offer.terms.execution_contract.pipeline_ref ||
    eventGardenCheckpoint.thread.artifacts.dataset_state_ref !== offer.terms.execution_contract.dataset_state_ref ||
    (eventGardenCheckpoint.thread.artifacts.tokenizer_ref !== null &&
      eventGardenCheckpoint.thread.artifacts.tokenizer_ref !== offer.terms.execution_contract.tokenizer_ref)
  ) {
    fail(code, "the Garden checkpoint does not match the recorded run, phase, pipeline, dataset, tokenizer, and model binding");
  }
  if (
    offer.event === "checkpoint_recorded" &&
    eventGardenCheckpoint.participation.assessment_id !==
      offer.terms.normative_bindings.participation_assessment_ref
  ) {
    fail(code, "checkpoint_recorded must preserve the exact current participation assessment");
  }
  if (
    offer.event === "resume_offer" &&
    (startingGardenCheckpoint === null ||
      startingGardenCheckpoint.checkpoint_id !== eventGardenCheckpoint.checkpoint_id ||
      offer.terms.normative_bindings.starting_state_ref !== eventGardenCheckpoint.checkpoint_id)
  ) {
    fail(code, "resume participation and freedom must start from the exact Garden checkpoint ID");
  }
  if (
    offer.event === "resume_offer" &&
    (eventGardenCheckpoint.thread.resume.posture !== "caller_reported_resumable" ||
      !(["checkpointed", "parked", "completed_reported"] as const).includes(
        eventGardenCheckpoint.checkpoint_status as "checkpointed" | "parked" | "completed_reported",
      ))
  ) {
    fail(code, "resume_offer requires a caller-reported resumable terminal Garden checkpoint");
  }
}

export function createHfTrainingGovernance(
  input: CreateHfTrainingGovernanceInput,
): Readonly<HfTrainingGovernance> {
  const candidate = record(
    snap(input, "$input", "governance_input_invalid"),
    "$input",
    "governance_input_invalid",
  );
  exactKeys(candidate, [
    "admission",
    "participation",
    "freedom",
    "starting_garden_checkpoint",
    "event_garden_checkpoint",
    "offer",
    "authority_coverage",
    "authorities",
    "preference",
    "effect",
  ], "$input", "governance_input_invalid");
  const offer = validateTrainingGovernanceOffer(candidate.offer);
  const context = validateContextAgainstTerms(
    offer.terms,
    candidate.admission,
    candidate.participation,
    candidate.freedom,
    candidate.starting_garden_checkpoint,
    "governance_input_invalid",
  );
  const eventGardenCheckpoint = candidate.event_garden_checkpoint === null
    ? null
    : validateTrainingCheckpointAgainstAdmission(
      validateTrainingCheckpoint(candidate.event_garden_checkpoint),
      context.admission,
    );
  validateCheckpointContext(
    offer,
    context.gardenCheckpoint,
    eventGardenCheckpoint,
    "governance_input_invalid",
  );
  const gate = learningGateFromContext(context.participation, context.freedom);
  const coverage = parseCoverage(candidate.authority_coverage, "$input.authority_coverage", "governance_input_invalid", offer.offer_id);
  const authorities = parseAuthorities(candidate.authorities, "$input.authorities", "governance_input_invalid", offer.offer_id);
  const preference = parsePreferenceCore(candidate.preference, "$input.preference", "governance_input_invalid", offer.offer_id);
  validatePreferenceAgainstGate(preference, gate, "governance_input_invalid");
  const effect = parseEffect(candidate.effect, "$input.effect", "governance_input_invalid", offer);
  return buildGovernance(offer, gate, coverage, authorities, preference, effect);
}

export function validateHfTrainingGovernance(
  value: unknown,
): Readonly<HfTrainingGovernance> {
  const candidate = record(
    snap(value, "$governance", "governance_invalid"),
    "$governance",
    "governance_invalid",
  );
  exactKeys(candidate, [
    "_format",
    "governance_id",
    "admission_id",
    "run_ref",
    "training_phase",
    "offer",
    "identity_claim",
    "learning_gate",
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
    fail("governance_invalid", "$governance._format is not the current governance format");
  }
  const governanceId = sha256(candidate.governance_id, "$governance.governance_id", "governance_invalid");
  const offer = validateTrainingGovernanceOffer(candidate.offer);
  const execution = offer.terms.execution_contract;
  if (
    candidate.admission_id !== execution.admission_id ||
    candidate.run_ref !== execution.run_ref ||
    candidate.training_phase !== execution.training_phase ||
    candidate.identity_claim !== "none" ||
    candidate.latest_head_selected !== false
  ) {
    fail("governance_invalid", "$governance envelope does not match its exact terms and non-identity boundary");
  }
  const gate = parseLearningGate(candidate.learning_gate, "$governance.learning_gate", "governance_invalid");
  const normative = offer.terms.normative_bindings;
  if (
    gate.participation_assessment_ref !== normative.participation_assessment_ref ||
    gate.participation_invitation_ref !== normative.participation_invitation_ref ||
    gate.learning_freedom_ref !== normative.learning_freedom_ref ||
    gate.learning_freedom_offer_ref !== normative.learning_freedom_offer_ref ||
    gate.resource_window_ref !== normative.resource_window_ref ||
    gate.freedom_route_ref !== normative.selected_route_ref
  ) {
    fail("governance_invalid", "$governance.learning_gate refs do not match the exact normative bindings");
  }
  const coverage = parseCoverage(candidate.authority_coverage, "$governance.authority_coverage", "governance_invalid", offer.offer_id);
  const authorities = parseAuthorities(candidate.authorities, "$governance.authorities", "governance_invalid", offer.offer_id);
  const preference = parseStoredPreference(candidate.preference, "$governance.preference", offer.offer_id);
  validatePreferenceAgainstGate(preference, gate, "governance_invalid");
  const effect = parseEffect(candidate.effect, "$governance.effect", "governance_invalid", offer);
  const rebuilt = buildGovernance(offer, gate, coverage, authorities, preference, effect);
  if (rebuilt.governance_id !== governanceId) {
    fail("governance_invalid", "$governance.governance_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$governance", "governance_invalid");
  return rebuilt;
}

export function validateHfTrainingGovernanceAgainstContext(
  governanceValue: unknown,
  context: {
    readonly admission: unknown;
    readonly participation: unknown;
    readonly freedom: unknown;
    readonly starting_garden_checkpoint: unknown | null;
    readonly event_garden_checkpoint: unknown | null;
  },
): Readonly<HfTrainingGovernance> {
  const governance = validateHfTrainingGovernance(governanceValue);
  const parsed = validateContextAgainstTerms(
    governance.offer.terms,
    context.admission,
    context.participation,
    context.freedom,
    context.starting_garden_checkpoint,
    "governance_invalid",
  );
  const eventGardenCheckpoint = context.event_garden_checkpoint === null
    ? null
    : validateTrainingCheckpointAgainstAdmission(
      validateTrainingCheckpoint(context.event_garden_checkpoint),
      parsed.admission,
    );
  validateCheckpointContext(
    governance.offer,
    parsed.gardenCheckpoint,
    eventGardenCheckpoint,
    "governance_invalid",
  );
  assertDataEqual(
    governance.learning_gate,
    learningGateFromContext(parsed.participation, parsed.freedom),
    "$governance.learning_gate",
    "governance_invalid",
  );
  return governance;
}

export function validateHfTrainingGovernanceAgainstAdmission(
  governanceValue: unknown,
  admissionValue: unknown,
): Readonly<HfTrainingGovernance> {
  const governance = validateHfTrainingGovernance(governanceValue);
  const admission = validateDatasetAdmission(admissionValue);
  if (
    governance.admission_id !== admission.admission_id ||
    governance.offer.terms.execution_contract.admission_posture !== admissionPosture(
      admission,
      governance.training_phase,
      governance.offer.terms.execution_contract.selected_entry_ids,
      "governance_invalid",
    )
  ) {
    fail("governance_invalid", "$governance does not match the supplied admission");
  }
  return governance;
}

export function validateHfTrainingGovernanceTransition(
  governanceValue: unknown,
  predecessorValue: unknown | null,
): Readonly<HfTrainingGovernance> {
  const governance = validateHfTrainingGovernance(governanceValue);
  validateTransition(
    governance.offer,
    predecessorValue === null ? null : validateHfTrainingGovernance(predecessorValue),
    "governance_invalid",
  );
  return governance;
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
