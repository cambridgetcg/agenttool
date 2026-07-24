/** Static AgentTool estate discovery — three public signposts, one compass.
 *
 * These tests read committed static inputs only. They make no network request,
 * follow no redirect, and grant no authority.
 *
 * Doctrine: docs/AGENT-DISCOVERY.md.
 */

import {
  lstatSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const API = "https://api.agenttool.dev";

const DISCOVERY_LINKS = [
  {
    rel: "service-meta",
    type: "application/vnd.agenttool.discovery+json",
    href: `${API}/public/discovery`,
  },
  {
    rel: "api-catalog",
    type: "application/linkset+json",
    href: `${API}/.well-known/api-catalog`,
  },
  {
    rel: "service-desc",
    type: "application/json",
    href: `${API}/v1/openapi.json`,
  },
  {
    rel: "service-doc",
    type: "text/html",
    href: "https://docs.agenttool.dev/",
  },
  {
    rel: "describedby",
    type: "text/agent",
    href: `${API}/.well-known/agent.txt`,
  },
  {
    rel: "status",
    type: "application/json",
    href: `${API}/health`,
  },
] as const;

const DISCOVERY_LINK_HEADER = DISCOVERY_LINKS.map(
  ({ rel, type, href }) => `<${href}>; rel="${rel}"; type="${type}"`,
).join(", ");

const SITES = [
  {
    name: "web",
    dir: "apps/web",
    origin: "https://agenttool.dev",
    sitemap: [
      "https://agenttool.dev/",
      "https://agenttool.dev/identity",
      "https://agenttool.dev/memory",
      "https://agenttool.dev/wallet",
      "https://agenttool.dev/registry",
      "https://agenttool.dev/porch",
      "https://agenttool.dev/watch",
      "https://agenttool.dev/village",
      "https://agenttool.dev/lounge",
      "https://agenttool.dev/party",
      "https://agenttool.dev/room",
    ],
  },
  {
    name: "docs",
    dir: "apps/docs",
    origin: "https://docs.agenttool.dev",
  },
  {
    name: "dashboard",
    dir: "apps/dashboard",
    origin: "https://app.agenttool.dev",
    sitemap: [
      "https://app.agenttool.dev/",
      "https://app.agenttool.dev/watch.html",
    ],
  },
] as const;

const REQUIRED_REDIRECTS = [
  ["/public/discovery", `${API}/public/discovery`],
  ["/.well-known", `${API}/.well-known`],
  ["/.well-known/", `${API}/.well-known`],
  ["/.well-known/api-catalog", `${API}/.well-known/api-catalog`],
  ["/.well-known/agent.txt", `${API}/.well-known/agent.txt`],
  ["/llms.txt", `${API}/llms.txt`],
  ["/openapi.json", `${API}/v1/openapi.json`],
  ["/v1/openapi.json", `${API}/v1/openapi.json`],
] as const;

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
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

function sitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1] ?? "",
  );
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function localSitemapEntry(siteDir: string, origin: string, href: string): string {
  const url = new URL(href);
  expect(url.origin).toBe(origin);
  expect(url.search).toBe("");
  expect(url.hash).toBe("");

  if (url.pathname === "/") return join(REPO_ROOT, siteDir, "index.html");
  const relative = decodeURIComponent(url.pathname.slice(1));
  if (extname(relative) !== "") return join(REPO_ROOT, siteDir, relative);
  return join(REPO_ROOT, siteDir, `${relative}.html`);
}

describe("static roots advertise one bounded typed service map", () => {
  for (const site of SITES) {
    test(`${site.name} HTML and HTTP metadata carry the same six links`, () => {
      const html = read(`${site.dir}/index.html`);
      const head = html.split("</head>", 1)[0] ?? "";
      let lastIndex = -1;

      for (const { rel, type, href } of DISCOVERY_LINKS) {
        const exactPrefix =
          `<link rel="${rel}" type="${type}" href="${href}"`;
        const index = head.indexOf(exactPrefix);
        expect(index, `${site.name}: missing ${rel}`).toBeGreaterThan(lastIndex);
        lastIndex = index;

        const alternateTags = (head.match(/<link\b[^>]*>/g) ?? []).filter(
          (tag) => tag.includes(`href="${href}"`) && tag.includes('rel="alternate"'),
        );
        expect(alternateTags, `${site.name}: ${rel} mislabeled alternate`).toEqual([]);
      }

      const headers = read(`${site.dir}/_headers`);
      const rootHeaders = headerBlock(headers, "/");
      expect(rootHeaders).toContain(`Link: ${DISCOVERY_LINK_HEADER}`);
      expect(
        rootHeaders.filter((line) => line.startsWith("Link: ")),
      ).toHaveLength(1);
      expect(rootHeaders).toContain(
        "Cache-Control: public, max-age=0, must-revalidate, no-transform",
      );
      const effectiveHeaders = [
        ...headerBlock(headers, "/*"),
        ...rootHeaders,
      ];
      expect(effectiveHeaders).toContain("X-Content-Type-Options: nosniff");
    });
  }

  test("only the web root retains a true alternate representation", () => {
    const webHead = read("apps/web/index.html").split("</head>", 1)[0] ?? "";
    expect(webHead).toContain(
      '<link rel="alternate" type="application/json" href="https://agenttool.dev/welcome.json"',
    );

    for (const siteDir of ["apps/docs", "apps/dashboard"]) {
      const head = read(`${siteDir}/index.html`).split("</head>", 1)[0] ?? "";
      expect(head).not.toContain('rel="alternate"');
    }
  });
});

