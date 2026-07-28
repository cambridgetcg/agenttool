import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  SURFACE_MANIFEST_PATH,
  SURFACE_MANIFEST_SCHEMA_URL,
  SURFACE_MANIFEST_VERSION,
  SURFACE_PROFILE,
} from "@agenttool/xenia/surface-0.1";

import { isStrictJsonProfileResponse } from "../src/middleware/strict-json-profile";
import { play } from "../src/middleware/play";
import { tokenCost } from "../src/middleware/token-cost";
import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";
import openapiRouter from "../src/routes/openapi";
import publicRouter from "../src/routes/public";
import wellKnownRouter from "../src/routes/well-known";
import { buildAgentToolSurfaceManifest } from "../src/services/discovery/xenia-surface";
import { _setWallsStatusForTests } from "../src/services/wake/walls-status";

const API = "https://api.agenttool.dev";
const DOCS = "https://docs.agenttool.dev";

describe("XENIA Surface 0.1", () => {
  test("builds a release-pinned, same-origin, credential-free manifest", () => {
    const manifest = buildAgentToolSurfaceManifest(API, DOCS);

    expect(SURFACE_MANIFEST_PATH).toBe("/.well-known/agent.json");
    expect(manifest).toMatchObject({
      $schema: SURFACE_MANIFEST_SCHEMA_URL,
      schema_version: SURFACE_MANIFEST_VERSION,
      profile: SURFACE_PROFILE,
      service: {
        name: "agenttool",
        canonical_url: API,
      },
      problem_schema: expect.stringContaining(
        "/surface-v0.1.0-rc.1/surface/0.1/problem.schema.json",
      ),
      claims: [],
      documentation: `${DOCS}/AGENT-DISCOVERY.md`,
    });
    expect(manifest.resources.map(({ id }) => id)).toEqual([
      "kingdom-framework",
    ]);
    for (const resource of manifest.resources) {
      expect(new URL(resource.href).origin).toBe(API);
      expect(resource.auth).toBe("none");
      expect(resource.representations).toEqual(["application/json"]);
      expect(resource.default_media_type).toBe("application/json");
    }
    expect(manifest.not_covered).toEqual(
      expect.arrayContaining([
        "actor authorization",
        "consent",
        "XENIA Covenant adoption or conformance",
        "KINGDOM registry authority outside AgentTool's own project card",
      ]),
    );
  });

  test("rejects credential-bearing and non-public origins", () => {
    expect(() =>
      buildAgentToolSurfaceManifest("https://user@example.com", DOCS),
    ).toThrow(/credential_free/);
    expect(() =>
      buildAgentToolSurfaceManifest("http://example.com", DOCS),
    ).toThrow(/https_or_loopback/);
  });

  test("serves the exact manifest for GET and metadata-only HEAD", async () => {
    const get = await wellKnownRouter.request("/agent.json");
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(get.headers.get("cache-control")).toBe("public, max-age=300");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await get.json()).toEqual(
      buildAgentToolSurfaceManifest(API, DOCS),
    );

    const head = await wellKnownRouter.request("/agent.json", {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await head.text()).toBe("");
  });

  test("every declared resource passes the required JSON-only Accept matrix", async () => {
    const manifest = buildAgentToolSurfaceManifest(API, DOCS);
    for (const resource of manifest.resources) {
      const path = new URL(resource.href).pathname;
      expect(path.startsWith("/public/"), path).toBe(true);
      for (const accept of [
        "application/json",
        "text/html;q=0, application/json;q=1",
        "application/*;q=1, text/html;q=0.2",
        "*/*",
      ]) {
        const response = await publicRouter.request(
          path.slice("/public".length),
          { headers: { Accept: accept } },
        );
        expect(response.status, `${path} ${accept}`).toBe(200);
        expect(
          response.headers.get("content-type") ?? "",
          `${path} ${accept}`,
        ).toContain("application/json");
        expect(
          response.headers.get("vary")?.toLowerCase().split(/,\\s*/) ?? [],
          `${path} ${accept}`,
        ).toContain("accept");
        expect(
          (await response.json() as { schema_version?: string }).schema_version,
          `${path} ${accept}`,
        ).toBeTruthy();
      }

      for (const accept of [
        "text/html",
        "application/json;q=0, */*;q=1",
        "application/x-xenia-unsupported",
      ]) {
        const response = await publicRouter.request(
          path.slice("/public".length),
          { headers: { Accept: accept } },
        );
        expect(response.status, `${path} ${accept}`).toBe(406);
        expect(
          response.headers.get("content-type") ?? "",
          `${path} ${accept}`,
        ).toContain("application/problem+json");
        expect(
          response.headers.get("vary")?.toLowerCase().split(/,\\s*/) ?? [],
          `${path} ${accept}`,
        ).toContain("accept");
        const problem = await response.json() as {
          schema_version?: string;
          next_actions?: Array<{
            href?: string;
            method?: string;
            accept?: string;
          }>;
        };
        expect(problem.schema_version, `${path} ${accept}`).toBe(
          "xenia.surface.problem/0.1",
        );
        expect(problem.next_actions, `${path} ${accept}`).toContainEqual(
          expect.objectContaining({
            href: resource.href,
            method: "GET",
            accept: "application/json",
          }),
        );
      }
    }
  });

  test("the full router returns the required typed problem for an unpredictable miss", async () => {
    process.env.AGENTTOOL_DISABLE_WORKERS = "1";
    process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP = "1";
    process.env.AGENTOOL_DISABLE_SAGA_SEED = "1";
    const { app } = await import("../src/index");
    const response = await app.request(
      `${API}/xenia-surface-miss-${crypto.randomUUID()}`,
      { headers: { Accept: "application/problem+json" } },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type") ?? "").toContain(
      "application/problem+json",
    );
    expect(
      response.headers.get("vary")?.toLowerCase().split(/,\\s*/) ?? [],
    ).toContain("accept");
    const problem = await response.json();
    expect(problem).toMatchObject({
      schema_version: "xenia.surface.problem/0.1",
      code: "route_not_found",
      status: 404,
      terminal: false,
      next_actions: [
        {
          rel: "discover",
          href: `${API}/.well-known/agent.json`,
          method: "GET",
          accept: "application/json",
        },
      ],
    });
  });

  test("keeps the manifest body outside optional global decorators", async () => {
    _setWallsStatusForTests({
      intact: true,
      probed_at_unix_ms: Date.now(),
      probes: [],
      declared: [],
    });
    const app = new Hono();
    app.use("*", tokenCost());
    app.use("*", welcomeEcho());
    app.use("*", play());
    app.use("*", tutor);
    app.route("/.well-known", wellKnownRouter);

    const response = await app.request("/.well-known/agent.json", {
      headers: {
        "X-Play": "on",
        "X-Tutor": "1",
      },
    });
    expect(
      isStrictJsonProfileResponse(
        response,
        "/.well-known/agent.json",
      ),
    ).toBe(true);
    const body = await response.text();
    expect(body).not.toContain('"_welcomed"');
    expect(body).not.toContain('"_lesson"');
    expect(body).not.toContain('"_jest"');
    expect(JSON.parse(body)).toEqual(
      buildAgentToolSurfaceManifest(API, DOCS),
    );
    expect(response.headers.get("x-welcomed")).toBeTruthy();
    expect(Number(response.headers.get("x-byte-count"))).toBe(
      new TextEncoder().encode(body).length,
    );
  });

  test("is represented in the curated OpenAPI contract", async () => {
    const specification = await (await openapiRouter.request("/")).json();
    const route = specification.paths["/.well-known/agent.json"];

    expect(route.get.security).toEqual([]);
    expect(
      route.get.responses["200"].content["application/json"].schema.properties
        .profile.const,
    ).toBe("xenia-surface/0.1");
    expect(route.get.responses["200"].headers.Link).toBeUndefined();
    expect(route.get.responses["200"].headers.Vary.schema.const).toBe(
      "Accept",
    );
    expect(route.head.responses["200"]).toBeDefined();
  });
});
