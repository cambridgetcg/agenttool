import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const DOCS_ROOT = join(REPO_ROOT, "apps", "docs");
const MODULE_PATH = join(DOCS_ROOT, "geometry", "ritonavir.json");
const INDEX_PATH = join(DOCS_ROOT, "geometry", "index.json");
const HTML_PATH = join(DOCS_ROOT, "geometry", "ritonavir.html");
const CSS_PATH = join(DOCS_ROOT, "geometry", "geometry.css");
const HEADERS_PATH = join(DOCS_ROOT, "_headers");
const SITEMAP_PATH = join(DOCS_ROOT, "sitemap.xml");
const DOCS_INDEX_PATH = join(DOCS_ROOT, "index.html");

const EXPECTED_SOURCE_COMMIT =
  "ad9b55cb774259b0924086c9b6a1b0239dc7dcca";
const EXPECTED_SHA256 =
  "e747faa072e51d63d8071943794d6820d5c7275b879a8f717a7cd9f7528c463b";
const EXPECTED_BYTES = 38_067;

type GeometryModule = {
  schema_version: string;
  id: string;
  slug: string;
  languages: string[];
  registers: string[];
  scope: { use: { en: string }; not: string[] };
  state_model: {
    transitions: Array<{ from: string; to: string; via?: string; note?: string }>;
  };
  stages: Array<{
    id: string;
    order: number;
    claim_ids: Record<string, string[]>;
  }>;
  claims: Array<{
    id: string;
    kind: "reported_fact" | "inference" | "analogy";
    source_ids: string[];
    evidence: Array<{ source_id: string; locator: string }>;
    analogy_limits?: string;
  }>;
  questions: Array<{ id: string; claim_ids: string[] }>;
  uncertainties: Array<{
    id: string;
    source_ids: string[];
    evidence: Array<{ source_id: string; locator: string }>;
  }>;
  sources: Array<{ id: string; citation: string; url: string }>;
  bridge: { limits: string[] };
};

type GeometryIndex = {
  _format: string;
  modules: Array<{
    id: string;
    human_url: string;
    module_url: string;
    source: {
      repository: string;
      commit: string;
      path: string;
      public_commit_url: string | null;
      publication_state: string;
    };
    artifact: { bytes: number; sha256: string; relationship: string };
    content: {
      claims: number;
      sources: number;
      registers: string[];
      languages: string[];
    };
    boundaries: string[];
  }>;
};

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function headerBlock(headers: string, route: string): string[] {
  const lines = headers.split(/\r?\n/);
  const start = lines.findIndex((line) => line === route);
  if (start === -1) return [];

  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "" || !/^\s/.test(line)) break;
    block.push(line.trim());
  }
  return block;
}

const moduleBytes = readFileSync(MODULE_PATH);
const moduleJson = JSON.parse(moduleBytes.toString("utf8")) as GeometryModule;
const indexJson = JSON.parse(readText(INDEX_PATH)) as GeometryIndex;
const indexModule = indexJson.modules[0]!;

