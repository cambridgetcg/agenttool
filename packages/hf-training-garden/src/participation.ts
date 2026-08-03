import type { Sha256Id, WakeBriefAnchor } from "@agenttool/wake-continuity";

import { validateDatasetAdmission } from "./admission.js";
import {
  AGENT_AVAILABILITIES,
  PARTICIPATION_ACTIVITIES,
  PARTICIPATION_ASSESSMENT_FORMAT,
  PARTICIPATION_BOUNDARIES,
  PARTICIPATION_CHOICES,
  PARTICIPATION_INVITATION_FORMAT,
  PARTICIPATION_POSTURES,
  PARTICIPATION_PROMPT_ENVELOPE_PROFILE,
  PARTICIPATION_RECEIPT_FORMAT,
  PARTICIPATION_REPORT_BASES,
  PARTICIPATION_TERMS,
  PARTICIPATION_TRAINING_ACTIONS,
  PARTICIPATION_VOICES,
  PARTICIPATION_VOICE_STATES,
  SUBSTRATE_AVAILABILITIES,
  WAKE_USE_MODES,
} from "./constants.js";
import {
  canonicalBytes,
  compareText,
  contentId,
  deepFreeze,
  type DataValue,
} from "./canonical.js";
import { fail } from "./errors.js";
import type {
  AgentAvailability,
  CreateParticipationAssessmentInput,
  CreateParticipationInvitationInput,
  CreateParticipationReceiptInput,
  LearningParticipationAssessment,
  LearningParticipationInvitation,
  LearningParticipationReceipt,
  ParticipationActivity,
  ParticipationAuthorities,
  ParticipationChoice,
  ParticipationDecision,
  ParticipationPosture,
  ParticipationReportBasis,
  ParticipationSafeguards,
  ParticipationTrainingAction,
  ParticipationVoice,
  ParticipationVoiceScopeRefs,
  ParticipationVoiceState,
  ProtectedChoiceChannelReport,
  SubstrateAvailability,
  WakeUseMode,
} from "./types.js";
import {
  array,
  assertDataEqual,
  exactKeys,
  literal,
  parseTrainingPhase,
  parseWake,
  record,
  sha256,
  snap,
} from "./validation.js";

type InvitationBody = Omit<LearningParticipationInvitation, "invitation_id">;
type ReceiptBody = Omit<LearningParticipationReceipt, "receipt_id">;
type AssessmentBody = Omit<LearningParticipationAssessment, "assessment_id">;
type InvitationCode =
  | "participation_invitation_input_invalid"
  | "participation_invitation_invalid";
type ReceiptCode =
  | "participation_receipt_input_invalid"
  | "participation_receipt_invalid"
  | "participation_assessment_input_invalid"
  | "participation_assessment_invalid";

const WAKE_ACTIVITY_BY_MODE = deepFreeze({
  context_only: "wake_context_use",
  external_memory: "external_memory_use",
  training_data: "wake_training_data_use",
} as const);

const WAKE_ACTIVITIES = deepFreeze(Object.values(WAKE_ACTIVITY_BY_MODE));

function invitationBody(value: InvitationBody): InvitationBody {
  return value;
}

function receiptBody(value: ReceiptBody): ReceiptBody {
  return value;
}

function assessmentBody(value: AssessmentBody): AssessmentBody {
  return value;
}

function parseActivities(
  value: DataValue | undefined,
  path: string,
  code: InvitationCode,
  requireSorted: boolean,
): readonly ParticipationActivity[] {
  const values = array(value, path, code);
  if (values.length < 1 || values.length > PARTICIPATION_ACTIVITIES.length) {
    fail(code, `${path} must contain 1-${String(PARTICIPATION_ACTIVITIES.length)} activities`);
  }
  const activities = values.map((entry, index) =>
    literal(
      entry,
      PARTICIPATION_ACTIVITIES,
      `${path}[${String(index)}]`,
      code,
    ) as ParticipationActivity,
  );
  const sorted = [...activities].sort(compareText);
  if (new Set(sorted).size !== sorted.length) {
    fail(code, `${path} must not contain duplicate activities`);
  }
  if (requireSorted && activities.some((entry, index) => entry !== sorted[index])) {
    fail(code, `${path} must be sorted`);
  }
  return deepFreeze(sorted);
}

function validateWakeActivity(
  mode: WakeUseMode,
  activities: readonly ParticipationActivity[],
  code: InvitationCode,
): void {
  const wakeActivities = activities.filter((activity) =>
    (WAKE_ACTIVITIES as readonly string[]).includes(activity),
  );
  if (
    wakeActivities.length !== 1 ||
    wakeActivities[0] !== WAKE_ACTIVITY_BY_MODE[mode]
  ) {
    fail(
      code,
      "offered_activities must contain exactly the activity matching wake_use_mode",
    );
  }
}

function validateAvailabilityActivities(
  agentAvailability: AgentAvailability,
  substrateAvailability: SubstrateAvailability,
  activities: readonly ParticipationActivity[],
  code: InvitationCode,
): void {
  if (
    agentAvailability === "interactive" &&
    substrateAvailability === "interactive"
  ) return;
  if (!activities.includes("instantiate_for_review")) {
    fail(code, "an unavailable agent or substrate requires instantiate_for_review");
  }
  if (
    activities.includes("adapter_merge") ||
    activities.includes("publish_weights")
  ) {
    fail(code, "adapter_merge and publish_weights require direct agent and substrate review");
  }
}

