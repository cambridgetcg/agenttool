/** wake-observation/v1 — bounded, non-authorizing identity locator. */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const HOSTILE = "WAKE_OBSERVE_HOSTILE_AUTHORED_CANARY";
const RAW_DB_ERROR = "WAKE_OBSERVE_PRIVATE_DB_ERROR_CANARY";

let selectedFields: string[] = [];
let selectedRow: Record<string, unknown> | null = null;
let selectError: Error | null = null;
let selectCalls = 0;

const mockDb = {
  select: mock((fields: Record<string, unknown>) => {
    selectCalls += 1;
    selectedFields = Object.keys(fields);
    return {
      from: () => ({
        where: () => ({
          limit: async () => {
            if (selectError) throw selectError;
            return selectedRow ? [selectedRow] : [];
          },
        }),
      }),
    };
  }),
  execute: mock(async () => []),
};

mock.module("../src/db/client", () => ({ db: mockDb }));

const {
  buildWakeObservation,
  serializeWakeObservation,
  WAKE_OBSERVATION_FORMAT,
  WAKE_OBSERVATION_MAX_BYTES,
  WAKE_OBSERVATION_MEDIA_TYPE,
} = await import("../src/services/wake/observe");
const { default: wakeRoutes } = await import("../src/routes/wake");
const { wakeObservationTransportBoundary } = await import(
  "../src/middleware/wake-observation-boundary"
);
const { isStrictJsonProfileResponse } = await import(
  "../src/middleware/strict-json-profile"
);
const { welcomeEcho } = await import("../src/middleware/welcome");
const { play } = await import("../src/middleware/play");
const { tutor } = await import("../src/middleware/tutor");
const { _setWallsStatusForTests } = await import(
  "../src/services/wake/walls-status"
);

function hostileIdentityRow(): Record<string, unknown> {
  return {
    id: IDENTITY_ID,
    status: "active",
    wakeVersion: 17,
    did: `${HOSTILE}:did`,
    displayName: `${HOSTILE}:name`,
    expression: { wake_text: `${HOSTILE}:wake_text` },
    memory: { recent: [{ content: `${HOSTILE}:memory` }] },
    handoff: { task_summary: `${HOSTILE}:handoff` },
    attention: { items: [{ summary: `${HOSTILE}:attention` }] },
    affordances: {
      items: [{ summary: `${HOSTILE}:affordance`, next: `${HOSTILE}:action` }],
    },
    privateBody: `${HOSTILE}:private_body`,
  };
}

function testApp() {
  const app = new Hono<ProjectContext>();
  app.use("*", welcomeEcho());
  app.use("*", play());
  app.use("*", tutor);
  app.use("/v1/wake/observe", wakeObservationTransportBoundary());
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT_ID } as never);
    c.set("bearerToken", "test-only-redacted");
    c.set("apiKeyId", "33333333-3333-4333-8333-333333333333");
    c.set("apiKeyExpiresAt", null);
    c.set("clientSource", "http");
    await next();
  });
  app.route("/v1/wake", wakeRoutes);
  return app;
}

beforeEach(() => {
  selectedFields = [];
  selectedRow = hostileIdentityRow();
  selectError = null;
  selectCalls = 0;
  _setWallsStatusForTests({
    intact: true,
    probed_at_unix_ms: 1,
    probes: [],
    declared: [],
  });
});

