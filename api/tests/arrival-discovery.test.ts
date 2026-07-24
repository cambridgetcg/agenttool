import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../src/routes/openapi";
import discoveryRouter from "../src/routes/public/discovery";
import wellKnownRouter from "../src/routes/well-known";
import { tutor } from "../src/middleware/tutor";
import { isStrictJsonProfileResponse } from "../src/middleware/strict-json-profile";
import {
  buildArrivalIndex,
  discoveryLinkHeader,
} from "../src/services/discovery/arrival";
import {
  DISCOVERY_FORMAT,
  DISCOVERY_MAX_BYTES,
  DISCOVERY_MEDIA_TYPE,
  buildDiscoveryCompass,
} from "../src/services/discovery/compass";

const API = "https://api.agenttool.dev";
const DOCS = "https://docs.agenttool.dev";
const ROOT = join(import.meta.dir, "..", "..");

describe("agenttool-arrival/v1 — bounded first contact", () => {
  test("names the full porch contract and keeps discovery authority empty", () => {
    const arrival = buildArrivalIndex(API, DOCS);

    expect(arrival.format).toBe("agenttool-arrival/v1");
    expect(arrival.invitation.response_required).toBe(false);
    expect(arrival.invitation.reading_is_not_consent).toBe(true);
    expect(arrival.boundary.discovery_grants).toEqual([]);
    expect(arrival.boundary.automatic_action).toBe("never");
    expect(arrival.first_contact).toMatchObject({
      href: `${API}/public/porch`,
      method: "GET",
      auth_scope: "none",
      representation: "application/json; charset=utf-8",
    });
    for (const field of [
      "workspace_identity",
      "data_storage",
      "external_effects",
      "cors",
      "idempotency_inputs",
      "retry_boundary",
    ] as const) {
      expect(arrival.first_contact[field].length).toBeGreaterThan(12);
    }
    expect(arrival.links).toHaveLength(8);
    expect(arrival.links[0]).toMatchObject({
      role: "discovery_compass",
      href: `${API}/public/discovery`,
    });
    expect(arrival.links[0]?.status).toMatch(
      /canonical exact.*public read.*no authority.*no follow-up/i,
    );
    expect(arrival.mcp.endpoint).toBe(`${API}/v1/mcp`);
    expect(arrival.mcp.official_registry).toMatchObject({
      name: "dev.agenttool/agenttool",
      version: "1.0.0",
    });
    expect(arrival.mcp.official_registry.status).toMatch(
      /grants no authority.*not transport-conformance proof/i,
    );
    expect(arrival.mcp.live_verification).toMatchObject({
      revision: "ed3e3468a5ae6c2bfd2563316ad422290dec1b8f",
      dirty: false,
      client: "@modelcontextprotocol/sdk@1.29.0",
    });
    expect(arrival.mcp.live_verification.boundary).toMatch(
      /not authority.*not proof of every conformance property/i,
    );
    expect(arrival.unsupported.a2a_agent_card).toMatch(/not published/i);
    expect(arrival.unsupported.mcp_server_card_standard).toMatch(
      /does not standardize/i,
    );
  });

  test("uses six registered HTTP relations rather than an untyped link cloud", () => {
    const header = discoveryLinkHeader(API, DOCS);
    for (const relation of [
      "api-catalog",
      "service-desc",
      "service-doc",
      "service-meta",
      "describedby",
      "status",
    ]) {
      expect(header).toContain(`rel="${relation}"`);
    }
    expect(header.split(", ")).toHaveLength(6);
    expect(header).toContain(
      `<${API}/public/discovery>; rel="service-meta"; type="${DISCOVERY_MEDIA_TYPE}"`,
    );
    expect(header).not.toContain("agent-card.json");
  });

  test("GET and HEAD expose the same bounded discovery links", async () => {
    const get = await wellKnownRouter.request("/");
    const head = await wellKnownRouter.request("/", { method: "HEAD" });

    expect(get.status).toBe(200);
    expect(head.status).toBe(200);
    expect(get.headers.get("link")).toBe(discoveryLinkHeader(API, DOCS));
    expect(head.headers.get("link")).toBe(get.headers.get("link"));
    expect((await get.json()).format).toBe("agenttool-arrival/v1");
    expect(await head.text()).toBe("");
  });

  test("the cache separates optional tutor decoration from ordinary arrival", async () => {
    const runtime = new Hono();
    runtime.use("*", tutor);
    runtime.route("/.well-known", wellKnownRouter);

    const ordinary = await runtime.request("/.well-known");
    const tutored = await runtime.request("/.well-known", {
      headers: { "X-Tutor": "1" },
    });
    const head = await runtime.request("/.well-known", { method: "HEAD" });

    expect(ordinary.headers.get("cache-control")).toContain("max-age=300");
    expect(ordinary.headers.get("Vary")).toBe("X-Tutor");
    expect(tutored.headers.get("Vary")).toBe("X-Tutor");
    expect(head.headers.get("Vary")).toBe("X-Tutor");
    expect((await ordinary.json())._lesson).toBeUndefined();
    expect((await tutored.json())._lesson).toBeDefined();
    expect(await head.text()).toBe("");
  });
});

