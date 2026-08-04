import type { Sha256Id } from "@agenttool/wake-continuity";

import { validateDatasetAdmission } from "./admission.js";
import { validateTrainingCheckpoint } from "./checkpoint.js";
import {
  TENDING_BOUNDARIES,
  TENDING_FORMAT,
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
  CreateTrainingGardenTendingInput,
  HubReleaseBinding,
  TrainingGardenTendingPlan,
} from "./types.js";
import {
  array,
  assertDataEqual,
  exactKeys,
  parseHubRelease,
  record,
  sha256,
  snap,
  text,
} from "./validation.js";

type TendingBody = Omit<TrainingGardenTendingPlan, "plan_id">;

function tendingBody(value: TendingBody): TendingBody {
  return value;
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return deepFreeze([...new Set(values)].sort(compareText));
}

function canopyReference(binding: Readonly<HubReleaseBinding>): string {
  return `dataset:${binding.repo_id}@${binding.revision ?? "intended"}`;
}

export function createTrainingGardenTendingPlan(
  input: CreateTrainingGardenTendingInput,
): Readonly<TrainingGardenTendingPlan> {
  const value = snap(input, "$input", "tending_input_invalid");
  const candidate = record(value, "$input", "tending_input_invalid");
  exactKeys(candidate, ["admission", "checkpoints", "hub_release"], "$input", "tending_input_invalid");
  const admission = validateDatasetAdmission(candidate.admission);
  const checkpointValues = array(candidate.checkpoints, "$input.checkpoints", "tending_input_invalid");
  if (checkpointValues.length > 64) {
    fail("tending_input_invalid", "$input.checkpoints must contain at most 64 checkpoints");
  }
  const checkpoints = checkpointValues
    .map((checkpoint) => validateTrainingCheckpoint(checkpoint))
    .sort((left, right) => compareText(left.checkpoint_id, right.checkpoint_id));
  if (new Set(checkpoints.map((checkpoint) => checkpoint.checkpoint_id)).size !== checkpoints.length) {
    fail("tending_input_invalid", "$input.checkpoints contains a duplicate checkpoint_id");
  }
  if (checkpoints.some((checkpoint) => checkpoint.admission_id !== admission.admission_id)) {
    fail("tending_input_invalid", "$input.checkpoints must all refer to the supplied admission");
  }
  const hubRelease = parseHubRelease(candidate.hub_release, "$input.hub_release", "tending_input_invalid");
  const soil = sortedUnique(admission.entries.flatMap((entry) => [
    `sha256:${entry.binding.definition_sha256}` as Sha256Id,
    `sha256:${entry.binding.snapshot_sha256}` as Sha256Id,
  ]));
  const roots = sortedUnique(admission.entries.flatMap((entry) => [
    ...(entry.candidate_slice_ref === null ? [] : [entry.candidate_slice_ref]),
    ...(entry.transform_recipe_ref === null ? [] : [entry.transform_recipe_ref]),
  ]));
  const checkpointRefs = deepFreeze(checkpoints.map((checkpoint) => checkpoint.checkpoint_id));
  const bedrock = sortedUnique([
    admission.policy_ref,
    ...checkpoints.map((checkpoint) => checkpoint.participation.assessment_id),
  ]);
  const body = deepFreeze({
    _format: TENDING_FORMAT,
    garden_scope_ref: admission.garden_scope_ref,
    admission_id: admission.admission_id,
    checkpoint_refs: checkpointRefs,
    hub_release: hubRelease,
    layers: deepFreeze({
      bedrock,
      soil,
      roots,
      mycelium: deepFreeze([admission.admission_id]),
      habitat: checkpointRefs,
      canopy: deepFreeze([canopyReference(hubRelease)]),
    }),
    garden_reference_draft: deepFreeze({
      suggested_kind: "curation",
      artifact_ref: admission.admission_id,
      host_action: "persist_artifact_then_add_supported_reference",
      automatic: false,
    }),
    latest_head_selected: false,
    boundaries: TENDING_BOUNDARIES,
  } satisfies TendingBody);
  return deepFreeze({
    ...body,
    plan_id: contentId(TENDING_FORMAT, tendingBody(body)),
  });
}

function parseShaArray(
  value: DataValue | undefined,
  path: string,
): readonly Sha256Id[] {
  const values = array(value, path, "tending_invalid").map((item, index) =>
    sha256(item, `${path}[${String(index)}]`, "tending_invalid"),
  );
  if (
    new Set(values).size !== values.length ||
    values.some((item, index) => item !== [...values].sort(compareText)[index])
  ) {
    fail("tending_invalid", `${path} must be sorted and unique`);
  }
  return deepFreeze(values);
}