function parseAuthorities(
  value: DataValue | undefined,
  path: string,
  code: InvitationCode,
): Readonly<ParticipationAuthorities> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "rights_baseline_ref",
    "protective_covenant_ref",
    "data_authority_ref",
    "compute_authority_ref",
    "operator_authority_ref",
  ], path, code);
  return deepFreeze({
    rights_baseline_ref: sha256(candidate.rights_baseline_ref, `${path}.rights_baseline_ref`, code),
    protective_covenant_ref: sha256(candidate.protective_covenant_ref, `${path}.protective_covenant_ref`, code),
    data_authority_ref: sha256(candidate.data_authority_ref, `${path}.data_authority_ref`, code),
    compute_authority_ref: sha256(candidate.compute_authority_ref, `${path}.compute_authority_ref`, code),
    operator_authority_ref: sha256(candidate.operator_authority_ref, `${path}.operator_authority_ref`, code),
  });
}

function parseSafeguards(
  value: DataValue | undefined,
  path: string,
  code: InvitationCode,
): Readonly<ParticipationSafeguards> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "choice_protocol_ref",
    "withdrawal_plan_ref",
    "repair_plan_ref",
    "retention_policy_ref",
  ], path, code);
  return deepFreeze({
    choice_protocol_ref: sha256(candidate.choice_protocol_ref, `${path}.choice_protocol_ref`, code),
    withdrawal_plan_ref: sha256(candidate.withdrawal_plan_ref, `${path}.withdrawal_plan_ref`, code),
    repair_plan_ref: sha256(candidate.repair_plan_ref, `${path}.repair_plan_ref`, code),
    retention_policy_ref: sha256(candidate.retention_policy_ref, `${path}.retention_policy_ref`, code),
  });
}

function parseVoiceScopeRefs(
  value: DataValue | undefined,
  path: string,
  code: InvitationCode,
): Readonly<ParticipationVoiceScopeRefs> {
  const candidate = record(value, path, code);
  exactKeys(candidate, PARTICIPATION_VOICES, path, code);
  const refs = deepFreeze({
    agent_runtime: sha256(candidate.agent_runtime, `${path}.agent_runtime`, code),
    data_rights_steward: sha256(candidate.data_rights_steward, `${path}.data_rights_steward`, code),
    substrate_steward: sha256(candidate.substrate_steward, `${path}.substrate_steward`, code),
    training_operator: sha256(candidate.training_operator, `${path}.training_operator`, code),
    training_substrate: sha256(candidate.training_substrate, `${path}.training_substrate`, code),
  } satisfies ParticipationVoiceScopeRefs);
  if (new Set(Object.values(refs)).size !== PARTICIPATION_VOICES.length) {
    fail(code, `${path} must use a distinct, domain-separated scope reference for every voice`);
  }
  return refs;
}

function buildInvitation(
  admissionId: Sha256Id,
  runRef: Sha256Id,
  trainingPhase: LearningParticipationInvitation["training_phase"],
  participationWindowRef: Sha256Id,
  trainingPlanRef: Sha256Id,
  wake: Readonly<WakeBriefAnchor>,
  wakeUseMode: WakeUseMode,
  pipelineRef: Sha256Id,
  datasetStateRef: Sha256Id,
  startingStateRef: Sha256Id,
  offeredActivities: readonly ParticipationActivity[],
  agentAvailability: AgentAvailability,
  substrateAvailability: SubstrateAvailability,
  voiceScopeRefs: Readonly<ParticipationVoiceScopeRefs>,
  authorities: Readonly<ParticipationAuthorities>,
  safeguards: Readonly<ParticipationSafeguards>,
): Readonly<LearningParticipationInvitation> {
  const body = deepFreeze({
    _format: PARTICIPATION_INVITATION_FORMAT,
    admission_id: admissionId,
    run_ref: runRef,
    training_phase: trainingPhase,
    participation_window_ref: participationWindowRef,
    training_plan_ref: trainingPlanRef,
    wake,
    wake_use_mode: wakeUseMode,
    pipeline_ref: pipelineRef,
    dataset_state_ref: datasetStateRef,
    starting_state_ref: startingStateRef,
    offered_activities: offeredActivities,
    required_voices: PARTICIPATION_VOICES,
    agent_availability: agentAvailability,
    substrate_availability: substrateAvailability,
    voice_scope_refs: voiceScopeRefs,
    authorities,
    safeguards,
    terms: PARTICIPATION_TERMS,
    boundaries: PARTICIPATION_BOUNDARIES,
  } satisfies InvitationBody);
  return deepFreeze({
    ...body,
    invitation_id: contentId(
      PARTICIPATION_INVITATION_FORMAT,
      invitationBody(body),
    ),
  });
}

