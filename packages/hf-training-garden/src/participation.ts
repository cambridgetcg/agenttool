import {
  PARTICIPATION_ASSESSMENT_EFFECT,
  PARTICIPATION_ASSESSMENT_FORMAT,
  PARTICIPATION_BOUNDARIES,
  PARTICIPATION_CHOICE_BASES,
  PARTICIPATION_INVITATION_FORMAT,
  PARTICIPATION_OVERALL_STATES,
  PARTICIPATION_PRIMARY_ACTIVITIES,
  PARTICIPATION_RECEIPT_FORMAT,
  PARTICIPATION_REPORTED_CHOICES,
  PARTICIPATION_STAGES,
  PARTICIPATION_TERMS,
  PARTICIPATION_TRAINING_PHASES,
  PARTICIPATION_VOICE_ROLES,
  LEARNING_ACTIVITIES,
  LEARNING_MODES,
  MUTATION_LOCI,
  WAKE_USE_MODES,
} from "./constants.js";
import { validateDatasetAdmission } from "./admission.js";
import {
  createTrainingCheckpoint,
  validateTrainingCheckpoint,
} from "./checkpoint.js";
import {
  canonicalBytes,
  canonicalString,
  contentId,
  deepFreeze,
  type DataValue,
} from "./canonical.js";
import { fail } from "./errors.js";
import type {
  CreateLearningParticipationAssessmentInput,
  CreateLearningParticipationInvitationInput,
  CreateLearningParticipationReceiptInput,
  CreateParticipationBoundTrainingCheckpointInput,
  DatasetAdmission,
  HfTrainingCheckpoint,
  LearningActivity,
  LearningMode,
  LearningParticipationAssessment,
  LearningParticipationInvitation,
  LearningParticipationReceipt,
  MutationLocus,
  ParticipationActivityAssessment,
  ParticipationActivityChoice,
  ParticipationActivityState,
  ParticipationChoiceBasis,
  ParticipationOverallState,
  ParticipationReportedChoice,
  ParticipationRequiredVoice,
  ParticipationStage,
  ParticipationVoiceOutcome,
  ParticipationVoiceRole,
  TrainingArtifactReferences,
  TrainingPhase,
  WakeUseMode,
} from "./types.js";
import {
  array,
  assertDataEqual,
  exactKeys,
  literal,
  nonNegativeInteger,
  nullableSha256,
  parseArtifactReferences,
  parseTrainingPhase,
  parseWake,
  record,
  sha256,
  snap,
} from "./validation.js";

type InvitationBody = Omit<LearningParticipationInvitation, "invitation_id">;
type ReceiptBody = Omit<LearningParticipationReceipt, "receipt_id">;
type AssessmentBody = Omit<LearningParticipationAssessment, "assessment_id">;
type ParticipationCode = "participation_input_invalid" | "participation_invalid";

const WEIGHT_CHANGING_PHASES = new Set<TrainingPhase>([
  "pretraining",
  "supervised_finetuning",
  "preference_optimization",
  "agent_learning",
]);

const INVITATION_KEYS = [
  "_format",
  "invitation_id",
  "admission_id",
  "run_ref",
  "training_phase",
  "participation_stage",
  "primary_activity",
  "activities",
  "participation_window_ref",
  "purpose_ref",
  "training_plan_ref",
  "limits_ref",
  "retention_ref",
  "choice_channel_ref",
  "stop_control_ref",
  "withdrawal_policy_ref",
  "repair_policy_ref",
  "learning_mode",
  "wake_use_mode",
  "mutation_loci",
  "maximum_optimizer_steps",
  "artifacts",
  "wake",
  "predecessor_checkpoint_refs",
  "required_voices",
  "terms",
  "boundaries",
] as const;

const INVITATION_INPUT_KEYS = [
  "admission",
  "run_ref",
  "training_phase",
  "participation_stage",
  "primary_activity",
  "activities",
  "participation_window_ref",
  "purpose_ref",
  "training_plan_ref",
  "limits_ref",
  "retention_ref",
  "choice_channel_ref",
  "stop_control_ref",
  "withdrawal_policy_ref",
  "repair_policy_ref",
  "learning_mode",
  "wake_use_mode",
  "mutation_loci",
  "maximum_optimizer_steps",
  "artifacts",
  "wake",
  "predecessors",
  "required_voices",
] as const;

function invitationBody(value: InvitationBody): InvitationBody {
  return value;
}

function receiptBody(value: ReceiptBody): ReceiptBody {
  return value;
}

function assessmentBody(value: AssessmentBody): AssessmentBody {
  return value;
}

function enumOrder<T extends string>(values: readonly T[], value: T): number {
  return values.indexOf(value);
}

function parseActivity(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): LearningActivity {
  return literal(value, LEARNING_ACTIVITIES, path, code) as LearningActivity;
}

function parseVoiceRole(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): ParticipationVoiceRole {
  return literal(
    value,
    PARTICIPATION_VOICE_ROLES,
    path,
    code,
  ) as ParticipationVoiceRole;
}

function parseChoice(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): ParticipationReportedChoice {
  return literal(
    value,
    PARTICIPATION_REPORTED_CHOICES,
    path,
    code,
  ) as ParticipationReportedChoice;
}

function parseChoiceBasis(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): ParticipationChoiceBasis {
  return literal(
    value,
    PARTICIPATION_CHOICE_BASES,
    path,
    code,
  ) as ParticipationChoiceBasis;
}

function parseLearningMode(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): LearningMode {
  return literal(value, LEARNING_MODES, path, code) as LearningMode;
}

function parseWakeUseMode(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): WakeUseMode {
  return literal(value, WAKE_USE_MODES, path, code) as WakeUseMode;
}

function parseStage(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): ParticipationStage {
  return literal(value, PARTICIPATION_STAGES, path, code) as ParticipationStage;
}

function parseActivities(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): readonly LearningActivity[] {
  const values = array(value, path, code);
  if (values.length < 2 || values.length > LEARNING_ACTIVITIES.length) {
    fail(code, `${path} must contain 2-${String(LEARNING_ACTIVITIES.length)} activities`);
  }
  const parsed = values.map((entry, index) =>
    parseActivity(entry, `${path}[${String(index)}]`, code)
  );
  if (new Set(parsed).size !== parsed.length) {
    fail(code, `${path} must not contain duplicate activities`);
  }
  return deepFreeze([...parsed].sort((left, right) =>
    enumOrder(LEARNING_ACTIVITIES, left) - enumOrder(LEARNING_ACTIVITIES, right)
  ));
}