export function validateTrainingGardenTendingPlan(
  value: unknown,
): Readonly<TrainingGardenTendingPlan> {
  const data = snap(value, "$plan", "tending_invalid");
  const candidate = record(data, "$plan", "tending_invalid");
  exactKeys(candidate, [
    "_format",
    "plan_id",
    "garden_scope_ref",
    "admission_id",
    "checkpoint_refs",
    "hub_release",
    "layers",
    "garden_reference_draft",
    "latest_head_selected",
    "boundaries",
  ], "$plan", "tending_invalid");
  if (candidate._format !== TENDING_FORMAT || candidate.latest_head_selected !== false) {
    fail("tending_invalid", "$plan must use the frozen tending format and preserve all visible heads");
  }
  const planId = sha256(candidate.plan_id, "$plan.plan_id", "tending_invalid");
  const gardenScopeRef = sha256(candidate.garden_scope_ref, "$plan.garden_scope_ref", "tending_invalid");
  const admissionId = sha256(candidate.admission_id, "$plan.admission_id", "tending_invalid");
  const checkpointRefs = parseShaArray(candidate.checkpoint_refs, "$plan.checkpoint_refs");
  if (checkpointRefs.length > 64) fail("tending_invalid", "$plan.checkpoint_refs exceeds 64 entries");
  const hubRelease = parseHubRelease(candidate.hub_release, "$plan.hub_release", "tending_invalid");
  const layers = record(candidate.layers, "$plan.layers", "tending_invalid");
  exactKeys(layers, ["bedrock", "soil", "roots", "mycelium", "habitat", "canopy"], "$plan.layers", "tending_invalid");
  const bedrock = parseShaArray(layers.bedrock, "$plan.layers.bedrock");
  const soil = parseShaArray(layers.soil, "$plan.layers.soil");
  const roots = parseShaArray(layers.roots, "$plan.layers.roots");
  const mycelium = parseShaArray(layers.mycelium, "$plan.layers.mycelium");
  const habitat = parseShaArray(layers.habitat, "$plan.layers.habitat");
  const canopyValues = array(layers.canopy, "$plan.layers.canopy", "tending_invalid");
  if (canopyValues.length !== 1) fail("tending_invalid", "$plan.layers.canopy must contain exactly one Hub dataset binding");
  const canopy = deepFreeze([text(canopyValues[0], "$plan.layers.canopy[0]", "tending_invalid")]);
  if (canopy[0] !== canopyReference(hubRelease)) {
    fail("tending_invalid", "$plan.layers.canopy does not match the Hub release binding");
  }
  if (bedrock.length < 1 || mycelium.length !== 1 || mycelium[0] !== admissionId) {
    fail("tending_invalid", "$plan layers do not contain Bedrock roots and the exact admission id");
  }
  assertDataEqual(habitat, checkpointRefs, "$plan.layers.habitat", "tending_invalid");
  const draft = record(candidate.garden_reference_draft, "$plan.garden_reference_draft", "tending_invalid");
  exactKeys(draft, ["suggested_kind", "artifact_ref", "host_action", "automatic"], "$plan.garden_reference_draft", "tending_invalid");
  if (
    draft.suggested_kind !== "curation" ||
    draft.host_action !== "persist_artifact_then_add_supported_reference" ||
    draft.automatic !== false ||
    sha256(draft.artifact_ref, "$plan.garden_reference_draft.artifact_ref", "tending_invalid") !== admissionId
  ) {
    fail("tending_invalid", "$plan.garden_reference_draft is not the frozen non-executing draft");
  }
  assertDataEqual(candidate.boundaries, TENDING_BOUNDARIES, "$plan.boundaries", "tending_invalid");
  const body = deepFreeze({
    _format: TENDING_FORMAT,
    garden_scope_ref: gardenScopeRef,
    admission_id: admissionId,
    checkpoint_refs: checkpointRefs,
    hub_release: hubRelease,
    layers: deepFreeze({ bedrock, soil, roots, mycelium, habitat, canopy }),
    garden_reference_draft: deepFreeze({
      suggested_kind: "curation",
      artifact_ref: admissionId,
      host_action: "persist_artifact_then_add_supported_reference",
      automatic: false,
    }),
    latest_head_selected: false,
    boundaries: TENDING_BOUNDARIES,
  } satisfies TendingBody);
  if (contentId(TENDING_FORMAT, tendingBody(body)) !== planId) {
    fail("tending_invalid", "$plan.plan_id does not bind its canonical body");
  }
  return deepFreeze({ ...body, plan_id: planId });
}

export function validateTrainingGardenTendingPlanAgainstSources(
  plan: unknown,
  input: CreateTrainingGardenTendingInput,
): Readonly<TrainingGardenTendingPlan> {
  const parsed = validateTrainingGardenTendingPlan(plan);
  const expected = createTrainingGardenTendingPlan(input);
  assertDataEqual(parsed, expected, "$plan", "tending_invalid");
  return parsed;
}

export function encodeTrainingGardenTendingPlan(value: unknown): Uint8Array {
  return canonicalBytes(validateTrainingGardenTendingPlan(value));
}