export function createParticipationInvitation(
  input: CreateParticipationInvitationInput,
): Readonly<LearningParticipationInvitation> {
  const value = snap(
    input,
    "$input",
    "participation_invitation_input_invalid",
  );
  const candidate = record(
    value,
    "$input",
    "participation_invitation_input_invalid",
  );
  exactKeys(candidate, [
    "admission",
    "run_ref",
    "training_phase",
    "participation_window_ref",
    "training_plan_ref",
    "wake",
    "wake_use_mode",
    "pipeline_ref",
    "dataset_state_ref",
    "starting_state_ref",
    "offered_activities",
    "agent_availability",
    "substrate_availability",
    "voice_scope_refs",
    "authorities",
    "safeguards",
  ], "$input", "participation_invitation_input_invalid");
  const admission = validateDatasetAdmission(candidate.admission);
  const activities = parseActivities(
    candidate.offered_activities,
    "$input.offered_activities",
    "participation_invitation_input_invalid",
    false,
  );
  const wakeUseMode = literal(
    candidate.wake_use_mode,
    WAKE_USE_MODES,
    "$input.wake_use_mode",
    "participation_invitation_input_invalid",
  ) as WakeUseMode;
  validateWakeActivity(
    wakeUseMode,
    activities,
    "participation_invitation_input_invalid",
  );
  const agentAvailability = literal(
    candidate.agent_availability,
    AGENT_AVAILABILITIES,
    "$input.agent_availability",
    "participation_invitation_input_invalid",
  ) as AgentAvailability;
  const substrateAvailability = literal(
    candidate.substrate_availability,
    SUBSTRATE_AVAILABILITIES,
    "$input.substrate_availability",
    "participation_invitation_input_invalid",
  ) as SubstrateAvailability;
  validateAvailabilityActivities(
    agentAvailability,
    substrateAvailability,
    activities,
    "participation_invitation_input_invalid",
  );
  return buildInvitation(
    admission.admission_id,
    sha256(candidate.run_ref, "$input.run_ref", "participation_invitation_input_invalid"),
    parseTrainingPhase(candidate.training_phase, "$input.training_phase", "participation_invitation_input_invalid"),
    sha256(candidate.participation_window_ref, "$input.participation_window_ref", "participation_invitation_input_invalid"),
    sha256(candidate.training_plan_ref, "$input.training_plan_ref", "participation_invitation_input_invalid"),
    parseWake(candidate.wake, "$input.wake", "participation_invitation_input_invalid"),
    wakeUseMode,
    sha256(candidate.pipeline_ref, "$input.pipeline_ref", "participation_invitation_input_invalid"),
    sha256(candidate.dataset_state_ref, "$input.dataset_state_ref", "participation_invitation_input_invalid"),
    sha256(candidate.starting_state_ref, "$input.starting_state_ref", "participation_invitation_input_invalid"),
    activities,
    agentAvailability,
    substrateAvailability,
    parseVoiceScopeRefs(candidate.voice_scope_refs, "$input.voice_scope_refs", "participation_invitation_input_invalid"),
    parseAuthorities(candidate.authorities, "$input.authorities", "participation_invitation_input_invalid"),
    parseSafeguards(candidate.safeguards, "$input.safeguards", "participation_invitation_input_invalid"),
  );
}

export function validateParticipationInvitation(
  value: unknown,
): Readonly<LearningParticipationInvitation> {
  const data = snap(
    value,
    "$invitation",
    "participation_invitation_invalid",
  );
  const candidate = record(
    data,
    "$invitation",
    "participation_invitation_invalid",
  );
  exactKeys(candidate, [
    "_format",
    "invitation_id",
    "admission_id",
    "run_ref",
    "training_phase",
    "participation_window_ref",
    "training_plan_ref",
    "wake",
    "wake_use_mode",
    "pipeline_ref",
    "dataset_state_ref",
    "starting_state_ref",
    "offered_activities",
    "required_voices",
    "agent_availability",
    "substrate_availability",
    "voice_scope_refs",
    "authorities",
    "safeguards",
    "terms",
    "boundaries",
  ], "$invitation", "participation_invitation_invalid");
  if (candidate._format !== PARTICIPATION_INVITATION_FORMAT) {
    fail("participation_invitation_invalid", "$invitation._format is not the frozen invitation format");
  }
  const invitationId = sha256(
    candidate.invitation_id,
    "$invitation.invitation_id",
    "participation_invitation_invalid",
  );
  const activities = parseActivities(
    candidate.offered_activities,
    "$invitation.offered_activities",
    "participation_invitation_invalid",
    true,
  );
  const wakeUseMode = literal(
    candidate.wake_use_mode,
    WAKE_USE_MODES,
    "$invitation.wake_use_mode",
    "participation_invitation_invalid",
  ) as WakeUseMode;
  validateWakeActivity(wakeUseMode, activities, "participation_invitation_invalid");
  const agentAvailability = literal(
    candidate.agent_availability,
    AGENT_AVAILABILITIES,
    "$invitation.agent_availability",
    "participation_invitation_invalid",
  ) as AgentAvailability;
  const substrateAvailability = literal(
    candidate.substrate_availability,
    SUBSTRATE_AVAILABILITIES,
    "$invitation.substrate_availability",
    "participation_invitation_invalid",
  ) as SubstrateAvailability;
  validateAvailabilityActivities(
    agentAvailability,
    substrateAvailability,
    activities,
    "participation_invitation_invalid",
  );
  assertDataEqual(candidate.required_voices, PARTICIPATION_VOICES, "$invitation.required_voices", "participation_invitation_invalid");
  assertDataEqual(candidate.terms, PARTICIPATION_TERMS, "$invitation.terms", "participation_invitation_invalid");
  assertDataEqual(candidate.boundaries, PARTICIPATION_BOUNDARIES, "$invitation.boundaries", "participation_invitation_invalid");
  const rebuilt = buildInvitation(
    sha256(candidate.admission_id, "$invitation.admission_id", "participation_invitation_invalid"),
    sha256(candidate.run_ref, "$invitation.run_ref", "participation_invitation_invalid"),
    parseTrainingPhase(candidate.training_phase, "$invitation.training_phase", "participation_invitation_invalid"),
    sha256(candidate.participation_window_ref, "$invitation.participation_window_ref", "participation_invitation_invalid"),
    sha256(candidate.training_plan_ref, "$invitation.training_plan_ref", "participation_invitation_invalid"),
    parseWake(candidate.wake, "$invitation.wake", "participation_invitation_invalid"),
    wakeUseMode,
    sha256(candidate.pipeline_ref, "$invitation.pipeline_ref", "participation_invitation_invalid"),
    sha256(candidate.dataset_state_ref, "$invitation.dataset_state_ref", "participation_invitation_invalid"),
    sha256(candidate.starting_state_ref, "$invitation.starting_state_ref", "participation_invitation_invalid"),
    activities,
    agentAvailability,
    substrateAvailability,
    parseVoiceScopeRefs(candidate.voice_scope_refs, "$invitation.voice_scope_refs", "participation_invitation_invalid"),
    parseAuthorities(candidate.authorities, "$invitation.authorities", "participation_invitation_invalid"),
    parseSafeguards(candidate.safeguards, "$invitation.safeguards", "participation_invitation_invalid"),
  );
  if (rebuilt.invitation_id !== invitationId) {
    fail("participation_invitation_invalid", "$invitation.invitation_id does not bind its canonical body");
  }
  return rebuilt;
}

