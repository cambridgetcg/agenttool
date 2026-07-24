/** Public crawl hints and the closed Content-Signal allowlist.
 *
 * Doctrine: docs/AGENT-DISCOVERY.md.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  PUBLIC_DISCOVERY_CONTENT_SIGNAL,
  PUBLIC_DISCOVERY_SIGNAL_PATHS,
  publicDiscoveryContentSignal,
} from "../src/middleware/content-signal";
import discoveryCrawlRouter from "../src/routes/discovery-crawl";
import openapiRouter from "../src/routes/openapi";
import discoveryRouter from "../src/routes/public/discovery";
import {
  API_SITEMAP_PATHS,
  buildApiRobotsTxt,
  buildApiSitemap,
} from "../src/services/discovery/crawl";

const API = "https://api.agenttool.dev";

function crawlApp() {
  const app = new Hono();
  app.use("*", publicDiscoveryContentSignal());
  app.route("/", discoveryCrawlRouter);
  app.route("/public/discovery", discoveryRouter);
  app.get("/public/agents/:did", (c) => c.json({ did: c.req.param("did") }));
  app.get("/v1/memories", (c) => c.json({ private: true }));
  return app;
}

describe("API robots.txt and sitemap.xml", () => {
  test("robots is explicit, open, bounded, and says what it cannot do", () => {
    const text = buildApiRobotsTxt(API);
    expect(text).toContain("User-agent: *");
    expect(text).toContain("Disallow: /");
    for (const path of [...API_SITEMAP_PATHS, "/sitemap.xml"]) {
      expect(text).toContain(`Allow: ${path}$`);
    }
    expect(
      text.match(
        /^Content-Signal: search=yes, ai-input=yes$/gm,
      ),
    ).toHaveLength(1);
    expect(text).toMatch(/emerging, nonstandard/i);
    expect(text).toMatch(/not access control/i);
    expect(text).toContain(`Sitemap: ${API}/sitemap.xml`);
    expect(text).not.toContain("ai-train");
    expect(text.match(/^Allow: /gm)).toHaveLength(
      API_SITEMAP_PATHS.length + 1,
    );
  });

  test("sitemap contains exactly nine stable public GET URLs", () => {
    const xml = buildApiSitemap(API);
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(urls).toEqual(API_SITEMAP_PATHS.map((path) => `${API}${path}`));
    expect(urls).toHaveLength(9);
    expect(xml).not.toContain("/v1/register");
    expect(xml).not.toContain("/agent-card.json");
  });

  test("GET and HEAD carry truthful types, cache, links, and no body on HEAD", async () => {
    const app = crawlApp();
    for (const [path, mediaType] of [
      ["/robots.txt", "text/plain; charset=utf-8"],
      ["/sitemap.xml", "application/xml; charset=utf-8"],
    ] as const) {
      const get = await app.request(path);
      expect(get.status).toBe(200);
      expect(get.headers.get("content-type")).toBe(mediaType);
      expect(get.headers.get("cache-control")).toContain("no-transform");
      expect(get.headers.get("link")).toContain(
        '<https://api.agenttool.dev/public/discovery>; rel="service-meta"',
      );
      expect(get.headers.get("x-content-type-options")).toBe("nosniff");
      expect(get.headers.get("content-signal")).toBe(
        PUBLIC_DISCOVERY_CONTENT_SIGNAL,
      );

      const head = await app.request(path, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe(mediaType);
      expect(await head.text()).toBe("");
    }
  });

  test("mutating methods remain absent", async () => {
    const app = crawlApp();
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect((await app.request(path, { method })).status).toBe(404);
      }
    }
  });

  test("the curated OpenAPI contract names both crawl hints", async () => {
    const specification = await (await openapiRouter.request("/")).json();
    expect(specification.paths["/robots.txt"].get).toBeDefined();
    expect(specification.paths["/sitemap.xml"].get).toBeDefined();
  });
});

describe("Content-Signal allowlist", () => {
  test("is closed and contains only public discovery reads", () => {
    expect([...PUBLIC_DISCOVERY_SIGNAL_PATHS]).toEqual([
      "/",
      "/robots.txt",
      "/sitemap.xml",
      "/public/discovery",
      "/public/porch",
      "/public/safety",
      "/.well-known",
      "/.well-known/api-catalog",
      "/.well-known/agent.txt",
      "/llms.txt",
      "/v1/openapi.json",
      "/v1/pathways",
    ]);
    expect(PUBLIC_DISCOVERY_CONTENT_SIGNAL).toBe(
      "search=yes, ai-input=yes",
    );
  });

  test("appears on the canonical compass and never on user/authenticated content", async () => {
    const app = crawlApp();
    const publicResponse = await app.request("/public/discovery");
    expect(publicResponse.headers.get("content-signal")).toBe(
      PUBLIC_DISCOVERY_CONTENT_SIGNAL,
    );

    for (const path of [
      "/public/agents/did%3Aat%3Aexample",
      "/v1/memories",
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-signal")).toBeNull();
    }
  });
});