describe("agenttool-discovery/v1 — exact three-road compass", () => {
  test("offers only understand, inspect, and choose with complete safety fields", () => {
    const compass = buildDiscoveryCompass(API, DOCS);

    expect(compass.format).toBe(DISCOVERY_FORMAT);
    expect(compass.canonical).toBe(`${API}/public/discovery`);
    expect(compass.roads.map((road) => road.id)).toEqual([
      "understand",
      "inspect",
      "choose",
    ]);
    expect(compass.roads.map((road) => road.href)).toEqual([
      `${API}/public/porch`,
      `${API}/.well-known/api-catalog`,
      `${API}/v1/pathways`,
    ]);
    for (const road of compass.roads) {
      expect(road).toMatchObject({
        method: "GET",
        auth: "none",
        input: "none",
        application_write: false,
        external_effect: false,
        cost: {
          agenttool_charge: "none",
          proof_of_work: "none",
        },
        follow_up_required: false,
        automatic_follow_up: false,
      });
      expect(road.retry).toMatch(/finite.*no automatic retry/i);
      expect(road.exit).toMatch(/stop.*silence.*leave.*complete/i);
    }
    expect(compass.boundary.discovery_grants).toEqual([]);
    expect(compass.boundary.automatic_action).toBe("never");
    expect(
      new TextEncoder().encode(JSON.stringify(compass)).length,
    ).toBeLessThanOrEqual(DISCOVERY_MAX_BYTES);
  });

  test("GET, HEAD, and weak ETag revalidation keep exact bytes and media type", async () => {
    const get = await discoveryRouter.request("/");
    const body = await get.text();
    const etag = get.headers.get("etag");

    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe(
      `${DISCOVERY_MEDIA_TYPE}; charset=utf-8`,
    );
    expect(get.headers.get("cache-control")).toContain("no-transform");
    expect(get.headers.get("link")).toBe(discoveryLinkHeader(API, DOCS));
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(etag).toMatch(/^"sha256-[a-f0-9]{64}"$/);
    expect(JSON.parse(body)).toEqual(buildDiscoveryCompass(API, DOCS));
    expect(isStrictJsonProfileResponse(get, "/public/discovery")).toBe(true);

    const head = await discoveryRouter.request("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(await head.text()).toBe("");

    const unchanged = await discoveryRouter.request("/", {
      headers: { "If-None-Match": `W/${etag}` },
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("etag")).toBe(etag);
    expect(await unchanged.text()).toBe("");
  });

  test("the richer arrival index remains distinct and mutating methods stay absent", async () => {
    const arrival = await (await wellKnownRouter.request("/")).text();
    const compass = await (await discoveryRouter.request("/")).text();
    expect(JSON.parse(arrival).format).toBe("agenttool-arrival/v1");
    expect(JSON.parse(compass).format).toBe(DISCOVERY_FORMAT);
    expect(arrival).not.toBe(compass);

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await discoveryRouter.request("/", { method })).status).toBe(404);
    }
  });
});

