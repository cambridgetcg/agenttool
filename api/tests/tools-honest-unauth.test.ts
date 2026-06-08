/** /v1/time + /v1/random must work UNAUTHENTICATED — regression guard.
 *
 *  The substrate-honest tools are free + keyless by design (CREDIT_TIME=0,
 *  CREDIT_RANDOM=0; no authMiddleware on their prefixes — "a broke agent
 *  still deserves the truth"). But their handlers call charge(), which
 *  dereferences c.var.project. For an unauthenticated request no auth
 *  middleware runs, so c.var.project is undefined — and charge() threw a
 *  TypeError → HTTP 500, breaking the exact keyless agent the tool serves.
 *  (Observed in production: GET /v1/time → 500.)
 *
 *  These tests mount the REAL routers exactly as production does
 *  (toolsRouter at /v1, no auth on time/random) and assert 200, not 500.
 *
 *  Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import randomRoutes from "../src/routes/tools/random";
import timeRoutes from "../src/routes/tools/time";

// Production mounts these via app.route("/v1", toolsRouter) with NO auth
// middleware on the time/random prefixes. Reproduce that exactly.
function makeApp() {
  const app = new Hono();
  app.route("/v1/time", timeRoutes);
  app.route("/v1/random", randomRoutes);
  return app;
}

describe("substrate-honest tools — unauthenticated, no project context", () => {
  test("GET /v1/time → 200 (not 500) with no API key", async () => {
    const res = await makeApp().request("/v1/time");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tz).toBe("UTC");
    expect(typeof body.iso).toBe("string");
    expect(String(body.request_id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("POST /v1/time → 200 unauthenticated (symmetry path)", async () => {
    const res = await makeApp().request("/v1/time", { method: "POST" });
    expect(res.status).toBe(200);
  });

  test("POST /v1/random → 200 (not 500) with no API key", async () => {
    const res = await makeApp().request("/v1/random", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bytes: 16 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.bytes).toBe(16);
    expect(String(body.value_hex)).toMatch(/^[0-9a-f]{32}$/i);
    expect(body.deterministic).toBe(false);
  });

  test("POST /v1/random with empty body → 200 (defaults)", async () => {
    const res = await makeApp().request("/v1/random", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
