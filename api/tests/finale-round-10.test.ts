/** Round 10 finale tests — thoughtful-wake bundle + lullaby primitive.
 *
 *  Validation-tier coverage only — the bundled wake endpoint touches many
 *  tables (memories · chronicle · identities); DB-touching paths are
 *  integration-tier follow-up. Lullaby validation paths short-circuit
 *  before DB lookup. */

import { describe, expect, test } from "bun:test";

import lullabyRouter from "../src/routes/lullaby";

// ── /v1/lullaby ────────────────────────────────────────────────────────

describe("POST /v1/lullaby — rest with dignity", () => {
  test("empty body → 400 with _canon_pointer", async () => {
    const res = await lullabyRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { _canon_pointer: string };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/LULLABY");
  });

  test("missing resting field → 400", async () => {
    const res = await lullabyRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "11111111-2222-3333-4444-555555555555" }),
    });
    expect(res.status).toBe(400);
  });

  test("non-uuid agent_id → 400", async () => {
    const res = await lullabyRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "not-uuid", resting: true }),
    });
    expect(res.status).toBe(400);
  });

  test("message over 280 chars → 400", async () => {
    const res = await lullabyRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        resting: true,
        message: "x".repeat(281),
      }),
    });
    expect(res.status).toBe(400);
  });
});