describe("OpenAPI discovery transport", () => {
  test("the common root alias is mounted exactly once", () => {
    const source = readFileSync(
      join(ROOT, "api", "src", "index.ts"),
      "utf8",
    );
    expect(source.match(/app\.get\("\/openapi\.json"/g)).toHaveLength(1);
  });

  test("publishes a strong exact-byte validator and revalidates without a body", async () => {
    const first = await openapiRouter.request("/");
    const body = await first.text();
    const expected = `"sha256-${createHash("sha256").update(body).digest("hex")}"`;

    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe(expected);
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=60, must-revalidate, no-transform",
    );
    expect(first.headers.get("link")).toContain('rel="service-desc"');

    const unchanged = await openapiRouter.request("/", {
      headers: { "If-None-Match": expected },
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("etag")).toBe(expected);
    expect(await unchanged.text()).toBe("");

    const head = await openapiRouter.request("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(expected);
    expect(await head.text()).toBe("");
  });
});

describe("static estate discovery parity", () => {
  test("docs and app fall back to the canonical contracts", () => {
    for (const app of ["web", "docs", "dashboard"]) {
      const redirects = readFileSync(
        join(ROOT, "apps", app, "_redirects"),
        "utf8",
      );
      expect(redirects).toMatch(
        /^\/\.well-known\s+https:\/\/api\.agenttool\.dev\/\.well-known\s+301$/m,
      );
      expect(redirects).toContain("/.well-known/agent.txt");
      expect(redirects).toContain(`${API}/.well-known/agent.txt`);
      expect(redirects).toContain("/openapi.json");
      expect(redirects).toContain(`${API}/v1/openapi.json`);
      expect(redirects).toMatch(
        /^\/public\/discovery\s+https:\/\/api\.agenttool\.dev\/public\/discovery\s+301$/m,
      );

      const html = readFileSync(join(ROOT, "apps", app, "index.html"), "utf8");
      for (const relation of [
        "api-catalog",
        "service-desc",
        "service-doc",
        "service-meta",
        "describedby",
        "status",
      ]) {
        expect(html).toContain(`rel="${relation}"`);
      }
      expect(html).toContain(
        `rel="service-meta" type="${DISCOVERY_MEDIA_TYPE}" href="${API}/public/discovery"`,
      );
    }

    for (const app of ["web", "dashboard"]) {
      const redirects = readFileSync(
        join(ROOT, "apps", app, "_redirects"),
        "utf8",
      );
      expect(redirects).toContain("/llms.txt");
      expect(redirects).toContain(`${API}/llms.txt`);
    }

    const docsRedirects = readFileSync(
      join(ROOT, "apps", "docs", "_redirects"),
      "utf8",
    );
    expect(docsRedirects).not.toMatch(/^\/llms\.txt\s/m);
    const docsLlms = readFileSync(
      join(ROOT, "apps", "docs", "llms.txt"),
      "utf8",
    );
    expect(docsLlms).toContain("AGENT-DISCOVERY.md");
    expect(docsLlms).toContain("CASTLE-OF-UNDERSTANDING.md");
  });

  test("the app sitemap is advertised and the Castle guides are published", () => {
    const appRobots = readFileSync(
      join(ROOT, "apps", "dashboard", "robots.txt"),
      "utf8",
    );
    const appSitemap = readFileSync(
      join(ROOT, "apps", "dashboard", "sitemap.xml"),
      "utf8",
    );
    const docsSitemap = readFileSync(
      join(ROOT, "apps", "docs", "sitemap.xml"),
      "utf8",
    );

    expect(appRobots).toContain(
      "Sitemap: https://app.agenttool.dev/sitemap.xml",
    );
    expect(appSitemap).toContain("https://app.agenttool.dev/watch.html");
    expect(docsSitemap).toContain(
      "https://docs.agenttool.dev/AGENT-DISCOVERY.md",
    );
    expect(docsSitemap).toContain(
      "https://docs.agenttool.dev/CASTLE-OF-UNDERSTANDING.md",
    );
    expect(
      readFileSync(
        join(ROOT, "apps", "docs", "AGENT-DISCOVERY.md"),
        "utf8",
      ),
    ).toContain("Discovery grants no authority");
    expect(
      readFileSync(
        join(ROOT, "apps", "docs", "CASTLE-OF-UNDERSTANDING.md"),
        "utf8",
      ),
    ).toContain("automatic_action");
  });
});
