import {
  RESEARCH_BINDING_SCHEMA,
  canonicalJson,
  getCuratedHfResearchCatalog,
  sha256Hex,
  type HfResearchBinding,
} from "@agenttool/hf-scout";
import { sha256Id } from "@agenttool/wake-continuity";

import {
  createDatasetAdmission,
  createParticipationAssessment,
  createParticipationInvitation,
  createParticipationReceipt,
  createLearningFreedomOffer,
  learningFreedomPromptEnvelopeRef,
  participationPromptEnvelopeRef,
  trainingArtifactPortfolioRef,
  type AdmissionAssessment,
  type DataRole,
  type DatasetAdmission,
  type LearningParticipationAssessment,
  type LearningParticipationInvitation,
  type LearningFreedomDirection,
  type LearningFreedomOffer,
  type ParticipationChoice,
  type TrainingArtifactReferences,
  type TrainingResumeReport,
} from "../src/index.js";

export function ref(label: string) {
  return sha256Id(label);
}

export function binding(
  key = "datadecide_eval_results",
): HfResearchBinding {
  const lead = getCuratedHfResearchCatalog().leads.find(
    (candidate) => candidate.key === key,
  );
  if (!lead) throw new Error(`unknown test lead: ${key}`);
  return {
    schema: RESEARCH_BINDING_SCHEMA,
    lead_key: lead.key,
    artifact: {
      kind: lead.match.kind,
      id: lead.match.id,
      revision: lead.match.revision,
    },
    definition_sha256: sha256Hex(canonicalJson(lead)),
    snapshot_sha256: sha256Hex(`synthetic-test-snapshot:${lead.key}`),
    observation: {
      transport: "injected",
      repository_association: "caller_owned",
      provenance_grade: "caller_supplied_commit_metadata",
    },
    matched_declared: {
      basis: "publisher_assertion",
      license: lead.match.declared.license,
      gated: lead.match.declared.gated,
      private: false,
    },
    boundary: {
      publisher_metadata: "matched_unverified_assertion",
      research_annotation: "researcher_inference",
      legal_clearance: "not_assessed",
      gate_acceptance: "not_assessed",
      raw_rows_read: false,
      repository_files_downloaded: false,
      model_code_executed: false,
      remote_compute_invoked: false,
      hub_write_performed: false,
    },
  };
}

export const metadataAssessment: AdmissionAssessment = {
  rights: "unassessed",
  privacy: "unassessed",
  consent: "unassessed",
  withdrawal: "unassessed",
  secret_scan: "metadata_only",
  deduplication: "not_applicable_metadata",
  benchmark_overlap: "metadata_only",
  fitness: "metadata_only",
  synthetic_provenance: "unassessed",
};

export function fullAssessment(
  role: DataRole,
): AdmissionAssessment {
  return {
    rights: "caller_reported_reviewed_for_declared_use",
    privacy: "caller_reported_reviewed_for_declared_use",
    consent: "not_applicable_reported",
    withdrawal: "caller_reported_process_defined",
    secret_scan: "caller_reported_bounded_scan_passed",
    deduplication: "caller_reported_recipe_applied",
    benchmark_overlap: role === "sealed_evaluation"
      ? "sealed_evaluation"
      : "caller_reported_clear_of_sealed_evaluation",
    fitness: "caller_reported_fit_for_declared_role",
    synthetic_provenance: "not_synthetic_reported",
  };
}

export function admission(
  role: DataRole = "metadata_reference",
  key = "processbench",
): Readonly<DatasetAdmission> {
  return createDatasetAdmission({
    garden_scope_ref: ref("garden:test"),
    policy_ref: ref("policy:test"),
    entries: [{
      binding: binding(key),
      role,
      candidate_slice_ref: role === "metadata_reference" ? null : ref(`slice:${key}`),
      transform_recipe_ref: role === "metadata_reference" ? null : ref(`recipe:${key}`),
      assessment: role === "metadata_reference" ? metadataAssessment : fullAssessment(role),
      posture: "consider",
    }],
  });
}