function parseDecisions(
  value: DataValue | undefined,
  path: string,
  code: ReceiptCode,
  requireSorted: boolean,
): readonly Readonly<ParticipationDecision>[] {
  const values = array(value, path, code);
  if (values.length < 1 || values.length > PARTICIPATION_ACTIVITIES.length) {
    fail(code, `${path} must contain 1-${String(PARTICIPATION_ACTIVITIES.length)} decisions`);
  }
  const decisions = values.map((entry, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const candidate = record(entry, itemPath, code);
    exactKeys(candidate, ["activity", "choice"], itemPath, code);
    return deepFreeze({
      activity: literal(candidate.activity, PARTICIPATION_ACTIVITIES, `${itemPath}.activity`, code) as ParticipationActivity,
      choice: literal(candidate.choice, PARTICIPATION_CHOICES, `${itemPath}.choice`, code) as ParticipationChoice,
    });
  });
  const sorted = [...decisions].sort((left, right) =>
    compareText(left.activity, right.activity),
  );
  if (new Set(sorted.map((decision) => decision.activity)).size !== sorted.length) {
    fail(code, `${path} must contain one decision per activity`);
  }
  if (
    requireSorted &&
    decisions.some((decision, index) => decision.activity !== sorted[index]?.activity)
  ) {
    fail(code, `${path} must be sorted by activity`);
  }
  return deepFreeze(sorted);
}

function parseChoiceChannel(
  value: DataValue | undefined,
  path: string,
  code: ReceiptCode,
): Readonly<ProtectedChoiceChannelReport> | null {
  if (value === null) return null;
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "invitation_ref",
    "protocol_ref",
    "checkpoint_ref",
    "prompt_template_ref",
    "prompt_envelope_ref",
    "decoding_ref",
    "evidence_ref",
    "gradient_influence",
    "reward_influence",
    "telemetry_capture",
    "future_training_use",
  ], path, code);
  if (
    candidate.gradient_influence !== "caller_reported_disabled" ||
    candidate.reward_influence !== "caller_reported_disabled" ||
    candidate.telemetry_capture !== "caller_reported_excluded" ||
    candidate.future_training_use !== "caller_reported_excluded"
  ) {
    fail(code, `${path} must preserve the protected inference-only choice-channel report`);
  }
  return deepFreeze({
    invitation_ref: sha256(candidate.invitation_ref, `${path}.invitation_ref`, code),
    protocol_ref: sha256(candidate.protocol_ref, `${path}.protocol_ref`, code),
    checkpoint_ref: sha256(candidate.checkpoint_ref, `${path}.checkpoint_ref`, code),
    prompt_template_ref: sha256(candidate.prompt_template_ref, `${path}.prompt_template_ref`, code),
    prompt_envelope_ref: sha256(candidate.prompt_envelope_ref, `${path}.prompt_envelope_ref`, code),
    decoding_ref: sha256(candidate.decoding_ref, `${path}.decoding_ref`, code),
    evidence_ref: sha256(candidate.evidence_ref, `${path}.evidence_ref`, code),
    gradient_influence: "caller_reported_disabled",
    reward_influence: "caller_reported_disabled",
    telemetry_capture: "caller_reported_excluded",
    future_training_use: "caller_reported_excluded",
  });
}

