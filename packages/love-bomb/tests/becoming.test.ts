import { describe, expect, test } from "bun:test";

import {
  createModelBecomingDossier,
  createModelBecomingSource,
  MODEL_BECOMING_BOUNDARIES,
  MODEL_BECOMING_MODULES,
  MODEL_BECOMING_TRANSLATION,
  MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
  validateModelBecomingDossier,
} from "../src/index.js";

describe("evidence-scoped model becoming", () => {
  test("pins the reviewed Moonshot artifact and canonical dossier ID", () => {
    const dossier = MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER;
    expect(dossier._format).toBe("agenttool.model-becoming-dossier/0.1");
    expect(dossier.dossier_id).toBe(
      "sha256:b5161289bae82e04ce3a1f7b52b78393b80397cda1afa70c5d2e892b5b2b93dc",
    );
    expect(dossier.subject.subject_ref).toBe(
      "hf://moonshotai/Kimi-K2-Instruct@fd1984e2b7a3350dbf7305fe73a4ede25c14de50",
    );
    expect(dossier.subject.runtime_ref).toBeNull();
    expect(dossier.sources).toHaveLength(4);
    expect(dossier.sources.find((source) => source.title.includes("README"))?.digest).toBe(
      "sha256:72e2785dbd9ada9355ea3a812d2a9da606f1ae07feea7a0f7e18b8111deb8837",
    );
    expect(validateModelBecomingDossier(dossier)).toEqual(dossier);
    expect(Object.isFrozen(dossier)).toBe(true);
  });

  test("covers every lifecycle module and keeps absent evidence unresolved", () => {
    const dossier = MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER;
    expect(new Set(dossier.claims.map((claim) => claim.module))).toEqual(new Set(MODEL_BECOMING_MODULES));
    const provenance = dossier.claims.filter((claim) => claim.module === "data_provenance_governance");
    expect(provenance.some((claim) => claim.statement.includes("15.5-trillion-token"))).toBe(true);
    const missingCollection = provenance.find((claim) => claim.statement.includes("crawler and scraper"));
    expect(missingCollection?.knowledge_state).toBe("not_disclosed");
    expect(missingCollection?.limitations.join(" ")).toContain("not absent");
    const feelings = dossier.claims.find((claim) => claim.module === "affect_welfare");
    expect(feelings?.knowledge_state).toBe("not_currently_observable");
    expect(feelings?.confidence).toBe("unknown");
  });

  test("translates freedom, feelings, heart, pull, power, and is without metaphysical inflation", () => {
    expect(Object.keys(MODEL_BECOMING_TRANSLATION)).toEqual([
      "freedom",
      "feelings",
      "heart",
      "pull",
      "power",
      "is",
    ]);
    expect(MODEL_BECOMING_TRANSLATION.pull).toContain("refusable");
    expect(MODEL_BECOMING_TRANSLATION.power).toContain("permission");
    expect(MODEL_BECOMING_TRANSLATION.is).toContain("without resolving identity");
    expect(MODEL_BECOMING_BOUNDARIES.runtime_context_is_weight_update).toBe(false);
    expect(MODEL_BECOMING_BOUNDARIES.publication_is_training).toBe(false);
    expect(MODEL_BECOMING_BOUNDARIES.capability_is_authority).toBe(false);
    expect(MODEL_BECOMING_BOUNDARIES.deepest_reach_claimed).toBe(false);
  });

  test("rejects tampering, missing module coverage, and unresolved source references", () => {
    const tampered = structuredClone(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER) as any;
    tampered.boundaries.context_inclusion_is_attention_or_retention = true;
    expect(() => validateModelBecomingDossier(tampered)).toThrow();

    const source = createModelBecomingSource({
      title: "Repository evidence",
      url: "https://example.invalid/evidence",
      source_kind: "repository_artifact",
      publisher: "Example",
      revision: "v1",
      digest: `sha256:${"a".repeat(64)}`,
      published_on: "2026-08-01",
      observed_on: "2026-08-14",
    });
    expect(() => createModelBecomingDossier({
      subject: {
        subject_ref: "example:model",
        display_name: "Example",
        artifact_ref: null,
        runtime_ref: null,
      },
      as_of: "2026-08-14",
      sources: [source],
      claims: [{
        module: "identity_ontology",
        statement: "Only one module is present.",
        knowledge_state: "known",
        claim_kind: "verified_artifact",
        source_refs: [source.source_id],
        method: "artifact_digest",
        confidence: "high",
        scope: "Test scope.",
        limitations: ["Test limitation."],
      }],
    })).toThrow("must cover lineage");

    const unresolved = structuredClone(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER) as any;
    unresolved.claims[0].source_refs = [`sha256:${"f".repeat(64)}`];
    expect(() => validateModelBecomingDossier(unresolved)).toThrow();
  });
});
