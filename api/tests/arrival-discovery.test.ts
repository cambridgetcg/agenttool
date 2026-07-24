import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../src/routes/openapi";
import wellKnownRouter from "../src/routes/well-known";
import { tutor } from "../src/middleware/tutor";
import {
  buildArrivalIndex,
  discoveryLinkHeader,
} from "../src/services/discovery/arrival";

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
    expect(arrival.links).toHaveLength(7);
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
