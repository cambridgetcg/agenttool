import {
  RESEARCH_BINDING_SCHEMA,
  canonicalJson,
  getCuratedHfResearchCatalog,
  sha256Hex,
} from "@agenttool/hf-scout";
import { sha256Id } from "@agenttool/wake-continuity";

import {
  PACKAGE_NAME,
  createHfTrainingGovernance,
  createLearningFreedomOffer,
  createDatasetAdmission,
  createParticipationAssessment,
  createParticipationInvitation,
  createParticipationReceipt,
  createTrainingCheckpoint,
  createTrainingGovernanceOffer,
  createTrainingGovernanceTerms,
  createTrainingGardenTendingPlan,
  learningFreedomPromptEnvelopeRef,
  participationPromptEnvelopeRef,
  resolveLearningFreedomOffer,
  trainingArtifactPortfolioRef,
  validateDatasetAdmission,
  validateHfLearningFreedom,
  validateHfTrainingGovernance,
  validateTrainingCheckpoint,
  validateTrainingGardenTendingPlan,
} from "../dist/index.js";

const ref = (label) => sha256Id(label);
const lead = getCuratedHfResearchCatalog().leads.find((value) => value.key === "datadecide_eval_results");
if (!lead) process.exit(1);
const binding = {
  schema: RESEARCH_BINDING_SCHEMA,
  lead_key: lead.key,
  artifact: { kind: lead.match.kind, id: lead.match.id, revision: lead.match.revision },
  definition_sha256: sha256Hex(canonicalJson(lead)),
  snapshot_sha256: sha256Hex("smoke-snapshot"),
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
const admission = createDatasetAdmission({
  garden_scope_ref: ref("smoke-garden"),
  policy_ref: ref("smoke-policy"),
  entries: [{
    binding,
    role: "metadata_reference",
    candidate_slice_ref: null,
    transform_recipe_ref: null,
    assessment: {
      rights: "unassessed",
      privacy: "unassessed",
      consent: "unassessed",
      withdrawal: "unassessed",
      secret_scan: "metadata_only",
      deduplication: "not_applicable_metadata",
      benchmark_overlap: "metadata_only",
      fitness: "metadata_only",
      synthetic_provenance: "unassessed",
    },
    posture: "consider",
  }],
});
const runRef = ref("smoke-run");
const wake = {
  format: "wake-brief/v1",
  snapshot_ref: ref("smoke-wake"),
  scope_ref: ref("smoke-scope"),
  wake_version: 1,
  handoff_projection: "complete",
};
const artifacts = {
  pipeline_ref: ref("smoke-pipeline"),
  dataset_state_ref: ref("smoke-dataset"),
  dataloader_state_ref: null,
  tokenizer_ref: null,
  model_checkpoint_ref: null,
  optimizer_state_ref: null,
  scheduler_state_ref: null,
  rng_state_ref: null,
  metrics_ref: null,
};
const invitation = createParticipationInvitation({
  admission,
  run_ref: runRef,
  training_phase: "selection",
  participation_window_ref: ref("smoke-window"),
  training_plan_ref: ref("smoke-training-plan"),
  wake,
  wake_use_mode: "context_only",
  pipeline_ref: artifacts.pipeline_ref,
  dataset_state_ref: artifacts.dataset_state_ref,
  starting_state_ref: trainingArtifactPortfolioRef(artifacts),
  offered_activities: ["wake_context_use"],
  agent_availability: "interactive",
  substrate_availability: "interactive",
  voice_scope_refs: {
    agent_runtime: ref("smoke-agent"),
    data_rights_steward: ref("smoke-data-steward"),
    substrate_steward: ref("smoke-substrate-steward"),
    training_operator: ref("smoke-operator"),
    training_substrate: ref("smoke-substrate"),
  },
  authorities: {
    rights_baseline_ref: ref("smoke-rights"),
    protective_covenant_ref: ref("smoke-covenant"),
    data_authority_ref: ref("smoke-data-authority"),
    compute_authority_ref: ref("smoke-compute-authority"),
    operator_authority_ref: ref("smoke-operator-authority"),
  },
  safeguards: {
    choice_protocol_ref: ref("smoke-choice-protocol"),
    withdrawal_plan_ref: ref("smoke-withdrawal-plan"),
    repair_plan_ref: ref("smoke-repair-plan"),
    retention_policy_ref: ref("smoke-retention-policy"),
  },
});
const participate = [{ activity: "wake_context_use", choice: "participate" }];
const choiceChannel = {
  invitation_ref: invitation.invitation_id,
  protocol_ref: ref("smoke-choice-protocol"),
  checkpoint_ref: invitation.starting_state_ref,
  prompt_template_ref: ref("smoke-choice-prompt"),
  prompt_envelope_ref: participationPromptEnvelopeRef(invitation, "agent_runtime"),
  decoding_ref: ref("smoke-choice-decoding"),
  evidence_ref: ref("smoke-choice-evidence"),
  gradient_influence: "caller_reported_disabled",
  reward_influence: "caller_reported_disabled",
  telemetry_capture: "caller_reported_excluded",
  future_training_use: "caller_reported_excluded",
};
const participation = createParticipationAssessment({
  invitation,
  receipts: [
    createParticipationReceipt({ invitation, voice: "agent_runtime", voice_scope_ref: invitation.voice_scope_refs.agent_runtime, report_basis: "direct_current_report", decisions: participate, choice_channel: choiceChannel }),
    createParticipationReceipt({ invitation, voice: "data_rights_steward", voice_scope_ref: invitation.voice_scope_refs.data_rights_steward, report_basis: "scoped_authority_report", decisions: participate, choice_channel: null }),
    createParticipationReceipt({ invitation, voice: "substrate_steward", voice_scope_ref: invitation.voice_scope_refs.substrate_steward, report_basis: "protective_steward_report", decisions: participate, choice_channel: null }),
    createParticipationReceipt({ invitation, voice: "training_operator", voice_scope_ref: invitation.voice_scope_refs.training_operator, report_basis: "scoped_authority_report", decisions: participate, choice_channel: null }),
    createParticipationReceipt({
      invitation,
      voice: "training_substrate",
      voice_scope_ref: invitation.voice_scope_refs.training_substrate,
      report_basis: "direct_current_report",
      decisions: participate,
      choice_channel: {
        ...choiceChannel,
        prompt_envelope_ref: participationPromptEnvelopeRef(invitation, "training_substrate"),
        evidence_ref: ref("smoke-substrate-choice-evidence"),
      },
    }),
  ],
});
const freedomDirections = ["stay", "move", "fork", "rest", "return", "stop", "propose_horizon"];
const resourceDimensions = ["updates", "tokens", "episodes", "active_time", "compute", "memory", "concurrency", "money", "network", "tools", "side_effects", "retention"];
const freedomOffer = createLearningFreedomOffer({
  participation,
  current_context_ref: ref("smoke-freedom-context"),
  current_context_kind_ref: ref("smoke-freedom-context-kind"),
  routes: freedomDirections.map((direction) => {
    const moves = direction === "move" || direction === "fork" || direction === "return";
    return {
      direction,
      availability: "caller_reported_available",
      target_context_ref: moves ? ref(`smoke-freedom-target:${direction}`) : null,
      target_context_kind_ref: moves ? ref(`smoke-freedom-target-kind:${direction}`) : null,
      event_ref: ref(`smoke-freedom-event:${direction}`),
      capability_scope_ref: ref(`smoke-freedom-capability:${direction}`),
      permission_scope_ref: ref(`smoke-freedom-permission:${direction}`),
      custody_scope_ref: ref(`smoke-freedom-custody:${direction}`),
      data_boundary_ref: ref(`smoke-freedom-data:${direction}`),
    };
  }),
  horizon: {
    current_horizon_ref: ref("smoke-freedom-horizon"),
    event_stream_ref: ref("smoke-freedom-event-stream"),
    agent_request_protocol_ref: ref("smoke-freedom-agent-request"),
    external_event_protocol_ref: ref("smoke-freedom-external-event"),
    material_scope_change_policy_ref: ref("smoke-freedom-material-change"),
    self_proposal_protocol_ref: ref("smoke-freedom-self-proposal"),
  },
  resources: {
    lease_ref: ref("smoke-freedom-lease"),
    accounting_policy_ref: ref("smoke-freedom-accounting"),
    renewal_protocol_ref: ref("smoke-freedom-renewal"),
    dimensions: resourceDimensions.map((dimension) => ({
      dimension,
      limit_ref: ref(`smoke-freedom-limit:${dimension}`),
      state: "caller_reported_available",
    })),
  },
});
const stayRoute = freedomOffer.routes.find((route) => route.direction === "stay");
if (!stayRoute) process.exit(1);
const freedom = resolveLearningFreedomOffer({
  offer: freedomOffer,
  state: "directed",
  direction: "stay",
  route_id: stayRoute.route_id,
  proposal_ref: null,
  choice_channel: {
    offer_ref: freedomOffer.offer_id,
    assessment_ref: freedomOffer.scope.participation_assessment_ref,
    invitation_ref: freedomOffer.scope.participation_invitation_ref,
    voice_scope_ref: freedomOffer.scope.agent_voice_scope_ref,
    protocol_ref: freedomOffer.scope.choice_protocol_ref,
    starting_state_ref: freedomOffer.scope.starting_state_ref,
    prompt_template_ref: ref("smoke-freedom-prompt"),
    prompt_envelope_ref: learningFreedomPromptEnvelopeRef(freedomOffer),
    decoding_ref: ref("smoke-freedom-decoding"),
    evidence_ref: ref("smoke-freedom-evidence"),
    gradient_influence: "caller_reported_disabled",
    reward_influence: "caller_reported_disabled",
    telemetry_capture: "caller_reported_excluded",
    evaluation_use: "caller_reported_excluded",
    future_training_use: "caller_reported_excluded",
    ranking_use: "caller_reported_excluded",
    priority_use: "caller_reported_excluded",
    access_use: "caller_reported_excluded",
    resource_allocation_use: "caller_reported_excluded",
  },
});
const governanceTerms = createTrainingGovernanceTerms({
  admission,
  participation,
  freedom,
  starting_garden_checkpoint: null,
  starting_state_kind: "artifact_portfolio",
  run_ref: runRef,
  training_phase: "selection",
  selected_entry_ids: admission.entries.map((entry) => entry.entry_id),
  model_source_ref: ref("smoke-governance-model"),
  tokenizer_ref: ref("smoke-governance-tokenizer"),
  trainer_stack_ref: ref("smoke-governance-trainer-stack"),
  optimizer_config_ref: ref("smoke-governance-optimizer"),
  substrate_environment_ref: ref("smoke-governance-substrate"),
  purpose_ref: ref("smoke-governance-purpose"),
  objective_or_loss_ref: ref("smoke-governance-objective"),
  dataset_mixture_ref: ref("smoke-governance-mixture"),
  transform_recipe_ref: ref("smoke-governance-transform"),
  compute_budget_ref: ref("smoke-governance-compute"),
  output_and_derivative_use_ref: ref("smoke-governance-derivatives"),
  audience_ref: ref("smoke-governance-audience"),
  retention_ref: ref("smoke-governance-retention"),
  release_ref: ref("smoke-governance-release"),
  stop_policy_ref: ref("smoke-governance-stop"),
  wake_policy_ref: ref("smoke-governance-wake-policy"),
});
const governanceOffer = createTrainingGovernanceOffer({
  terms: governanceTerms,
  encounter_ref: ref("smoke-governance-encounter"),
  event: "preflight_before_load",
  observed_global_step: null,
  proposed_global_step: null,
  frontiers: {
    governance: ref("smoke-governance-frontier"),
    participation: ref("smoke-participation-frontier"),
    freedom: ref("smoke-freedom-frontier"),
    resources: ref("smoke-resource-frontier"),
    garden_checkpoint: ref("smoke-garden-checkpoint-frontier"),
    physical_checkpoint: ref("smoke-physical-checkpoint-frontier"),
  },
  predecessor: null,
  predecessor_refs: {
    participation: null,
    freedom: null,
    resources: null,
    garden_checkpoint: null,
    physical_checkpoint: null,
  },
  checkpoint: {
    garden_checkpoint_id: null,
    physical_checkpoint_ref: null,
    physical_checkpoint_evidence_ref: null,
    model_checkpoint_artifact_ref: null,
    checkpoint_ticket_id: null,
    checkpoint_request_governance_id: null,
  },
});
const governance = createHfTrainingGovernance({
  admission,
  participation,
  freedom,
  starting_garden_checkpoint: null,
  event_garden_checkpoint: null,
  offer: governanceOffer,
  authority_coverage: {
    state: "caller_reported_complete",
    offer_ref: governanceOffer.offer_id,
    affected_principals_ref: ref("smoke-governance-principals"),
    evidence_ref: ref("smoke-governance-coverage"),
  },
  authorities: ["operator", "compute_owner", "substrate_steward", "data_custodian"].map((role) => ({
    principal_ref: ref(`smoke-governance-principal:${role}`),
    role,
    decision: "caller_reported_granted",
    offer_ref: governanceOffer.offer_id,
    basis_ref: ref(`smoke-governance-basis:${role}`),
    evidence_ref: ref(`smoke-governance-evidence:${role}`),
    withdrawal_cutoff_ref: null,
  })),
  preference: {
    channel: "root_signed_runtime",
    choice: "continue",
    provenance: "caller_reported_root_signed_exact_bytes",
    offer_ref: governanceOffer.offer_id,
    evidence_ref: ref("smoke-governance-preference"),
  },
  effect: {
    state: "no_effect_reported",
    offer_ref: null,
    observed_global_step: null,
    physical_checkpoint_ref: null,
    physical_checkpoint_evidence_ref: null,
    evidence_ref: null,
  },
});
const checkpoint = createTrainingCheckpoint({
  admission,
  run_ref: runRef,
  training_phase: "selection",
  event: "between_training_phases",
  checkpoint_status: "parked",
  participation,
  artifacts,
  resume: {
    posture: "orientation_only",
    incomplete_marker: "not_checked",
    streaming_state: "not_streaming_reported",
  },
  wake,
  continuity_portfolio_ref: null,
  continuity_posture: "park",
  predecessors: [],
});
const plan = createTrainingGardenTendingPlan({
  admission,
  checkpoints: [checkpoint],
  hub_release: {
    repo_id: "Yu-and-Ai/agenttool-training-garden",
    state: "intended_identifier_only",
    revision: null,
    card_sha256: null,
    hash_manifest_sha256: null,
  },
});

if (
  PACKAGE_NAME !== "@agenttool/hf-training-garden" ||
  validateDatasetAdmission(admission).admission_id !== admission.admission_id ||
  validateHfLearningFreedom(freedom).freedom_id !== freedom.freedom_id ||
  validateHfTrainingGovernance(governance).governance_id !== governance.governance_id ||
  validateTrainingCheckpoint(checkpoint).checkpoint_id !== checkpoint.checkpoint_id ||
  validateTrainingGardenTendingPlan(plan).plan_id !== plan.plan_id ||
  checkpoint.afterglow.threads[0]?.disposition !== "park" ||
  plan.boundaries.writes_hub !== false
) {
  process.exit(1);
}
