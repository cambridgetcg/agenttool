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
  createTrainingCheckpoint,
  createTrainingGardenTendingPlan,
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
const checkpoint = createTrainingCheckpoint({
  admission,
  run_ref: ref("smoke-run"),
  training_phase: "selection",
  event: "between_training_phases",
  checkpoint_status: "parked",
  artifacts: {
    pipeline_ref: ref("smoke-pipeline"),
    dataset_state_ref: ref("smoke-dataset"),
    dataloader_state_ref: null,
    tokenizer_ref: null,
    model_checkpoint_ref: null,
    optimizer_state_ref: null,
    scheduler_state_ref: null,
    rng_state_ref: null,
    metrics_ref: null,
  },
  resume: {
    posture: "orientation_only",
    incomplete_marker: "not_checked",
    streaming_state: "not_streaming_reported",
  },
  wake: {
    format: "wake-brief/v1",
    snapshot_ref: ref("smoke-wake"),
    scope_ref: ref("smoke-scope"),
    wake_version: 1,
    handoff_projection: "complete",
  },
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
