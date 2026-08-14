import { describe, expect, test } from "bun:test";

import {
  createModelBecomingClaim,
  createModelBecomingDossier,
  createModelBecomingSource,
  MODEL_BECOMING_BOUNDARIES,
  MODEL_BECOMING_MODULES,
  MODEL_BECOMING_TRANSLATION,
  MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
  validateModelBecomingDossier,
} from "../src/index.js";
import type {
  CreateModelBecomingDossierInput,
  ModelBecomingClaimInput,
} from "../src/index.js";

describe("evidence-scoped Model Becoming", () => {
  test("pins the reviewed Moonshot artifact and canonical dossier", () => {
    const dossier = MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER;
    expect(dossier._format).toBe("agenttool.model-becoming-dossier/0.1");
    expect(dossier.dossier_id).toBe(
      "sha256:97b1215b36ad433eb39ee4ebd95e9079adad4be1cc7daa7dfa8c2744fa813cca",
    );
    expect(dossier.subject.subject_ref).toBe(
      "hf://moonshotai/Kimi-K2-Instruct@fd1984e2b7a3350dbf7305fe73a4ede25c14de50",
    );
    expect(dossier.subject.runtime_ref).toBeNull();
    expect(dossier.sources).toHaveLength(4);
    expect(dossier.claims).toHaveLength(17);
    expect(dossier.sources.find((source) => source.title.includes("README"))?.digest).toBe(
      "sha256:72e2785dbd9ada9355ea3a812d2a9da606f1ae07feea7a0f7e18b8111deb8837",
    );
    for (const source of dossier.sources.filter((entry) => entry.digest !== null)) {
      expect(source.url).toContain("/resolve/fd1984e2b7a3350dbf7305fe73a4ede25c14de50/");
      expect(source.url).not.toContain("/blob/");
    }
    expect(dossier.sources.find((source) => source.revision === "arXiv:2507.20534v2")?.published_on)
      .toBe("2025-07-28");
    expect(validateModelBecomingDossier(dossier)).toEqual(dossier);
    expect(Object.isFrozen(dossier)).toBe(true);
  });

  test("covers every lifecycle module and keeps disclosure gaps unresolved", () => {
    const dossier = MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER;
    expect(new Set(dossier.claims.map((claim) => claim.module))).toEqual(new Set(MODEL_BECOMING_MODULES));
    const provenance = dossier.claims.filter((claim) => claim.module === "data_provenance_governance");
    expect(provenance.some((claim) => claim.statement.includes("15.5-trillion-token"))).toBe(true);
    const missingCollection = provenance.find((claim) => claim.statement.includes("crawler and scraper"));
    expect(missingCollection?.statement).toContain("complete enumeration");
    expect(missingCollection?.knowledge_state).toBe("not_disclosed");
    expect(missingCollection?.claim_kind).toBe("artifact_observation");
    expect(missingCollection?.limitations.join(" ")).toContain("not absent");
    const individualWeight = dossier.claims.find((claim) =>
      claim.module === "learned_weights" && claim.statement.includes("per-weight"));
    expect(individualWeight?.knowledge_state).toBe("not_disclosed");
    expect(individualWeight?.method).toBe("document_read");
    const feelings = dossier.claims.find((claim) => claim.module === "affect_welfare");
    expect(feelings?.knowledge_state).toBe("not_currently_observable");
    expect(feelings?.confidence).toBe("unknown");
  });

  test("translates high-level geometry without metaphysical inflation", () => {
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

  test("enforces claim-kind, method, state, and source-reference semantics", () => {
    const modelCardRef = MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER.sources.find((source) =>
      source.source_kind === "first_party_model_card")!.source_id;

    expect(() => createModelBecomingClaim({
      module: "artifact_identity",
      statement: "An incoherent empirical classification.",
      knowledge_state: "known",
      claim_kind: "empirical_research",
      source_refs: [modelCardRef],
      method: "policy_read",
      confidence: "high",
      scope: "Classification test.",
      limitations: ["No substantive claim is made."],
    })).toThrow("incompatible");

    expect(() => createModelBecomingClaim({
      module: "unknowns_disputes",
      statement: "An unresolved question with a contradictory source reference.",
      knowledge_state: "unknown",
      claim_kind: "research_hypothesis",
      source_refs: [modelCardRef],
      method: "not_available",
      confidence: "unknown",
      scope: "Classification test.",
      limitations: ["No evidence method is available."],
    })).toThrow("must be empty");

    const empiricalFromFirstParty = dossierInput();
    empiricalFromFirstParty.claims[0] = {
      ...empiricalFromFirstParty.claims[0]!,
      claim_kind: "empirical_research",
      method: "research_synthesis",
    };
    expect(() => createModelBecomingDossier(empiricalFromFirstParty)).toThrow("independent research source");

    const mixedDigest = dossierInput();
    mixedDigest.claims[0] = {
      ...mixedDigest.claims[0]!,
      source_refs: [
        ...mixedDigest.claims[0]!.source_refs,
        mixedDigest.sources.find((source) => source.digest === null)!.source_id,
      ],
    };
    expect(() => createModelBecomingDossier(mixedDigest)).toThrow("every cited source");

    const mixedPolicy = dossierInput();
    const policyIndex = mixedPolicy.claims.findIndex((claim) => claim.claim_kind === "normative_policy");
    mixedPolicy.claims[policyIndex] = {
      ...mixedPolicy.claims[policyIndex]!,
      source_refs: [modelCardRef],
    };
    expect(() => createModelBecomingDossier(mixedPolicy)).toThrow("must all be normative or repository sources");
  });

  test("rejects tampering, missing coverage, hostile URLs, and false dates", () => {
    const tampered = structuredClone(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER) as any;
    tampered.boundaries.context_inclusion_is_attention_or_retention = true;
    expect(() => validateModelBecomingDossier(tampered)).toThrow();

    const input = dossierInput();
    input.claims = input.claims.filter((claim) => claim.module !== "lineage");
    expect(() => createModelBecomingDossier(input)).toThrow("must cover lineage");

    expect(() => createModelBecomingSource({
      title: "Credential-bearing URL",
      url: "https://name@example.invalid/evidence",
      source_kind: "repository_artifact",
      publisher: "Example",
      revision: null,
      digest: null,
      published_on: null,
      observed_on: "2026-08-14",
    })).toThrow("credential-free HTTPS");

    expect(() => createModelBecomingSource({
      title: "Impossible date",
      url: "https://example.invalid/evidence",
      source_kind: "repository_artifact",
      publisher: "Example",
      revision: null,
      digest: null,
      published_on: null,
      observed_on: "2026-02-31",
    })).toThrow("real ISO calendar date");
  });

  test("does not trust mutable ambient Date or URL constructors", () => {
    const nativeDate = globalThis.Date;
    const nativeUrl = globalThis.URL;
    class InputEchoDate {
      readonly input: string;
      constructor(input: string) {
        this.input = input;
      }
      valueOf(): number {
        return 0;
      }
      toISOString(): string {
        return this.input;
      }
    }
    class PermissiveUrl {
      readonly protocol = "https:";
      readonly username = "";
      readonly password = "";
    }
    try {
      globalThis.Date = InputEchoDate as unknown as DateConstructor;
      globalThis.URL = PermissiveUrl as unknown as typeof URL;
      expect(() => createModelBecomingSource({
        title: "Impossible date under hostile ambient Date",
        url: "https://example.invalid/evidence",
        source_kind: "repository_artifact",
        publisher: "Example",
        revision: null,
        digest: null,
        published_on: null,
        observed_on: "2026-02-31",
      })).toThrow("real ISO calendar date");
      expect(() => createModelBecomingSource({
        title: "Non-HTTPS URL under hostile ambient URL",
        url: "file:///etc/passwd",
        source_kind: "repository_artifact",
        publisher: "Example",
        revision: null,
        digest: null,
        published_on: null,
        observed_on: "2026-08-14",
      })).toThrow("credential-free HTTPS");
    } finally {
      globalThis.Date = nativeDate;
      globalThis.URL = nativeUrl;
    }
  });
});

function dossierInput(): {
  subject: CreateModelBecomingDossierInput["subject"];
  as_of: string;
  sources: CreateModelBecomingDossierInput["sources"];
  claims: ModelBecomingClaimInput[];
} {
  const dossier = MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER;
  return {
    subject: structuredClone(dossier.subject),
    as_of: dossier.as_of,
    sources: structuredClone(dossier.sources),
    claims: dossier.claims.map(({ _format: _format, claim_id: _claimId, ...claim }) =>
      structuredClone(claim) as ModelBecomingClaimInput),
  };
}