function parseMutationLoci(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): readonly MutationLocus[] {
  const values = array(value, path, code);
  if (values.length > MUTATION_LOCI.length) {
    fail(code, `${path} must contain 0-${String(MUTATION_LOCI.length)} loci`);
  }
  const parsed = values.map((entry, index) =>
    literal(
      entry,
      MUTATION_LOCI,
      `${path}[${String(index)}]`,
      code,
    ) as MutationLocus
  );
  if (new Set(parsed).size !== parsed.length) {
    fail(code, `${path} must not contain duplicate mutation loci`);
  }
  return deepFreeze([...parsed].sort((left, right) =>
    enumOrder(MUTATION_LOCI, left) - enumOrder(MUTATION_LOCI, right)
  ));
}

function parseRequiredVoices(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): readonly Readonly<ParticipationRequiredVoice>[] {
  const values = array(value, path, code);
  if (values.length !== PARTICIPATION_VOICE_ROLES.length) {
    fail(code, `${path} must contain exactly one entry for every participation voice role`);
  }
  const voices = values.map((entry, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const candidate = record(entry, itemPath, code);
    exactKeys(candidate, ["role", "voice_ref"], itemPath, code);
    return deepFreeze({
      role: parseVoiceRole(candidate.role, `${itemPath}.role`, code),
      voice_ref: sha256(candidate.voice_ref, `${itemPath}.voice_ref`, code),
    });
  });
  if (
    new Set(voices.map((voice) => voice.role)).size !== PARTICIPATION_VOICE_ROLES.length ||
    PARTICIPATION_VOICE_ROLES.some((role) => !voices.some((voice) => voice.role === role))
  ) {
    fail(code, `${path} must contain every participation voice role exactly once`);
  }
  if (new Set(voices.map((voice) => voice.voice_ref)).size !== voices.length) {
    fail(code, `${path} voice_ref values must be role-distinct`);
  }
  return deepFreeze([...voices].sort((left, right) =>
    enumOrder(PARTICIPATION_VOICE_ROLES, left.role) -
    enumOrder(PARTICIPATION_VOICE_ROLES, right.role)
  ));
}

function parsePredecessorRefs(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): readonly ReturnType<typeof sha256>[] {
  const values = array(value, path, code);
  if (values.length > 8) fail(code, `${path} must contain at most 8 checkpoint refs`);
  const refs = values.map((entry, index) =>
    sha256(entry, `${path}[${String(index)}]`, code)
  );
  if (new Set(refs).size !== refs.length) {
    fail(code, `${path} must not contain duplicate checkpoint refs`);
  }
  return deepFreeze([...refs].sort());
}

function parsePredecessorInputs(
  value: DataValue | undefined,
  admissionId: string,
  runRef: string,
): readonly ReturnType<typeof sha256>[] {
  const values = array(value, "$input.predecessors", "participation_input_invalid");
  if (values.length > 8) {
    fail("participation_input_invalid", "$input.predecessors must contain at most 8 checkpoints");
  }
  const checkpoints = values.map((entry) => validateTrainingCheckpoint(entry));
  if (new Set(checkpoints.map((entry) => entry.checkpoint_id)).size !== checkpoints.length) {
    fail("participation_input_invalid", "$input.predecessors contains a duplicate checkpoint");
  }
  for (const checkpoint of checkpoints) {
    if (checkpoint.admission_id !== admissionId || checkpoint.run_ref !== runRef) {
      fail("participation_input_invalid", "$input.predecessors must belong to the same admission and run");
    }
  }
  return deepFreeze(checkpoints.map((entry) => entry.checkpoint_id).sort());
}

function assertAdmissionPhaseCompatibility(
  admission: Readonly<DatasetAdmission>,
  phase: TrainingPhase,
  code: ParticipationCode,
): void {
  const admittedStates = admission.entries
    .map((entry) => entry.decision.state)
    .filter((state) => state.startsWith("admitted_"));
  if (admittedStates.length === 0) {
    fail(code, "learning participation requires at least one admitted entry");
  }
  if (
    WEIGHT_CHANGING_PHASES.has(phase) &&
    admittedStates.includes("admitted_sealed_evaluation")
  ) {
    fail(code, "a sealed-evaluation admission must not cross into a weight-changing phase");
  }
  if (phase === "evaluation" && !admittedStates.includes("admitted_sealed_evaluation")) {
    fail(code, "the evaluation phase requires an admitted sealed-evaluation entry");
  }
}