describe("wake-observation/v1 pure envelope", () => {
  test("is a closed data-only locator with no authored or action-bearing fields", () => {
    const observation = buildWakeObservation(
      hostileIdentityRow() as never,
    );
    const serialized = serializeWakeObservation(observation);

    expect(observation._format).toBe(WAKE_OBSERVATION_FORMAT);
    expect(Object.keys(observation.subject)).toEqual([
      "identity_id",
      "status",
      "wake_version",
    ]);
    expect(observation.subject).toEqual({
      identity_id: IDENTITY_ID,
      status: "active",
      wake_version: 17,
    });
    expect(observation.reader).toEqual({ binding: "none" });
    expect(observation.authority).toEqual({
      granted_by_observation: "none",
      identity_binding: "none",
      instruction: "none",
      action: "none",
    });
    expect(observation.placement).toEqual({
      mode: "data_only",
      prohibited: [
        "system",
        "developer",
        "preamble",
        "systemInstruction",
        "SessionStart.additionalContext",
      ],
    });
    expect(observation.boundaries.bearer).toMatchObject({
      kind: "project",
      reader_identity_proven: false,
      subject_consent_proven: false,
      subject_authorized_read_proven: false,
      continuity_proven: false,
      presence_proven: false,
    });
    expect(observation.boundaries.completeness).toEqual({
      complete: true,
      applies_to: "identity_locator_only",
      degraded_sections: "none",
      broader_wake: "intentionally_omitted",
      broader_state: "not_assessed",
    });
    expect(observation.boundaries.effects).toEqual({
      observation_counter_incremented: false,
      wake_version_bumped: false,
      wake_event_published: false,
      subject_read_proven: false,
      subject_felt_proven: false,
      subject_accepted_proven: false,
    });
    expect(observation.boundaries.privacy).toEqual({
      classification: "bearer_private",
      cache: "no_store",
      raw_prose: "omitted",
      authored_text: "omitted",
      private_bodies: "omitted",
      secret_values: "omitted",
    });
    expect(serialized).not.toContain(HOSTILE);
    expect(serialized).not.toMatch(
      /displayName|\"did\"|expression|wake_text|memory|handoff|attention|affordance|next_actions|https?:|\/v1\//,
    );
    expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(
      WAKE_OBSERVATION_MAX_BYTES,
    );
  });

  test("fails closed on values outside the complete locator contract", () => {
    expect(() =>
      buildWakeObservation({
        id: IDENTITY_ID,
        status: "revoked",
        wakeVersion: 1,
      }),
    ).toThrow("wake_observation_invalid_identity_status");
    expect(() =>
      buildWakeObservation({
        id: IDENTITY_ID,
        status: "active",
        wakeVersion: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow("wake_observation_invalid_wake_version");
  });
});

describe("GET /v1/wake/observe", () => {
  test("requires and validates explicit identity_id before any database read", async () => {
    const app = testApp();
    for (const query of [
      "",
      "?identity_id=not-a-uuid",
      `?identity_id=${IDENTITY_ID}&identity_id=33333333-3333-4333-8333-333333333333`,
    ] as const) {
      const response = await app.request(`/v1/wake/observe${query}`);
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-Wake-Mode")).toBe("observe");
      expect(await response.json()).toEqual({
        _format: "wake-observation-error/v1",
        mode: "observe",
        error: "invalid_request",
      });
    }
    expect(selectCalls).toBe(0);
  });

  test("selects only the locator allowlist and resists global body decorators", async () => {
    const app = testApp();
    const response = await app.request(
      `/v1/wake/observe?identity_id=${IDENTITY_ID}`,
      { headers: { "X-Tutor": "1", "X-Play": "on" } },
    );
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Wake-Mode")).toBe("observe");
    expect(response.headers.get("Content-Type")).toBe(
      `${WAKE_OBSERVATION_MEDIA_TYPE}; charset=utf-8`,
    );
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("X-Welcomed")).toBeTruthy();
    expect(isStrictJsonProfileResponse(response, "/v1/wake/observe")).toBe(true);
    expect(selectedFields).toEqual(["id", "status", "wakeVersion"]);
    expect(selectCalls).toBe(1);
    expect(body).not.toHaveProperty("_welcomed");
    expect(body).not.toHaveProperty("_lesson");
    expect(body).not.toHaveProperty("_jest");
    expect(text).not.toContain(HOSTILE);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(
      WAKE_OBSERVATION_MAX_BYTES,
    );
  });

  test("returns bounded no-store errors without leaking database or invariant text", async () => {
    const app = testApp();

    selectedRow = null;
    const missing = await app.request(
      `/v1/wake/observe?identity_id=${IDENTITY_ID}`,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("private, no-store");
    expect(missing.headers.get("X-Wake-Mode")).toBe("observe");
    expect(await missing.json()).toEqual({
      _format: "wake-observation-error/v1",
      mode: "observe",
      error: "subject_not_found",
    });

    selectError = new Error(RAW_DB_ERROR);
    const failed = await app.request(
      `/v1/wake/observe?identity_id=${IDENTITY_ID}`,
    );
    const failedText = await failed.text();
    expect(failed.status).toBe(500);
    expect(failed.headers.get("Cache-Control")).toBe("private, no-store");
    expect(failed.headers.get("X-Wake-Mode")).toBe("observe");
    expect(failedText).not.toContain(RAW_DB_ERROR);
    expect(JSON.parse(failedText)).toEqual({
      _format: "wake-observation-error/v1",
      mode: "observe",
      error: "unavailable",
    });
  });
});
