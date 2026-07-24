/** Bounded public crawl hints.
 *
 * These are invitations to safe reads, never access control, authority, or
 * an automatic crawl. AgentTool deliberately emits no Content-Signal policy.
 */

import { describe, expect, test } from "bun:test";

import discoveryCrawlRouter from "../src/routes/discovery-crawl";
import {
  API_SITEMAP_PATHS,
  buildApiRobotsTxt,
  buildApiSitemap,
} from "../src/services/discovery/crawl";

const API = "https://api.agenttool.dev";

describe("API robots.txt and sitemap.xml", () => {
  test("robots allows only the exact bounded public reads", () => {
    const text = buildApiRobotsTxt(API);

    expect(text).toContain("User-agent: *");
    expect(text).toContain("Disallow: /");
    for (const path of [...API_SITEMAP_PATHS, "/sitemap.xml"]) {
      expect(text).toContain(`Allow: ${path}$`);
    }
    expect(text.match(/^Allow: /gm)).toHaveLength(
      API_SITEMAP_PATHS.length + 1,
    );
    expect(text).toContain(`Sitemap: ${API}/sitemap.xml`);
    expect(text).toMatch(/not access control/i);
    expect(text).not.toContain("Content-Signal");
    expect(text).not.toContain("ai-train");
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
});
