/** Executed Garden route contract with a process-isolated store mock.
 *
 * `mock.module` makes the hermetic tier run this file in its own Bun process,
 * so argument capture cannot leak into another route test. No database or
 * network is touched. */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const GARDEN_ID = "22222222-2222-4222-8222-222222222222";
const TENDING_ID = "33333333-3333-4333-8333-333333333333";
const REF_ID = "44444444-4444-4444-8444-444444444444";

const calls: Array<{ operation: string; args: unknown[] }> = [];
let nextTendError: Error | null = null;

class MockGardenError extends Error {
  constructor(
    public readonly code:
      | "garden_not_found"
      | "garden_not_active"
      | "gardener_not_found_or_not_owned"
      | "name_too_long"
      | "description_too_long"
      | "note_too_long"
      | "ref_kind_invalid"
      | "already_tended"
      | "tending_not_found",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "GardenError";
  }
}

const GARDEN = {
  id: GARDEN_ID,
  gardener_identity_id: "55555555-5555-4555-8555-555555555555",
  gardener_did: "did:agenttool:garden-test",
  project_id: PROJECT_ID,
  name: "Test garden",
  description: null,
  visibility: "private" as const,
  status: "active" as const,
  tendings_count: 1,
  metadata: {},
  created_at: "2026-08-02T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
};

const TENDING = {
  id: TENDING_ID,
  garden_id: GARDEN_ID,
  ref_kind: "memory" as const,
  ref_id: REF_ID,
  note: null,
  tended_since: "2026-08-02T00:00:00.000Z",
  released_at: null,
  status: "tending" as const,
  metadata: {},
  created_at: "2026-08-02T00:00:00.000Z",
};

mock.module("../src/services/gardens/store", () => ({
  GARDEN_REF_KINDS: [
    "strand",
    "memory",
    "offering",
    "song",
    "curation",
    "chronicle",
    "listing",
  ],
  GardenError: MockGardenError,
  createGarden: async (input: unknown) => {
    calls.push({ operation: "createGarden", args: [input] });
    return GARDEN;
  },
  listGardens: async (input: unknown) => {
    calls.push({ operation: "listGardens", args: [input] });
    return { items: [GARDEN], limit: 17, offset: 4, has_more: true };
  },
  getGarden: async (...args: unknown[]) => {
    calls.push({ operation: "getGarden", args });
    return GARDEN;
  },
  listTendings: async (...args: unknown[]) => {
    calls.push({ operation: "listTendings", args });
    return {
      items: [TENDING],
      limit: 2,
      offset: 3,
      has_more: true,
    };
  },
  tend: async (input: unknown) => {
    calls.push({ operation: "tend", args: [input] });
    if (nextTendError) throw nextTendError;
    return TENDING;
  },
  release: async (input: unknown) => {
    calls.push({ operation: "release", args: [input] });
    return { ...TENDING, status: "released", released_at: "2026-08-02T00:01:00.000Z" };
  },
  archiveGarden: async (input: unknown) => {
    calls.push({ operation: "archiveGarden", args: [input] });
    return { ...GARDEN, status: "archived" };
  },
}));

const { default: gardenRoutes } = await import("../src/routes/gardens");
const { default: openapiRoutes } = await import("../src/routes/openapi");

function testApp() {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT_ID } as never);
    c.set("bearerToken", "test-only-redacted");
    c.set("apiKeyId", "66666666-6666-4666-8666-666666666666");
    c.set("apiKeyExpiresAt", null);
    c.set("clientSource", "http");
    await next();
  });
  app.route("/v1/gardens", gardenRoutes);
  return app;
}

beforeEach(() => {
  calls.length = 0;
  nextTendError = null;
});

