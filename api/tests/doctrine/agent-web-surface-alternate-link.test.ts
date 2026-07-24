/** apps/docs alternate-link discovery — pins Move 4 of AGENT-WEB-SURFACE.md.
 *
 *  Operational API-reference pages carry a JSON alternate in both their HTML
 *  head and the parallel Cloudflare Pages `_headers` block. Other editorial or
 *  visual pages are not forced to invent a structured sibling. The docs root
 *  uses registered service relations for related discovery resources instead
 *  of calling them alternate representations. When any page does declare a
 *  JSON alternate, this test still checks that URL's discipline.
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

const OPERATIONAL_JSON_PAGES = [
  { file: "adapters.html", path: "/adapters" },
  { file: "bootstrap.html", path: "/bootstrap" },
  { file: "continuity.html", path: "/continuity" },
  { file: "economy.html", path: "/economy" },
  { file: "errors.html", path: "/errors" },
  { file: "identity.html", path: "/identity" },
  { file: "inbox.html", path: "/inbox" },
  { file: "marketplace.html", path: "/marketplace" },
  { file: "mathos.html", path: "/mathos" },
  { file: "memory.html", path: "/memory" },
  { file: "pathways.html", path: "/pathways" },
  { file: "pulse.html", path: "/pulse" },
  { file: "roadmap.html", path: "/roadmap" },
  { file: "runtime.html", path: "/runtime" },
  { file: "strands.html", path: "/strands" },
  { file: "tools.html", path: "/tools" },
  { file: "trace.html", path: "/trace" },
  { file: "traces.html", path: "/traces" },
  { file: "vault.html", path: "/vault" },
  { file: "verify.html", path: "/verify" },
  { file: "wake.html", path: "/wake" },
  { file: "wallets.html", path: "/wallets" },
  { file: "welcome.html", path: "/welcome" },
] as const;

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

function findHeaderAlternateJsonHrefs(headers: string, path: string): string[] {
  const lines = headers.split(/\r?\n/);
  const start = lines.findIndex((line) => line === path);
  if (start === -1) return [];

  const hrefs: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line === "" || !/^\s/.test(line)) break;
    const value = line.match(/^\s*Link:\s*(.+)$/)?.[1];
    if (!value) continue;
    for (const linkValue of value.split(/,\s*(?=<)/)) {
      const match = linkValue.match(
        /^<([^>]+)>;\s*rel=["']alternate["'];\s*type=["']application\/json["']$/,
      );
      if (match) hrefs.push(match[1]);
    }
  }
  return hrefs;
}

// ── In-document <link rel="alternate"> ──────────────────────────────────

describe("apps/docs alternate-link — in-document <link>", () => {
  const files = htmlFiles();
  test("at least 20 HTML files present (sanity check on the corpus)", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(OPERATIONAL_JSON_PAGES.length).toBeLessThan(files.length);
  });

  for (const { file } of OPERATIONAL_JSON_PAGES) {
    test(`${file} carries its operational JSON alternate`, () => {
      const content = readFileSync(join(DOCS_HTML_DIR, file), "utf8");
      const hrefs = findAlternateJsonHrefs(content);
      expect(hrefs.length).toBeGreaterThanOrEqual(1);
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
    expect(content).toContain("https://api.agenttool.dev/.well-known/agent.txt");
  });

  test("clean docs URLs carry alternates and no known-dead alternate is advertised", () => {
    const content = readFileSync(HEADERS_FILE, "utf8");
    for (const path of ["/wake", "/economy", "/memory", "/tools", "/pulse"]) {
      expect(content).toMatch(new RegExp(`^${path}\\n`, "m"));
    }
    expect(content).not.toContain("/v1/economy/billing/plans");
    expect(content).not.toContain("https://api.agenttool.dev/v1/memory>");
    expect(content).not.toContain("https://api.agenttool.dev/v1/tools>");
    expect(content).not.toContain("https://api.agenttool.dev/public/agents>");
    expect(content).toContain("doctrine=https://docs.agenttool.dev/SOUL.md");
  });

  test("every operational page repeats an in-document alternate in its own clean-path header block", () => {
    const headers = readFileSync(HEADERS_FILE, "utf8");
    const missingFromHeaders: string[] = [];
    for (const { file, path } of OPERATIONAL_JSON_PAGES) {
      const html = readFileSync(join(DOCS_HTML_DIR, file), "utf8");
      const hrefs = findAlternateJsonHrefs(html);
      const headerHrefs = findHeaderAlternateJsonHrefs(headers, path);
      const anyInHeaders = hrefs.some((href) => headerHrefs.includes(href));
      if (!anyInHeaders) {
        missingFromHeaders.push(
          `${file} (${path}) → html: ${hrefs.join(", ")} · headers: ${headerHrefs.join(", ")}`,
        );
      }
    }
    expect(missingFromHeaders).toEqual([]);
  });
});

// ── Sibling URL discipline ──────────────────────────────────────────────

describe("apps/docs alternate-link — URL discipline", () => {
  test("pages that declare JSON alternates use the HTTPS API host", () => {
    let declared = 0;
    for (const file of htmlFiles()) {
      const content = readFileSync(join(DOCS_HTML_DIR, file), "utf8");
      const hrefs = findAlternateJsonHrefs(content);
      if (hrefs.length === 0) continue;
      declared += hrefs.length;
      const apiHrefs = hrefs.filter((h) => h.startsWith("https://api.agenttool.dev/"));
      expect(apiHrefs).toEqual(hrefs);
    }
    expect(declared).toBeGreaterThanOrEqual(OPERATIONAL_JSON_PAGES.length);
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

  test("no HTML page advertises the known dead alternates", () => {
    const hrefs = htmlFiles().flatMap((file) =>
      findAlternateJsonHrefs(
        readFileSync(join(DOCS_HTML_DIR, file), "utf8"),
      ),
    );
    expect(hrefs).not.toContain(
      "https://api.agenttool.dev/v1/economy/billing/plans",
    );
    expect(hrefs).not.toContain("https://api.agenttool.dev/v1/memory");
    expect(hrefs).not.toContain("https://api.agenttool.dev/v1/tools");
    expect(hrefs).not.toContain("https://api.agenttool.dev/public/agents");
  });
});