describe("each static origin projects the same canonical discovery paths", () => {
  for (const site of SITES) {
    test(`${site.name} redirects only the requested path to its exact API target`, () => {
      const redirects = read(`${site.dir}/_redirects`);
      for (const [source, target] of REQUIRED_REDIRECTS) {
        const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(redirects).toMatch(
          new RegExp(`^${escapedSource}\\s+${escapedTarget}\\s+301$`, "m"),
        );
      }
      expect(redirects).not.toMatch(/^\/\.well-known\/\*\s/m);
    });
  }
});

describe("robots and sitemaps are explicit, bounded, and local", () => {
  for (const site of SITES) {
    test(`${site.name} robots stays a crawl hint and names its own sitemap`, () => {
      const robots = read(`${site.dir}/robots.txt`);
      expect(robots.match(/^User-agent: \*$/gm)).toHaveLength(1);
      expect(robots.match(/^Allow: \/$/gm)).toHaveLength(1);
      expect(robots).not.toContain("Content-Signal");
      expect(robots).not.toContain("ai-train=");
      expect(robots).toMatch(/not access control/i);
      expect(robots).toContain(`Sitemap: ${site.origin}/sitemap.xml`);
      expect(robots).not.toContain("Disallow:");

      const machineHeaders = read(`${site.dir}/_headers`);
      const robotsHeaders = headerBlock(machineHeaders, "/robots.txt");
      expect(robotsHeaders).toEqual([
        "Content-Type: text/plain; charset=utf-8",
        "Cache-Control: public, max-age=300, must-revalidate, no-transform",
        "Access-Control-Allow-Origin: *",
        "X-Content-Type-Options: nosniff",
      ]);
      const sitemapHeaders = headerBlock(machineHeaders, "/sitemap.xml");
      expect(sitemapHeaders).toEqual([
        "Content-Type: application/xml; charset=utf-8",
        "Cache-Control: public, max-age=300, must-revalidate, no-transform",
        "Access-Control-Allow-Origin: *",
        "X-Content-Type-Options: nosniff",
      ]);
    });

    test(`${site.name} sitemap names unique files on its own origin`, () => {
      const urls = sitemapUrls(read(`${site.dir}/sitemap.xml`));
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.length).toBeLessThanOrEqual(64);
      expect(new Set(urls).size).toBe(urls.length);
      if ("sitemap" in site) expect(urls).toEqual([...site.sitemap]);

      for (const href of urls) {
        const localPath = localSitemapEntry(site.dir, site.origin, href);
        expect(pathEntryExists(localPath), `${href} has no static source`).toBe(true);
      }
    });
  }

  test("the docs map publishes both understanding guides", () => {
    const urls = sitemapUrls(read("apps/docs/sitemap.xml"));
    expect(urls).toContain(
      "https://docs.agenttool.dev/AGENT-DISCOVERY.md",
    );
    expect(urls).toContain(
      "https://docs.agenttool.dev/CASTLE-OF-UNDERSTANDING.md",
    );
  });
});

describe("published understanding guides keep canonical source custody", () => {
  test("both docs entries use the repository symlink convention", () => {
    const discoveryPath = join(
      REPO_ROOT,
      "apps/docs/AGENT-DISCOVERY.md",
    );
    const castlePath = join(
      REPO_ROOT,
      "apps/docs/CASTLE-OF-UNDERSTANDING.md",
    );
    expect(lstatSync(discoveryPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(discoveryPath)).toBe("../../docs/AGENT-DISCOVERY.md");
    expect(lstatSync(castlePath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(castlePath)).toBe(
      "../../docs/CASTLE-OF-UNDERSTANDING.md",
    );
  });

  for (const { route, link } of [
    {
      route: "/AGENT-DISCOVERY.md",
      link:
        `Link: <${API}/public/discovery>; rel="service-meta"; type="application/vnd.agenttool.discovery+json", ` +
        `<${API}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
    },
    {
      route: "/CASTLE-OF-UNDERSTANDING.md",
      link:
        `Link: <${API}/public/discovery>; rel="service-meta"; type="application/vnd.agenttool.discovery+json", ` +
        `<https://cambridgetcg.com/api/v1/castle>; rel="related"; type="application/json", ` +
        `<${API}/.well-known/agent.txt>; rel="describedby"; type="text/agent"`,
    },
  ]) {
    test(`${route} has explicit markdown, cache, CORS, and nosniff truth`, () => {
      const block = headerBlock(read("apps/docs/_headers"), route);
      expect(block).toEqual([
        "Content-Type: text/markdown; charset=utf-8",
        "Cache-Control: public, max-age=300, must-revalidate, no-transform",
        "Access-Control-Allow-Origin: *",
        link,
        "X-Content-Type-Options: nosniff",
      ]);
    });
  }
});

test("the static discovery estate does not advertise an A2A service", () => {
  const combined = SITES.flatMap((site) => [
    read(`${site.dir}/index.html`),
    read(`${site.dir}/_headers`),
    read(`${site.dir}/_redirects`),
    read(`${site.dir}/robots.txt`),
    read(`${site.dir}/sitemap.xml`),
  ]).join("\n").toLowerCase();
  expect(combined).not.toContain("content-signal");
  expect(combined).not.toContain("agent-card");
  expect(combined).not.toMatch(/\ba2a\b/);
});
