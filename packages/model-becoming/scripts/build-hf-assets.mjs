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
  MODEL_BECOMING_FORMATS,
  MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
} from "../dist/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(packageRoot, "hf", "dataset");
const dataRoot = join(root, "data");
const referenceRoot = join(root, "reference");
mkdirSync(dataRoot, { recursive: true });
mkdirSync(referenceRoot, { recursive: true });

const referenceRow = {
  _format: MODEL_BECOMING_FORMATS.hfReferenceRow,
  row_role: "reference_only",
  training_admission: "not_applicable",
  requires_separate_training_authorization: true,
  training_authorized: false,
  dossier: MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
};

writeJsonl(join(dataRoot, "model-becoming-reference.jsonl"), [referenceRow]);
copyFileSync(
  join(packageRoot, "schema", "agenttool-model-becoming-dossier-v0.1.schema.json"),
  join(referenceRoot, "agenttool-model-becoming-dossier-v0.1.schema.json"),
);

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
  `${JSON.stringify({ _format: "agenttool-model-becoming-hf-hash-manifest/0.1", files }, null, 2)}\n`,
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
