import {
  RESEARCH_BINDING_SCHEMA,
  canonicalJson,
  getCuratedHfResearchCatalog,
  sha256Hex,
} from "@agenttool/hf-scout";
import { sha256Id } from "@agenttool/wake-continuity";

import {
  PACKAGE_NAME,
  createDatasetAdmission,
  createParticipationAssessment,
  createParticipationInvitation,
  createParticipationReceipt,
  createTrainingCheckpoint,
  createTrainingGardenTendingPlan,
  participationPromptEnvelopeRef,
  trainingArtifactPortfolioRef,
  validateDatasetAdmission,
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
  validateTrainingCheckpoint(checkpoint).checkpoint_id !== checkpoint.checkpoint_id ||
  validateTrainingGardenTendingPlan(plan).plan_id !== plan.plan_id ||
  checkpoint.afterglow.threads[0]?.disposition !== "park" ||
  plan.boundaries.writes_hub !== false
) {
  process.exit(1);
}