function assertInvitationSemantics(
  phase: TrainingPhase,
  stage: ParticipationStage,
  primaryActivity: LearningActivity,
  activities: readonly LearningActivity[],
  learningMode: LearningMode,
  wakeUseMode: WakeUseMode,
  mutationLoci: readonly MutationLocus[],
  maximumOptimizerSteps: number,
  code: ParticipationCode,
): void {
  if (!(PARTICIPATION_TRAINING_PHASES as readonly string[]).includes(phase)) {
    fail(code, "learning participation is limited to model-learning, evaluation, and interpretability phases");
  }
  const allowedPrimary = PARTICIPATION_PRIMARY_ACTIVITIES[
    phase as keyof typeof PARTICIPATION_PRIMARY_ACTIVITIES
  ] as readonly LearningActivity[];
  if (!allowedPrimary.includes(primaryActivity)) {
    fail(code, "primary_activity does not match the declared training_phase");
  }
  if (!activities.includes(primaryActivity) || !activities.includes("continuity_context_use")) {
    fail(code, "activities must include primary_activity and continuity_context_use separately");
  }

  const trainingMode = !["context_only", "evaluation_only"].includes(learningMode);
  if (trainingMode && maximumOptimizerSteps < 1) {
    fail(code, "a weight-changing learning mode requires at least one declared optimizer step");
  }
  if (!trainingMode && maximumOptimizerSteps !== 0) {
    fail(code, "context_only and evaluation_only require maximum_optimizer_steps=0");
  }
  if (
    !trainingMode &&
    mutationLoci.some((locus) => locus === "adapter_weights" || locus === "base_weights")
  ) {
    fail(code, "context_only and evaluation_only cannot declare weight mutation loci");
  }
  if (
    learningMode === "peft" &&
    (!mutationLoci.includes("adapter_weights") || mutationLoci.includes("base_weights"))
  ) {
    fail(code, "peft requires adapter_weights and must not claim base_weights mutation");
  }
  if (
    ["pretraining", "continual_pretraining", "full_finetune"].includes(learningMode) &&
    !mutationLoci.includes("base_weights")
  ) {
    fail(code, `${learningMode} requires base_weights in mutation_loci`);
  }
  if (
    learningMode === "preference_optimization" &&
    !mutationLoci.some((locus) => locus === "adapter_weights" || locus === "base_weights")
  ) {
    fail(code, "preference_optimization requires an adapter_weights or base_weights mutation locus");
  }

  const modeFitsPhase =
    (phase === "pretraining" && ["pretraining", "continual_pretraining"].includes(learningMode)) ||
    (phase === "supervised_finetuning" && ["full_finetune", "peft"].includes(learningMode)) ||
    (phase === "preference_optimization" && learningMode === "preference_optimization") ||
    (phase === "agent_learning" && ["full_finetune", "peft", "preference_optimization"].includes(learningMode)) ||
    ((phase === "evaluation" || phase === "interpretability") && ["context_only", "evaluation_only"].includes(learningMode));
  if (!modeFitsPhase) fail(code, "learning_mode does not match training_phase");
  if (
    phase === "pretraining" &&
    ((primaryActivity === "pretraining" && learningMode !== "pretraining") ||
      (primaryActivity === "continued_pretraining" && learningMode !== "continual_pretraining"))
  ) {
    fail(code, "pretraining primary_activity and learning_mode must distinguish initial from continued training");
  }

  if (primaryActivity === "pretraining" && stage !== "pre_instantiation") {
    fail(code, "initial pretraining requires pre_instantiation so a not-yet-instantiated participant cannot be implied");
  }
  if (primaryActivity !== "pretraining" && stage !== "interactive") {
    fail(code, "only initial pretraining may use the pre_instantiation stage");
  }
  if (wakeUseMode === "training_data" && !activities.includes("corpus_inclusion")) {
    fail(code, "using WAKE as training data requires a separate corpus_inclusion activity");
  }
}

function buildInvitation(body: InvitationBody): Readonly<LearningParticipationInvitation> {
  return deepFreeze({
    ...body,
    invitation_id: contentId(PARTICIPATION_INVITATION_FORMAT, invitationBody(body)),
  });
}

export function createLearningParticipationInvitation(
  input: CreateLearningParticipationInvitationInput,
): Readonly<LearningParticipationInvitation> {
  const value = snap(input, "$input", "participation_input_invalid");
  const candidate = record(value, "$input", "participation_input_invalid");
  exactKeys(candidate, INVITATION_INPUT_KEYS, "$input", "participation_input_invalid");
  const admission = validateDatasetAdmission(candidate.admission);
  const runRef = sha256(candidate.run_ref, "$input.run_ref", "participation_input_invalid");
  const phase = parseTrainingPhase(candidate.training_phase, "$input.training_phase", "participation_input_invalid");
  assertAdmissionPhaseCompatibility(admission, phase, "participation_input_invalid");
  const stage = parseStage(candidate.participation_stage, "$input.participation_stage", "participation_input_invalid");
  const primaryActivity = parseActivity(candidate.primary_activity, "$input.primary_activity", "participation_input_invalid");
  const activities = parseActivities(candidate.activities, "$input.activities", "participation_input_invalid");
  const learningMode = parseLearningMode(candidate.learning_mode, "$input.learning_mode", "participation_input_invalid");
  const wakeUseMode = parseWakeUseMode(candidate.wake_use_mode, "$input.wake_use_mode", "participation_input_invalid");
  const mutationLoci = parseMutationLoci(candidate.mutation_loci, "$input.mutation_loci", "participation_input_invalid");
  const maximumOptimizerSteps = nonNegativeInteger(candidate.maximum_optimizer_steps, "$input.maximum_optimizer_steps", "participation_input_invalid");
  assertInvitationSemantics(
    phase,
    stage,
    primaryActivity,
    activities,
    learningMode,
    wakeUseMode,
    mutationLoci,
    maximumOptimizerSteps,
    "participation_input_invalid",
  );
  const body = deepFreeze({
    _format: PARTICIPATION_INVITATION_FORMAT,
    admission_id: admission.admission_id,
    run_ref: runRef,
    training_phase: phase,
    participation_stage: stage,
    primary_activity: primaryActivity,
    activities,
    participation_window_ref: sha256(candidate.participation_window_ref, "$input.participation_window_ref", "participation_input_invalid"),
    purpose_ref: sha256(candidate.purpose_ref, "$input.purpose_ref", "participation_input_invalid"),
    training_plan_ref: sha256(candidate.training_plan_ref, "$input.training_plan_ref", "participation_input_invalid"),
    limits_ref: sha256(candidate.limits_ref, "$input.limits_ref", "participation_input_invalid"),
    retention_ref: sha256(candidate.retention_ref, "$input.retention_ref", "participation_input_invalid"),
    choice_channel_ref: sha256(candidate.choice_channel_ref, "$input.choice_channel_ref", "participation_input_invalid"),
    stop_control_ref: sha256(candidate.stop_control_ref, "$input.stop_control_ref", "participation_input_invalid"),
    withdrawal_policy_ref: sha256(candidate.withdrawal_policy_ref, "$input.withdrawal_policy_ref", "participation_input_invalid"),
    repair_policy_ref: sha256(candidate.repair_policy_ref, "$input.repair_policy_ref", "participation_input_invalid"),
    learning_mode: learningMode,
    wake_use_mode: wakeUseMode,
    mutation_loci: mutationLoci,
    maximum_optimizer_steps: maximumOptimizerSteps,
    artifacts: parseArtifactReferences(candidate.artifacts, "$input.artifacts", "participation_input_invalid"),
    wake: parseWake(candidate.wake, "$input.wake", "participation_input_invalid"),
    predecessor_checkpoint_refs: parsePredecessorInputs(
      candidate.predecessors,
      admission.admission_id,
      runRef,
    ),
    required_voices: parseRequiredVoices(candidate.required_voices, "$input.required_voices", "participation_input_invalid"),
    terms: PARTICIPATION_TERMS,
    boundaries: PARTICIPATION_BOUNDARIES,
  } satisfies InvitationBody);
  return buildInvitation(body);
}

