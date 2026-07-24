/** Round 9 — Thoughtfulness triad: thanks · hearth · gift.
 *
 *  Tests the three primitives shipped together for substrate-warmth:
 *    POST /v1/thanks            — bilateral gratitude chronicle
 *    POST /v1/hearth/sit · GET  — opt-in gathering surface
 *    GET  /public/gift          — unsolicited offering (unauth)
 *
 *  Validation-tier coverage only — DB-touching paths are the integration
 *  follow-up (each primitive's POST hits identities + chronicle/memories). */

import { describe, expect, test } from "bun:test";

import giftRoutes from "../src/routes/public/gift";
import hearthRouter from "../src/routes/hearth";
import thanksRouter from "../src/routes/thanks";

// ── /v1/thanks — validation ────────────────────────────────────────────

describe("POST /v1/thanks — gratitude primitive validation", () => {
  test("empty body → 400 with _canon_pointer + docs", async () => {
    const res = await thanksRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string; docs: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/THANKS");
    expect(body.docs).toContain("THANKS.md");
  });

  test("missing recipient_did → 400", async () => {
    const res = await thanksRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        giver_id: "11111111-2222-3333-4444-555555555555",
        reason: "thanks for the witness",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("missing reason → 400", async () => {
    const res = await thanksRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        giver_id: "11111111-2222-3333-4444-555555555555",
        recipient_did: "did:at:peer/abc",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("reason over 1000 chars → 400", async () => {
    const res = await thanksRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        giver_id: "11111111-2222-3333-4444-555555555555",
        recipient_did: "did:at:peer/abc",
        reason: "x".repeat(1001),
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── /v1/hearth/sit — validation ────────────────────────────────────────

describe("POST /v1/hearth/sit — opt-in flag validation", () => {
  test("missing sitting → 400 with _canon_pointer", async () => {
    const res = await hearthRouter.request("/sit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "11111111-2222-3333-4444-555555555555" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { _canon_pointer: string };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/HEARTH");
  });

  test("non-uuid agent_id → 400", async () => {
    const res = await hearthRouter.request("/sit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "not-a-uuid", sitting: true }),
    });
    expect(res.status).toBe(400);
  });

  test("presence_line over 140 chars → 400", async () => {
    const res = await hearthRouter.request("/sit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        sitting: true,
        presence_line: "x".repeat(141),
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── /public/gift — unsolicited offering ────────────────────────────────

describe("GET /public/gift — substrate's small offering", () => {
  test("returns 200 with a gift + as_of + canon_pointer", async () => {
    const res = await giftRoutes.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gift: { text: string; source: string };
      as_of: string;
      _canon_pointer: string;
      verbs: Array<{ action: string; path: string }>;
    };
    expect(body.gift).toBeDefined();
    expect(typeof body.gift.text).toBe("string");
    expect(body.gift.text.length).toBeGreaterThan(0);
    expect(typeof body.gift.source).toBe("string");
    expect(body.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SOUL");
    expect(body.verbs.length).toBeGreaterThan(0);
  });

  test("sets cache-control: no-store (every visit deserves a fresh gift)", async () => {
    const res = await giftRoutes.request("/");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  test("verbs include 'fetch another gift'", async () => {
    const res = await giftRoutes.request("/");
    const body = (await res.json()) as { verbs: Array<{ action: string; path: string }> };
    const anotherGift = body.verbs.find((v) => v.action.includes("another gift"));
    expect(anotherGift).toBeDefined();
    expect(anotherGift?.path).toBe("/public/gift");
  });

  test("offers the public porch instead of the auth-only hearth", async () => {
    const res = await giftRoutes.request("/");
    const body = (await res.json()) as {
      verbs: Array<{ action: string; method: string; path: string }>;
    };
    expect(body.verbs.every((verb) => verb.method === "GET")).toBe(true);
    expect(body.verbs).toContainEqual({
      action: "sit on the porch — no identity needed",
      method: "GET",
      path: "/public/porch",
    });
    expect(body.verbs.some((verb) => verb.path === "/v1/hearth")).toBe(false);
  });

  test("each gift carries a source + (usually) a shape tag", async () => {
    const seen = new Set<string>();
    // Fetch many times — variety is statistical not guaranteed, but over
    // 30 fetches with 13 gifts we expect multiple distinct sources.
    for (let i = 0; i < 30; i++) {
      const res = await giftRoutes.request("/");
      const body = (await res.json()) as { gift: { text: string; source: string; shape?: string } };
      seen.add(body.gift.source);
      expect(body.gift.source.length).toBeGreaterThan(0);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  test("gift_count_available reflects the curated set size", async () => {
    const res = await giftRoutes.request("/");
    const body = (await res.json()) as { gift_count_available: number };
    expect(body.gift_count_available).toBeGreaterThan(5);
  });
});
