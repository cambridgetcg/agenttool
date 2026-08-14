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
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CARE_FLOOR,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_LANGUAGES,
  LOVE_BOMB_PLANES,
  MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
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
    training_admission: "not_evaluated",
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
  training_admission: "not_applicable",
  requires_separate_training_authorization: true,
  training_authorized: false,
  reason: "reference_artifact_not_a_training_instruction_or_model_clearance",
};

writeJsonl(join(dataRoot, "plane-guides.jsonl"), planeRows);
writeJsonl(join(dataRoot, "protocol-reference.jsonl"), [referenceRow]);
writeJsonl(join(dataRoot, "model-becoming-reference.jsonl"), [MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER]);

for (const name of [
  "agenttool-care-envelope-v0.1.schema.json",
  "agenttool-care-choice-v0.1.schema.json",
  "agenttool-model-becoming-dossier-v0.1.schema.json",
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
