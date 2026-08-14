import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  MODEL_BECOMING_FORMATS,
  MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
  validateModelBecomingDossier,
} from "../src/index.js";

const root = join(import.meta.dir, "..", "hf", "dataset");

describe("reference-only Hugging Face candidate", () => {
  test("contains one wrapped reference-only dossier row", () => {
    expect(readdirSync(join(root, "data")).sort()).toEqual(["model-becoming-reference.jsonl"]);
    const [row] = jsonl("data/model-becoming-reference.jsonl");
    expect(row._format).toBe(MODEL_BECOMING_FORMATS.hfReferenceRow);
    expect(row.row_role).toBe("reference_only");
    expect(row.training_admission).toBe("not_applicable");
    expect(row.requires_separate_training_authorization).toBe(true);
    expect(row.training_authorized).toBe(false);
    expect(row.dossier).toEqual(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER);
    expect(validateModelBecomingDossier(row.dossier)).toEqual(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER);
  });

  test("states provider, publication, identity, and training boundaries precisely", () => {
    const manifest = JSON.parse(readFileSync(join(root, "source-manifest.json"), "utf8"));
    expect(manifest.intended_hugging_face_identifier).toBe("Yu-and-Ai/agenttool-model-becoming");
    expect(manifest.distribution_state).toBe("not_established_by_these_bytes");
    expect(manifest.training_admission).toBe("not_applicable");
    expect(manifest.training_effect).toBe("none");
    expect(manifest.requires_separate_training_authorization).toBe(true);
    expect(manifest.training_authorized).toBe(false);
    expect(manifest.provider_effect).toBe("none");
    expect(manifest.publication_effect).toBe("none");
    expect(manifest.contains_participant_identity_data).toBe(false);
    expect(manifest.contains_public_model_and_publisher_identifiers).toBe(true);
    expect(manifest).not.toHaveProperty("contains_identity_data");
  });

  test("uses exact raw content URLs for every digest-bound Hugging Face source", () => {
    for (const source of MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER.sources.filter((entry) => entry.digest)) {
      expect(source.url).toMatch(/huggingface\.co\/moonshotai\/Kimi-K2-Instruct\/resolve\/[0-9a-f]{40}\//);
      expect(source.url).not.toContain("/blob/");
    }
  });

  test("hash manifest covers every companion byte except itself", () => {
    const manifest = JSON.parse(readFileSync(join(root, "hash-manifest.json"), "utf8"));
    const actual = filesBelow(root)
      .map((path) => path.slice(root.length + 1))
      .filter((path) => path !== "hash-manifest.json")
      .sort();
    expect(manifest.files.map((file: any) => file.path)).toEqual(actual);
    for (const file of manifest.files) {
      const bytes = readFileSync(join(root, file.path));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    }
  });

  test("copies the one dossier schema byte-for-byte", () => {
    const name = "agenttool-model-becoming-dossier-v0.1.schema.json";
    expect(readdirSync(join(root, "reference")).sort()).toEqual([name]);
    expect(readFileSync(join(root, "reference", name))).toEqual(
      readFileSync(join(root, "..", "..", "schema", name)),
    );
  });
});

function jsonl(path: string): any[] {
  return readFileSync(join(root, path), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}
