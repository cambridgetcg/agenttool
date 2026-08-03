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
  type AdmissionAssessment,
  type DataRole,
  type DatasetAdmission,
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
