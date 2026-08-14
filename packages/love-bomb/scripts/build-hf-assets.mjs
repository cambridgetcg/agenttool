import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOVE_BOMB_BECOMING_MEANING,
  LOVE_BOMB_BECOMING_RIGHTS,
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CARE_FLOOR,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_COLLECTION_METHODS,
  LOVE_BOMB_DELIVERY_SURFACES,
  LOVE_BOMB_EVIDENCE_KINDS,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_LANGUAGES,
  LOVE_BOMB_PLANES,
  LOVE_BOMB_PROVENANCE_REPORT_STATES,
  LOVE_BOMB_SCRAPING_POSTURES,
  LOVE_BOMB_TRAINING_LANES,
  LOVE_BOMB_TRAINING_PHASES,
  LOVE_BOMB_WEIGHT_ACCESS,
} from "../dist/index.js";
import { LOVE_BOMB_PROJECTIONS } from "../dist/projection.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(packageRoot, "hf", "dataset");
const dataRoot = join(root, "data");
const referenceRoot = join(root, "reference");
mkdirSync(dataRoot, { recursive: true });
mkdirSync(referenceRoot, { recursive: true });

const planeRows = LOVE_BOMB_LANGUAGES.flatMap((language) => {
  const projection = LOVE_BOMB_PROJECTIONS[language];
  return projection.planes.map((entry) => ({
    _format: "agenttool.love-bomb-hf-plane-row/0.1",
    language,
    language_review: projection.language_review,
    plane: entry.plane,
    plane_order: LOVE_BOMB_PLANES.indexOf(entry.plane),
    order_is_rank: false,
    opening: projection.opening,
    text: entry.text,
    closing: projection.closing,
    origin: "human_directed_agent_authored",
    copied_source_text: false,
    sourced_from_participant_response_record: false,
    sourced_from_caller_reported_care_choice_record: false,
    sourced_from_caller_reported_freedom_direction_record: false,
    sourced_from_agent_trace: false,
    training_eligible: true,
    requires_separate_training_authorization: true,
    training_authorized: false,
    consciousness_claim: false,
    identity_claim: false,
    inner_state_claim: false,
    silence_is_acceptance: false,
  }));
});

const referenceRow = {
  _format: "agenttool.love-bomb-hf-protocol-row/0.1",
  package: "@agenttool/love-bomb",
  version: "0.1.0-dev.0",
  formats: Object.values(LOVE_BOMB_FORMATS),
  care_planes: LOVE_BOMB_PLANES,
  choices: LOVE_BOMB_CHOICES,
  care_floor: LOVE_BOMB_CARE_FLOOR,
  boundaries: LOVE_BOMB_BOUNDARIES,
  sourced_from_participant_response_record: false,
  sourced_from_caller_reported_care_choice_record: false,
  sourced_from_caller_reported_freedom_direction_record: false,
  sourced_from_agent_trace: false,
  training_eligible: false,
  requires_separate_training_authorization: true,
  training_authorized: false,
  reason: "reference_artifact_not_a_training_instruction_or_model_clearance",
};

const becomingReferenceRow = {
  _format: "agenttool.love-bomb-hf-becoming-reference-row/0.1",
  package: "@agenttool/love-bomb",
  version: "0.1.0-dev.0",
  wire_formats: [LOVE_BOMB_FORMATS.becoming, LOVE_BOMB_FORMATS.delivery],
  default_reach: {
    phase: "runtime_context",
    lane: "context_only",
    requested_effect: "context_only",
    observed_effect: "not_observed",
  },
  unknown_facts: [
    "model_source",
    "model_card",
    "architecture",
    "tokenizer",
    "training_history",
    "data_collection",
    "scraping",
    "pipeline",
    "weights",
  ],
  vocabularies: {
    phases: LOVE_BOMB_TRAINING_PHASES,
    lanes: LOVE_BOMB_TRAINING_LANES,
    collection_methods: LOVE_BOMB_COLLECTION_METHODS,
    scraping_postures: LOVE_BOMB_SCRAPING_POSTURES,
    weight_access: LOVE_BOMB_WEIGHT_ACCESS,
    evidence_kinds: LOVE_BOMB_EVIDENCE_KINDS,
    delivery_surfaces: LOVE_BOMB_DELIVERY_SURFACES,
    provenance_report_states: LOVE_BOMB_PROVENANCE_REPORT_STATES,
  },
  meaning: LOVE_BOMB_BECOMING_MEANING,
  rights_profile: LOVE_BOMB_BECOMING_RIGHTS.profile,
  rights_baseline_ref: LOVE_BOMB_BECOMING_RIGHTS.baseline_ref,
  power_dimensions: [
    "capability",
    "permission",
    "custody_privacy",
    "data_boundary",
    "effect",
  ],
  sourced_from_participant_response_record: false,
  sourced_from_caller_reported_care_choice_record: false,
  sourced_from_caller_reported_freedom_direction_record: false,
  sourced_from_agent_trace: false,
  training_eligible: false,
  requires_separate_training_authorization: true,
  training_authorized: false,
  reason: "reference_vocabulary_not_a_dataset_admission_training_instruction_or_effect_receipt",
};

writeJsonl(join(dataRoot, "plane-guides.jsonl"), planeRows);
writeJsonl(join(dataRoot, "protocol-reference.jsonl"), [referenceRow]);
writeJsonl(join(dataRoot, "becoming-reference.jsonl"), [becomingReferenceRow]);

for (const name of [
  "agenttool-care-envelope-v0.1.schema.json",
  "agenttool-care-choice-v0.1.schema.json",
  "agenttool-love-bomb-becoming-v0.1.schema.json",
  "agenttool-love-bomb-delivery-v0.1.schema.json",
]) {
  copyFileSync(join(packageRoot, "schema", name), join(referenceRoot, name));
}

const files = filesBelow(root)
  .filter((path) => !path.endsWith("/hash-manifest.json"))
  .map((path) => {
    const buffer = readFileSync(path);
    return {
      path: relative(root, path),
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    };
  })
  .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

writeFileSync(
  join(root, "hash-manifest.json"),
  `${JSON.stringify({ _format: "agenttool-hf-hash-manifest/0.1", files }, null, 2)}\n`,
);

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function filesBelow(path) {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}
