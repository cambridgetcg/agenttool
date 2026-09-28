/** Public local-core reading paths, exercised as URLs against loopback assets.
 * The real Pages guard handles requests; no API/provider/registry is contacted.
 * This checks source assets and URL resolution, not production deployment or
 * native browser scrolling within a raw Markdown representation.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { handlePagesRequest } from "../../infra/pages/sensitive-path-worker.js";

const ROOT = resolve(import.meta.dir, "../..");
const DOCS_ROOT = join(ROOT, "apps/docs");
const DOCS = "https://docs.agenttool.dev";
const GUIDES = ["LOCAL-CORE.md", "CORE.md", "API-COVERAGE.md", "IDENTITY-PARTITIONS.md", "LOCAL-CONTEXT-GRANTS.md", "COLLABORATION.md", "COLLABORATION-ROADMAP.md", "COLLABORATION-MISSIONS.md"];
const SOURCE_PREFIX = "/cambridgetcg/agenttool/";
let server: ReturnType<typeof Bun.serve>;
const served = new Map<string, Promise<{ status: number; contentType: string; body: string }>>();

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    && !isAbsolute(path);
}

async function asset(request: Request): Promise<Response> {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  if (pathname.includes("\0")) return new Response("Not Found", { status: 404 });
  // Pages applies its committed redirect file at the asset layer. Emulate only
  // local aliases here; canonical external discovery redirects remain separate.
  const redirects = await readFile(join(DOCS_ROOT, "_redirects"), "utf8");
  const alias = redirects.split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .find(([from, to, status]) => from === pathname && to?.startsWith("/") && status === "301");
  if (alias) return new Response(null, { status: 301, headers: { Location: alias[1]! } });
  const candidate = resolve(DOCS_ROOT, `.${pathname}`);
  if (!inside(DOCS_ROOT, candidate)) return new Response("Not Found", { status: 404 });
  const possibilities = pathname.endsWith("/")
    ? [join(candidate, "index.html")] : [candidate, `${candidate}.html`];
  for (const possibility of possibilities) {
    try {
      const file = await realpath(possibility);
      // Canonical docs are symlinks into this repository, not arbitrary disk.
      if (!inside(ROOT, file) || !(await stat(file)).isFile()) continue;
      const contentType = ({ ".md": "text/markdown", ".html": "text/html", ".txt": "text/plain", ".json": "application/json" } as Record<string, string>)[extname(file)] ?? "application/octet-stream";
      return new Response(await readFile(file), { headers: { "Content-Type": `${contentType}; charset=utf-8` } });
    } catch { /* A missing public URL must stay missing even if repo source exists. */ }
  }
  return new Response("Not Found", { status: 404 });
}

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const local = new URL(request.url);
      const publicRequest = new Request(`${DOCS}${local.pathname}${local.search}`, { method: "GET" });
      return handlePagesRequest(publicRequest, { ASSETS: { fetch: asset } });
    },
  });
});

afterAll(() => { server?.stop(true); });

function get(publicUrl: URL) {
  expect(publicUrl.origin).toBe(DOCS);
  const key = `${publicUrl.pathname}${publicUrl.search}`;
  if (!served.has(key)) {
    served.set(key, (async () => {
      const response = await fetch(new URL(key, server.url), { redirect: "manual" });
      return { status: response.status, contentType: response.headers.get("content-type") ?? "", body: await response.text() };
    })());
  }
  return served.get(key)!;
}

function prose(markdown: string): string {
  let fence: string | undefined;
  return markdown.split(/\r?\n/).filter(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return false;
    }
    return !fence;
  }).join("\n");
}

function links(markdown: string): string[] {
  const content = prose(markdown);
  return [
    ...[...content.matchAll(/(?<!!)\[[^\]]+\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)].map(match => match[1] ?? match[2]),
    ...[...content.matchAll(/\bhref=["']([^"']+)["']/g)].map(match => match[1]),
  ];
}

