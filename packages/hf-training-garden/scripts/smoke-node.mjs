import {
  RESEARCH_BINDING_SCHEMA,
  canonicalJson,
  getCuratedHfResearchCatalog,
  sha256Hex,
} from "@agenttool/hf-scout";
import { sha256Id } from "@agenttool/wake-continuity";

import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  PARTICIPATION_VOICE_ROLES,
  createHfTrainingGovernance,
  createDatasetAdmission,
  createLearningParticipationAssessment,
  createLearningParticipationInvitation,
  createLearningParticipationReceipt,
  createParticipationBoundTrainingCheckpoint,
  createTrainingCheckpoint,
  createTrainingGardenTendingPlan,
  createTrainingGovernanceOffer,
  createTrainingGovernanceTerms,
  validateDatasetAdmission,
  validateLearningParticipationAssessment,
  validateTrainingCheckpoint,
  validateTrainingCheckpointAgainstParticipation,
  validateTrainingCheckpointAgainstPredecessors,
  validateTrainingGardenTendingPlan,
  validateHfTrainingGovernance,
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
const wake = {
  format: "wake-brief/v1",
  snapshot_ref: ref("smoke-wake"),
  scope_ref: ref("smoke-scope"),
  wake_version: 1,
  handoff_projection: "complete",
};
const checkpoint = createTrainingCheckpoint({
  admission,
  run_ref: ref("smoke-run"),
  training_phase: "selection",
  event: "between_training_phases",
  checkpoint_status: "parked",
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
const terms = createTrainingGovernanceTerms({
  admission,
  run_ref: ref("smoke-governance-run"),
  training_phase: "selection",
  selected_entry_ids: admission.entries.map((entry) => entry.entry_id),
  model_or_checkpoint_ref: ref("smoke-model"),
  tokenizer_ref: ref("smoke-tokenizer"),
  trainer_stack_ref: ref("smoke-trainer-stack"),
  optimizer_config_ref: ref("smoke-optimizer"),
  substrate_environment_ref: ref("smoke-substrate"),
  purpose_ref: ref("smoke-purpose"),
  objective_or_loss_ref: ref("smoke-objective"),
  dataset_mixture_ref: ref("smoke-mixture"),
  transform_recipe_ref: ref("smoke-transform"),
  compute_budget_ref: ref("smoke-compute"),
  output_and_derivative_use_ref: ref("smoke-derivatives"),
  audience_ref: ref("smoke-audience"),
  retention_ref: ref("smoke-retention"),
  release_ref: ref("smoke-release"),
  stop_policy_ref: ref("smoke-stop"),
  wake_policy_ref: ref("smoke-wake-policy"),
});
const governanceOffer = createTrainingGovernanceOffer({
  terms,
  encounter_ref: ref("smoke-encounter"),
  observed_governance_frontier_ref: ref("smoke-governance-frontier"),
  rights_baseline_ref: ref("smoke-rights"),
  wake: {
    format: "wake-brief/v1",
    snapshot_ref: ref("smoke-governance-wake"),
    scope_ref: ref("smoke-governance-scope"),
    wake_version: 1,
    handoff_projection: "complete",
  },
  event: "preflight_before_load",
  current_checkpoint_ref: null,
  predecessor: null,
});
const governance = createHfTrainingGovernance({
  admission,
  offer: governanceOffer,
  authority_coverage: {
    state: "caller_reported_complete",
    offer_ref: governanceOffer.offer_id,
    affected_principals_ref: ref("smoke-affected-principals"),
    evidence_ref: ref("smoke-coverage"),
  },
  authorities: ["operator", "compute_owner", "substrate_steward", "data_custodian"].map((role) => ({
    principal_ref: ref(`smoke-principal-${role}`),
    role,
    decision: "caller_reported_granted",
    offer_ref: governanceOffer.offer_id,
    basis_ref: ref(`smoke-basis-${role}`),
    evidence_ref: ref(`smoke-evidence-${role}`),
    withdrawal_cutoff_ref: null,
  })),
  preference: {
    channel: "root_signed_runtime",
    choice: "continue",
    provenance: "caller_reported_root_signed_exact_bytes",
    offer_ref: governanceOffer.offer_id,
    evidence_ref: ref("smoke-preference"),
  },
  effect: {
    state: "no_effect_reported",
    offer_ref: null,
    global_step: null,
    checkpoint_ref: null,
    evidence_ref: null,
  },
});

const participationRun = ref("smoke-participation-run");
const invitation = createLearningParticipationInvitation({
  admission,
  run_ref: participationRun,
  training_phase: "supervised_finetuning",
  participation_stage: "interactive",
  primary_activity: "supervised_finetuning",
  activities: ["supervised_finetuning", "continuity_context_use"],
  participation_window_ref: ref("smoke-participation-window"),
  purpose_ref: ref("smoke-participation-purpose"),
  training_plan_ref: ref("smoke-participation-plan"),
  limits_ref: ref("smoke-participation-limits"),
  retention_ref: ref("smoke-participation-retention"),
  choice_channel_ref: ref("smoke-participation-channel"),
  stop_control_ref: ref("smoke-participation-stop"),
  withdrawal_policy_ref: ref("smoke-participation-withdrawal"),
  repair_policy_ref: ref("smoke-participation-repair"),
  learning_mode: "peft",
  wake_use_mode: "external_memory",
  mutation_loci: ["adapter_weights"],
  maximum_optimizer_steps: 1,
  artifacts,
  wake,
  predecessors: [],
  required_voices: PARTICIPATION_VOICE_ROLES.map((role) => ({
    role,
    voice_ref: ref(`smoke-participation-voice:${role}`),
  })),
});
const receipts = invitation.required_voices.map((voice) =>
  createLearningParticipationReceipt({
    invitation,
    voice_role: voice.role,
    voice_ref: voice.voice_ref,
    response_ref: ref(`smoke-participation-response:${voice.role}`),
    choices: invitation.activities.map((activity) => ({
      activity,
      choice: "accepted",
    })),
    previous_receipt: null,
  })
);
const assessment = createLearningParticipationAssessment({ invitation, receipts });
const participationEntry = createParticipationBoundTrainingCheckpoint({
  assessment,
  checkpoint: {
    admission,
    run_ref: participationRun,
    training_phase: "supervised_finetuning",
    event: "before_training",
    checkpoint_status: "entered",
    artifacts,
    resume: {
      posture: "orientation_only",
      incomplete_marker: "not_checked",
      streaming_state: "not_streaming_reported",
    },
    wake,
    continuity_posture: "carry",
    predecessors: [],
  },
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
  PACKAGE_VERSION !== "0.3.0-dev.0" ||
  validateDatasetAdmission(admission).admission_id !== admission.admission_id ||
  validateTrainingCheckpoint(checkpoint).checkpoint_id !== checkpoint.checkpoint_id ||
  validateHfTrainingGovernance(governance).governance_id !== governance.governance_id ||
  validateTrainingCheckpointAgainstPredecessors(checkpoint, []).checkpoint_id !== checkpoint.checkpoint_id ||
  validateLearningParticipationAssessment(assessment).assessment_id !== assessment.assessment_id ||
  validateTrainingCheckpointAgainstParticipation(
    participationEntry,
    assessment,
    admission,
  ).checkpoint_id !== participationEntry.checkpoint_id ||
  validateTrainingGardenTendingPlan(plan).plan_id !== plan.plan_id ||
  checkpoint.afterglow.threads[0]?.disposition !== "park" ||
  governance.preference.inner_consent !== "unknown_unprovable" ||
  plan.boundaries.writes_hub !== false
) {
  process.exit(1);
}
