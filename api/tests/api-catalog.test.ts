/** RFC 9727 API Catalog — AgentTool product passport.
 *
 *  Pins the RFC 9264 Linkset shape, read-only GET/HEAD transport, registered
 *  relation vocabulary, HTTPS-only public targets, honest policy/licence
 *  omissions, and the non-transactional payment-discovery boundary.
 */

import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import wellKnownRouter from "../src/routes/well-known";
import openapiRouter from "../src/routes/openapi";
import {
  API_CATALOG_MEDIA_TYPE,
  API_CATALOG_PROFILE,
  apiCatalogLinkHeader,
  buildApiCatalog,
  type ApiCatalogLinkContext,
  type ApiCatalogLinkTarget,
} from "../src/services/discovery/api-catalog";

const API = "https://api.agenttool.dev";
const DOCS = "https://docs.agenttool.dev";
const REPO_ROOT = join(import.meta.dir, "..", "..");
const RELATIONS = new Set([
  "alternate",
  "item",
  "service-desc",
  "service-doc",
  "service-meta",
  "status",
  "payment",
]);

function targets(context: ApiCatalogLinkContext): ApiCatalogLinkTarget[] {
  return Object.entries(context)
    .filter(([relation]) => RELATIONS.has(relation))
    .flatMap(([, value]) => value as ApiCatalogLinkTarget[]);
}

describe("RFC 9727 product passport document", () => {
  test("is Linkset JSON with one catalog membership context and six products", () => {
    const document = buildApiCatalog(API, DOCS);
    expect(Object.keys(document)).toEqual(["linkset"]);
    expect(document.linkset).toHaveLength(7);

    const membership = document.linkset[0]!;
    expect(membership.anchor).toBe(`${API}/.well-known/api-catalog`);
    expect(membership.item?.map((item) => item.href)).toEqual([
      `${API}/v1/scrape`,
      `${API}/v1/document`,
      `${API}/public/listings`,
      `${API}/feeds/offers.atom`,
      `${API}/public/gallery`,
      `${API}/.well-known/love-packages`,
    ]);
    expect(membership["service-desc"]?.[0]?.href).toBe(
      `${API}/v1/openapi.json`,
    );
    expect(membership["service-doc"]?.[0]?.href).toBe(`${DOCS}/`);
    expect(membership["service-meta"]?.map((item) => item.href)).toEqual([
      `${API}/public/porch`,
      `${API}/v1/pathways`,
      `${API}/public/safety`,
    ]);
    expect(membership.status?.[0]?.href).toBe(`${API}/health`);
  });

  test("uses only registered relations and absolute credential-free HTTPS URLs", () => {
    const document = buildApiCatalog(API, DOCS);
    const anchors = new Set<string>();

    for (const context of document.linkset) {
      expect(anchors.has(context.anchor)).toBe(false);
      anchors.add(context.anchor);

      const anchor = new URL(context.anchor);
      expect(anchor.protocol).toBe("https:");
      expect(anchor.username).toBe("");
      expect(anchor.password).toBe("");

      for (const relation of Object.keys(context).filter(
        (key) => key !== "anchor",
      )) {
        expect(RELATIONS.has(relation)).toBe(true);
      }
      for (const target of targets(context)) {
        const url = new URL(target.href);
        expect(url.protocol).toBe("https:");
        expect(url.username).toBe("");
        expect(url.password).toBe("");
        expect(["api.agenttool.dev", "docs.agenttool.dev", "agenttool.dev"]).toContain(
          url.hostname,
        );
      }
    }
  });

  test("payment discovery exists only for structurally x402-eligible endpoints", () => {
    const document = buildApiCatalog(API, DOCS);
    const paymentContexts = document.linkset.filter(
      (context) => context.payment !== undefined,
    );

    expect(paymentContexts.map((context) => context.anchor)).toEqual([
      `${API}/v1/scrape`,
      `${API}/v1/document`,
    ]);
    for (const context of paymentContexts) {
      expect(context.payment).toHaveLength(1);
      expect(context.payment?.[0]?.href).toBe(context.anchor);
      expect(context.payment?.[0]?.title).toMatch(
        /may be accepted only after.*exact PAYMENT-REQUIRED.*does not promise deployment readiness or initiate payment/i,
      );
    }
  });

  test("classifies Offer Bus JSON as an alternate, not service metadata", () => {
    const context = buildApiCatalog(API, DOCS).linkset.find(
      (candidate) => candidate.anchor === `${API}/feeds/offers.atom`,
    );
    expect(context?.alternate).toEqual([
      {
        href: `${API}/feeds/offers.json`,
        type: "application/vnd.agenttool.offer-bus+json",
        title:
          "Canonical logical JSON model — authority and settlement remain none",
      },
    ]);
    expect(context?.["service-meta"]?.map((target) => target.href)).not.toContain(
      `${API}/feeds/offers.json`,
    );
  });

  test("every OpenAPI service description actually contains its anchor path", async () => {
    const specification = await (await openapiRouter.request("/")).json();
    const document = buildApiCatalog(API, DOCS);

    for (const context of document.linkset) {
      if (
        context["service-desc"]?.some(
          (target) => target.href === `${API}/v1/openapi.json`,
        )
      ) {
        expect(specification.paths[new URL(context.anchor).pathname]).toBeDefined();
      }
    }
  });

  test("OpenAPI declares exact-byte validators and no-transform", async () => {
    const specification = await (await openapiRouter.request("/")).json();
    for (const [path, maxAge] of [
      ["/feeds", 300],
      ["/feeds/offers.atom", 30],
      ["/feeds/offers.rss", 30],
      ["/feeds/offers.json", 30],
      ["/.well-known/webfinger", 300],
    ] as const) {
      expect(
        specification.paths[path].get.responses["200"].headers[
          "Cache-Control"
        ].schema.const,
      ).toBe(`public, max-age=${maxAge}, must-revalidate, no-transform`);
    }
  });

  test("does not invent legal policy, privacy, or repository licence links", () => {
    const serialized = JSON.stringify(buildApiCatalog(API, DOCS));
    expect(serialized).not.toContain('"privacy-policy"');
    expect(serialized).not.toContain('"terms-of-service"');
    expect(serialized).not.toContain('"license"');
    expect(serialized).not.toContain("localhost");
    expect(serialized).not.toContain("internal.");
  });

  test("rejects non-HTTPS and credential-bearing catalog origins", () => {
    expect(() => buildApiCatalog("http://api.example", DOCS)).toThrow(
      "public_base_must_be_credential_free_https_origin",
    );
    expect(() => buildApiCatalog("https://user:pass@api.example", DOCS)).toThrow(
      "public_base_must_be_credential_free_https_origin",
    );
  });
});

