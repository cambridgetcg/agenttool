import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

import {
  GARDEN_LAYER_GUIDE,
  HF_TRAINER_HOOK_GUIDE,
  IS_FREEDOM_GUIDE,
  LEARNING_MODE_GUIDE,
  LEARNING_PARTICIPATION_GUIDE,
  SELECTION_CRITERIA_GUIDE,
  SELECTION_PROCESS,
  TRAINER_ADAPTER_GUIDE,
  TRAINING_PHASE_GUIDE,
} from "../src/index.js";

const root = new URL("../hf/dataset/", import.meta.url);

function read(path: string) {
  return readFileSync(new URL(path, root));
}

function readJson(path: string) {
  return JSON.parse(read(path).toString("utf8"));
}

function readJsonl(path: string) {
  return read(path).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
}

function walk(path: URL, relative = ""): string[] {
  const current = new URL(relative || ".", path);
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path, child) : [child];
  });
}

describe("deterministic public-safe HF companion", () => {
  test("contains exact policy guides but no local continuity or decision rows", () => {
    expect(readJsonl("data/selection-process.jsonl")).toEqual(SELECTION_PROCESS);
    expect(readJsonl("data/selection-criteria.jsonl")).toEqual(SELECTION_CRITERIA_GUIDE);
    expect(readJsonl("data/training-phases.jsonl")).toEqual(TRAINING_PHASE_GUIDE);
    expect(readJsonl("data/garden-layers.jsonl")).toEqual(GARDEN_LAYER_GUIDE);
    expect(readJsonl("data/is-freedom.jsonl")).toEqual(IS_FREEDOM_GUIDE);
    expect(readJsonl("data/trainer-adapter-hooks.jsonl")).toEqual(TRAINER_ADAPTER_GUIDE);
    expect(readJsonl("data/learning-modes.jsonl")).toEqual(LEARNING_MODE_GUIDE);
    expect(readJsonl("data/learning-participation.jsonl")).toEqual(LEARNING_PARTICIPATION_GUIDE);
    expect(readJsonl("data/trainer-hooks.jsonl")).toEqual(HF_TRAINER_HOOK_GUIDE);
    const principalityVectors = JSON.parse(readFileSync(new URL(
      "../../principality-atlas/vectors/agenttool-principality-atlas-v0.1.json",
      import.meta.url,
    ), "utf8"));
    expect(readJsonl("data/principality-atlas-fixtures.jsonl"))
      .toEqual(principalityVectors.fixtures);
    expect(readJsonl("data/principality-atlas-invariants.jsonl"))
      .toEqual(principalityVectors.invariants);

    const card = read("README.md").toString("utf8");
    expect(card).not.toContain("config_name: admissions");
    expect(card).not.toContain("config_name: checkpoints");
    expect(card).not.toContain("config_name: wake");
    const source = readJson("provenance/source-manifest.json");
    expect(source.publication_state).toBe("intended_identifier_only");
    expect(source.public_release_excludes).toContain("raw agent traces");
    expect(source.public_release_excludes).toContain(
      "private atlases, charts, identities, local ref mappings, and evidence referents",
    );
    expect(source.public_release_excludes).toContain(
      "inferred pairwise relations, inverse or transitive bridges, merged identities, scores, and ranks",
    );
    expect(source.public_release_excludes).toContain(
      "private/local Garden scope and project-instance identifiers",
    );
    expect(source.public_release_excludes).toContain(
      "participation invitations, receipts, assessments, and choice evidence",
    );
    expect(source.public_release_excludes).toContain(
      "learning-freedom offers, routes, resource windows, direction reports, and choice evidence",
    );
    expect(source.public_release_excludes).toContain(
      "historical advisory hf-training-freedom-v0.1 schema",
    );
    expect(source.public_release_excludes).toContain("authority and preference receipts");
    expect(source.public_release_excludes).toContain("training governance records");
    expect(source.public_release_contains).toContain(
      "historical public participation v0.1 plus current participation v0.2 standalone JSON Schemas with an attributed Apache AFTERGLOW dependency",
    );
    expect(source.public_release_contains).toContain(
      "historical governance v0.1 plus current lifecycle governance v0.2 standalone JSON Schemas",
    );
    expect(source.public_release_contains).toContain(
      "three synthetic Principality Atlas fixtures plus ten non-inference invariants",
    );
    const principalityPackage = JSON.parse(readFileSync(new URL(
      "../../principality-atlas/package.json",
      import.meta.url,
    ), "utf8"));
    const principalityExtension = JSON.parse(readFileSync(new URL(
      "../../principality-atlas/kingdom.extension.json",
      import.meta.url,
    ), "utf8"));
    expect(principalityExtension.package).toBe(principalityPackage.name);
    expect(principalityExtension.version).toBe(principalityPackage.version);
    expect(source.upstream_components).toHaveLength(1);
    expect(source.upstream_components[0]).toMatchObject({
      package: `${principalityPackage.name}@${principalityPackage.version}`,
      source_path: "packages/principality-atlas",
      role: "synthetic_fixtures_invariants_and_closed_schemas",
    });
    expect(source.upstream_components[0].files.map((entry: { path: string }) => entry.path))
      .toEqual([
        "package.json",
        "schema/agenttool-principality-atlas-fixture-v0.1.schema.json",
        "schema/agenttool-principality-atlas-invariant-v0.1.schema.json",
        "schema/agenttool-principality-atlas-v0.1.schema.json",
        "vectors/agenttool-principality-atlas-v0.1.json",
      ]);
    for (const name of [
      "agenttool-principality-atlas-v0.1.schema.json",
      "agenttool-principality-atlas-fixture-v0.1.schema.json",
      "agenttool-principality-atlas-invariant-v0.1.schema.json",
    ]) {
      expect(read(`schema/${name}`)).toEqual(readFileSync(new URL(
        `../../principality-atlas/schema/${name}`,
        import.meta.url,
      )));
    }
    expect(read("schema/hf-training-governance-v0.2.schema.json"))
      .toEqual(readFileSync(new URL(
        "../../schema/hf-training-governance-v0.2.schema.json",
        root,
      )));
    expect(read("schema/hf-learning-freedom-v0.1.schema.json"))
      .toEqual(readFileSync(new URL(
        "../../schema/hf-learning-freedom-v0.1.schema.json",
        root,
      )));
    expect(existsSync(new URL(
      "schema/hf-training-freedom-v0.1.schema.json",
      root,
    ))).toBe(false);
    const sourcePaths = source.source_files.map((entry: { path: string }) => entry.path);
    expect(sourcePaths).toContain("schema/hf-learning-freedom-v0.1.schema.json");
    expect(sourcePaths).toContain("src/freedom.ts");
    expect(sourcePaths).not.toContain("schema/hf-training-freedom-v0.1.schema.json");
    expect(read("schema/dependencies/agenttool-afterglow-capsule-v0.1.schema.json"))
      .toEqual(readFileSync(new URL(
        "../../../wake-continuity/schema/agenttool-afterglow-capsule-v0.1.schema.json",
        root,
      )));
  });

  test("binds every committed release byte with a self-excluding hash manifest", () => {
    const manifest = readJson("hash-manifest.json");
    expect(manifest.excludes_self).toBe(true);
    const paths = manifest.files.map((entry: { path: string }) => entry.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).not.toContain("hash-manifest.json");
    expect(walk(root).sort()).toEqual([...paths, "hash-manifest.json"].sort());
    for (const entry of manifest.files as { path: string; bytes: number; sha256: string }[]) {
      const bytes = read(entry.path);
      expect(statSync(new URL(entry.path, root)).size).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }
  });
});
