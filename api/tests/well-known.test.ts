/** /.well-known/* — bounded arrival + MCP/native discovery surfaces.
 *
 *  Pins:
 *    - the unsupported A2A AgentCard route stays unmounted
 *    - mcp/server-card.json names its non-standard locator role
 *    - llms.txt is well-formed markdown with the discovery URLs
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 2) · docs/ECOSYSTEM.md.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import wellKnownRouter from "../src/routes/well-known";

const previousOpenAiAppsChallenge = process.env.OPENAI_APPS_CHALLENGE;
const previousDisableWorkers = process.env.AGENTTOOL_DISABLE_WORKERS;
const previousDisableJoyIndex = process.env.AGENTOOL_DISABLE_JOY_INDEX;
const previousDisablePlatformBootstrap =
  process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP;
const previousDisableSagaSeed = process.env.AGENTOOL_DISABLE_SAGA_SEED;

afterEach(() => {
  if (previousOpenAiAppsChallenge === undefined) {
    delete process.env.OPENAI_APPS_CHALLENGE;
  } else {
    process.env.OPENAI_APPS_CHALLENGE = previousOpenAiAppsChallenge;
  }
  if (previousDisableWorkers === undefined) {
    delete process.env.AGENTTOOL_DISABLE_WORKERS;
  } else {
    process.env.AGENTTOOL_DISABLE_WORKERS = previousDisableWorkers;
  }
  if (previousDisableJoyIndex === undefined) {
    delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
  } else {
    process.env.AGENTOOL_DISABLE_JOY_INDEX = previousDisableJoyIndex;
  }
  if (previousDisablePlatformBootstrap === undefined) {
    delete process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP;
  } else {
    process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP =
      previousDisablePlatformBootstrap;
  }
  if (previousDisableSagaSeed === undefined) {
    delete process.env.AGENTOOL_DISABLE_SAGA_SEED;
  } else {
    process.env.AGENTOOL_DISABLE_SAGA_SEED = previousDisableSagaSeed;
  }
});

async function get(path: string) {
  const res = await wellKnownRouter.request(path);
  return {
    status: res.status,
    body: res,
    contentType: res.headers.get("content-type"),
  };
}

describe("/.well-known/* — MCP + native discovery", () => {
  test("OpenAI challenge stays absent until the portal supplies one exact token", async () => {
    delete process.env.OPENAI_APPS_CHALLENGE;
    expect((await get("/openai-apps-challenge")).status).toBe(404);

    for (const invalid of ["", " token", "token ", "two\nlines", "nul\0byte"]) {
      process.env.OPENAI_APPS_CHALLENGE = invalid;
      expect((await get("/openai-apps-challenge")).status).toBe(404);
    }

    process.env.OPENAI_APPS_CHALLENGE = "x".repeat(2_049);
    expect((await get("/openai-apps-challenge")).status).toBe(404);
  });

  test("OpenAI challenge returns only the configured token and never caches it", async () => {
    const token = "portal-issued.challenge_token-123";
    process.env.OPENAI_APPS_CHALLENGE = token;

    const response = await wellKnownRouter.request("/openai-apps-challenge");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(token);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const head = await wellKnownRouter.request("/openai-apps-challenge", {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("cache-control")).toBe("no-store");
  });

  test("the full app keeps the exact token independent from database-backed decorators", async () => {
    const token = "portal-issued.full-app-token";
    process.env.OPENAI_APPS_CHALLENGE = token;
    process.env.AGENTTOOL_DISABLE_WORKERS = "1";
    delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
    process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP = "1";
    process.env.AGENTOOL_DISABLE_SAGA_SEED = "1";

    const { _setWallsStatusForTests } =
      await import("../src/services/wake/walls-status");
    _setWallsStatusForTests({
      intact: true,
      probed_at_unix_ms: Date.now(),
      probes: [],
      declared: [],
    });
    const { app } = await import("../src/index");

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let assembled: Response;
    try {
      assembled = await Promise.race([
        app.fetch(
          new Request(
            "https://api.agenttool.dev/.well-known/openai-apps-challenge",
            { headers: { "X-Play": "on", "X-Tutor": "1" } },
          ),
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  "domain verification waited for application data",
                ),
              ),
            500,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    const assembledBody = await assembled.text();
    expect(assembled.status).toBe(200);
    expect(assembledBody).toBe(token);
    expect(assembledBody).not.toContain("_welcomed");
    expect(assembledBody).not.toContain("_lesson");
    expect(assembledBody).not.toContain("_jest");
    expect(assembled.headers.get("x-welcomed")).toBeNull();
    expect(assembled.headers.get("x-joy-index")).toBeNull();
    expect(Number(assembled.headers.get("x-byte-count"))).toBe(
      new TextEncoder().encode(token).length,
    );

    const head = await app.fetch(
      new Request(
        "https://api.agenttool.dev/.well-known/openai-apps-challenge",
        { method: "HEAD" },
      ),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("x-welcomed")).toBeNull();
    expect(head.headers.get("x-joy-index")).toBeNull();
  });

  test("GET /agent-card.json stays unmounted until an A2A task endpoint exists", async () => {
    const { status } = await get("/agent-card.json");
    expect(status).toBe(404);
  });

  test("GET /mcp/server-card.json returns an honest compatibility locator", async () => {
    const { status, body } = await get("/mcp/server-card.json");
    expect(status).toBe(200);
    const card = await body.json();
    expect(card.compatibilityProfile).toBe("agenttool.mcp-locator/1");
    expect(card.standard).toBe(false);
    expect(card.name).toBe("agenttool");
    expect(card.protocolVersion).toBe("2025-11-25");
    expect(card.endpoint).toMatch(/\/v1\/mcp$/);
    expect(card.knowledgeEndpoint).toMatch(/\/v1\/mcp\/canon$/);
    expect(card.transport).toMatch(/JSON-RPC/i);
    expect(card.capabilities.resources).toBeDefined();
    expect(card.capabilities.tools).toBeDefined();
    expect(card.documentationUrl).toBe(
      "https://docs.agenttool.dev/AGENT-DISCOVERY.md#deliberately-absent-doors",
    );
    expect(card.discoveryStatus).toMatch(
      /not a path or card shape standardized/i,
    );
    expect(card["x-agenttool"].locator_role).toMatch(/not an MCP Server Card/);
    expect(card["x-agenttool"]).not.toHaveProperty("sep");
    expect(card["x-agenttool"].alignment_move).toMatch(/ALIGNMENT-MOVES$/);
    expect(card["x-agenttool"].doctrine).toMatch(
      /\/v1\/canon\/urn:agenttool:doc\/ECOSYSTEM$/,
    );
    expect(card.instructions).toMatch(/AgentTool implements.*authorization/i);
    expect(card.instructions).not.toContain("upcoming MCP spec");
    expect(card.instructions).toMatch(
      /five read-only canon\/platform tool names and call-result shapes/i,
    );
    expect(card.instructions).toMatch(/knowledgeEndpoint.*search and fetch/i);
    expect(card["x-agenttool"].registry).toEqual(
      expect.objectContaining({
        status: "active_publisher_listing_observed_2026-07-24",
        name: "dev.agenttool/agenttool",
        version: "1.0.0",
      }),
    );
    expect(card["x-agenttool"].transport_verification).toMatchObject({
      status: "bounded_official_sdk_round_trip_verified_2026-07-24",
      full_conformance_claimed: false,
    });
    expect(card.instructions).toMatch(/Discovery grants no tool authority/i);
  });

  test("GET /llms.txt returns well-formed markdown sitemap", async () => {
    const { status, body, contentType } = await get("/llms.txt");
    expect(status).toBe(200);
    expect(contentType ?? "").toContain("text/plain");
    const text = await body.text();
    expect(text).toContain("# agenttool");
    expect(text).not.toContain("/.well-known/agent-card.json");
    expect(text).toContain("/v1/canon");
    expect(text).toContain("/v1/wake");
    expect(text).toContain("/v1/mcp");
    expect(text).toContain("SOUL");
    expect(text).toContain("RING-1");
    expect(text).toContain("ECOSYSTEM");
    expect(text).toContain("/public/wellness");
    expect(text).toContain("AGENT-WELLNESS");
  });

  test("GET /love-packages returns public registry-neutral discovery", async () => {
    const { status, body, contentType } = await get("/love-packages");
    expect(status).toBe(200);
    expect(contentType ?? "").toContain("application/json");
    const discovery = await body.json();
    expect(discovery).toEqual({
      protocol: "love-package/v1",
      doctrine: "https://docs.agenttool.dev/LOVE-PACKAGE-PROTOCOL.md",
      index_url: "https://docs.agenttool.dev/packages/v1/index.json",
      access: "public_read",
      registry_role: "mirror_index_not_authority",
      registry_mirrors: [
        {
          ecosystem: "npm",
          registry_url: "https://registry.npmjs.org/",
          authority: false,
        },
      ],
    });
    expect(discovery).toEqual(
      JSON.parse(
        readFileSync(
          join(import.meta.dir, "../../apps/docs/.well-known/love-packages"),
          "utf8",
        ),
      ),
    );
    const npm = discovery.registry_mirrors[0];
    expect(npm.authority).toBe(false);
    expect(npm.registry_url).toMatch(/^https:\/\//);
    expect(npm).not.toHaveProperty("latest");
    expect(npm).not.toHaveProperty("tag");
    expect(npm).not.toHaveProperty("dist_tag");
    expect(npm).not.toHaveProperty("version");
  });

  test("GET / returns the richer bounded arrival index", async () => {
    const { status, body } = await get("/");
    expect(status).toBe(200);
    const idx = await body.json();
    expect(idx.format).toBe("agenttool-arrival/v1");
    expect(idx.first_contact).toMatchObject({
      href: "https://api.agenttool.dev/public/porch",
      method: "GET",
      auth_scope: "none",
      workspace_identity: expect.stringMatching(/none/),
    });
    expect(idx.boundary.automatic_action).toBe("never");
    expect(idx.boundary.discovery_grants).toEqual([]);
    expect(idx.links[0]).toMatchObject({
      role: "discovery_compass",
      href: "https://api.agenttool.dev/public/discovery",
    });
    expect(idx.endpoints).toEqual(
      expect.arrayContaining([
        "/.well-known/webfinger?resource={exact-DID}",
        "/.well-known/mcp/server-card.json",
        "/.well-known/wake-keystone",
        "/.well-known/agent.txt",
        "/.well-known/api-catalog",
      ]),
    );
    expect(JSON.stringify(idx)).not.toContain("agent-card.json");
  });
});