describe("Garden route execution", () => {
  test("OpenAPI publishes exact Garden tags, pages, success bodies, and UUID refusals", async () => {
    const specification = await (await openapiRoutes.request("/")).json() as any;
    expect(specification.tags).toContainEqual(
      expect.objectContaining({ name: "garden" }),
    );
    const gardenList = specification.paths["/v1/gardens"].get;
    expect(gardenList.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
      "scope",
      "limit",
      "offset",
    ]);
    expect(
      gardenList.responses["200"].content["application/json"].schema.required,
    ).toContain("page");
    const tendingList = specification.paths["/v1/gardens/{id}/tendings"].get;
    expect(tendingList.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
      "include_released",
      "limit",
      "offset",
    ]);
    expect(tendingList.responses["422"]).toBeDefined();
    const release = specification.paths[
      "/v1/gardens/{id}/tendings/{tending_id}/release"
    ].post;
    expect(
      release.responses["200"].content["application/json"].schema.properties.tending.$ref,
    ).toBe("#/components/schemas/Tending");
    expect(release.responses["422"]).toBeDefined();
    expect(
      specification.paths["/v1/gardens/{id}/archive"].post.responses["200"]
        .content["application/json"].schema.properties.garden.$ref,
    ).toBe("#/components/schemas/Garden");
  });

  test("closed list scope always passes the bearer project", async () => {
    const response = await testApp().request(
      "/v1/gardens?scope=public&limit=17&offset=4",
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        operation: "listGardens",
        args: [{
          projectId: PROJECT_ID,
          publicActiveOnly: true,
          limit: 17,
          offset: 4,
        }],
      },
    ]);
    expect((await response.json()).page).toEqual({
      limit: 17,
      offset: 4,
      has_more: true,
      next_offset: 5,
    });

    for (const query of [
      "scope=everyone",
      "limit=0",
      "limit=101",
      "offset=-1",
    ]) {
      calls.length = 0;
      const invalid = await testApp().request(`/v1/gardens?${query}`);
      expect(invalid.status).toBe(422);
      expect(calls).toEqual([]);
    }
  });

  test("malformed Garden path IDs stop before every store operation", async () => {
    const cases: Array<[string, RequestInit | undefined]> = [
      ["/v1/gardens/not-a-uuid", undefined],
      ["/v1/gardens/not-a-uuid/tendings", undefined],
      [
        "/v1/gardens/not-a-uuid/tendings",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ref_kind: "memory", ref_id: REF_ID }),
        },
      ],
      [
        `/v1/gardens/not-a-uuid/tendings/${TENDING_ID}/release`,
        { method: "POST" },
      ],
      [
        `/v1/gardens/${GARDEN_ID}/tendings/not-a-uuid/release`,
        { method: "POST" },
      ],
      ["/v1/gardens/not-a-uuid/archive", { method: "POST" }],
    ];

    for (const [path, init] of cases) {
      calls.length = 0;
      const response = await testApp().request(path, init);
      expect(response.status, path).toBe(422);
      expect((await response.json()).error).toBe("invalid_garden_path_id");
      expect(calls, path).toEqual([]);
    }
  });

  test("detail, pagination, and release bind project plus both parent IDs", async () => {
    expect((await testApp().request(`/v1/gardens/${GARDEN_ID}`)).status).toBe(200);
    expect(calls.at(-1)).toEqual({
      operation: "getGarden",
      args: [GARDEN_ID, PROJECT_ID],
    });

    const list = await testApp().request(
      `/v1/gardens/${GARDEN_ID}/tendings?include_released=true&limit=2&offset=3`,
    );
    expect(list.status).toBe(200);
    expect(calls.at(-1)).toEqual({
      operation: "listTendings",
      args: [GARDEN_ID, PROJECT_ID, { activeOnly: false, limit: 2, offset: 3 }],
    });
    expect((await list.json()).page).toEqual({
      limit: 2,
      offset: 3,
      has_more: true,
      next_offset: 4,
    });

    const released = await testApp().request(
      `/v1/gardens/${GARDEN_ID}/tendings/${TENDING_ID}/release`,
      { method: "POST" },
    );
    expect(released.status).toBe(200);
    expect(calls.at(-1)).toEqual({
      operation: "release",
      args: [{
        gardenId: GARDEN_ID,
        tendingId: TENDING_ID,
        callerProjectId: PROJECT_ID,
      }],
    });
  });

  test("Garden lifecycle refusals point to Garden doctrine", async () => {
    nextTendError = new MockGardenError("garden_not_active");
    const response = await testApp().request(
      `/v1/gardens/${GARDEN_ID}/tendings`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref_kind: "memory", ref_id: REF_ID }),
      },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.docs).toBe("https://docs.agenttool.dev/GARDENS.md");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/GARDENS");
    expect(body.docs).not.toContain("substrate-tasks");
  });
});