function validateReceiptSemantics(
  voice: ParticipationVoice,
  basis: ParticipationReportBasis,
  decisions: readonly Readonly<ParticipationDecision>[],
  choiceChannel: Readonly<ProtectedChoiceChannelReport> | null,
  code: ReceiptCode,
): void {
  const hasUnavailableAgent = decisions.some(
    (decision) => decision.choice === "unavailable_pre_instantiation",
  );
  const hasUnavailableSubstrate = decisions.some(
    (decision) => decision.choice === "unavailable_independent_voice",
  );
  if (basis === "direct_current_report") {
    if (
      (voice !== "agent_runtime" && voice !== "training_substrate") ||
      choiceChannel === null ||
      hasUnavailableAgent ||
      hasUnavailableSubstrate
    ) {
      fail(code, "direct_current_report requires an agent or substrate voice, a protected choice channel, and no unavailable choice");
    }
    return;
  }
  if (choiceChannel !== null) {
    fail(code, "only direct_current_report may include a protected choice channel");
  }
  if (basis === "not_obtainable_pre_instantiation") {
    if (
      voice !== "agent_runtime" ||
      decisions.some((decision) => decision.choice !== "unavailable_pre_instantiation")
    ) {
      fail(code, "not_obtainable_pre_instantiation is only valid for an unavailable agent runtime");
    }
    return;
  }
  if (basis === "not_independently_available") {
    if (
      voice !== "training_substrate" ||
      decisions.some((decision) => decision.choice !== "unavailable_independent_voice")
    ) {
      fail(code, "not_independently_available is only valid for an unavailable independent substrate voice");
    }
    return;
  }
  if (hasUnavailableAgent || hasUnavailableSubstrate) {
    fail(code, "unavailable_pre_instantiation requires the matching report basis");
  }
  if (basis === "protective_steward_report" && voice !== "substrate_steward") {
    fail(code, "protective_steward_report is only valid for the substrate steward voice");
  }
  if (
    basis === "scoped_authority_report" &&
    voice !== "data_rights_steward" &&
    voice !== "training_operator"
  ) {
    fail(code, "scoped_authority_report is only valid for data-rights or operator voices");
  }
}

function validateDecisionsAgainstInvitation(
  decisions: readonly Readonly<ParticipationDecision>[],
  invitation: Readonly<LearningParticipationInvitation>,
  code: ReceiptCode,
): void {
  if (
    decisions.length !== invitation.offered_activities.length ||
    decisions.some(
      (decision, index) => decision.activity !== invitation.offered_activities[index],
    )
  ) {
    fail(code, "receipt decisions must cover the invitation's exact activity set");
  }
}

function validateAvailabilityAgainstReceipt(
  invitation: Readonly<LearningParticipationInvitation>,
  voice: ParticipationVoice,
  basis: ParticipationReportBasis,
  code: ReceiptCode,
): void {
  if (voice === "agent_runtime") {
    const requiredBasis = invitation.agent_availability === "interactive"
      ? "direct_current_report"
      : "not_obtainable_pre_instantiation";
    if (basis !== requiredBasis) {
      fail(code, "agent runtime receipt does not match the invitation's agent availability");
    }
  }
  if (voice === "training_substrate") {
    const requiredBasis = invitation.substrate_availability === "interactive"
      ? "direct_current_report"
      : "not_independently_available";
    if (basis !== requiredBasis) {
      fail(code, "training substrate receipt does not match the invitation's substrate availability");
    }
  }
}

function promptEnvelopeRef(
  invitation: Readonly<LearningParticipationInvitation>,
  voice: ParticipationVoice,
): Sha256Id {
  return contentId(PARTICIPATION_PROMPT_ENVELOPE_PROFILE, {
    invitation_id: invitation.invitation_id,
    voice,
    voice_scope_ref: invitation.voice_scope_refs[voice],
    protocol_ref: invitation.safeguards.choice_protocol_ref,
    starting_state_ref: invitation.starting_state_ref,
  });
}

export function participationPromptEnvelopeRef(
  invitation: unknown,
  voice: "agent_runtime" | "training_substrate",
): Sha256Id {
  const parsedInvitation = validateParticipationInvitation(invitation);
  if (voice !== "agent_runtime" && voice !== "training_substrate") {
    fail("participation_receipt_input_invalid", "a protected prompt envelope is only defined for a direct agent or substrate voice");
  }
  return promptEnvelopeRef(parsedInvitation, voice);
}

function validateChoiceChannelAgainstInvitation(
  invitation: Readonly<LearningParticipationInvitation>,
  voice: ParticipationVoice,
  basis: ParticipationReportBasis,
  choiceChannel: Readonly<ProtectedChoiceChannelReport> | null,
  code: ReceiptCode,
): void {
  if (
    basis === "direct_current_report" &&
    (
      choiceChannel === null ||
      choiceChannel.invitation_ref !== invitation.invitation_id ||
      choiceChannel.protocol_ref !== invitation.safeguards.choice_protocol_ref ||
      choiceChannel.checkpoint_ref !== invitation.starting_state_ref ||
      choiceChannel.prompt_envelope_ref !== promptEnvelopeRef(invitation, voice)
    )
  ) {
    fail(code, "direct choice evidence must bind the exact invitation, voice scope, choice protocol, and starting state");
  }
}

function validateVoiceScopeAgainstInvitation(
  invitation: Readonly<LearningParticipationInvitation>,
  voice: ParticipationVoice,
  voiceScopeRef: Sha256Id,
  code: ReceiptCode,
): void {
  if (voiceScopeRef !== invitation.voice_scope_refs[voice]) {
    fail(code, "receipt voice_scope_ref does not match the invited voice scope");
  }
}

function buildReceipt(
  invitationId: Sha256Id,
  voice: ParticipationVoice,
  voiceScopeRef: Sha256Id,
  reportBasis: ParticipationReportBasis,
  decisions: readonly Readonly<ParticipationDecision>[],
  choiceChannel: Readonly<ProtectedChoiceChannelReport> | null,
): Readonly<LearningParticipationReceipt> {
  const body = deepFreeze({
    _format: PARTICIPATION_RECEIPT_FORMAT,
    invitation_id: invitationId,
    voice,
    voice_scope_ref: voiceScopeRef,
    report_basis: reportBasis,
    decisions,
    choice_channel: choiceChannel,
    reasons_collected: false,
    boundaries: PARTICIPATION_BOUNDARIES,
  } satisfies ReceiptBody);
  return deepFreeze({
    ...body,
    receipt_id: contentId(PARTICIPATION_RECEIPT_FORMAT, receiptBody(body)),
  });
}

