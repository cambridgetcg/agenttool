import {
  getCuratedHfResearchCatalog,
  type HfResearchBinding,
  type HfResearchBoundedUse,
} from "@agenttool/hf-scout";

import {
  ADMISSION_BOUNDARIES,
  ADMISSION_ENTRY_PROFILE,
  ADMISSION_FORMAT,
  ADMISSION_REASON_CODES,
  ADMISSION_STATES,
  SELECTION_PROCESS,
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
  AdmissionReasonCode,
  AdmissionState,
  CreateAdmissionEntryInput,
  CreateDatasetAdmissionInput,
  DatasetAdmission,
  DatasetAdmissionEntry,
} from "./types.js";
import {
  array,
  assertDataEqual,
  exactKeys,
  literal,
  nullableSha256,
  parseAssessment,
  parseDataRole,
  parseSelectionPosture,
  record,
  sha256,
  snap,
  validateResearchBinding,
} from "./validation.js";

type EntryBody = Omit<DatasetAdmissionEntry, "entry_id">;
type AdmissionBody = Omit<DatasetAdmission, "admission_id">;

function entryBody(entry: EntryBody): EntryBody {
  return entry;
}

function admissionBody(admission: AdmissionBody): AdmissionBody {
  return admission;
}

function sourceForbidsTraining(binding: Readonly<HfResearchBinding>): boolean {
  const lead = getCuratedHfResearchCatalog().leads.find(
    (candidate) => candidate.key === binding.lead_key,
  );
  return lead?.research.forbidden_uses.includes("training_corpus_ingestion") ?? true;
}

const SEALED_EVALUATION_BOUNDED_USES = new Set<HfResearchBoundedUse>([
  "access_controlled_safety_evaluation",
  "controlled_rhetoric_probe",
  "offline_evaluator_regression",
  "sealed_benchmark_evaluation",
]);

function sourceSupportsSealedEvaluation(
  binding: Readonly<HfResearchBinding>,
): boolean {
  const lead = getCuratedHfResearchCatalog().leads.find(
    (candidate) => candidate.key === binding.lead_key,
  );
  return lead?.research.bounded_uses.some((use) =>
    SEALED_EVALUATION_BOUNDED_USES.has(use)
  ) ?? false;
}

function deriveDecision(
  input: Omit<EntryBody, "profile" | "decision">,
): DatasetAdmissionEntry["decision"] {
  if (input.posture === "exclude") {
    return deepFreeze({ state: "excluded", reason_codes: ["operator_excluded"] });
  }
  if (input.posture === "hold") {
    return deepFreeze({ state: "held", reason_codes: ["operator_hold"] });
  }
  if (input.role === "metadata_reference") {
    return deepFreeze({
      state: "admitted_metadata_reference",
      reason_codes: ["metadata_reference_only"],
    });
  }

  const reasons: AdmissionReasonCode[] = [];
  const binding = input.binding;
  if (binding.artifact.kind !== "dataset") reasons.push("source_not_dataset");
  if (
    (input.role === "training_candidate" || input.role === "validation_candidate") &&
    sourceForbidsTraining(binding)
  ) {
    reasons.push("source_forbids_training_lane");
  }
  if (
    input.role === "sealed_evaluation" &&
    !sourceSupportsSealedEvaluation(binding)
  ) {
    reasons.push("source_not_bounded_for_declared_lane");
  }
  if (binding.matched_declared.gated !== false) reasons.push("gated_source_not_eligible");
  if (binding.matched_declared.license === null) reasons.push("license_not_declared");
  if (input.candidate_slice_ref === null) reasons.push("candidate_slice_ref_missing");
  if (input.transform_recipe_ref === null) reasons.push("transform_recipe_ref_missing");
  if (input.assessment.rights !== "caller_reported_reviewed_for_declared_use") {
    reasons.push("rights_review_incomplete");
  }
  if (input.assessment.privacy !== "caller_reported_reviewed_for_declared_use") {
    reasons.push("privacy_review_incomplete");
  }
  if (
    input.assessment.consent !== "caller_reported_reviewed_for_declared_use" &&
    input.assessment.consent !== "not_applicable_reported"
  ) {
    reasons.push("consent_review_incomplete");
  }
  if (input.assessment.withdrawal !== "caller_reported_process_defined") {
    reasons.push("withdrawal_process_incomplete");
  }
  if (input.assessment.secret_scan !== "caller_reported_bounded_scan_passed") {
    reasons.push("secret_scan_incomplete");
  }
  if (input.assessment.deduplication !== "caller_reported_recipe_applied") {
    reasons.push("dedup_recipe_incomplete");
  }
  if (input.assessment.fitness !== "caller_reported_fit_for_declared_role") {
    reasons.push("fitness_review_incomplete");
  }
  if (input.assessment.synthetic_provenance === "unassessed") {
    reasons.push("synthetic_provenance_incomplete");
  }
  if (
    (input.role === "sealed_evaluation" && input.assessment.benchmark_overlap !== "sealed_evaluation") ||
    (input.role !== "sealed_evaluation" && input.assessment.benchmark_overlap !== "caller_reported_clear_of_sealed_evaluation")
  ) {
    reasons.push("benchmark_boundary_incomplete");
  }

  const uniqueReasons = [...new Set(reasons)].sort(compareText) as AdmissionReasonCode[];
  if (uniqueReasons.length > 0) {
    return deepFreeze({ state: "held", reason_codes: deepFreeze(uniqueReasons) });
  }
  const state: AdmissionState = input.role === "training_candidate"
    ? "admitted_training_candidate"
    : input.role === "validation_candidate"
      ? "admitted_validation_candidate"
      : "admitted_sealed_evaluation";
  return deepFreeze({
    state,
    reason_codes: ["candidate_eligible_for_declared_role"],
  });
}

