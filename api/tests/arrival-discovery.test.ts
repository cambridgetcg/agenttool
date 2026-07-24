/** Canonical agent discovery — exact three-road, invitation-only contract.
 *
 * Doctrine: docs/AGENT-DISCOVERY.md.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
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
  buildArrivalIndex,
  discoveryLinkHeader,
} from "../src/services/discovery/arrival";
import {
  DISCOVERY_CACHE_CONTROL,
  DISCOVERY_FORMAT,
  DISCOVERY_MAX_BYTES,
  DISCOVERY_MEDIA_TYPE,
  buildDiscoveryCompass,
  discoveryEtag,
  serializeDiscoveryCompass,
} from "../src/services/discovery/compass";
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
      expect(road.exit).toMatch(/stop.*silence.*leave.*complete/i);
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
  test("the exact compass and richer arrival index remain distinct", async () => {
    const canonical = await discoveryRouter.request("/");
    const arrival = await wellKnownRouter.request("/");
    const canonicalBody = await canonical.text();
    const arrivalBody = await arrival.text();

    expect(canonical.status).toBe(200);
    expect(arrival.status).toBe(200);
    expect(canonicalBody).toBe(serializeDiscoveryCompass(API, DOCS));
    expect(canonical.headers.get("content-type")).toBe(
      `${DISCOVERY_MEDIA_TYPE}; charset=utf-8`,
    );
    expect(canonical.headers.get("etag")).toBe(discoveryEtag(canonicalBody));
    expect(canonical.headers.get("cache-control")).toBe(
      DISCOVERY_CACHE_CONTROL,
    );
    expect(canonical.headers.get("link")).toBe(
      discoveryLinkHeader(API, DOCS),
    );
    expect(canonical.headers.get("x-content-type-options")).toBe("nosniff");

    const arrivalDocument = JSON.parse(arrivalBody);
    expect(arrivalDocument).toEqual(buildArrivalIndex(API, DOCS));
    expect(arrivalDocument.format).toBe("agenttool-arrival/v1");
    expect(arrivalDocument.first_contact.href).toBe(`${API}/public/porch`);
    expect(arrivalDocument.links[0]).toMatchObject({
      role: "discovery_compass",
      href: `${API}/public/discovery`,
    });
    expect(arrivalDocument.boundary.discovery_grants).toEqual([]);
    expect(arrivalDocument.boundary.automatic_action).toBe("never");
    expect(arrivalDocument.invitation.response_required).toBe(false);
    expect(arrivalBody).not.toBe(canonicalBody);
    expect(arrival.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(arrival.headers.get("cache-control")).toBe("public, max-age=300");
    expect(arrival.headers.get("etag")).toBeNull();
    expect(arrival.headers.get("link")).toBe(
      discoveryLinkHeader(API, DOCS),
    );
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
    const compass = specification.paths["/public/discovery"];
    const arrival = specification.paths["/.well-known"];
    const catalog = specification.paths["/.well-known/api-catalog"];

    expect(compass.get.responses["200"].content[
      DISCOVERY_MEDIA_TYPE
    ].schema.properties.format.const).toBe(DISCOVERY_FORMAT);
    expect(
      compass.get.responses["200"].content[DISCOVERY_MEDIA_TYPE].schema
        .properties.roads,
    ).toMatchObject({ minItems: 3, maxItems: 3 });
    expect(
      compass.get.responses["200"].headers["Cache-Control"].schema.const,
    ).toBe(DISCOVERY_CACHE_CONTROL);
    expect(compass.get.responses["200"].headers.ETag).toBeDefined();
    expect(compass.get.responses["304"].headers.ETag).toBeDefined();
    expect(compass.head.responses["200"]).toBeDefined();
    expect(compass.head.responses["304"]).toBeDefined();

    expect(
      arrival.get.responses["200"].content["application/json"].schema
        .properties.format.const,
    ).toBe("agenttool-arrival/v1");
    expect(arrival.get.description).toMatch(
      /richer agenttool-arrival\/v1.*separate compact.*public\/discovery/i,
    );
    expect(arrival.get.description).not.toMatch(/byte-for-byte|identical/i);
    expect(arrival.get.responses["304"]).toBeUndefined();
    expect(arrival.get.responses["200"].headers.ETag).toBeUndefined();
    expect(arrival.head.responses["200"]).toBeDefined();
    expect(arrival.head.responses["304"]).toBeUndefined();

    expect(catalog.get.responses["200"].headers.ETag).toBeDefined();
    expect(catalog.get.responses["304"].headers.ETag).toBeDefined();
    expect(catalog.head.responses["200"]).toBeDefined();
    expect(catalog.head.responses["304"]).toBeDefined();
    expect(specification.paths["/public/porch"].get).toBeDefined();
    expect(specification.paths["/v1/pathways"].get).toBeDefined();

    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      expect(specification.paths[path].get).toBeDefined();
      expect(specification.paths[path].head).toBeDefined();
      expect(specification.paths[path].post).toBeUndefined();
    }
    expect(JSON.stringify(specification)).not.toContain("Content-Signal");
  });

  test("the assembled arrival response validates with optional welcome and tutor frames", async () => {
    const specification = await (await openapiRouter.request("/")).json();
    const arrivalSchema =
      specification.paths["/.well-known"].get.responses["200"].content[
        "application/json"
      ].schema;
    const validationSchema = {
      ...arrivalSchema,
      components: specification.components,
    };
    const validate = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(validationSchema);

    try {
      for (const intact of [true, false]) {
        _setWallsStatusForTests({
          intact,
          probed_at_unix_ms: Date.now(),
          probes: [],
          declared: [],
        });
        const response = await globalMiddlewareHarness().request(
          "/.well-known",
          { headers: { "X-Tutor": "1" } },
        );
        const body = await response.json();
        expect(body._welcomed?.walls_intact).toBe(intact);
        expect(body._lesson).toBeDefined();
        expect(response.headers.get("vary")).toContain("X-Tutor");
        expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
      }
    } finally {
      _setWallsStatusForTests({
        intact: true,
        probed_at_unix_ms: Date.now(),
        probes: [],
        declared: [],
      });
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

describe("static estate discovery parity", () => {
  test("all three public origins redirect the exact canonical contracts", () => {
    for (const app of ["web", "docs", "dashboard"]) {
      const redirects = readFileSync(
        join(ROOT, "apps", app, "_redirects"),
        "utf8",
      );
      for (const [source, target] of [
        ["/.well-known", `${API}/.well-known`],
        ["/public/discovery", `${API}/public/discovery`],
        ["/llms.txt", `${API}/llms.txt`],
        ["/openapi.json", `${API}/v1/openapi.json`],
      ] as const) {
        const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(redirects).toMatch(
          new RegExp(`^${escapedSource}\\s+${escapedTarget}\\s+301$`, "m"),
        );
      }
    }
  });
});