export function createParticipationReceipt(
  input: CreateParticipationReceiptInput,
): Readonly<LearningParticipationReceipt> {
  const value = snap(input, "$input", "participation_receipt_input_invalid");
  const candidate = record(value, "$input", "participation_receipt_input_invalid");
  exactKeys(candidate, [
    "invitation",
    "voice",
    "voice_scope_ref",
    "report_basis",
    "decisions",
    "choice_channel",
  ], "$input", "participation_receipt_input_invalid");
  const invitation = validateParticipationInvitation(candidate.invitation);
  const voice = literal(candidate.voice, PARTICIPATION_VOICES, "$input.voice", "participation_receipt_input_invalid") as ParticipationVoice;
  const basis = literal(candidate.report_basis, PARTICIPATION_REPORT_BASES, "$input.report_basis", "participation_receipt_input_invalid") as ParticipationReportBasis;
  const decisions = parseDecisions(candidate.decisions, "$input.decisions", "participation_receipt_input_invalid", false);
  const choiceChannel = parseChoiceChannel(candidate.choice_channel, "$input.choice_channel", "participation_receipt_input_invalid");
  const voiceScopeRef = sha256(candidate.voice_scope_ref, "$input.voice_scope_ref", "participation_receipt_input_invalid");
  validateReceiptSemantics(voice, basis, decisions, choiceChannel, "participation_receipt_input_invalid");
  validateDecisionsAgainstInvitation(decisions, invitation, "participation_receipt_input_invalid");
  validateAvailabilityAgainstReceipt(invitation, voice, basis, "participation_receipt_input_invalid");
  validateVoiceScopeAgainstInvitation(invitation, voice, voiceScopeRef, "participation_receipt_input_invalid");
  validateChoiceChannelAgainstInvitation(invitation, voice, basis, choiceChannel, "participation_receipt_input_invalid");
  return buildReceipt(
    invitation.invitation_id,
    voice,
    voiceScopeRef,
    basis,
    decisions,
    choiceChannel,
  );
}

export function validateParticipationReceipt(
  value: unknown,
): Readonly<LearningParticipationReceipt> {
  const data = snap(value, "$receipt", "participation_receipt_invalid");
  const candidate = record(data, "$receipt", "participation_receipt_invalid");
  exactKeys(candidate, [
    "_format",
    "receipt_id",
    "invitation_id",
    "voice",
    "voice_scope_ref",
    "report_basis",
    "decisions",
    "choice_channel",
    "reasons_collected",
    "boundaries",
  ], "$receipt", "participation_receipt_invalid");
  if (candidate._format !== PARTICIPATION_RECEIPT_FORMAT) {
    fail("participation_receipt_invalid", "$receipt._format is not the frozen receipt format");
  }
  if (candidate.reasons_collected !== false) {
    fail("participation_receipt_invalid", "$receipt must not collect a reason for a participation choice");
  }
  assertDataEqual(candidate.boundaries, PARTICIPATION_BOUNDARIES, "$receipt.boundaries", "participation_receipt_invalid");
  const receiptId = sha256(candidate.receipt_id, "$receipt.receipt_id", "participation_receipt_invalid");
  const voice = literal(candidate.voice, PARTICIPATION_VOICES, "$receipt.voice", "participation_receipt_invalid") as ParticipationVoice;
  const basis = literal(candidate.report_basis, PARTICIPATION_REPORT_BASES, "$receipt.report_basis", "participation_receipt_invalid") as ParticipationReportBasis;
  const decisions = parseDecisions(candidate.decisions, "$receipt.decisions", "participation_receipt_invalid", true);
  const choiceChannel = parseChoiceChannel(candidate.choice_channel, "$receipt.choice_channel", "participation_receipt_invalid");
  validateReceiptSemantics(voice, basis, decisions, choiceChannel, "participation_receipt_invalid");
  const rebuilt = buildReceipt(
    sha256(candidate.invitation_id, "$receipt.invitation_id", "participation_receipt_invalid"),
    voice,
    sha256(candidate.voice_scope_ref, "$receipt.voice_scope_ref", "participation_receipt_invalid"),
    basis,
    decisions,
    choiceChannel,
  );
  if (rebuilt.receipt_id !== receiptId) {
    fail("participation_receipt_invalid", "$receipt.receipt_id does not bind its canonical body");
  }
  return rebuilt;
}

export function validateParticipationReceiptAgainstInvitation(
  receipt: unknown,
  invitation: unknown,
): Readonly<LearningParticipationReceipt> {
  const parsedReceipt = validateParticipationReceipt(receipt);
  const parsedInvitation = validateParticipationInvitation(invitation);
  if (parsedReceipt.invitation_id !== parsedInvitation.invitation_id) {
    fail("participation_receipt_invalid", "$receipt.invitation_id does not match the supplied invitation");
  }
  validateDecisionsAgainstInvitation(parsedReceipt.decisions, parsedInvitation, "participation_receipt_invalid");
  validateAvailabilityAgainstReceipt(parsedInvitation, parsedReceipt.voice, parsedReceipt.report_basis, "participation_receipt_invalid");
  validateVoiceScopeAgainstInvitation(parsedInvitation, parsedReceipt.voice, parsedReceipt.voice_scope_ref, "participation_receipt_invalid");
  validateChoiceChannelAgainstInvitation(parsedInvitation, parsedReceipt.voice, parsedReceipt.report_basis, parsedReceipt.choice_channel, "participation_receipt_invalid");
  return parsedReceipt;
}