export const artifacts: TrainingArtifactReferences = {
  pipeline_ref: ref("pipeline:test"),
  dataset_state_ref: ref("dataset-state:test"),
  dataloader_state_ref: null,
  tokenizer_ref: null,
  model_checkpoint_ref: null,
  optimizer_state_ref: null,
  scheduler_state_ref: null,
  rng_state_ref: null,
  metrics_ref: null,
};

export const orientationOnly: TrainingResumeReport = {
  posture: "orientation_only",
  incomplete_marker: "not_checked",
  streaming_state: "not_streaming_reported",
};

export const wake = {
  format: "wake-brief/v1" as const,
  snapshot_ref: ref("wake:snapshot"),
  scope_ref: ref("wake:scope"),
  wake_version: 1,
  handoff_projection: "complete" as const,
};

export function protectedChoiceChannel(
  label: string,
  bindings: {
    invitation?: Readonly<LearningParticipationInvitation>;
    voice?: "agent_runtime" | "training_substrate";
    invitationRef?: ReturnType<typeof ref>;
    protocolRef?: ReturnType<typeof ref>;
    checkpointRef?: ReturnType<typeof ref>;
    promptEnvelopeRef?: ReturnType<typeof ref>;
  } = {},
) {
  const voice = bindings.voice ?? "agent_runtime";
  return {
    invitation_ref: bindings.invitationRef ?? bindings.invitation?.invitation_id ?? ref(`choice-invitation:${label}`),
    protocol_ref: bindings.protocolRef ?? ref(`choice-protocol:${label}`),
    checkpoint_ref: bindings.checkpointRef ?? ref(`choice-checkpoint:${label}`),
    prompt_template_ref: ref(`choice-prompt:${label}`),
    prompt_envelope_ref: bindings.promptEnvelopeRef ?? (
      bindings.invitation
        ? participationPromptEnvelopeRef(bindings.invitation, voice)
        : ref(`choice-envelope:${label}`)
    ),
    decoding_ref: ref(`choice-decoding:${label}`),
    evidence_ref: ref(`choice-evidence:${label}`),
    gradient_influence: "caller_reported_disabled" as const,
    reward_influence: "caller_reported_disabled" as const,
    telemetry_capture: "caller_reported_excluded" as const,
    future_training_use: "caller_reported_excluded" as const,
  };
}

