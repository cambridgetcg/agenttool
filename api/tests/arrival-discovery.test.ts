/** Canonical agent discovery — exact three-road, invitation-only contract.
 *
 * Doctrine: docs/AGENT-DISCOVERY.md.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { apiCors } from "../src/middleware/api-cors";
import { play } from "../src/middleware/play";
import { tokenCost } from "../src/middleware/token-cost";
import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";
import pathwaysRouter from "../src/routes/pathways";
import openapiRouter from "../src/routes/openapi";
import discoveryRouter from "../src/routes/public/discovery";
import { createPorchRoutes } from "../src/routes/public/porch";
import wellKnownRouter from "../src/routes/well-known";
import {
  DISCOVERY_CACHE_CONTROL,
  DISCOVERY_FORMAT,
  DISCOVERY_MAX_BYTES,
  DISCOVERY_MEDIA_TYPE,
  buildDiscoveryCompass,
  discoveryEtag,
  discoveryLinkHeader,
  serializeDiscoveryCompass,
} from "../src/services/discovery/arrival";
import { _setWallsStatusForTests } from "../src/services/wake/walls-status";

const API = "https://api.agenttool.dev";
const DOCS = "https://docs.agenttool.dev";
const ROOT = join(import.meta.dir, "..", "..");
const ROAD_FIELDS = [
  "id",
  "intent",
  "method",
  "href",
  "representation",
  "auth",
  "input",
  "application_write",
  "external_effect",
  "cost",
  "repeatability",
  "retry",
  "follow_up_required",
  "automatic_follow_up",
  "exit",
] as const;

beforeAll(() => {
  _setWallsStatusForTests({
    intact: true,
    probed_at_unix_ms: Date.now(),
    probes: [],
    declared: [],
  });
});

function globalMiddlewareHarness() {
  const app = new Hono();
  app.use("*", apiCors());
  app.use("*", tokenCost());
  app.use("*", welcomeEcho());
  app.use("*", play());
  app.use("*", tutor);
  app.route("/public/discovery", discoveryRouter);
  app.route("/.well-known", wellKnownRouter);
  return app;
}

describe("agenttool-discovery/v1 document", () => {
  test("contains exactly three ordered optional public GET roads", () => {
    const compass = buildDiscoveryCompass(API, DOCS);
    expect(compass.format).toBe(DISCOVERY_FORMAT);
    expect(compass.canonical).toBe(`${API}/public/discovery`);
    expect(compass.roads.map((road) => [road.id, road.href])).toEqual([
      ["understand", `${API}/public/porch`],
      ["inspect", `${API}/.well-known/api-catalog`],
      ["choose", `${API}/v1/pathways`],
    ]);

    for (const road of compass.roads) {
      expect(Object.keys(road)).toEqual(ROAD_FIELDS);
      expect(road.method).toBe("GET");
      expect(road.auth).toBe("none");
      expect(road.input).toBe("none");
      expect(road.application_write).toBe(false);
      expect(road.external_effect).toBe(false);
      expect(road.cost).toEqual({
        agenttool_charge: "none",
        proof_of_work: "none",
      });
      expect(road.repeatability).toBe("safe and idempotent public read");
      expect(road.retry).toMatch(/caller-chosen.*finite.*no automatic retry/i);
      expect(road.follow_up_required).toBe(false);
      expect(road.automatic_follow_up).toBe(false);
      expect(road.exit).toMatch(/stop.*silent.*leave.*complete/i);
    }
  });

  test("makes the seed truth, invitation, storage, and authority boundary explicit", () => {
    const compass = buildDiscoveryCompass(API, DOCS);
    expect(compass.boundary.seed_truth).toMatch(
      /cannot be discovered from literal nothing/i,
    );
    expect(compass.invitation.response_required).toBe(false);
    expect(compass.invitation.reading_is_not_consent).toBe(true);
    expect(compass.invitation.silence_or_leaving_is_complete).toBe(true);
    expect(compass.boundary.discovery_grants).toEqual([]);
    expect(compass.boundary.scope).toMatch(/no project.*identity.*workspace/i);
    expect(compass.boundary.application_storage).toMatch(
      /no application-state write.*hosting metadata/i,
    );
    expect(compass.boundary.automatic_action).toBe("never");
  });

  test("names six independent channels without inventing A2A", () => {
    const compass = buildDiscoveryCompass(API, DOCS);
    expect(compass.channels.map((channel) => channel.id)).toEqual([
      "web",
      "machine_web",
      "source",
      "packages",
      "protocols_and_feeds",
      "directory",
    ]);
    const serialized = JSON.stringify(compass);
    expect(serialized).not.toContain("agent-card.json");
    expect(serialized).not.toContain('"a2a"');
  });

  test("stays inside the fixed first-contact byte budget", () => {
    const body = serializeDiscoveryCompass(API, DOCS);
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(
      DISCOVERY_MAX_BYTES,
    );
    expect(JSON.stringify(JSON.parse(body))).toBe(body);
  });

  test("publishes exactly six registered typed links", () => {
    const header = discoveryLinkHeader(API, DOCS);
    expect(header.split(", ")).toHaveLength(6);
    expect(header).toStartWith(
      `<${API}/public/discovery>; rel="service-meta"; type="${DISCOVERY_MEDIA_TYPE}"`,
    );
    for (const relation of [
      "service-meta",
      "api-catalog",
      "service-desc",
      "service-doc",
      "describedby",
      "status",
    ]) {
      expect(header).toContain(`rel="${relation}"`);
    }
    expect(header).not.toContain("agent-card.json");
  });
});

describe("canonical and compatibility transport", () => {
  test("GET bytes, media type, ETag, cache, and Link header are identical", async () => {
    const canonical = await discoveryRouter.request("/");
    const compatibility = await wellKnownRouter.request("/");
    const canonicalBody = await canonical.text();
    const compatibilityBody = await compatibility.text();

    expect(canonical.status).toBe(200);
    expect(compatibility.status).toBe(200);
    expect(compatibilityBody).toBe(canonicalBody);
    expect(canonicalBody).toBe(serializeDiscoveryCompass(API, DOCS));
    for (const response of [canonical, compatibility]) {
      expect(response.headers.get("content-type")).toBe(
        `${DISCOVERY_MEDIA_TYPE}; charset=utf-8`,
      );
      expect(response.headers.get("etag")).toBe(discoveryEtag(canonicalBody));
      expect(response.headers.get("cache-control")).toBe(
        DISCOVERY_CACHE_CONTROL,
      );
      expect(response.headers.get("link")).toBe(
        discoveryLinkHeader(API, DOCS),
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  test("HEAD and If-None-Match preserve metadata without a body", async () => {
    const first = await discoveryRouter.request("/");
    const etag = first.headers.get("etag")!;

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

  test("global welcome, play, and tutor middleware cannot alter exact bytes", async () => {
    const app = globalMiddlewareHarness();
    const response = await app.request("/public/discovery", {
      headers: {
        Origin: "https://reader.example",
        "X-Tutor": "1",
        "X-Play": "on",
      },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe(serializeDiscoveryCompass(API, DOCS));
    expect(body).not.toContain('"_welcomed"');
    expect(body).not.toContain('"_lesson"');
    expect(body).not.toContain('"_jest"');
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-welcomed")).toBeTruthy();
    expect(Number(response.headers.get("x-byte-count"))).toBe(
      new TextEncoder().encode(body).length,
    );
  });

  test("CORS preflight offers only read methods and bounded read headers", async () => {
    const response = await globalMiddlewareHarness().request(
      "/public/discovery",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://reader.example",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "If-None-Match",
        },
      },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET,HEAD,OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "If-None-Match,X-Play,X-Tutor",
    );
  });

  test("mutating methods and a false A2A card stay absent", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await discoveryRouter.request("/", { method })).status).toBe(404);
    }
    expect(
      (await wellKnownRouter.request("/agent-card.json")).status,
    ).toBe(404);
  });
});

describe("all three roads land on current public handlers", () => {
  test("understand, inspect, and choose each answer a bounded GET", async () => {
    const porch = createPorchRoutes({
      gift: async () => null,
      neighbor: async () => null,
      artifact: async () => null,
    });
    const responses = await Promise.all([
      porch.request("/"),
      wellKnownRouter.request("/api-catalog"),
      pathwaysRouter.request("/"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
  });

  test("the curated OpenAPI contract describes the compass and both road contracts", async () => {
    const specification = await (await openapiRouter.request("/")).json();
    expect(specification.paths["/public/discovery"].get).toBeDefined();
    expect(specification.paths["/public/discovery"].head).toBeDefined();
    expect(
      specification.paths["/public/discovery"].head.responses["304"],
    ).toBeDefined();
    expect(specification.paths["/.well-known"].head).toBeDefined();
    expect(
      specification.paths["/.well-known"].get.responses["304"].headers.ETag,
    ).toBeDefined();
    expect(
      specification.paths["/.well-known/api-catalog"].get,
    ).toBeDefined();
    expect(
      specification.paths["/.well-known/api-catalog"].head,
    ).toBeDefined();
    expect(specification.paths["/public/porch"].get).toBeDefined();
    expect(specification.paths["/v1/pathways"].get).toBeDefined();
    expect(
      specification.paths["/public/discovery"].get.responses["200"].content[
        "application/vnd.agenttool.discovery+json"
      ].schema.properties.roads,
    ).toMatchObject({ minItems: 3, maxItems: 3 });
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
      headers: { "If-None-Match": `W/${expected}` },
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
