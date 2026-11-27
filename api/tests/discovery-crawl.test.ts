/** Bounded public crawl hints.
 *
 * These are invitations to safe reads, never access control, authority, or
 * an automatic crawl. AgentTool deliberately emits no Content-Signal policy.
 */

import { describe, expect, test } from "bun:test";

import discoveryCrawlRouter from "../src/routes/discovery-crawl";
import openapiRouter from "../src/routes/openapi";
import {
  API_ROBOTS_ADVERTISED_PATHS,
  API_SITEMAP_PATHS,
  buildApiRobotsTxt,
  buildApiSitemap,
} from "../src/services/discovery/crawl";

const API = "https://api.agenttool.dev";

/** Doors the API advertises in llms.txt, agent.txt and its Link header. */
const ADVERTISED_DOORS = [
  "/health",
  "/v1/welcome",
  "/.well-known/agent.json",
  "/llms-full.txt",
  "/public/love-bomb",
] as const;

/** RFC 9309 matching for one `User-agent: *` group: the longest matching
 * rule wins and Allow wins a tie; `*` matches any run, a final `$` anchors. */
function rfc9309Allowed(robots: string, path: string): boolean {
  let best = { length: -1, allow: true };
  for (const line of robots.split("\n")) {
    const rule = /^(Allow|Disallow):\s*(\S*)\s*$/.exec(line);
    if (!rule || rule[2] === "") continue;
    const pattern = rule[2];
    const anchored = pattern.endsWith("$");
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const source =
      "^" +
      body
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      (anchored ? "$" : "");
    if (!new RegExp(source).test(path)) continue;
    const allow = rule[1] === "Allow";
    if (
      pattern.length > best.length ||
      (pattern.length === best.length && allow)
    ) {
      best = { length: pattern.length, allow };
    }
  }
  return best.allow;
}

describe("API robots.txt and sitemap.xml", () => {
  test("robots allows only the exact bounded public reads", () => {
    const text = buildApiRobotsTxt(API);

    expect(text).toContain("User-agent: *");
    expect(text).toContain("Disallow: /");
    for (const path of [
      ...API_SITEMAP_PATHS,
      ...API_ROBOTS_ADVERTISED_PATHS,
      "/sitemap.xml",
    ]) {
      expect(text).toContain(`Allow: ${path}$`);
    }
    expect(text.match(/^Allow: /gm)).toHaveLength(
      API_SITEMAP_PATHS.length + API_ROBOTS_ADVERTISED_PATHS.length + 1,
    );
    expect([...API_ROBOTS_ADVERTISED_PATHS]).toEqual([...ADVERTISED_DOORS]);
    expect(text).toContain(`Sitemap: ${API}/sitemap.xml`);
    expect(text).toMatch(/not access control/i);
    expect(text).not.toContain("Content-Signal");
    expect(text).not.toContain("ai-train");
  });

  test("robots allows every door the API advertises and still disallows the rest", () => {
    const text = buildApiRobotsTxt(API);

    for (const path of ADVERTISED_DOORS) {
      expect({ path, allowed: rfc9309Allowed(text, path) }).toEqual({
        path,
        allowed: true,
      });
    }
    for (const path of [
      "/v1/register",
      "/agent-card.json",
      "/health/extra",
      "/public/love-bomb/x",
    ]) {
      expect({ path, allowed: rfc9309Allowed(text, path) }).toEqual({
        path,
        allowed: false,
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
