import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalJson,
  compareUnicode,
  OFFICIAL_SOURCE_CATALOG_SHA256,
  sha256Id,
} from "../src/index.js";

const catalog = JSON.parse(
  readFileSync(
    join(import.meta.dir, "..", "sources", "official-deepseek-primary-sources.json"),
    "utf8",
  ),
);

describe("official primary-source lead catalog", () => {
  test("is content pinned, sorted, unique, and drift locked", () => {
    expect(sha256Id(canonicalJson(catalog))).toBe(OFFICIAL_SOURCE_CATALOG_SHA256);
    expect(catalog.sources).toHaveLength(18);
    const ids = catalog.sources.map((source: { source_id: string }) => source.source_id);
    expect(ids).toEqual([...ids].sort(compareUnicode));
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of catalog.sources) {
      expect(source.observed_on ?? catalog.observed_on).toBe("2026-08-01");
      expect(source.evidence_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(source.license_review_required).toBe(true);
      expect(source.classification_basis).toBe(
        "researcher_inference_from_primary_source",
      );
    }
  });

  test("uses only exact official DeepSeek or versioned arXiv routes", () => {
    for (const source of catalog.sources) {
      if (source.origin === "deepseek_github") {
        expect(source.repository_id).toMatch(/^deepseek-ai\//u);
        expect(source.revision).toMatch(/^[0-9a-f]{40}$/u);
        expect(source.canonical_url).toBe(
          `https://github.com/${source.repository_id}/blob/${source.revision}/${source.path}`,
        );
        expect(source.evidence_url).toBe(
          `https://raw.githubusercontent.com/${source.repository_id}/${source.revision}/${source.path}`,
        );
      } else if (source.origin === "deepseek_huggingface") {
        expect(source.repository_id).toMatch(/^deepseek-ai\//u);
        expect(source.revision).toMatch(/^[0-9a-f]{40}$/u);
        const prefix = source.resource_kind === "dataset_repository" ? "datasets/" : "";
        expect(source.canonical_url).toBe(
          `https://huggingface.co/${prefix}${source.repository_id}/blob/${source.revision}/${source.path}`,
        );
        expect(source.evidence_url).toBe(
          `https://huggingface.co/${prefix}${source.repository_id}/resolve/${source.revision}/${source.path}`,
        );
      } else {
        expect(source.resource_kind).toBe("paper");
        expect(source.revision).toMatch(/^\d{4}\.\d{4,5}v[1-9][0-9]*$/u);
        expect(source.revision.startsWith(`${source.repository_id}v`)).toBe(true);
        expect(source.canonical_url).toBe(`https://arxiv.org/abs/${source.revision}`);
        expect(source.evidence_url).toBe(`https://arxiv.org/pdf/${source.revision}`);
      }
    }
  });

  test("contains the high-signal research, dataset, model-card, and systems lanes", () => {
    const ids = new Set(catalog.sources.map((source: { source_id: string }) => source.source_id));
    for (const expected of [
      "deepseek-r1-paper",
      "deepseek-v3-paper",
      "deepseek-math-paper",
      "deepseek-v3-2-exp-github",
      "engram-github",
      "deepseek-math-v2-github",
      "deepseek-prover-v2-github",
      "deepseek-proverbench-hf-dataset",
      "janus-github",
      "dualpipe-github",
      "deepgemm-github",
      "flashmla-github",
    ]) {
      expect(ids.has(expected)).toBe(true);
    }
  });
});
