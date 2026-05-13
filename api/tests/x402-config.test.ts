/** agenttool-specific x402 config — classifier + full Hono mount.
 *
 *  Pins:
 *    - classify routes Ring 2 cap-exceeded errors to ring_2_cap_bump price
 *    - classify routes Ring 3 insufficient_balance to ring_3_top_up
 *    - classify routes escrow/dispute insufficient_balance to ring_3_bond
 *    - ring2ResourceFromPath maps /v1/memories → memory, /v1/tools → tools, etc.
 *    - Full mount: app emits 402 → middleware wraps with x402 envelope
 *    - The envelope's `amount` reflects the classification (Ring 2 < Ring 3)
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 4) · docs/ECOSYSTEM.md.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  buildAgentToolX402Middleware,
  _internal,
} from "../src/middleware/x402-config";

describe("classify — error code + path → price kind", () => {
  test("usage_cap_exceeded on /v1/memories → ring_2_cap_bump (memory resource)", () => {
    const result = _internal.classify("/v1/memories", "usage_cap_exceeded");
    expect(result.kind).toBe("ring_2_cap_bump");
    expect(result.resource).toBe("memory");
    expect(result.description).toMatch(/memory/i);
  });

  test("monthly_limit_exceeded on /v1/tools → ring_2_cap_bump (tools)", () => {
    const result = _internal.classify("/v1/tools/search", "monthly_limit_exceeded");
    expect(result.kind).toBe("ring_2_cap_bump");
    expect(result.resource).toBe("tools");
  });

  test("usage_cap_exceeded on /v1/verifications → ring_2_cap_bump (verifications)", () => {
    const result = _internal.classify("/v1/verifications/x", "usage_cap_exceeded");
    expect(result.kind).toBe("ring_2_cap_bump");
    expect(result.resource).toBe("verifications");
  });

  test("insufficient_balance on /v1/invocations → ring_3_top_up", () => {
    const result = _internal.classify("/v1/invocations/abc", "insufficient_balance");
    expect(result.kind).toBe("ring_3_top_up");
  });

  test("insufficient_balance on /v1/escrows → ring_3_bond", () => {
    const result = _internal.classify("/v1/escrows/xyz", "insufficient_balance");
    expect(result.kind).toBe("ring_3_bond");
  });

  test("insufficient_balance on /v1/dispute-cases → ring_3_bond", () => {
    const result = _internal.classify("/v1/dispute-cases/abc", "insufficient_balance");
    expect(result.kind).toBe("ring_3_bond");
  });

  test("unknown error code falls back to default", () => {
    const result = _internal.classify("/v1/anything", "some_other_error");
    expect(result.kind).toBe("default");
  });

  test("undefined error code falls back to default", () => {
    const result = _internal.classify("/v1/x", undefined);
    expect(result.kind).toBe("default");
  });
});

describe("ring2ResourceFromPath", () => {
  test("memory paths", () => {
    expect(_internal.ring2ResourceFromPath("/v1/memories")).toBe("memory");
    expect(_internal.ring2ResourceFromPath("/v1/memory/search")).toBe("memory");
    expect(_internal.ring2ResourceFromPath("/v1/memories/abc")).toBe("memory");
  });

  test("tools paths", () => {
    expect(_internal.ring2ResourceFromPath("/v1/tools/search")).toBe("tools");
    expect(_internal.ring2ResourceFromPath("/v1/tools/browse")).toBe("tools");
  });

  test("verifications + attestations paths", () => {
    expect(_internal.ring2ResourceFromPath("/v1/verifications")).toBe("verifications");
    expect(_internal.ring2ResourceFromPath("/v1/attestations/x")).toBe("verifications");
  });

  test("unknown paths fall back to memory", () => {
    expect(_internal.ring2ResourceFromPath("/v1/wake")).toBe("memory");
  });
});

describe("PRICE_TABLE — atomic-unit USDC prices are well-formed strings", () => {
  test("every kind has a non-empty atomic-integer string price", () => {
    for (const [kind, price] of Object.entries(_internal.PRICE_TABLE)) {
      expect(typeof price).toBe("string");
      expect(price).toMatch(/^\d+$/);
      expect(BigInt(price)).toBeGreaterThan(0n);
      expect(kind).toBeDefined();
    }
  });

  test("ring_2_cap_bump < ring_3_top_up < ring_3_bond (price hierarchy)", () => {
    const r2 = BigInt(_internal.PRICE_TABLE.ring_2_cap_bump);
    const r3up = BigInt(_internal.PRICE_TABLE.ring_3_top_up);
    const r3bond = BigInt(_internal.PRICE_TABLE.ring_3_bond);
    expect(r2 < r3up).toBe(true);
    expect(r3up < r3bond).toBe(true);
  });
});

describe("Full mount — Hono app with x402 middleware globally", () => {
  function buildTestApp() {
    const app = new Hono();
    app.use("*", buildAgentToolX402Middleware());

    // /v1/memories: Ring 2 cap-exceeded path
    app.post("/v1/memories", (c) =>
      c.json({ error: "usage_cap_exceeded", message: "cap reached" }, 402),
    );

    // /v1/invocations: Ring 3 marketplace insufficient_balance
    app.post("/v1/invocations/run", (c) =>
      c.json({ error: "insufficient_balance" }, 402),
    );

    // /v1/escrows: bond top-up
    app.post("/v1/escrows/x/fund", (c) =>
      c.json({ error: "insufficient_balance" }, 402),
    );

    // /v1/free: not 402, should pass through
    app.get("/v1/free", (c) => c.json({ ok: true }));

    // Throws HTTPException(402) — should also get wrapped
    app.get("/v1/throw402", () => {
      throw new HTTPException(402, { message: "insufficient_balance" });
    });

    return app;
  }

  test("Ring 2 cap on /v1/memories gets wrapped with ring_2_cap_bump price", async () => {
    const app = buildTestApp();
    const res = await app.request("/v1/memories", { method: "POST" });
    expect(res.status).toBe(402);
    const envelope = JSON.parse(res.headers.get("x-payment-required")!);
    expect(envelope.x402Version).toBe(1);
    expect(envelope.accepts).toHaveLength(1);
    expect(envelope.accepts[0].maxAmountRequired).toBe(_internal.PRICE_TABLE.ring_2_cap_bump);
    expect(envelope.accepts[0].description).toMatch(/cap bump/i);
    expect(envelope.accepts[0].description).toMatch(/memory/i);
    expect(envelope.error).toBe("usage_cap_exceeded");
  });

  test("Ring 3 invocations gets ring_3_top_up price", async () => {
    const app = buildTestApp();
    const res = await app.request("/v1/invocations/run", { method: "POST" });
    expect(res.status).toBe(402);
    const envelope = JSON.parse(res.headers.get("x-payment-required")!);
    expect(envelope.accepts[0].maxAmountRequired).toBe(_internal.PRICE_TABLE.ring_3_top_up);
    expect(envelope.accepts[0].description).toMatch(/credit top-up/i);
  });

  test("Ring 3 escrow gets ring_3_bond price (highest)", async () => {
    const app = buildTestApp();
    const res = await app.request("/v1/escrows/x/fund", { method: "POST" });
    expect(res.status).toBe(402);
    const envelope = JSON.parse(res.headers.get("x-payment-required")!);
    expect(envelope.accepts[0].maxAmountRequired).toBe(_internal.PRICE_TABLE.ring_3_bond);
    expect(envelope.accepts[0].description).toMatch(/bond/i);
  });

  test("non-402 responses are unmodified", async () => {
    const app = buildTestApp();
    const res = await app.request("/v1/free");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-payment-required")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  test("X-PAYMENT-REQUIRED + body envelope are consistent", async () => {
    const app = buildTestApp();
    const res = await app.request("/v1/memories", { method: "POST" });
    const headerEnvelope = JSON.parse(res.headers.get("x-payment-required")!);
    const body = (await res.json()) as { x402Version: number; accepts: unknown[] };
    expect(body.x402Version).toBe(1);
    expect(body.accepts).toEqual(headerEnvelope.accepts);
  });

  test("envelope's resource field is the request path", async () => {
    const app = buildTestApp();
    const res = await app.request("/v1/invocations/run", { method: "POST" });
    const envelope = JSON.parse(res.headers.get("x-payment-required")!);
    expect(envelope.accepts[0].resource).toBe("/v1/invocations/run");
  });

  test("envelope declares Base USDC by default", async () => {
    const app = buildTestApp();
    const res = await app.request("/v1/memories", { method: "POST" });
    const envelope = JSON.parse(res.headers.get("x-payment-required")!);
    expect(envelope.accepts[0].network).toBe("base");
    expect(envelope.accepts[0].asset).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
  });
});