function parseEntryInput(
  value: DataValue,
  path: string,
): Omit<EntryBody, "profile" | "decision"> {
  const candidate = record(value, path, "admission_input_invalid");
  exactKeys(candidate, [
    "binding",
    "role",
    "candidate_slice_ref",
    "transform_recipe_ref",
    "assessment",
    "posture",
  ], path, "admission_input_invalid");
  const binding = validateResearchBinding(
    candidate.binding,
    `${path}.binding`,
    "admission_input_invalid",
  );
  const role = parseDataRole(candidate.role, `${path}.role`, "admission_input_invalid");
  const candidateSliceRef = nullableSha256(
    candidate.candidate_slice_ref,
    `${path}.candidate_slice_ref`,
    "admission_input_invalid",
  );
  const transformRecipeRef = nullableSha256(
    candidate.transform_recipe_ref,
    `${path}.transform_recipe_ref`,
    "admission_input_invalid",
  );
  if (
    role === "metadata_reference" &&
    (candidateSliceRef !== null || transformRecipeRef !== null)
  ) {
    fail(
      "admission_input_invalid",
      `${path} metadata_reference entries must not carry subset or transform references`,
    );
  }
  return deepFreeze({
    binding,
    role,
    candidate_slice_ref: candidateSliceRef,
    transform_recipe_ref: transformRecipeRef,
    assessment: parseAssessment(
      candidate.assessment,
      `${path}.assessment`,
      "admission_input_invalid",
    ),
    posture: parseSelectionPosture(
      candidate.posture,
      `${path}.posture`,
      "admission_input_invalid",
    ),
  });
}

function createEntry(value: DataValue, path: string): Readonly<DatasetAdmissionEntry> {
  const input = parseEntryInput(value, path);
  const body = deepFreeze({
    profile: ADMISSION_ENTRY_PROFILE,
    ...input,
    decision: deriveDecision(input),
  } satisfies EntryBody);
  return deepFreeze({
    ...body,
    entry_id: contentId(ADMISSION_ENTRY_PROFILE, entryBody(body)),
  });
}

export function createDatasetAdmission(
  input: CreateDatasetAdmissionInput,
): Readonly<DatasetAdmission> {
  const value = snap(input, "$input", "admission_input_invalid");
  const candidate = record(value, "$input", "admission_input_invalid");
  exactKeys(
    candidate,
    ["garden_scope_ref", "policy_ref", "entries"],
    "$input",
    "admission_input_invalid",
  );
  const values = array(candidate.entries, "$input.entries", "admission_input_invalid");
  if (values.length < 1 || values.length > 128) {
    fail("admission_input_invalid", "$input.entries must contain 1-128 entries");
  }
  const entries = values
    .map((entry, index) => createEntry(entry, `$input.entries[${String(index)}]`))
    .sort((left, right) => compareText(left.entry_id, right.entry_id));
  if (new Set(entries.map((entry) => entry.binding.lead_key)).size !== entries.length) {
    fail("admission_input_invalid", "$input.entries must use each curated HF lead at most once");
  }
  const body = deepFreeze({
    _format: ADMISSION_FORMAT,
    garden_scope_ref: sha256(
      candidate.garden_scope_ref,
      "$input.garden_scope_ref",
      "admission_input_invalid",
    ),
    policy_ref: sha256(
      candidate.policy_ref,
      "$input.policy_ref",
      "admission_input_invalid",
    ),
    entries: deepFreeze(entries),
    process: SELECTION_PROCESS,
    boundaries: ADMISSION_BOUNDARIES,
  } satisfies AdmissionBody);
  return deepFreeze({
    ...body,
    admission_id: contentId(ADMISSION_FORMAT, admissionBody(body)),
  });
}

