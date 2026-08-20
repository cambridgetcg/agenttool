import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  validateDatasetInfluenceStudy,
  validateDatasetLineage,
  validateIdentityEvidenceView,
  validateShadowAttribution,
} from "../src/index.js";

const root = join(import.meta.dir, "..", "hf", "dataset");

describe("reference-only Hugging Face candidate", () => {
  test("contains one synthetic, training-unauthorized reference row", () => {
    const [row] = readFileSync(join(root, "data", "dataset-influence-reference.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(row.row_role).toBe("reference_only");
    expect(row.origin).toBe("human_directed_agent_authored_synthetic");
    expect(row.training_admission).toBe("not_applicable");
    expect(row.requires_separate_training_authorization).toBe(true);
    expect(row.training_authorized).toBe(false);
    expect(row.contains_private_or_participant_data).toBe(false);
    validateDatasetLineage(row.lineage);
    validateDatasetInfluenceStudy(row.study);
    validateIdentityEvidenceView(row.identity_evidence);
    validateShadowAttribution(row.shadow_attribution);
  });

  test("states intended-provider and zero-effect boundaries precisely", () => {
    const manifest = JSON.parse(readFileSync(join(root, "source-manifest.json"), "utf8"));
    const card = readFileSync(join(root, "README.md"), "utf8");
    expect(manifest.intended_hugging_face_identifier).toBe("Yu-and-Ai/agenttool-dataset-influence");
    expect(manifest.publication_state_at_generation).toContain("not_uploaded");
    expect(manifest.source_manifest_scope).toContain("not_complete_repository_or_package_inventory");
    expect(manifest.source_files_complete).toBe(false);
    expect(manifest.upstream_repository).toBe("https://github.com/cambridgetcg/agenttool");
    expect(manifest.upstream_revision).toBeNull();
    expect(manifest.upstream_revision_state).toContain("unpublished");
    expect(manifest.selected_source_set_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash("sha256").update(JSON.stringify(manifest.source_files)).digest("hex"))
      .toBe(manifest.selected_source_set_sha256);
    expect(manifest.source_files.some((file: any) => file.path === "../../docs/DATASET-INFLUENCE.md"))
      .toBe(true);
    expect(manifest.source_manifest_is_attestation).toBe(false);
    expect(manifest.training_authorized).toBe(false);
    expect(manifest.training_effect).toBe("none");
    expect(manifest.provider_effect).toBe("none");
    expect(manifest.identity_effect).toBe("none");
    expect(manifest.economic_effect).toBe("none");
    expect(card).toContain("config_name: dataset_influence_reference");
    expect(card).toContain("- split: reference\n    path: data/dataset-influence-reference.jsonl");
    expect(card).toContain("non-enforcing\ngovernance metadata");
    expect(card).toContain("reference/\` directory carries the protocol README");
    expect(card).not.toContain("- split: train");
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

  test("copies schemas, vectors, protocol, and doctrine byte-for-byte", () => {
    for (const name of readdirSync(join(root, "reference")).filter((entry) => entry.endsWith(".json")).sort()) {
      const source = name === "agenttool-dataset-influence-v0.1.json"
        ? join(root, "..", "..", "vectors", name)
        : join(root, "..", "..", "schema", name);
      expect(readFileSync(join(root, "reference", name))).toEqual(readFileSync(source));
    }
    expect(readFileSync(join(root, "reference", "PROTOCOL.md")))
      .toEqual(readFileSync(join(root, "..", "..", "README.md")));
    expect(readFileSync(join(root, "reference", "DATASET-INFLUENCE.md")))
      .toEqual(readFileSync(join(root, "..", "..", "..", "..", "docs", "DATASET-INFLUENCE.md")));
  });
});

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}