function anchors(body: string, markdown: boolean): Set<string> {
  const ids = new Set([...body.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)].map(match => match[1]));
  if (!markdown) return ids;
  const counts = new Map<string, number>();
  for (const match of prose(body).matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1].replace(/<[^>]*>/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "").replace(/ /g, "-");
    const count = counts.get(slug) ?? 0;
    ids.add(count ? `${slug}-${count}` : slug);
    counts.set(slug, count + 1);
  }
  return ids;
}

describe("local scaffolding discovery reaches public representations", () => {
  for (const name of GUIDES) {
    test(`${name} links resolve from its served URL rather than the repository directory`, async () => {
      const base = new URL(name, `${DOCS}/`);
      const page = await get(base);
      expect(page.status).toBe(200);
      expect(page.contentType).toContain("text/markdown");
      const destinations = links(page.body);
      expect(destinations.length).toBeGreaterThan(2);
      let localChecks = 0;
      for (const href of destinations) {
        expect(href, `${name}: repository-relative code is not served by the public docs origin`)
          .not.toMatch(/^\.\.\/(?:api|packages|apps)\//);
        const url = new URL(href, base);
        expect(url.origin === "https://github.com" && (url.pathname === SOURCE_PREFIX.slice(0, -1) || url.pathname.startsWith(SOURCE_PREFIX)),
          `${name}: a private source repository is not an account-free reading destination: ${url}`).toBe(false);
        if (url.origin === DOCS) {
          localChecks++;
          const destination = await get(url);
          expect(destination.status, `${name}: ${href} resolves to unavailable ${url}`).toBe(200);
          if (url.hash) {
            expect(anchors(destination.body, destination.contentType.includes("markdown")).has(decodeURIComponent(url.hash.slice(1))),
              `${name}: missing target fragment ${url}`).toBe(true);
          }
        }
      }
      expect(localChecks).toBeGreaterThan(1);
    });
  }

  test("the local entry fragment identifies a section in the served guide", async () => {
    const destination = await get(new URL(`${DOCS}/LOCAL-CORE.md#files-only-starter`));
    expect(destination.status).toBe(200);
    expect(anchors(destination.body, true).has("files-only-starter")).toBe(true);
  });

  test("the former collaboration channel URL reaches public onboarding through its committed alias", async () => {
    const response = await fetch(new URL("/COLLABORATION-CHANNELS.md", server.url), { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/COLLABORATION.md");
    const destination = await get(new URL(response.headers.get("location")!, DOCS));
    expect(destination.status).toBe(200);
    expect(destination.body).toContain("## Connect two local harnesses");
    expect(destination.body).toContain("**Published 0.4.0**");
    expect(destination.body).toContain("**Source candidate 0.5.0**");
  });

  test("human, agent, package and fallback entries offer the self-contained collaboration guide", async () => {
    for (const name of ["index.html", "agents.html", "packages.html", "llms.txt"]) {
      const page = await get(new URL(name, `${DOCS}/`));
      expect(page.status).toBe(200);
      expect(links(page.body).some(href => new URL(href, DOCS).pathname === "/COLLABORATION.md"), name).toBe(true);
    }
  });

  test("the static llms fallback discloses an account-free package preview and a usable guide", async () => {
    // Read the fallback asset through the Pages guard. Canonical external
    // redirect handling and live API llms are separate deployment contracts.
    const fallback = await get(new URL(`${DOCS}/llms.txt`));
    expect(fallback.status).toBe(200);
    const entry = fallback.body.split(/\r?\n/).find(line => links(line).some(href => {
      const url = new URL(href, DOCS);
      return url.origin === DOCS && url.pathname === "/LOCAL-CORE.md" && url.hash === "#files-only-starter";
    }));
    expect(entry, "fallback needs a direct local-starter choice").toBeDefined();
    expect(entry).toMatch(/account[- ]free|no (?:package or )?(?:AgentTool )?account|without an account/i);
    expect(entry).toMatch(/package preview/i);
    const guide = await get(new URL(`${DOCS}/LOCAL-CORE.md#files-only-starter`));
    expect(guide.status).toBe(200);
    expect(anchors(guide.body, true).has("files-only-starter")).toBe(true);
  });
});
