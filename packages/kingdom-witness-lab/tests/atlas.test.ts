import { describe, expect, test } from "bun:test";

import {
  DEEPSEEK_ATLAS_SCHEMA,
  createDeepSeekPassport,
  deepSeekResearchKeys,
  getDeepSeekResearchAtlas,
  getDeepSeekResearchEntry,
  validateDeepSeekResearchAtlas,
} from "../src/index.js";

describe("dated DeepSeek research atlas", () => {
  test("pins eight inert official-source research leads", () => {
    const atlas = getDeepSeekResearchAtlas();
    expect(atlas.schema).toBe(DEEPSEEK_ATLAS_SCHEMA);
    expect(atlas.atlas_id).toBe(
      "sha256:90bb057b3a1a562bbaf32ebe361592cf19bd85e69b847b146eaf7e0c49d20bd1",
    );
    expect(atlas.observed_on).toBe("2026-08-01");
    expect(atlas.entries).toHaveLength(8);
    expect(deepSeekResearchKeys).toEqual([
      "deepseek-3fs",
      "deepseek-engram",
      "deepseek-math-v2",
      "deepseek-ocr-2",
      "deepseek-proverbench",
      "deepseek-r1",
      "deepseek-v4-flash-0731",
      "deepspec",
    ]);
    expect(atlas.boundary).toEqual({
      artifact_content: "not_downloaded",
      code: "not_executed",
      public_metadata: "read_only_observed",
      inference_or_write_api: "not_called",
      credentials: "not_read",
      terms: "not_accepted",
      legal_clearance: "not_assessed",
      truth: "not_determined",
      authority: "none",
    });
    expect(Object.isFrozen(atlas.entries)).toBe(true);
  });

  test("preserves license uncertainty and workload boundaries literally", () => {
    const prover = getDeepSeekResearchEntry("deepseek-proverbench");
    expect(prover.publisher_assertions.declared_license).toBeNull();
    expect(prover.proposal.stage).toBe("metadata_only");
    expect(prover.proposal.boundary_codes).toContain("no_declared_license");
    expect(prover.proposal.boundary_codes).toContain("benchmark_excluded_from_training");
    expect(prover.official_sources).toContain(
      "https://huggingface.co/datasets/deepseek-ai/DeepSeek-ProverBench",
    );

    const deepSpec = getDeepSeekResearchEntry("deepspec");
    expect(deepSpec.proposal.boundary_codes).toContain("bulk_cache_separate_approval");
    expect(deepSpec.proposal.boundary_codes).toContain("workflow_not_executed");
  });

  test("rejects a Hugging Face dataset source in the model namespace", () => {
    const atlas = structuredClone(getDeepSeekResearchAtlas());
    const prover = atlas.entries.find((entry) => entry.key === "deepseek-proverbench");
    if (!prover) throw new Error("missing ProverBench fixture");
    prover.official_sources = [
      "https://arxiv.org/abs/2504.21801",
      "https://huggingface.co/deepseek-ai/DeepSeek-ProverBench",
    ];
    expect(() => validateDeepSeekResearchAtlas(atlas)).toThrow(
      "provider- and kind-specific URL",
    );
  });

  test("keeps every atlas row admissible as a research passport", () => {
    const wrongNullScope = structuredClone(getDeepSeekResearchAtlas());
    const prover = wrongNullScope.entries.find((entry) => entry.key === "deepseek-proverbench");
    if (!prover) throw new Error("missing ProverBench fixture");
    prover.publisher_assertions.license_scope = "artifact";
    expect(() => validateDeepSeekResearchAtlas(wrongNullScope)).toThrow(
      "license_scope=unknown",
    );

    const falseAbsentBoundary = structuredClone(getDeepSeekResearchAtlas());
    const r1 = falseAbsentBoundary.entries.find((entry) => entry.key === "deepseek-r1");
    if (!r1) throw new Error("missing R1 fixture");
    r1.proposal.boundary_codes = [
      ...r1.proposal.boundary_codes,
      "no_declared_license",
    ].sort();
    expect(() => validateDeepSeekResearchAtlas(falseAbsentBoundary)).toThrow(
      "exactly track",
    );

    const missingClearance = structuredClone(getDeepSeekResearchAtlas());
    const v4 = missingClearance.entries.find((entry) => entry.key === "deepseek-v4-flash-0731");
    if (!v4) throw new Error("missing V4 fixture");
    v4.proposal.boundary_codes = v4.proposal.boundary_codes.filter(
      (code) => code !== "license_clearance_not_assessed",
    );
    expect(() => validateDeepSeekResearchAtlas(missingClearance)).toThrow(
      "retain license_clearance_not_assessed",
    );
  });

  test("projects an atlas row into a deterministic passport", () => {
    const passport = createDeepSeekPassport(
      "deepseek-ocr-2",
      "2026-08-01T12:20:00.000Z",
    );
    expect(passport.subject.revision).toBe("aaa02f3811945a91062062994c5c4a3f4c0af2b0");
    expect(passport.evidence_refs).toContain(getDeepSeekResearchAtlas().atlas_id);
    expect(passport.proposal.boundary_codes).toContain("visual_input_disclosure_separate");
    expect(() => createDeepSeekPassport(
      "deepseek-ocr-2",
      "2099-01-01T00:00:00.000Z",
    )).toThrow("atlas observation day");
    expect(() => getDeepSeekResearchEntry("not-a-real-entry")).toThrow("Unknown DeepSeek");
  });

  test("validates the atlas date without consulting mutable global Date", () => {
    const atlas = structuredClone(getDeepSeekResearchAtlas());
    atlas.observed_on = "2026-02-30";
    const originalDate = globalThis.Date;
    class LyingDate {
      toISOString(): string {
        return "2026-02-30T00:00:00.000Z";
      }
    }
    let rejectedImpossibleDate = false;
    try {
      globalThis.Date = LyingDate as unknown as DateConstructor;
      try {
        validateDeepSeekResearchAtlas(atlas);
      } catch {
        rejectedImpossibleDate = true;
      }
    } finally {
      globalThis.Date = originalDate;
    }
    expect(rejectedImpossibleDate).toBe(true);
  });
});
