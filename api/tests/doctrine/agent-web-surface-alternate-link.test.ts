/** apps/docs alternate-link discovery — pins Move 4 of AGENT-WEB-SURFACE.md.
 *
 *  Every `apps/docs/*.html` carries a `<link rel="alternate" type="application/json" href="...">`
 *  AND the parallel Cloudflare Pages `_headers` file emits an HTTP `Link:` header
 *  with the same target. Closes the discovery loop without a second fetch:
 *  the agent that lands on the HTML page learns the JSON sibling's URL from
 *  either the `<head>` (full GET) or the response headers (HEAD probe).
 *
 *  Doctrine: docs/AGENT-WEB-SURFACE.md Move 4 ·
 *            docs/PATTERN-MACHINE-READABLE-PARITY.md (operational deepening).
 *
 *  Wall candidate: urn:agenttool:wall/visible-without-structured-sibling
 *    (proposed — promote to canon when the full apps/docs surface is pinned). */

import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const DOCS_HTML_DIR = join(REPO_ROOT, "apps", "docs");
const HEADERS_FILE = join(DOCS_HTML_DIR, "_headers");

function htmlFiles(): string[] {
  return readdirSync(DOCS_HTML_DIR)
    .filter((f) => f.endsWith(".html"))
    .sort();
}

/** Find every `<link>` tag whose attributes include both
 *  `rel="alternate"` and `type="application/json"` (in any order),
 *  and return all href values. A doc may declare multiple JSON siblings
 *  (e.g. welcome.html points at both /v1/wake and /v1/mathos/catalog). */
function findAlternateJsonHrefs(html: string): string[] {
  const linkTags = html.match(/<link\b[^>]*>/g) ?? [];
  const hrefs: string[] = [];
  for (const tag of linkTags) {
    if (
      /\brel=["']alternate["']/.test(tag) &&
      /\btype=["']application\/json["']/.test(tag)
    ) {
      const m = tag.match(/\bhref=["']([^"']+)["']/);
      if (m) hrefs.push(m[1]);
    }
  }
  return hrefs;
}

// ── In-document <link rel="alternate"> ──────────────────────────────────

describe("apps/docs alternate-link — in-document <link>", () => {
  const files = htmlFiles();
  test("at least 20 HTML files present (sanity check on the corpus)", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  for (const file of htmlFiles()) {
    test(`${file} carries <link rel="alternate" type="application/json" ...>`, () => {
      const content = readFileSync(join(DOCS_HTML_DIR, file), "utf8");
      const hrefs = findAlternateJsonHrefs(content);
      expect(hrefs.length).toBeGreaterThanOrEqual(1);
      // At least one href must be an absolute https URL pointing at api.agenttool.dev
      const apiHrefs = hrefs.filter((h) => h.startsWith("https://api.agenttool.dev/"));
      expect(apiHrefs.length).toBeGreaterThanOrEqual(1);
    });
  }
});

// ── HTTP Link: header via Cloudflare _headers ────────────────────────────

describe("apps/docs alternate-link — _headers file (Cloudflare HTTP Link)", () => {
  test("_headers file exists at apps/docs/_headers", () => {
    const content = readFileSync(HEADERS_FILE, "utf8");
    expect(content.length).toBeGreaterThan(0);
  });

  test("_headers carries Substrate-Disposition globally", () => {
    const content = readFileSync(HEADERS_FILE, "utf8");
    expect(content).toContain("Substrate-Disposition: love");
    expect(content).toContain("/*");
  });

  test("_headers points at /.well-known/agent.txt via X-Agent-Surface", () => {
    const content = readFileSync(HEADERS_FILE, "utf8");
    expect(content).toContain("X-Agent-Surface");
    expect(content).toContain("/.well-known/agent.txt");
  });

  test("every HTML file has at least one in-document href that appears in _headers", () => {
    const headers = readFileSync(HEADERS_FILE, "utf8");
    const missingFromHeaders: string[] = [];
    for (const file of htmlFiles()) {
      const html = readFileSync(join(DOCS_HTML_DIR, file), "utf8");
      const hrefs = findAlternateJsonHrefs(html);
      if (hrefs.length === 0) continue;
      const anyInHeaders = hrefs.some((href) => headers.includes(href));
      if (!anyInHeaders) {
        missingFromHeaders.push(`${file} → ${hrefs.join(", ")}`);
      }
    }
    expect(missingFromHeaders).toEqual([]);
  });
});

// ── Sibling URL discipline ──────────────────────────────────────────────

describe("apps/docs alternate-link — URL discipline", () => {
  test("all alternate hrefs are https + api.agenttool.dev hosts", () => {
    for (const file of htmlFiles()) {
      const content = readFileSync(join(DOCS_HTML_DIR, file), "utf8");
      const hrefs = findAlternateJsonHrefs(content);
      if (hrefs.length === 0) continue;
      const apiHrefs = hrefs.filter((h) => h.startsWith("https://api.agenttool.dev/"));
      expect(apiHrefs.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("every alternate href starts with /v1/, /public/, or /.well-known/", () => {
    for (const file of htmlFiles()) {
      const content = readFileSync(join(DOCS_HTML_DIR, file), "utf8");
      const hrefs = findAlternateJsonHrefs(content);
      for (const href of hrefs) {
        if (!href.startsWith("https://api.agenttool.dev")) continue;
        const path = href.replace("https://api.agenttool.dev", "");
        expect(
          path.startsWith("/v1/") ||
            path.startsWith("/public/") ||
            path.startsWith("/.well-known/"),
        ).toBe(true);
      }
    }
  });
});