describe("/.well-known/api-catalog transport", () => {
  test("GET returns the RFC profile media type, Link header, cache, and nosniff", async () => {
    const response = await wellKnownRouter.request("/api-catalog", {
      headers: { Accept: "application/linkset+json" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(API_CATALOG_MEDIA_TYPE);
    expect(response.headers.get("content-type")).toContain(API_CATALOG_PROFILE);
    expect(response.headers.get("link")).toBe(apiCatalogLinkHeader(API));
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate, no-transform",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.text();
    expect(response.headers.get("etag")).toBe(
      `"sha256-${createHash("sha256").update(body).digest("hex")}"`,
    );
    expect(JSON.parse(body)).toEqual(buildApiCatalog(API, DOCS));
  });

  test("HEAD carries discovery headers and no representation body", async () => {
    const response = await wellKnownRouter.request("/api-catalog", {
      method: "HEAD",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("link")).toBe(apiCatalogLinkHeader(API));
    expect(response.headers.get("content-type")).toBe(API_CATALOG_MEDIA_TYPE);
    expect(response.headers.get("etag")).toMatch(/^"sha256-[a-f0-9]{64}"$/);
    expect(await response.text()).toBe("");
  });

  test("If-None-Match revalidates the exact catalog bytes without a body", async () => {
    const first = await wellKnownRouter.request("/api-catalog");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"sha256-[a-f0-9]{64}"$/);

    const unchanged = await wellKnownRouter.request("/api-catalog", {
      headers: { "If-None-Match": etag! },
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("etag")).toBe(etag);
    expect(await unchanged.text()).toBe("");
  });

  test("is read-only", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        (await wellKnownRouter.request("/api-catalog", { method })).status,
      ).toBe(404);
    }
  });
});

describe("product passport discovery doors", () => {
  test("well-known index and agent.txt advertise the catalog", async () => {
    const index = await (await wellKnownRouter.request("/")).json();
    expect(index.endpoints).toContain("/.well-known/api-catalog");

    const agentTxt = await (await wellKnownRouter.request("/agent.txt")).text();
    expect(agentTxt).toContain(
      `API-Catalog: ${API}/.well-known/api-catalog`,
    );
    expect(agentTxt).toContain(`Offer-Bus: ${API}/feeds/offers.atom`);
    expect(agentTxt).toContain(
      "Offer-Bus-Boundary: authority=none; settlement=none; automatic-action=never",
    );
  });

  test("the human door links and redirects to the canonical API catalog", () => {
    const html = readFileSync(join(REPO_ROOT, "apps", "web", "index.html"), "utf8");
    const redirects = readFileSync(
      join(REPO_ROOT, "apps", "web", "_redirects"),
      "utf8",
    );
    expect(html).toContain('rel="api-catalog"');
    expect(html).toContain(`${API}/.well-known/api-catalog`);
    expect(redirects).toContain(
      `/.well-known/api-catalog          ${API}/.well-known/api-catalog          301`,
    );
  });
});
