/** Pre-auth transport framing for the private observation endpoint. */

import { expect, test } from "bun:test";
import { Hono } from "hono";

import {
  wakeObservationTransportBoundary,
} from "../src/middleware/wake-observation-boundary";
import {
  WAKE_OBSERVATION_MAX_BYTES,
  WAKE_OBSERVATION_MEDIA_TYPE,
} from "../src/services/wake/observe";

process.env.AGENTTOOL_DISABLE_WORKERS = "1";
process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP = "1";
process.env.AGENTOOL_DISABLE_SAGA_SEED = "1";

test("unauthenticated observation is still no-store and mode-labeled", async () => {
  const { _setWallsStatusForTests } = await import(
    "../src/services/wake/walls-status"
  );
  _setWallsStatusForTests({
    intact: true,
    probed_at_unix_ms: Date.now(),
    probes: [],
    declared: [],
  });
  const { app } = await import("../src/index");
  for (const path of [
    "/v1/wake/observe",
    "/v1/wake/observe/",
    "/v1/wake/observe//",
  ]) {
    const response = await app.fetch(
      new Request(
        `https://api.agenttool.dev${path}` +
          "?identity_id=22222222-2222-4222-8222-222222222222",
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Wake-Mode")).toBe("observe");
    expect(response.headers.get("Content-Type")).toBe(
      `${WAKE_OBSERVATION_MEDIA_TYPE}; charset=utf-8`,
    );
    expect(await response.json()).toEqual({
      _format: "wake-observation-error/v1",
      mode: "observe",
      error: "unauthorized",
    });
  }
});

test("every non-200 body is replaced by a fixed non-action error enum", async () => {
  const hostile = "HOSTILE_REMOTE_ERROR_PROSE";
  const cases = [
    [400, "invalid_request"],
    [201, "request_rejected"],
    [203, "request_rejected"],
    [206, "request_rejected"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "subject_not_found"],
    [405, "method_not_allowed"],
    [418, "request_rejected"],
    [429, "rate_limited"],
    [500, "unavailable"],
  ] as const;

  for (const [status, error] of cases) {
    const app = new Hono();
    app.use("*", wakeObservationTransportBoundary());
    app.get("/", () => new Response(
      JSON.stringify({ message: hostile, next_actions: [{ action: hostile }] }),
      {
        status,
        headers: {
          "Content-Type": "application/json",
          ETag: '"hostile"',
        },
      },
    ));

    const response = await app.request("/");
    const text = await response.text();
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Wake-Mode")).toBe("observe");
    expect(response.headers.get("Content-Type")).toBe(
      `${WAKE_OBSERVATION_MEDIA_TYPE}; charset=utf-8`,
    );
    expect(response.headers.get("ETag")).toBeNull();
    expect(text).not.toContain(hostile);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(
      WAKE_OBSERVATION_MAX_BYTES,
    );
    expect(JSON.parse(text)).toEqual({
      _format: "wake-observation-error/v1",
      mode: "observe",
      error,
    });
  }
});

test("bodyless non-200 downstream status becomes a closed unavailable error", async () => {
  const app = new Hono();
  app.use("*", wakeObservationTransportBoundary());
  app.get("/", () => new Response(null, { status: 204 }));

  const response = await app.request("/");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    _format: "wake-observation-error/v1",
    mode: "observe",
    error: "unavailable",
  });
});