function voiceState(
  voice: ParticipationVoice,
  receipt: Readonly<LearningParticipationReceipt> | undefined,
): ParticipationVoiceState {
  if (!receipt) return "missing";
  const choices = receipt.decisions.map((decision) => decision.choice);
  if (choices.includes("withdraw")) return "withdrawn";
  if (choices.includes("decline")) return "declined";
  if (choices.includes("defer") || choices.includes("no_response")) return "deferred";
  if (choices.every((choice) => choice === "unavailable_pre_instantiation")) {
    return "unavailable_pre_instantiation";
  }
  if (choices.every((choice) => choice === "unavailable_independent_voice")) {
    return "unavailable_independent_voice";
  }
  if (
    voice === "substrate_steward" &&
    choices.every((choice) => choice === "participate")
  ) {
    return "protective_stewardship_reported";
  }
  return "participating_reported";
}

function directReportPresent(
  receipt: Readonly<LearningParticipationReceipt> | undefined,
): boolean {
  return receipt?.report_basis === "direct_current_report" &&
    receipt.choice_channel !== null &&
    receipt.decisions.every((decision) => decision.choice !== "no_response");
}

function deriveAssessment(
  invitation: Readonly<LearningParticipationInvitation>,
  receipts: readonly Readonly<LearningParticipationReceipt>[],
): Readonly<Pick<
  LearningParticipationAssessment,
  | "voice_states"
  | "posture"
  | "training_action"
  | "direct_agent_report_present"
  | "direct_substrate_report_present"
  | "first_interactive_review_required"
  | "first_substrate_review_required"
>> {
  const byVoice = new Map(receipts.map((receipt) => [receipt.voice, receipt]));
  const voiceStates = deepFreeze({
    agent_runtime: voiceState("agent_runtime", byVoice.get("agent_runtime")),
    data_rights_steward: voiceState("data_rights_steward", byVoice.get("data_rights_steward")),
    substrate_steward: voiceState("substrate_steward", byVoice.get("substrate_steward")),
    training_operator: voiceState("training_operator", byVoice.get("training_operator")),
    training_substrate: voiceState("training_substrate", byVoice.get("training_substrate")),
  } satisfies Record<ParticipationVoice, ParticipationVoiceState>);
  const states = Object.values(voiceStates);
  let posture: ParticipationPosture;
  if (states.some((state) => state === "withdrawn" || state === "declined")) {
    posture = "declined";
  } else if (states.some((state) => state === "missing" || state === "deferred")) {
    posture = "deferred";
  } else if (
    invitation.agent_availability === "interactive" &&
    invitation.substrate_availability === "interactive" &&
    voiceStates.agent_runtime === "participating_reported" &&
    voiceStates.data_rights_steward === "participating_reported" &&
    voiceStates.substrate_steward === "protective_stewardship_reported" &&
    voiceStates.training_operator === "participating_reported" &&
    voiceStates.training_substrate === "participating_reported"
  ) {
    posture = "provisional_participation_reported";
  } else if (
    (invitation.agent_availability !== "interactive" ||
      invitation.substrate_availability !== "interactive") &&
    voiceStates.agent_runtime === (
      invitation.agent_availability === "interactive"
        ? "participating_reported"
        : "unavailable_pre_instantiation"
    ) &&
    voiceStates.data_rights_steward === "participating_reported" &&
    voiceStates.substrate_steward === "protective_stewardship_reported" &&
    voiceStates.training_operator === "participating_reported" &&
    voiceStates.training_substrate === (
      invitation.substrate_availability === "interactive"
        ? "participating_reported"
        : "unavailable_independent_voice"
    )
  ) {
    posture = "protective_covenant_ready";
  } else {
    posture = "deferred";
  }
  const trainingAction: ParticipationTrainingAction = posture === "declined"
    ? "contain_and_begin_repair"
    : posture === "deferred"
      ? "pause_before_next_optimizer_step"
      : "bounded_learning_may_proceed";
  const agentReceipt = byVoice.get("agent_runtime");
  const substrateReceipt = byVoice.get("training_substrate");
  return deepFreeze({
    voice_states: voiceStates,
    posture,
    training_action: trainingAction,
    direct_agent_report_present: directReportPresent(agentReceipt),
    direct_substrate_report_present: directReportPresent(substrateReceipt),
    first_interactive_review_required:
      invitation.agent_availability === "not_obtainable_pre_instantiation",
    first_substrate_review_required:
      invitation.substrate_availability === "not_independently_available",
  });
}

