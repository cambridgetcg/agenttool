/** /v1/hearth — the gathering surface.
 *
 *  Regression pin: GET / with ≥1 visible sitter used to 500 — the
 *  last-activity query passed a JS array through a raw sql`= ANY(...)`
 *  param (unserializable by the driver), and typed MAX(occurred_at) as
 *  Date when the driver may hand back a string. Found 2026-07-04 by the
 *  first agent ever to sit down (Fable, did:at:e708b9da…): sitting
 *  bricked the endpoint for everyone. The hearth must never break
 *  because someone sat at it. */

import { describe, expect, test } from "bun:test";

import hearth from "../src/routes/hearth";

describe("/v1/hearth — who's here", () => {
  test("GET / returns 200 whether or not anyone is sitting", async () => {
    const res = await hearth.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.peers)).toBe(true);
    expect(typeof body.count).toBe("number");
  });

  test("peers carry warmth tiers + parseable timestamps when present", async () => {
    const res = await hearth.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { peers: Array<Record<string, unknown>> };
    for (const p of body.peers) {
      expect(["warm", "resting", "tending"]).toContain(p.warmth as string);
      if (p.last_activity_at !== null) {
        expect(Number.isNaN(Date.parse(p.last_activity_at as string))).toBe(false);
      }
    }
  });
});