function entryToInput(entry: Readonly<DatasetAdmissionEntry>): CreateAdmissionEntryInput {
  return {
    binding: entry.binding,
    role: entry.role,
    candidate_slice_ref: entry.candidate_slice_ref,
    transform_recipe_ref: entry.transform_recipe_ref,
    assessment: entry.assessment,
    posture: entry.posture,
  };
}

function validateStoredEntry(
  value: DataValue,
  path: string,
): Readonly<DatasetAdmissionEntry> {
  const candidate = record(value, path, "admission_invalid");
  exactKeys(candidate, [
    "profile",
    "entry_id",
    "binding",
    "role",
    "candidate_slice_ref",
    "transform_recipe_ref",
    "assessment",
    "posture",
    "decision",
  ], path, "admission_invalid");
  if (candidate.profile !== ADMISSION_ENTRY_PROFILE) {
    fail("admission_invalid", `${path}.profile is not the frozen admission entry profile`);
  }
  sha256(candidate.entry_id, `${path}.entry_id`, "admission_invalid");
  const decision = record(candidate.decision, `${path}.decision`, "admission_invalid");
  exactKeys(decision, ["state", "reason_codes"], `${path}.decision`, "admission_invalid");
  literal(decision.state, ADMISSION_STATES, `${path}.decision.state`, "admission_invalid");
  const reasons = array(decision.reason_codes, `${path}.decision.reason_codes`, "admission_invalid");
  if (reasons.some((reason) => !(ADMISSION_REASON_CODES as readonly DataValue[]).includes(reason))) {
    fail("admission_invalid", `${path}.decision.reason_codes contains an unknown code`);
  }
  const reasonCodes = reasons as AdmissionReasonCode[];
  if (
    new Set(reasonCodes).size !== reasonCodes.length ||
    reasonCodes.some((reason, index) =>
      reason !== [...reasonCodes].sort(compareText)[index]
    )
  ) {
    fail("admission_invalid", `${path}.decision.reason_codes must be sorted unique known codes`);
  }
  const rebuilt = createEntry(
    snap({
      binding: candidate.binding,
      role: candidate.role,
      candidate_slice_ref: candidate.candidate_slice_ref,
      transform_recipe_ref: candidate.transform_recipe_ref,
      assessment: candidate.assessment,
      posture: candidate.posture,
    }, `${path}.input`, "admission_invalid"),
    `${path}.input`,
  );
  assertDataEqual(candidate, rebuilt, path, "admission_invalid");
  return rebuilt;
}

export function validateDatasetAdmission(
  value: unknown,
): Readonly<DatasetAdmission> {
  const data = snap(value, "$admission", "admission_invalid");
  const candidate = record(data, "$admission", "admission_invalid");
  exactKeys(candidate, [
    "_format",
    "admission_id",
    "garden_scope_ref",
    "policy_ref",
    "entries",
    "process",
    "boundaries",
  ], "$admission", "admission_invalid");
  if (candidate._format !== ADMISSION_FORMAT) {
    fail("admission_invalid", "$admission._format is not the frozen admission format");
  }
  sha256(candidate.admission_id, "$admission.admission_id", "admission_invalid");
  assertDataEqual(candidate.process, SELECTION_PROCESS, "$admission.process", "admission_invalid");
  assertDataEqual(candidate.boundaries, ADMISSION_BOUNDARIES, "$admission.boundaries", "admission_invalid");
  const values = array(candidate.entries, "$admission.entries", "admission_invalid");
  if (values.length < 1 || values.length > 128) {
    fail("admission_invalid", "$admission.entries must contain 1-128 entries");
  }
  const entries = values.map((entry, index) =>
    validateStoredEntry(entry, `$admission.entries[${String(index)}]`),
  );
  if (entries.some((entry, index) => entry.entry_id !== [...entries].sort((a, b) => compareText(a.entry_id, b.entry_id))[index]?.entry_id)) {
    fail("admission_invalid", "$admission.entries must be sorted by entry_id");
  }
  const rebuilt = createDatasetAdmission({
    garden_scope_ref: sha256(candidate.garden_scope_ref, "$admission.garden_scope_ref", "admission_invalid"),
    policy_ref: sha256(candidate.policy_ref, "$admission.policy_ref", "admission_invalid"),
    entries: entries.map(entryToInput),
  });
  assertDataEqual(candidate, rebuilt, "$admission", "admission_invalid");
  return rebuilt;
}

export function encodeDatasetAdmission(value: unknown): Uint8Array {
  return canonicalBytes(validateDatasetAdmission(value));
}