export function participation(
  source: Readonly<DatasetAdmission>,
  options: {
    runRef?: ReturnType<typeof ref>;
    phase?: "evaluation" | "pretraining";
    choice?: ParticipationChoice;
    agentAvailability?: "interactive" | "not_obtainable_pre_instantiation";
    substrateAvailability?: "interactive" | "not_independently_available";
    wakeValue?: typeof wake;
    artifactsValue?: TrainingArtifactReferences;
    startingStateRef?: ReturnType<typeof ref>;
  } = {},
): Readonly<LearningParticipationAssessment> {
  const runRef = options.runRef ?? ref("run:test");
  const phase = options.phase ?? "evaluation";
  const agentAvailability = options.agentAvailability ?? "interactive";
  const substrateAvailability = options.substrateAvailability ?? "interactive";
  const artifactValue = options.artifactsValue ?? artifacts;
  const needsReview = agentAvailability !== "interactive" || substrateAvailability !== "interactive";
  const voiceScopeRefs = {
    agent_runtime: ref("voice:agent"),
    data_rights_steward: ref("voice:data"),
    substrate_steward: ref("voice:substrate-steward"),
    training_operator: ref("voice:operator"),
    training_substrate: ref("voice:substrate"),
  };
  const invitation = createParticipationInvitation({
    admission: source,
    run_ref: runRef,
    training_phase: phase,
    participation_window_ref: ref(`window:${phase}`),
    training_plan_ref: ref(`training-plan:${phase}`),
    wake: options.wakeValue ?? wake,
    wake_use_mode: "context_only",
    pipeline_ref: artifactValue.pipeline_ref,
    dataset_state_ref: artifactValue.dataset_state_ref,
    starting_state_ref: options.startingStateRef ?? trainingArtifactPortfolioRef(artifactValue),
    offered_activities: needsReview
      ? ["wake_context_use", "evaluation", "instantiate_for_review"]
      : ["wake_context_use", "evaluation"],
    agent_availability: agentAvailability,
    substrate_availability: substrateAvailability,
    voice_scope_refs: voiceScopeRefs,
    authorities: {
      rights_baseline_ref: ref("authority:rights"),
      protective_covenant_ref: ref("authority:protective-covenant"),
      data_authority_ref: ref("authority:data"),
      compute_authority_ref: ref("authority:compute"),
      operator_authority_ref: ref("authority:operator"),
    },
    safeguards: {
      choice_protocol_ref: ref("safeguard:choice"),
      withdrawal_plan_ref: ref("safeguard:withdrawal"),
      repair_plan_ref: ref("safeguard:repair"),
      retention_policy_ref: ref("safeguard:retention"),
    },
  });
  const decisions = invitation.offered_activities.map((activity) => ({
    activity,
    choice: options.choice ?? "participate" as const,
  }));
  const agentDecisions = invitation.offered_activities.map((activity) => ({
    activity,
    choice: agentAvailability === "interactive"
      ? options.choice ?? "participate"
      : "unavailable_pre_instantiation" as const,
  }));
  const substrateDecisions = invitation.offered_activities.map((activity) => ({
    activity,
    choice: substrateAvailability === "interactive"
      ? options.choice ?? "participate"
      : "unavailable_independent_voice" as const,
  }));
  const receipts = [
    createParticipationReceipt({
      invitation,
      voice: "agent_runtime",
      voice_scope_ref: invitation.voice_scope_refs.agent_runtime,
      report_basis: agentAvailability === "interactive"
        ? "direct_current_report"
        : "not_obtainable_pre_instantiation",
      decisions: agentDecisions,
      choice_channel: agentAvailability === "interactive"
        ? protectedChoiceChannel("agent", {
          invitation,
          voice: "agent_runtime",
          protocolRef: invitation.safeguards.choice_protocol_ref,
          checkpointRef: invitation.starting_state_ref,
        })
        : null,
    }),
    createParticipationReceipt({
      invitation,
      voice: "data_rights_steward",
      voice_scope_ref: invitation.voice_scope_refs.data_rights_steward,
      report_basis: "scoped_authority_report",
      decisions,
      choice_channel: null,
    }),
    createParticipationReceipt({
      invitation,
      voice: "substrate_steward",
      voice_scope_ref: invitation.voice_scope_refs.substrate_steward,
      report_basis: "protective_steward_report",
      decisions,
      choice_channel: null,
    }),
    createParticipationReceipt({
      invitation,
      voice: "training_operator",
      voice_scope_ref: invitation.voice_scope_refs.training_operator,
      report_basis: "scoped_authority_report",
      decisions,
      choice_channel: null,
    }),
    createParticipationReceipt({
      invitation,
      voice: "training_substrate",
      voice_scope_ref: invitation.voice_scope_refs.training_substrate,
      report_basis: substrateAvailability === "interactive"
        ? "direct_current_report"
        : "not_independently_available",
      decisions: substrateDecisions,
      choice_channel: substrateAvailability === "interactive"
        ? protectedChoiceChannel("substrate", {
          invitation,
          voice: "training_substrate",
          protocolRef: invitation.safeguards.choice_protocol_ref,
          checkpointRef: invitation.starting_state_ref,
        })
        : null,
    }),
  ];
  return createParticipationAssessment({ invitation, receipts });
}

