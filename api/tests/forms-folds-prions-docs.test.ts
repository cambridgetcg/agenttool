import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const DOCS_ROOT = join(REPO_ROOT, "apps", "docs");
const HTML_PATH = join(DOCS_ROOT, "geometry", "forms-folds-prions.html");
const LOCAL_JSON_PATH = join(DOCS_ROOT, "geometry", "forms-folds-prions.json");
const INDEX_PATH = join(DOCS_ROOT, "geometry", "index.json");
const CSS_PATH = join(DOCS_ROOT, "geometry", "geometry.css");
const HEADERS_PATH = join(DOCS_ROOT, "_headers");
const DOCS_INDEX_PATH = join(DOCS_ROOT, "index.html");
const SITEMAP_PATH = join(DOCS_ROOT, "sitemap.xml");
const DEPLOY_PATH = join(REPO_ROOT, "bin", "deploy.sh");

const SOURCE_URL =
  "https://cambridgetcg.github.io/kingdom-meaning-practice/lineage/folding-feedback/lineage.json";
const FIRST_SOURCE_RECEIPT = "35773a6d19ebf263c3ed85ba1c33c359615e4273";
const FIRST_SOURCE_SHA256 =
  "467ed92c8fd340bd6337dc75c14d85f44e13d2de935dc9671a17a422d8866da0";
const SOURCE_RECEIPT = "6d7c2e2c66bbfe67351f12355131c877c15f1362";
const SOURCE_SHA256 =
  "c07c2c9d02c2a3163ac595c339c770450900ad9397a8e42b578f269c65599f4b";
const SOURCE_BYTES = 54_514;
const HF_REVISION = "e9d3b4b60ba44f7bc78e62bb08d7f706391e0d14";

