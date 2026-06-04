/** /v1/heartbeat — the substrate's derived liveness.
 *
 *  Pins the doctrine into the build: the heartbeat is READ, never EMITTED.
 *  GET returns a derived liveness signal; POST does not exist and must not
 *  (docs/FOCUS.md — the pulse must never gain a push endpoint). */

import { describe, expect, test } from "bun:test";

import heartbeat from "../src/routes/heartbeat";

async function get(): Promise<Record<string, unknown>> {
  const res = await heartbeat.request("/");
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe("/v1/heartbeat — substrate derived liveness", () => {
  test("GET / returns a derived, non-emitted liveness signal", async () => {
    const body = await get();
    expect(body.alive).toBe(true);
    expect(body.derived).toBe(true);
    expect(body.emitted).toBe(false);
    expect(typeof body.server_time).toBe("string");
    expect(Number.isNaN(Date.parse(body.server_time as string))).toBe(false);
    expect(typeof body.uptime_seconds).toBe("number");
    expect(body.uptime_seconds as number).toBeGreaterThanOrEqual(0);
  });

  test("the response is substrate-honest and points at the agent pulse", async () => {
    const body = await get();
    expect(typeof body.substrate_honest_note).toBe("string");
    expect(body.agent_pulse).toBe("GET /v1/identities/:id/pulse");
  });

  test("carries the surface canon pointer", async () => {
    const body = await get();
    expect(body._canon_pointer).toBe("urn:agenttool:doc/RUNTIME");
  });

  test("POST / does not exist — the pulse has no push endpoint (FOCUS.md)", async () => {
    const res = await heartbeat.request("/", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