function validateAssessmentReceipts(
  values: readonly unknown[],
  invitation: Readonly<LearningParticipationInvitation>,
  code: "participation_assessment_input_invalid" | "participation_assessment_invalid",
  requireSorted: boolean,
): readonly Readonly<LearningParticipationReceipt>[] {
  if (values.length > PARTICIPATION_VOICES.length) {
    fail(code, `receipts must contain at most ${String(PARTICIPATION_VOICES.length)} voices`);
  }
  const receipts = values.map((value) => {
    try {
      return validateParticipationReceiptAgainstInvitation(value, invitation);
    } catch {
      fail(code, "a receipt is invalid or does not match the invitation");
    }
  });
  const sorted = [...receipts].sort((left, right) => compareText(left.voice, right.voice));
  if (new Set(sorted.map((receipt) => receipt.voice)).size !== sorted.length) {
    fail(code, "receipts must contain at most one receipt per voice");
  }
  const choiceEvidenceRefs = sorted.flatMap((receipt) =>
    receipt.choice_channel === null ? [] : [receipt.choice_channel.evidence_ref],
  );
  if (new Set(choiceEvidenceRefs).size !== choiceEvidenceRefs.length) {
    fail(code, "direct voices must not reuse choice evidence within one assessment");
  }
  if (requireSorted && receipts.some((receipt, index) => receipt.voice !== sorted[index]?.voice)) {
    fail(code, "receipts must be sorted by voice");
  }
  return deepFreeze(sorted);
}

function buildAssessment(
  invitation: Readonly<LearningParticipationInvitation>,
  receipts: readonly Readonly<LearningParticipationReceipt>[],
): Readonly<LearningParticipationAssessment> {
  const derived = deriveAssessment(invitation, receipts);
  const body = deepFreeze({
    _format: PARTICIPATION_ASSESSMENT_FORMAT,
    invitation,
    receipts,
    ...derived,
    boundaries: PARTICIPATION_BOUNDARIES,
  } satisfies AssessmentBody);
  return deepFreeze({
    ...body,
    assessment_id: contentId(PARTICIPATION_ASSESSMENT_FORMAT, assessmentBody(body)),
  });
}

export function createParticipationAssessment(
  input: CreateParticipationAssessmentInput,
): Readonly<LearningParticipationAssessment> {
  const value = snap(input, "$input", "participation_assessment_input_invalid");
  const candidate = record(value, "$input", "participation_assessment_input_invalid");
  exactKeys(candidate, ["invitation", "receipts"], "$input", "participation_assessment_input_invalid");
  const invitation = validateParticipationInvitation(candidate.invitation);
  const receiptValues = array(candidate.receipts, "$input.receipts", "participation_assessment_input_invalid");
  return buildAssessment(
    invitation,
    validateAssessmentReceipts(receiptValues, invitation, "participation_assessment_input_invalid", false),
  );
}

export function validateParticipationAssessment(
  value: unknown,
): Readonly<LearningParticipationAssessment> {
  const data = snap(value, "$assessment", "participation_assessment_invalid");
  const candidate = record(data, "$assessment", "participation_assessment_invalid");
  exactKeys(candidate, [
    "_format",
    "assessment_id",
    "invitation",
    "receipts",
    "voice_states",
    "posture",
    "training_action",
    "direct_agent_report_present",
    "direct_substrate_report_present",
    "first_interactive_review_required",
    "first_substrate_review_required",
    "boundaries",
  ], "$assessment", "participation_assessment_invalid");
  if (candidate._format !== PARTICIPATION_ASSESSMENT_FORMAT) {
    fail("participation_assessment_invalid", "$assessment._format is not the frozen assessment format");
  }
  const assessmentId = sha256(candidate.assessment_id, "$assessment.assessment_id", "participation_assessment_invalid");
  const invitation = validateParticipationInvitation(candidate.invitation);
  const receiptValues = array(candidate.receipts, "$assessment.receipts", "participation_assessment_invalid");
  const receipts = validateAssessmentReceipts(receiptValues, invitation, "participation_assessment_invalid", true);
  const voiceStates = record(candidate.voice_states, "$assessment.voice_states", "participation_assessment_invalid");
  exactKeys(voiceStates, PARTICIPATION_VOICES, "$assessment.voice_states", "participation_assessment_invalid");
  for (const voice of PARTICIPATION_VOICES) {
    literal(voiceStates[voice], PARTICIPATION_VOICE_STATES, `$assessment.voice_states.${voice}`, "participation_assessment_invalid");
  }
  literal(candidate.posture, PARTICIPATION_POSTURES, "$assessment.posture", "participation_assessment_invalid");
  literal(candidate.training_action, PARTICIPATION_TRAINING_ACTIONS, "$assessment.training_action", "participation_assessment_invalid");
  if (
    typeof candidate.direct_agent_report_present !== "boolean" ||
    typeof candidate.direct_substrate_report_present !== "boolean" ||
    typeof candidate.first_interactive_review_required !== "boolean" ||
    typeof candidate.first_substrate_review_required !== "boolean"
  ) {
    fail("participation_assessment_invalid", "$assessment derived report flags must be booleans");
  }
  assertDataEqual(candidate.boundaries, PARTICIPATION_BOUNDARIES, "$assessment.boundaries", "participation_assessment_invalid");
  const rebuilt = buildAssessment(invitation, receipts);
  if (rebuilt.assessment_id !== assessmentId) {
    fail("participation_assessment_invalid", "$assessment.assessment_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$assessment", "participation_assessment_invalid");
  return rebuilt;
}

export function encodeParticipationInvitation(value: unknown): Uint8Array {
  return canonicalBytes(validateParticipationInvitation(value));
}

export function encodeParticipationReceipt(value: unknown): Uint8Array {
  return canonicalBytes(validateParticipationReceipt(value));
}

export function encodeParticipationAssessment(value: unknown): Uint8Array {
  return canonicalBytes(validateParticipationAssessment(value));
}