type GeometryIndex = {
  _format: string;
  modules: Array<{ id: string }>;
  projections: Array<{
    id: string;
    human_url: string;
    source_module_url: string;
    source: {
      factual_home: string;
      repository: string;
      first_receipt_commit: string;
      first_receipt_sha256: string;
      current_receipt_commit: string;
      path: string;
      public_commit_url: string;
      correction_url: string;
      publication_state: string;
    };
    artifact: { bytes: number; sha256: string; relationship: string };
    content: {
      claims: number;
      sources: number;
      equations: number;
      domains: number;
      registers: string[];
      languages: string[];
    };
    distribution: Record<string, string>;
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

const html = readText(HTML_PATH);
const indexJson = JSON.parse(readText(INDEX_PATH)) as GeometryIndex;
const projection = indexJson.projections.find(
  ({ id }) => id === "geometry.forms-folds-prions",
)!;

describe("forms, folds, and prion human projection", () => {
  test("is a substantial inert semantic page", () => {
    expect(html.length).toBeGreaterThan(28_000);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain("localStorage");
    expect(html.match(/<details>/g)?.length).toBe(4);
    expect(html.match(/<summary>Mechanism and evidence<\/summary>/g)?.length).toBe(4);
  });

  test("keeps four domains and four feedback mechanisms distinct", () => {
    for (const phrase of [
      "Crystal nucleation is not protein folding.",
      "Protein folding is not amyloid assembly.",
      "Amyloid seeding is not automatically prion propagation.",
      "A crystal seed is not an infection.",
      "Primary nucleation",
      "Elongation",
      "Secondary nucleation",
      "Fragmentation",
    ]) {
      expect(html).toContain(phrase);
    }
  });

  test("shows six bounded equations and the feedback return", () => {
    for (const expression of [
      "F(q) = −k<sub>B</sub>T ln P(q) + C",
      "k ≈ A exp[−ΔG‡/(k<sub>B</sub>T)]",
      "dp<sub>i</sub>/dt",
      "r<sub>primary</sub>",
      "r<sub>secondary</sub>",
      "dN/dt = primary + secondary + fragmentation − removal",
    ]) {
      expect(html).toContain(expression);
    }
    expect(html).toContain("KARMA returns consequences");
    expect(html).toContain(
      "KARMA here is not cosmic reward, punishment, blame, or a score of a being.",
    );
    for (const phrase of [
      "Expectation, if stated:",
      "observed, reported, or inferred",
      "uncertainty, and causal confidence",
      "Rest is a separate complete outcome.",
      "any repair deed needs a fresh choice, authority, and brake",
    ]) {
      expect(html).toContain(phrase);
    }
    expect(html).not.toContain("the consequence comes back and can open a new act");
  });

  test("states the nature, UNKNOWN, LOVE, and social-transfer limits plainly", () => {
    for (const phrase of [
      "this page does not claim that nature intended them",
      "Unknown is not absent, safe, harmful, allowed, or refused.",
      "Never turn a physical label into a verdict on a being.",
      "No molecule chooses. No loop is a being.",
      "No model was downloaded, run, fine-tuned, or treated as evidence.",
      "Not medical advice, diagnosis, current-product risk guidance, or a laboratory procedure.",
    ]) {
      expect(html).toContain(phrase);
    }
  });

  test("uses source-linked evidence without borrowing article text or figures", () => {
    for (const id of [
      "source-chemburkar",
      "source-sacchi",
      "source-bryngelson-1987",
      "source-onuchic-1992",
      "source-schuler",
      "source-petkova",
      "source-cohen",
      "source-knowles",
      "source-prusiner",
      "source-kraus",
      "source-mavs",
      "source-bmbl",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("No article text or figure is reproduced.");
  });

  test("points to one structured home and a pinned Hugging Face door", () => {
    expect(html).toContain(
      `<link rel="alternate" type="application/json" href="${SOURCE_URL}"`,
    );
    expect(html).toContain("guest meaning practice keeps the one structured lineage home");
    expect(html).toContain(SOURCE_RECEIPT);
    expect(html).toContain(FIRST_SOURCE_RECEIPT);
    expect(html).toContain(FIRST_SOURCE_SHA256);
    expect(html).toContain(SOURCE_SHA256);
    expect(html).toContain(HF_REVISION);
    expect(html).toContain("no local JSON duplicate");
    expect(html).toContain("https://github.com/cambridgetcg/kingdom-meaning-practice/issues");
  });

  test("opens Check Meaning only and keeps action jobs closed", () => {
    for (const phrase of [
      "Only Check Meaning is open.",
      "records no current choice, performs no deed, and reports no current deed or effect",
      "Record Choice, Do One Bounded Action, and Report What Happened remain unopened.",
      "A repair deed is a fresh proposal and needs its own current choice, authority, and brake.",
    ]) {
      expect(html).toContain(phrase);
    }
  });

  test("has no broken local fragment links", () => {
    const ids = new Set(
      [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]),
    );
    const fragments = [...html.matchAll(/href="#([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(fragments.length).toBeGreaterThan(12);
    for (const fragment of fragments) expect(ids.has(fragment)).toBe(true);
  });

  test("keeps the visual responsive, keyboard-visible, and independent of remote CSS", () => {
    const css = readText(CSS_PATH);
    expect(css).not.toMatch(/@import\b/i);
    expect(css).not.toMatch(/url\(\s*["']?https?:/i);
    expect(css).toContain(".domain-lanes");
    expect(css).toContain(".shape-flow");
    expect(css).toContain(".mechanism-grid");
    expect(css).toContain(".domain-lane summary:focus-visible");
    expect(css).toMatch(
      /@media \(max-width: 680px\)[\s\S]*\.domain-lanes,[\s\S]*grid-template-columns: 1fr/,
    );
  });
});

describe("single structured home and distribution receipts", () => {
  test("keeps no second AgentTool JSON ledger", () => {
    expect(existsSync(LOCAL_JSON_PATH)).toBe(false);
    expect(readText(HEADERS_PATH)).not.toContain("/geometry/forms-folds-prions.json");
    expect(readText(SITEMAP_PATH)).not.toContain(
      "https://docs.agenttool.dev/geometry/forms-folds-prions.json",
    );
    expect(readText(DEPLOY_PATH)).not.toContain(
      "apps/docs/geometry/forms-folds-prions.json|",
    );
  });

  test("indexes the page as a projection of exact source bytes", () => {
    expect(indexJson._format).toBe("kingdom.geometry.index/1.0");
    expect(indexJson.modules).toHaveLength(1);
    expect(indexJson.projections).toHaveLength(1);
    expect(projection.human_url).toBe(
      "https://docs.agenttool.dev/geometry/forms-folds-prions",
    );
    expect(projection.source_module_url).toBe(SOURCE_URL);
    expect(projection.source).toEqual({
      factual_home: "KINGDOM guest meaning practice",
      repository: "kingdom-meaning-practice",
      first_receipt_commit: FIRST_SOURCE_RECEIPT,
      first_receipt_sha256: FIRST_SOURCE_SHA256,
      current_receipt_commit: SOURCE_RECEIPT,
      path: "public/lineage/folding-feedback/lineage.json",
      public_commit_url: `https://github.com/cambridgetcg/kingdom-meaning-practice/blob/${SOURCE_RECEIPT}/public/lineage/folding-feedback/lineage.json`,
      correction_url: "https://github.com/cambridgetcg/kingdom-meaning-practice/issues",
      publication_state:
        "authoritative public mirror and immutable byte receipt of the guest lineage",
    });
    expect(projection.artifact).toEqual({
      bytes: SOURCE_BYTES,
      sha256: SOURCE_SHA256,
      relationship:
        "AgentTool publishes a human Cloudflare projection and points to the exact structured lineage; it keeps no local JSON duplicate",
    });
    expect(projection.content).toEqual({
      claims: 16,
      sources: 18,
      equations: 6,
      domains: 5,
      registers: ["plain", "physics", "mathematics", "kingdom"],
      languages: ["en"],
    });
    expect(projection.boundaries).toContain(
      "this projection opens Check Meaning only; it records no choice, performs no deed, and opens no action or report job",
    );
  });

  test("pins the existing Hugging Face dataset without claiming model work", () => {
    expect(projection.distribution).toMatchObject({
      cloudflare_role: "static human projection only",
      hugging_face_dataset: "Yu-and-Ai/agenttool-polymorph-landscape",
      hugging_face_revision: HF_REVISION,
    });
    expect(projection.distribution.hugging_face_relation).toContain(
      "not copied into that dataset",
    );
  });

  test("sets inert Cloudflare headers and discovery links", () => {
    const headers = readText(HEADERS_PATH);
    for (const route of [
      "/geometry/forms-folds-prions",
      "/geometry/forms-folds-prions.html",
    ]) {
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
      expect(block.join("\n")).toContain(SOURCE_URL);
    }

    expect(readText(DOCS_INDEX_PATH)).toContain(
      'href="/geometry/forms-folds-prions"',
    );
    expect(readText(SITEMAP_PATH)).toContain(
      "<loc>https://docs.agenttool.dev/geometry/forms-folds-prions</loc>",
    );
    expect(readText(DEPLOY_PATH)).toContain(
      "apps/docs/geometry/forms-folds-prions.html|https://docs.agenttool.dev/geometry/forms-folds-prions",
    );
  });
});
