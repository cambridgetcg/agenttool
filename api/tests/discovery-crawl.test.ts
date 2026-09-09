/** Bounded public crawl hints.
 *
 * These are invitations to safe reads, never access control, authority, or
 * an automatic crawl. AgentTool deliberately emits no Content-Signal policy.
 */

import { describe, expect, test } from "bun:test";

import discoveryCrawlRouter from "../src/routes/discovery-crawl";
import openapiRouter from "../src/routes/openapi";
import {
  API_ROBOTS_RULES,
  API_SITEMAP_PATHS,
  buildApiRobotsTxt,
  buildApiSitemap,
} from "../src/services/discovery/crawl";

const API = "https://api.agenttool.dev";

/** Minimal RFC 9309 longest-match evaluator: rules are order-independent;
 * the longest matching path prefix wins; no matching rule means allowed. */
function rfc9309Allows(rules: readonly string[], path: string): boolean {
  let verdict = true;
  let longest = -1;
  for (const rule of rules) {
    const [directive, rulePath] = rule.split(": ");
    if (!rulePath || !path.startsWith(rulePath)) continue;
    if (rulePath.length > longest) {
      longest = rulePath.length;
      verdict = directive === "Allow";
    }
  }
  return verdict;
}

describe("API robots.txt and sitemap.xml", () => {
  test("robots uses portable RFC 9309 prefix rules with no $ anchors", () => {
    const text = buildApiRobotsTxt(API);

    expect(text).toContain("User-agent: *");
    for (const rule of API_ROBOTS_RULES) {
      expect(text).toContain(rule);
    }
    const ruleLines = text
      .split("\n")
      .filter((line) => /^(Allow|Disallow): /.test(line));
    expect(ruleLines).toEqual([...API_ROBOTS_RULES]);
    for (const line of ruleLines) {
      expect(line).not.toContain("$");
      expect(line).not.toContain("*");
    }
    expect(text).toContain(`Sitemap: ${API}/sitemap.xml`);
    expect(text).toMatch(/not access control/i);
    expect(text).not.toContain("Content-Signal");
    expect(text).not.toContain("ai-train");
  });

  test("longest-match semantics welcome public reads and keep private surfaces closed", () => {
    const allowed = [
      "/",
      "/public/porch",
      "/public/discovery",
      "/.well-known/api-catalog",
      "/docs/SOUL.md",
      "/docs/RING-1.md",
      "/llms.txt",
      "/AGENTS.md",
      "/robots.txt",
      "/sitemap.xml",
      "/v1/openapi.json",
      "/v1/pathways",
      "/v1/welcome",
      "/v1/canon",
      "/v1/self",
      "/v1/mathos",
      "/v1/youspeak",
    ];
    const disallowed = [
      "/v1/identities",
      "/v1/memories/anything",
      "/v1/keys",
      "/v1/register",
      "/v1/self-love",
      "/v1/self-recognition/attest",
      "/federation",
      "/feeds",
    ];
    for (const path of allowed) {
      expect({ path, crawl: rfc9309Allows(API_ROBOTS_RULES, path) }).toEqual({
        path,
        crawl: true,
      });
    }
    for (const path of disallowed) {
      expect({ path, crawl: rfc9309Allows(API_ROBOTS_RULES, path) }).toEqual({
        path,
        crawl: false,
      });
    }
  });

  test("sitemap contains exactly the selected public GET URLs", () => {
    const xml = buildApiSitemap(API);
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );

    expect(urls).toEqual(API_SITEMAP_PATHS.map((path) => `${API}${path}`));
    expect(new Set(urls).size).toBe(urls.length);
    expect(xml).not.toContain("/v1/register");
    expect(xml).not.toContain("/agent-card.json");
  });

  test("GET and HEAD carry truthful types, cache, links, and no policy header", async () => {
    for (const [path, mediaType] of [
      ["/robots.txt", "text/plain; charset=utf-8"],
      ["/sitemap.xml", "application/xml; charset=utf-8"],
    ] as const) {
      const get = await discoveryCrawlRouter.request(path);
      expect(get.status).toBe(200);
      expect(get.headers.get("content-type")).toBe(mediaType);
      expect(get.headers.get("cache-control")).toContain("no-transform");
      expect(get.headers.get("link")).toContain(
        '<https://api.agenttool.dev/public/discovery>; rel="service-meta"',
      );
      expect(get.headers.get("x-content-type-options")).toBe("nosniff");
      expect(get.headers.get("content-signal")).toBeNull();

      const head = await discoveryCrawlRouter.request(path, {
        method: "HEAD",
      });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe(mediaType);
      expect(head.headers.get("content-signal")).toBeNull();
      expect(await head.text()).toBe("");
    }
  });

  test("mutating methods remain absent", async () => {
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(
          (await discoveryCrawlRouter.request(path, { method })).status,
        ).toBe(404);
      }
    }
  });

  test("the curated OpenAPI contract names both crawl hints without a policy claim", async () => {
    const specification = await (await openapiRouter.request("/")).json();
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      expect(specification.paths[path].get).toBeDefined();
      expect(specification.paths[path].head).toBeDefined();
      expect(specification.paths[path].post).toBeUndefined();
    }
    expect(JSON.stringify(specification)).not.toContain("Content-Signal");
  });
});