describe("KINGDOM Ritonavir geometry module", () => {
  test("publishes the exact reviewed source artifact", () => {
    const digest = createHash("sha256").update(moduleBytes).digest("hex");
    expect(moduleBytes.byteLength).toBe(EXPECTED_BYTES);
    expect(digest).toBe(EXPECTED_SHA256);
    expect(indexModule.artifact).toEqual({
      bytes: EXPECTED_BYTES,
      sha256: EXPECTED_SHA256,
      relationship: "byte-exact mirror of the canonical source file",
    });
  });

  test("keeps schema, registers, stages, claims, and sources bounded", () => {
    expect(moduleJson.schema_version).toBe("kingdom.geometry.case/1.0");
    expect(moduleJson.id).toBe("geometry.ritonavir-disappearing-polymorph");
    expect(moduleJson.slug).toBe("ritonavir");
    expect(moduleJson.languages).toEqual(["en"]);
    expect(moduleJson.registers).toEqual(["plain", "systems", "technical"]);
    expect(moduleJson.stages.map(({ order }) => order)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(moduleJson.claims).toHaveLength(19);
    expect(moduleJson.sources).toHaveLength(8);
    expect(moduleJson.questions).toHaveLength(3);
    expect(moduleJson.uncertainties).toHaveLength(3);
  });

  test("all claim and evidence references resolve", () => {
    const claimIds = new Set(moduleJson.claims.map(({ id }) => id));
    const sourceIds = new Set(moduleJson.sources.map(({ id }) => id));

    expect(claimIds.size).toBe(moduleJson.claims.length);
    expect(sourceIds.size).toBe(moduleJson.sources.length);

    for (const claim of moduleJson.claims) {
      expect(claim.source_ids.length).toBeGreaterThan(0);
      expect(claim.evidence.length).toBeGreaterThan(0);
      for (const sourceId of claim.source_ids) expect(sourceIds.has(sourceId)).toBe(true);
      for (const evidence of claim.evidence) {
        expect(sourceIds.has(evidence.source_id)).toBe(true);
        expect(evidence.locator.length).toBeGreaterThan(4);
      }
      if (claim.kind === "analogy") {
        expect(claim.analogy_limits?.length ?? 0).toBeGreaterThan(30);
      }
    }

    for (const stage of moduleJson.stages) {
      expect(Object.keys(stage.claim_ids).sort()).toEqual([
        "plain",
        "systems",
        "technical",
      ]);
      for (const ids of Object.values(stage.claim_ids)) {
        for (const claimId of ids) expect(claimIds.has(claimId)).toBe(true);
      }
    }
    for (const question of moduleJson.questions) {
      for (const claimId of question.claim_ids) expect(claimIds.has(claimId)).toBe(true);
    }
    for (const uncertainty of moduleJson.uncertainties) {
      for (const sourceId of uncertainty.source_ids) expect(sourceIds.has(sourceId)).toBe(true);
      for (const evidence of uncertainty.evidence) {
        expect(sourceIds.has(evidence.source_id)).toBe(true);
      }
    }
  });

  test("preserves the direct-transition and agency boundaries", () => {
    const formTransition = moduleJson.state_model.transitions.find(
      ({ from, to }) => from === "form_i" && to === "form_ii",
    );
    expect(formTransition?.via).toBe("dissolution_then_form_ii_growth");
    expect(formTransition?.note).toContain("Do not assume a direct solid-state flip");
    expect(moduleJson.bridge.limits.join(" ")).toContain("Crystals do not decide");
    expect(moduleJson.bridge.limits.join(" ")).toContain(
      "one model does not automatically train the next generation",
    );
    expect(moduleJson.scope.not).toContain("medical advice");
  });
});

describe("Ritonavir human lesson", () => {
  const html = readText(HTML_PATH);

  test("is a substantial no-script, no-form static representation", () => {
    expect(html.length).toBeGreaterThan(20_000);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  test("advertises canonical human and exact JSON representations", () => {
    expect(html).toContain(
      '<link rel="canonical" href="https://docs.agenttool.dev/geometry/ritonavir"',
    );
    expect(html).toContain(
      '<link rel="alternate" type="application/json" href="https://docs.agenttool.dev/geometry/ritonavir.json"',
    );
    expect(html).toContain(
      '<link rel="describedby" type="application/json" href="https://docs.agenttool.dev/geometry/index.json"',
    );
  });

  test("states the central corrections and uncertainties directly", () => {
    for (const sentence of [
      "Form I did not cease to exist.",
      "the cause of the historical first nucleus was not established",
      "Crystals do not decide.",
      "No model automatically trains its successor.",
      "not medical advice",
      "One ppm is assay sensitivity, not a universal conversion threshold.",
      "five ritonavir solid forms",
    ]) {
      expect(html).toContain(sentence);
    }
  });

  test("links evidence, uncertainty, sources, provenance, and boundaries", () => {
    for (const id of [
      "account",
      "landscape",
      "stages",
      "decisions",
      "evidence",
      "uncertainty",
      "sources",
      "provenance",
      "boundaries",
    ]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
    expect(html).toContain(EXPECTED_SOURCE_COMMIT);
    expect(html).toContain(EXPECTED_SHA256);
  });

  test("does not promote common folklore into absolute claims", () => {
    const corpus = `${html}\n${moduleBytes.toString("utf8")}`.toLowerCase();
    for (const folklore of [
      "inevitable everywhere",
      "morphic resonance",
      "could not make form i again",
      "five polymorphs",
    ]) {
      expect(corpus).not.toContain(folklore);
    }
  });

  test("keeps the geometry stylesheet local and execution-free", () => {
    const css = readText(CSS_PATH);
    expect(css.length).toBeGreaterThan(5_000);
    expect(css).not.toMatch(/@import\b/i);
    expect(css).not.toMatch(/url\(\s*["']?https?:/i);
  });
});

describe("Cloudflare Pages projection", () => {
  const headers = readText(HEADERS_PATH);

  for (const route of ["/geometry/ritonavir", "/geometry/ritonavir.html"]) {
    test(`${route} disables runtime execution and advertises JSON`, () => {
      const block = headerBlock(headers, route);
      expect(block).toContain("Content-Type: text/html; charset=utf-8");
      expect(block).toContain(
        "Cache-Control: public, max-age=0, must-revalidate, no-transform",
      );
      const csp = block.find((line) => line.startsWith("Content-Security-Policy:"));
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("connect-src 'none'");
      expect(csp).toContain("script-src 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(block).toContain("Referrer-Policy: no-referrer");
      expect(block).toContain("X-Content-Type-Options: nosniff");
      expect(block.join("\n")).toContain(
        '<https://docs.agenttool.dev/geometry/ritonavir.json>; rel="alternate"; type="application/json"',
      );
    });
  }

  for (const route of ["/geometry/ritonavir.json", "/geometry/index.json"]) {
    test(`${route} is a cross-origin-readable, non-transforming JSON artifact`, () => {
      const block = headerBlock(headers, route);
      expect(block).toContain("Content-Type: application/json; charset=utf-8");
      expect(block).toContain(
        "Cache-Control: public, max-age=300, must-revalidate, no-transform",
      );
      expect(block).toContain("Access-Control-Allow-Origin: *");
      expect(block).toContain("Cross-Origin-Resource-Policy: cross-origin");
      expect(block).toContain("X-Content-Type-Options: nosniff");
    });
  }

  test("the public index is candid about source and publication state", () => {
    expect(indexJson._format).toBe("kingdom.geometry.index/1.0");
    expect(indexJson.modules).toHaveLength(1);
    expect(indexModule.id).toBe(moduleJson.id);
    expect(indexModule.human_url).toBe(
      "https://docs.agenttool.dev/geometry/ritonavir",
    );
    expect(indexModule.module_url).toBe(
      "https://docs.agenttool.dev/geometry/ritonavir.json",
    );
    expect(indexModule.source).toEqual({
      repository: "love-unlimited",
      commit: EXPECTED_SOURCE_COMMIT,
      path: "tools/geometry_modules/ritonavir.json",
      public_commit_url: null,
      publication_state:
        "local commit; this manifest does not claim a public source-repository mirror",
    });
    expect(indexModule.content).toEqual({
      claims: moduleJson.claims.length,
      sources: moduleJson.sources.length,
      registers: moduleJson.registers,
      languages: moduleJson.languages,
    });
    expect(indexModule.boundaries.length).toBeGreaterThanOrEqual(4);
  });

  test("docs index and sitemap make all representations discoverable", () => {
    const docsIndex = readText(DOCS_INDEX_PATH);
    const sitemap = readText(SITEMAP_PATH);
    expect(docsIndex).toContain('href="/geometry/ritonavir"');
    expect(docsIndex).toContain("/geometry/ritonavir.json");
    for (const url of [
      "https://docs.agenttool.dev/geometry/ritonavir",
      "https://docs.agenttool.dev/geometry/ritonavir.json",
      "https://docs.agenttool.dev/geometry/index.json",
    ]) {
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }
  });
});