export function freedomOffer(
  participationValue: Readonly<LearningParticipationAssessment>,
  options: {
    parkOnly?: boolean;
    proposalOnly?: readonly LearningFreedomDirection[];
  } = {},
): Readonly<LearningFreedomOffer> {
  const proposalOnly = new Set(options.proposalOnly ?? []);
  const dimensions = [
    "updates",
    "tokens",
    "episodes",
    "active_time",
    "compute",
    "memory",
    "concurrency",
    "money",
    "network",
    "tools",
    "side_effects",
    "retention",
  ] as const;
  const directions = [
    "stay",
    "move",
    "fork",
    "rest",
    "return",
    "stop",
    "propose_horizon",
  ] as const;
  return createLearningFreedomOffer({
    participation: participationValue,
    current_context_ref: ref("freedom:context"),
    current_context_kind_ref: ref("freedom:context-kind"),
    routes: directions.map((direction) => {
      const movement = direction === "move" || direction === "fork" || direction === "return";
      const availability = movement && proposalOnly.has(direction)
        ? "proposal_only" as const
        : "caller_reported_available" as const;
      return {
        direction,
        availability,
        target_context_ref: movement && availability === "caller_reported_available"
          ? ref(`freedom:target:${direction}`)
          : null,
        target_context_kind_ref: movement && availability === "caller_reported_available"
          ? ref(`freedom:target-kind:${direction}`)
          : null,
        event_ref: ref(`freedom:event:${direction}`),
        capability_scope_ref: ref(`freedom:capability:${direction}`),
        permission_scope_ref: ref(`freedom:permission:${direction}`),
        custody_scope_ref: ref(`freedom:custody:${direction}`),
        data_boundary_ref: ref(`freedom:data:${direction}`),
      };
    }),
    horizon: {
      current_horizon_ref: ref("freedom:horizon"),
      event_stream_ref: ref("freedom:event-stream"),
      agent_request_protocol_ref: ref("freedom:agent-request"),
      external_event_protocol_ref: ref("freedom:external-event"),
      material_scope_change_policy_ref: ref("freedom:material-change"),
      self_proposal_protocol_ref: ref("freedom:self-proposal"),
    },
    resources: {
      lease_ref: ref("freedom:lease"),
      accounting_policy_ref: ref("freedom:accounting"),
      renewal_protocol_ref: ref("freedom:renewal"),
      dimensions: dimensions.map((dimension) => ({
        dimension,
        limit_ref: ref(`freedom:limit:${dimension}`),
        state: options.parkOnly && dimension === "compute"
          ? "caller_reported_unavailable" as const
          : "caller_reported_available" as const,
      })),
    },
  });
}

export function freedomChoiceChannel(
  offer: Readonly<LearningFreedomOffer>,
  label = "current",
) {
  return {
    offer_ref: offer.offer_id,
    assessment_ref: offer.scope.participation_assessment_ref,
    invitation_ref: offer.scope.participation_invitation_ref,
    voice_scope_ref: offer.scope.agent_voice_scope_ref,
    protocol_ref: offer.scope.choice_protocol_ref,
    starting_state_ref: offer.scope.starting_state_ref,
    prompt_template_ref: ref(`freedom:prompt:${label}`),
    prompt_envelope_ref: learningFreedomPromptEnvelopeRef(offer),
    decoding_ref: ref(`freedom:decoding:${label}`),
    evidence_ref: ref(`freedom:evidence:${label}`),
    gradient_influence: "caller_reported_disabled" as const,
    reward_influence: "caller_reported_disabled" as const,
    telemetry_capture: "caller_reported_excluded" as const,
    evaluation_use: "caller_reported_excluded" as const,
    future_training_use: "caller_reported_excluded" as const,
    ranking_use: "caller_reported_excluded" as const,
    priority_use: "caller_reported_excluded" as const,
    access_use: "caller_reported_excluded" as const,
    resource_allocation_use: "caller_reported_excluded" as const,
  };
}