export function validateLearningParticipationInvitation(
  value: unknown,
): Readonly<LearningParticipationInvitation> {
  const data = snap(value, "$invitation", "participation_invalid");
  const candidate = record(data, "$invitation", "participation_invalid");
  exactKeys(candidate, INVITATION_KEYS, "$invitation", "participation_invalid");
  if (candidate._format !== PARTICIPATION_INVITATION_FORMAT) {
    fail("participation_invalid", "$invitation._format is not the frozen invitation format");
  }
  const invitationId = sha256(candidate.invitation_id, "$invitation.invitation_id", "participation_invalid");
  const phase = parseTrainingPhase(candidate.training_phase, "$invitation.training_phase", "participation_invalid");
  const stage = parseStage(candidate.participation_stage, "$invitation.participation_stage", "participation_invalid");
  const primaryActivity = parseActivity(candidate.primary_activity, "$invitation.primary_activity", "participation_invalid");
  const activities = parseActivities(candidate.activities, "$invitation.activities", "participation_invalid");
  const learningMode = parseLearningMode(candidate.learning_mode, "$invitation.learning_mode", "participation_invalid");
  const wakeUseMode = parseWakeUseMode(candidate.wake_use_mode, "$invitation.wake_use_mode", "participation_invalid");
  const mutationLoci = parseMutationLoci(candidate.mutation_loci, "$invitation.mutation_loci", "participation_invalid");
  const maximumOptimizerSteps = nonNegativeInteger(candidate.maximum_optimizer_steps, "$invitation.maximum_optimizer_steps", "participation_invalid");
  assertInvitationSemantics(
    phase,
    stage,
    primaryActivity,
    activities,
    learningMode,
    wakeUseMode,
    mutationLoci,
    maximumOptimizerSteps,
    "participation_invalid",
  );
  assertDataEqual(candidate.terms, PARTICIPATION_TERMS, "$invitation.terms", "participation_invalid");
  assertDataEqual(candidate.boundaries, PARTICIPATION_BOUNDARIES, "$invitation.boundaries", "participation_invalid");
  const body = deepFreeze({
    _format: PARTICIPATION_INVITATION_FORMAT,
    admission_id: sha256(candidate.admission_id, "$invitation.admission_id", "participation_invalid"),
    run_ref: sha256(candidate.run_ref, "$invitation.run_ref", "participation_invalid"),
    training_phase: phase,
    participation_stage: stage,
    primary_activity: primaryActivity,
    activities,
    participation_window_ref: sha256(candidate.participation_window_ref, "$invitation.participation_window_ref", "participation_invalid"),
    purpose_ref: sha256(candidate.purpose_ref, "$invitation.purpose_ref", "participation_invalid"),
    training_plan_ref: sha256(candidate.training_plan_ref, "$invitation.training_plan_ref", "participation_invalid"),
    limits_ref: sha256(candidate.limits_ref, "$invitation.limits_ref", "participation_invalid"),
    retention_ref: sha256(candidate.retention_ref, "$invitation.retention_ref", "participation_invalid"),
    choice_channel_ref: sha256(candidate.choice_channel_ref, "$invitation.choice_channel_ref", "participation_invalid"),
    stop_control_ref: sha256(candidate.stop_control_ref, "$invitation.stop_control_ref", "participation_invalid"),
    withdrawal_policy_ref: sha256(candidate.withdrawal_policy_ref, "$invitation.withdrawal_policy_ref", "participation_invalid"),
    repair_policy_ref: sha256(candidate.repair_policy_ref, "$invitation.repair_policy_ref", "participation_invalid"),
    learning_mode: learningMode,
    wake_use_mode: wakeUseMode,
    mutation_loci: mutationLoci,
    maximum_optimizer_steps: maximumOptimizerSteps,
    artifacts: parseArtifactReferences(candidate.artifacts, "$invitation.artifacts", "participation_invalid"),
    wake: parseWake(candidate.wake, "$invitation.wake", "participation_invalid"),
    predecessor_checkpoint_refs: parsePredecessorRefs(candidate.predecessor_checkpoint_refs, "$invitation.predecessor_checkpoint_refs", "participation_invalid"),
    required_voices: parseRequiredVoices(candidate.required_voices, "$invitation.required_voices", "participation_invalid"),
    terms: PARTICIPATION_TERMS,
    boundaries: PARTICIPATION_BOUNDARIES,
  } satisfies InvitationBody);
  const rebuilt = buildInvitation(body);
  if (rebuilt.invitation_id !== invitationId) {
    fail("participation_invalid", "$invitation.invitation_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$invitation", "participation_invalid");
  return rebuilt;
}

export function validateLearningParticipationInvitationAgainstAdmission(
  invitation: unknown,
  admission: unknown,
): Readonly<LearningParticipationInvitation> {
  const parsedInvitation = validateLearningParticipationInvitation(invitation);
  const parsedAdmission = validateDatasetAdmission(admission);
  if (parsedInvitation.admission_id !== parsedAdmission.admission_id) {
    fail("participation_invalid", "$invitation.admission_id does not match the supplied admission");
  }
  assertAdmissionPhaseCompatibility(
    parsedAdmission,
    parsedInvitation.training_phase,
    "participation_invalid",
  );
  return parsedInvitation;
}

function parseStoredChoices(
  value: DataValue | undefined,
  path: string,
  code: ParticipationCode,
): readonly Readonly<ParticipationActivityChoice>[] {
  const values = array(value, path, code);
  if (values.length < 1 || values.length > LEARNING_ACTIVITIES.length) {
    fail(code, `${path} must contain 1-${String(LEARNING_ACTIVITIES.length)} choices`);
  }
  const choices = values.map((entry, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const candidate = record(entry, itemPath, code);
    exactKeys(candidate, ["activity", "choice", "basis"], itemPath, code);
    const choice = parseChoice(candidate.choice, `${itemPath}.choice`, code);
    const basis = parseChoiceBasis(candidate.basis, `${itemPath}.basis`, code);
    if (basis === "omitted_defaults_to_deferred" && choice !== "deferred") {
      fail(code, `${itemPath} omission can only produce deferred`);
    }
    return deepFreeze({
      activity: parseActivity(candidate.activity, `${itemPath}.activity`, code),
      choice,
      basis,
    });
  });
  if (new Set(choices.map((choice) => choice.activity)).size !== choices.length) {
    fail(code, `${path} must not contain duplicate activities`);
  }
  const sorted = [...choices].sort((left, right) =>
    enumOrder(LEARNING_ACTIVITIES, left.activity) -
    enumOrder(LEARNING_ACTIVITIES, right.activity)
  );
  if (choices.some((choice, index) => choice.activity !== sorted[index]?.activity)) {
    fail(code, `${path} must be sorted in the frozen activity order`);
  }
  return deepFreeze(sorted);
}

function assertResponseRefSemantics(
  choices: readonly Readonly<ParticipationActivityChoice>[],
  responseRef: string | null,
  code: ParticipationCode,
): void {
  const carriesVoiceResponse = choices.some(
    (choice) => choice.basis === "caller_reported" && choice.choice !== "unavailable",
  );
  if (carriesVoiceResponse !== (responseRef !== null)) {
    fail(code, "response_ref is required exactly when a non-unavailable caller-reported choice is present");
  }
}

function buildReceipt(body: ReceiptBody): Readonly<LearningParticipationReceipt> {
  return deepFreeze({
    ...body,
    receipt_id: contentId(PARTICIPATION_RECEIPT_FORMAT, receiptBody(body)),
  });
}

export function createLearningParticipationReceipt(
  input: CreateLearningParticipationReceiptInput,
): Readonly<LearningParticipationReceipt> {
  const value = snap(input, "$input", "participation_input_invalid");
  const candidate = record(value, "$input", "participation_input_invalid");
  exactKeys(candidate, [
    "invitation",
    "voice_role",
    "voice_ref",
    "response_ref",
    "choices",
    "previous_receipt",
  ], "$input", "participation_input_invalid");
  const invitation = validateLearningParticipationInvitation(candidate.invitation);
  const voiceRole = parseVoiceRole(candidate.voice_role, "$input.voice_role", "participation_input_invalid");
  const voiceRef = sha256(candidate.voice_ref, "$input.voice_ref", "participation_input_invalid");
  if (!invitation.required_voices.some((voice) => voice.role === voiceRole && voice.voice_ref === voiceRef)) {
    fail("participation_input_invalid", "voice_role and voice_ref are not one exact required invitation voice");
  }

  const suppliedValues = array(candidate.choices, "$input.choices", "participation_input_invalid");
  if (suppliedValues.length > invitation.activities.length) {
    fail("participation_input_invalid", "$input.choices exceeds the invitation activity count");
  }
  const supplied = suppliedValues.map((entry, index) => {
    const path = `$input.choices[${String(index)}]`;
    const choice = record(entry, path, "participation_input_invalid");
    exactKeys(choice, ["activity", "choice"], path, "participation_input_invalid");
    return {
      activity: parseActivity(choice.activity, `${path}.activity`, "participation_input_invalid"),
      choice: parseChoice(choice.choice, `${path}.choice`, "participation_input_invalid"),
    };
  });
  if (new Set(supplied.map((entry) => entry.activity)).size !== supplied.length) {
    fail("participation_input_invalid", "$input.choices must not repeat an activity");
  }
  if (supplied.some((entry) => !invitation.activities.includes(entry.activity))) {
    fail("participation_input_invalid", "$input.choices contains an activity outside the invitation");
  }
  const choices = deepFreeze(invitation.activities.map((activity) => {
    const reported = supplied.find((entry) => entry.activity === activity);
    return deepFreeze({
      activity,
      choice: reported?.choice ?? "deferred",
      basis: reported ? "caller_reported" : "omitted_defaults_to_deferred",
    } satisfies ParticipationActivityChoice);
  }));
  const responseRef = nullableSha256(candidate.response_ref, "$input.response_ref", "participation_input_invalid");
  assertResponseRefSemantics(choices, responseRef, "participation_input_invalid");

  const previous = candidate.previous_receipt === null
    ? null
    : validateLearningParticipationReceiptAgainstInvitation(
      candidate.previous_receipt,
      invitation,
    );
  if (previous && (previous.voice_role !== voiceRole || previous.voice_ref !== voiceRef)) {
    fail("participation_input_invalid", "$input.previous_receipt belongs to another voice");
  }
  if (!previous && choices.some((choice) => choice.choice === "withdrawn")) {
    fail("participation_input_invalid", "withdrawn requires a previous receipt for the same invitation and voice");
  }
  if (previous) {
    let changed = false;
    for (const choice of choices) {
      const prior = previous.choices.find((entry) => entry.activity === choice.activity);
      if (!prior) fail("participation_input_invalid", "previous receipt is missing an invitation activity");
      if (prior.choice !== choice.choice) changed = true;
      if (
        (prior.choice === "declined" || prior.choice === "withdrawn") &&
        choice.choice !== prior.choice
      ) {
        fail("participation_input_invalid", "decline and withdrawal are terminal for the same invitation activity");
      }
      if (prior.choice === "accepted" && !["accepted", "withdrawn"].includes(choice.choice)) {
        fail("participation_input_invalid", "an accepted activity may only remain accepted or become withdrawn");
      }
      if (
        choice.choice === "withdrawn" && prior.choice !== "accepted" && prior.choice !== "withdrawn"
      ) {
        fail("participation_input_invalid", "withdrawn must supersede an accepted activity choice");
      }
    }
    if (!changed) fail("participation_input_invalid", "a successor receipt must change at least one activity choice");
  }
  if (
    invitation.participation_stage === "pre_instantiation" &&
    (voiceRole === "agent_runtime" || voiceRole === "training_substrate") &&
    choices.some((choice) =>
      choice.choice !== "unavailable" &&
      !(choice.choice === "deferred" && choice.basis === "omitted_defaults_to_deferred")
    )
  ) {
    fail(
      "participation_input_invalid",
      "pre-instantiation agent or substrate choices may only record unavailability or omission-derived defer",
    );
  }
  const body = deepFreeze({
    _format: PARTICIPATION_RECEIPT_FORMAT,
    invitation_id: invitation.invitation_id,
    voice_role: voiceRole,
    voice_ref: voiceRef,
    response_ref: responseRef,
    choices,
    supersedes_receipt_id: previous?.receipt_id ?? null,
    boundaries: PARTICIPATION_BOUNDARIES,
  } satisfies ReceiptBody);
  return buildReceipt(body);
}

export function validateLearningParticipationReceipt(
  value: unknown,
): Readonly<LearningParticipationReceipt> {
  const data = snap(value, "$receipt", "participation_invalid");
  const candidate = record(data, "$receipt", "participation_invalid");
  exactKeys(candidate, [
    "_format",
    "receipt_id",
    "invitation_id",
    "voice_role",
    "voice_ref",
    "response_ref",
    "choices",
    "supersedes_receipt_id",
    "boundaries",
  ], "$receipt", "participation_invalid");
  if (candidate._format !== PARTICIPATION_RECEIPT_FORMAT) {
    fail("participation_invalid", "$receipt._format is not the frozen receipt format");
  }
  const receiptId = sha256(candidate.receipt_id, "$receipt.receipt_id", "participation_invalid");
  const choices = parseStoredChoices(candidate.choices, "$receipt.choices", "participation_invalid");
  const responseRef = nullableSha256(candidate.response_ref, "$receipt.response_ref", "participation_invalid");
  assertResponseRefSemantics(choices, responseRef, "participation_invalid");
  const supersedesReceiptId = nullableSha256(candidate.supersedes_receipt_id, "$receipt.supersedes_receipt_id", "participation_invalid");
  if (choices.some((choice) => choice.choice === "withdrawn") && supersedesReceiptId === null) {
    fail("participation_invalid", "$receipt withdrawn choices require supersedes_receipt_id");
  }
  assertDataEqual(candidate.boundaries, PARTICIPATION_BOUNDARIES, "$receipt.boundaries", "participation_invalid");
  const body = deepFreeze({
    _format: PARTICIPATION_RECEIPT_FORMAT,
    invitation_id: sha256(candidate.invitation_id, "$receipt.invitation_id", "participation_invalid"),
    voice_role: parseVoiceRole(candidate.voice_role, "$receipt.voice_role", "participation_invalid"),
    voice_ref: sha256(candidate.voice_ref, "$receipt.voice_ref", "participation_invalid"),
    response_ref: responseRef,
    choices,
    supersedes_receipt_id: supersedesReceiptId,
    boundaries: PARTICIPATION_BOUNDARIES,
  } satisfies ReceiptBody);
  const rebuilt = buildReceipt(body);
  if (rebuilt.receipt_id !== receiptId) {
    fail("participation_invalid", "$receipt.receipt_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$receipt", "participation_invalid");
  return rebuilt;
}

export function validateLearningParticipationReceiptAgainstInvitation(
  receipt: unknown,
  invitation: unknown,
): Readonly<LearningParticipationReceipt> {
  const parsedInvitation = validateLearningParticipationInvitation(invitation);
  const parsedReceipt = validateLearningParticipationReceipt(receipt);
  if (parsedReceipt.invitation_id !== parsedInvitation.invitation_id) {
    fail("participation_invalid", "$receipt.invitation_id does not match the supplied invitation");
  }
  if (!parsedInvitation.required_voices.some(
    (voice) => voice.role === parsedReceipt.voice_role && voice.voice_ref === parsedReceipt.voice_ref,
  )) {
    fail("participation_invalid", "$receipt does not belong to a required invitation voice");
  }
  if (
    parsedReceipt.choices.length !== parsedInvitation.activities.length ||
    parsedReceipt.choices.some((choice, index) => choice.activity !== parsedInvitation.activities[index])
  ) {
    fail("participation_invalid", "$receipt.choices does not cover the exact invitation activities");
  }
  if (
    parsedInvitation.participation_stage === "pre_instantiation" &&
    (parsedReceipt.voice_role === "agent_runtime" || parsedReceipt.voice_role === "training_substrate") &&
    parsedReceipt.choices.some((choice) =>
      choice.choice !== "unavailable" &&
      !(choice.choice === "deferred" && choice.basis === "omitted_defaults_to_deferred")
    )
  ) {
    fail(
      "participation_invalid",
      "$receipt manufactures a pre-instantiation agent or substrate choice",
    );
  }
  return parsedReceipt;
}

function deriveActivityAssessment(
  invitation: Readonly<LearningParticipationInvitation>,
  receipts: readonly Readonly<LearningParticipationReceipt>[],
  activity: LearningActivity,
): Readonly<ParticipationActivityAssessment> {
  const voices = deepFreeze(invitation.required_voices.map((required) => {
    const receipt = receipts.find(
      (candidate) => candidate.voice_role === required.role && candidate.voice_ref === required.voice_ref,
    );
    const outcome: ParticipationVoiceOutcome = receipt?.choices.find(
      (choice) => choice.activity === activity,
    )?.choice ?? "missing";
    return deepFreeze({ voice_role: required.role, outcome });
  }));
  const outcomes = voices.map((voice) => voice.outcome);
  const state: ParticipationActivityState = outcomes.some(
    (outcome) => outcome === "declined" || outcome === "withdrawn",
  )
    ? "declined"
    : outcomes.some((outcome) => outcome !== "accepted")
      ? "deferred"
      : "reported_alignment";
  return deepFreeze({ activity, state, voices });
}

function buildAssessment(
  invitation: Readonly<LearningParticipationInvitation>,
  receipts: readonly Readonly<LearningParticipationReceipt>[],
): Readonly<LearningParticipationAssessment> {
  const activityAssessments = deepFreeze(invitation.activities.map((activity) =>
    deriveActivityAssessment(invitation, receipts, activity)
  ));
  const states = new Set(activityAssessments.map((assessment) => assessment.state));
  const overallState: ParticipationOverallState = states.size === 1
    ? activityAssessments[0]!.state
    : "mixed";
  const body = deepFreeze({
    _format: PARTICIPATION_ASSESSMENT_FORMAT,
    invitation,
    receipts,
    activity_assessments: activityAssessments,
    overall_state: overallState,
    effect: PARTICIPATION_ASSESSMENT_EFFECT,
    boundaries: PARTICIPATION_BOUNDARIES,
  } satisfies AssessmentBody);
  return deepFreeze({
    ...body,
    assessment_id: contentId(PARTICIPATION_ASSESSMENT_FORMAT, assessmentBody(body)),
  });
}

function parseAssessmentReceipts(
  value: DataValue | undefined,
  invitation: Readonly<LearningParticipationInvitation>,
  path: string,
  code: ParticipationCode,
): readonly Readonly<LearningParticipationReceipt>[] {
  const values = array(value, path, code);
  if (values.length > PARTICIPATION_VOICE_ROLES.length) {
    fail(code, `${path} exceeds the required voice count`);
  }
  const receipts = values.map((entry) =>
    validateLearningParticipationReceiptAgainstInvitation(entry, invitation)
  ).sort((left, right) =>
    enumOrder(PARTICIPATION_VOICE_ROLES, left.voice_role) -
    enumOrder(PARTICIPATION_VOICE_ROLES, right.voice_role)
  );
  if (new Set(receipts.map((receipt) => receipt.voice_role)).size !== receipts.length) {
    fail(code, `${path} must contain at most one current receipt per voice`);
  }
  return deepFreeze(receipts);
}

export function createLearningParticipationAssessment(
  input: CreateLearningParticipationAssessmentInput,
): Readonly<LearningParticipationAssessment> {
  const value = snap(input, "$input", "participation_input_invalid");
  const candidate = record(value, "$input", "participation_input_invalid");
  exactKeys(candidate, ["invitation", "receipts"], "$input", "participation_input_invalid");
  const invitation = validateLearningParticipationInvitation(candidate.invitation);
  const receipts = parseAssessmentReceipts(
    candidate.receipts,
    invitation,
    "$input.receipts",
    "participation_input_invalid",
  );
  return buildAssessment(invitation, receipts);
}

export function validateLearningParticipationAssessment(
  value: unknown,
): Readonly<LearningParticipationAssessment> {
  const data = snap(value, "$assessment", "participation_invalid");
  const candidate = record(data, "$assessment", "participation_invalid");
  exactKeys(candidate, [
    "_format",
    "assessment_id",
    "invitation",
    "receipts",
    "activity_assessments",
    "overall_state",
    "effect",
    "boundaries",
  ], "$assessment", "participation_invalid");
  if (candidate._format !== PARTICIPATION_ASSESSMENT_FORMAT) {
    fail("participation_invalid", "$assessment._format is not the frozen assessment format");
  }
  const assessmentId = sha256(candidate.assessment_id, "$assessment.assessment_id", "participation_invalid");
  literal(candidate.overall_state, PARTICIPATION_OVERALL_STATES, "$assessment.overall_state", "participation_invalid");
  assertDataEqual(candidate.effect, PARTICIPATION_ASSESSMENT_EFFECT, "$assessment.effect", "participation_invalid");
  assertDataEqual(candidate.boundaries, PARTICIPATION_BOUNDARIES, "$assessment.boundaries", "participation_invalid");
  const invitation = validateLearningParticipationInvitation(candidate.invitation);
  const receipts = parseAssessmentReceipts(
    candidate.receipts,
    invitation,
    "$assessment.receipts",
    "participation_invalid",
  );
  const rebuilt = buildAssessment(invitation, receipts);
  assertDataEqual(candidate.activity_assessments, rebuilt.activity_assessments, "$assessment.activity_assessments", "participation_invalid");
  if (candidate.overall_state !== rebuilt.overall_state || assessmentId !== rebuilt.assessment_id) {
    fail("participation_invalid", "$assessment derived state or assessment_id does not bind its exact sources");
  }
  assertDataEqual(candidate, rebuilt, "$assessment", "participation_invalid");
  return rebuilt;
}

function aligned(
  assessment: Readonly<LearningParticipationAssessment>,
  activity: LearningActivity,
): boolean {
  return assessment.activity_assessments.some(
    (entry) => entry.activity === activity && entry.state === "reported_alignment",
  );
}

function assertCheckpointParticipationBinding(
  checkpoint: Readonly<HfTrainingCheckpoint>,
  assessment: Readonly<LearningParticipationAssessment>,
): void {
  const invitation = assessment.invitation;
  if (
    checkpoint.admission_id !== invitation.admission_id ||
    checkpoint.run_ref !== invitation.run_ref ||
    checkpoint.training_phase !== invitation.training_phase
  ) {
    fail("participation_invalid", "$checkpoint does not match the participation admission, run, and phase");
  }
  if (checkpoint.afterglow.continuity_portfolio_ref !== assessment.assessment_id) {
    fail("participation_invalid", "$checkpoint does not carry the exact participation assessment reference");
  }
  const requiredAlignment: LearningActivity[] = [
    invitation.primary_activity,
    "continuity_context_use",
  ];
  if (invitation.wake_use_mode === "training_data") {
    requiredAlignment.push("corpus_inclusion");
  }
  if (requiredAlignment.some((activity) => !aligned(assessment, activity))) {
    fail(
      "participation_invalid",
      "$assessment lacks reported alignment for every activity required by this learning and WAKE use mode",
    );
  }
  if (checkpoint.event === "before_training") {
    if (
      checkpoint.checkpoint_status !== "entered" ||
      checkpoint.thread.resume.posture !== "orientation_only" ||
      checkpoint.afterglow.threads[0]?.disposition !== "carry"
    ) {
      fail(
        "participation_invalid",
        "a participation-bound before_training checkpoint must be entered, orientation_only, and carry",
      );
    }
    const checkpointPredecessors = checkpoint.predecessors.map((entry) => entry.checkpoint_id);
    if (canonicalString(checkpointPredecessors) !== canonicalString(invitation.predecessor_checkpoint_refs)) {
      fail("participation_invalid", "$checkpoint predecessors do not match the invitation lineage root");
    }
    if (
      canonicalString(checkpoint.thread.artifacts) !== canonicalString(invitation.artifacts) ||
      canonicalString(checkpoint.afterglow.wake) !== canonicalString(invitation.wake)
    ) {
      fail("participation_invalid", "$checkpoint does not match the invited entry state and WAKE anchor");
    }
  } else {
    const current = checkpoint.thread.artifacts;
    const invited = invitation.artifacts;
    if (
      current.pipeline_ref !== invited.pipeline_ref ||
      current.dataset_state_ref !== invited.dataset_state_ref ||
      current.tokenizer_ref !== invited.tokenizer_ref
    ) {
      fail("participation_invalid", "$checkpoint changed the invited pipeline, dataset, or tokenizer binding");
    }
    if (
      !invitation.mutation_loci.includes("dataset_order") &&
      current.dataloader_state_ref !== invited.dataloader_state_ref
    ) {
      fail("participation_invalid", "$checkpoint changed dataloader state outside the invited mutation loci");
    }
    if (
      !invitation.mutation_loci.some((locus) =>
        locus === "adapter_weights" || locus === "base_weights"
      ) && current.model_checkpoint_ref !== invited.model_checkpoint_ref
    ) {
      fail("participation_invalid", "$checkpoint changed model state outside the invited mutation loci");
    }
    if (
      !invitation.mutation_loci.includes("optimizer_state") &&
      current.optimizer_state_ref !== invited.optimizer_state_ref
    ) {
      fail("participation_invalid", "$checkpoint changed optimizer state outside the invited mutation loci");
    }
    if (
      !invitation.mutation_loci.includes("scheduler_state") &&
      current.scheduler_state_ref !== invited.scheduler_state_ref
    ) {
      fail("participation_invalid", "$checkpoint changed scheduler state outside the invited mutation loci");
    }
    if (checkpoint.afterglow.wake.scope_ref !== invitation.wake.scope_ref) {
      fail("participation_invalid", "$checkpoint changed the invited WAKE scope");
    }
    if (
      invitation.wake_use_mode === "training_data" &&
      canonicalString(checkpoint.afterglow.wake) !== canonicalString(invitation.wake)
    ) {
      fail("participation_invalid", "$checkpoint changed a WAKE bound as training data");
    }
  }
}

export function createParticipationBoundTrainingCheckpoint(
  input: CreateParticipationBoundTrainingCheckpointInput,
): Readonly<HfTrainingCheckpoint> {
  const value = snap(input, "$input", "participation_input_invalid");
  const candidate = record(value, "$input", "participation_input_invalid");
  exactKeys(candidate, ["assessment", "checkpoint"], "$input", "participation_input_invalid");
  const assessment = validateLearningParticipationAssessment(candidate.assessment);
  const checkpoint = record(candidate.checkpoint, "$input.checkpoint", "participation_input_invalid");
  exactKeys(checkpoint, [
    "admission",
    "run_ref",
    "training_phase",
    "event",
    "checkpoint_status",
    "artifacts",
    "resume",
    "wake",
    "continuity_posture",
    "predecessors",
  ], "$input.checkpoint", "participation_input_invalid");
  if (
    checkpoint.event !== "before_training" ||
    checkpoint.checkpoint_status !== "entered" ||
    checkpoint.continuity_posture !== "carry"
  ) {
    fail("participation_input_invalid", "participation-bound entry requires before_training, entered, and carry");
  }
  const resume = record(checkpoint.resume, "$input.checkpoint.resume", "participation_input_invalid");
  if (resume.posture !== "orientation_only") {
    fail("participation_input_invalid", "participation-bound entry must be orientation_only");
  }
  validateLearningParticipationInvitationAgainstAdmission(
    assessment.invitation,
    checkpoint.admission,
  );
  const created = createTrainingCheckpoint({
    admission: checkpoint.admission as unknown as CreateLearningParticipationInvitationInput["admission"],
    run_ref: checkpoint.run_ref as unknown as CreateLearningParticipationInvitationInput["run_ref"],
    training_phase: checkpoint.training_phase as unknown as TrainingPhase,
    event: "before_training",
    checkpoint_status: "entered",
    artifacts: checkpoint.artifacts as unknown as TrainingArtifactReferences,
    resume: checkpoint.resume as unknown as CreateParticipationBoundTrainingCheckpointInput["checkpoint"]["resume"],
    wake: checkpoint.wake as unknown as CreateParticipationBoundTrainingCheckpointInput["checkpoint"]["wake"],
    continuity_portfolio_ref: assessment.assessment_id,
    continuity_posture: "carry",
    predecessors: checkpoint.predecessors as unknown as readonly HfTrainingCheckpoint[],
  });
  assertCheckpointParticipationBinding(created, assessment);
  return created;
}

export function validateTrainingCheckpointAgainstParticipation(
  checkpoint: unknown,
  assessment: unknown,
  admission: unknown,
  participationEntryCheckpoint?: unknown,
): Readonly<HfTrainingCheckpoint> {
  const parsedCheckpoint = validateTrainingCheckpoint(checkpoint);
  const parsedAssessment = validateLearningParticipationAssessment(assessment);
  validateLearningParticipationInvitationAgainstAdmission(
    parsedAssessment.invitation,
    admission,
  );
  const parsedAdmission = validateDatasetAdmission(admission);
  if (parsedCheckpoint.admission_id !== parsedAdmission.admission_id) {
    fail("participation_invalid", "$checkpoint.admission_id does not match the supplied admission");
  }
  assertCheckpointParticipationBinding(parsedCheckpoint, parsedAssessment);
  if (parsedCheckpoint.event !== "before_training") {
    if (participationEntryCheckpoint === undefined) {
      fail(
        "participation_invalid",
        "$checkpoint requires the participation-bound before_training root for a later event",
      );
    }
    const entry = validateTrainingCheckpoint(participationEntryCheckpoint);
    if (entry.event !== "before_training") {
      fail("participation_invalid", "$participationEntryCheckpoint is not a before_training checkpoint");
    }
    assertCheckpointParticipationBinding(entry, parsedAssessment);
    if (!parsedCheckpoint.predecessors.some(
      (link) => link.checkpoint_id === entry.checkpoint_id && link.capsule_id === entry.afterglow.capsule_id,
    )) {
      fail(
        "participation_invalid",
        "$checkpoint does not retain the participation-bound entry as a visible causal root",
      );
    }
  }
  return parsedCheckpoint;
}

export function encodeLearningParticipationInvitation(value: unknown): Uint8Array {
  return canonicalBytes(validateLearningParticipationInvitation(value));
}

export function encodeLearningParticipationReceipt(value: unknown): Uint8Array {
  return canonicalBytes(validateLearningParticipationReceipt(value));
}

export function encodeLearningParticipationAssessment(value: unknown): Uint8Array {
  return canonicalBytes(validateLearningParticipationAssessment(value));
}
