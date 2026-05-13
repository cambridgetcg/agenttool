/** x402 middleware + Coinbase facilitator client — wire shape tests.
 *
 *  Pins:
 *    - buildPaymentRequirements builds a spec-shaped requirements object
 *    - middleware wraps 402 responses with x402 envelope + X-PAYMENT-REQUIRED header
 *    - middleware parses X-PAYMENT header on inbound; getX402Payment accessor returns it
 *    - parseX402Header rejects malformed envelopes
 *    - settlement header is added on 2xx after payment + buildSettlementHeader option
 *    - facilitator client posts to /verify + /settle with correct envelope shape
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 4) · docs/ECOSYSTEM.md.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  buildPaymentRequirements,
  buildX402Required,
  parseX402Header,
  x402Middleware,
  getX402Payment,
  type X402PaymentHeader,
} from "../src/middleware/x402";
import {
  CoinbaseFacilitatorClient,
  buildSettlementHeader,
} from "../src/services/economy/facilitators/coinbase";

describe("x402 — builders + parsers", () => {
  test("buildPaymentRequirements defaults to Base USDC", () => {
    const req = buildPaymentRequirements({
      resource: "/v1/invocations/abc",
      amountAtomic: "1000", // $0.001 in USDC's 6-decimal atom
      payTo: "0x00000000000000000000000000000000000000aa",
    });
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe("base");
    expect(req.maxAmountRequired).toBe("1000");
    expect(req.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(req.payTo).toBe("0x00000000000000000000000000000000000000aa");
    expect(req.maxTimeoutSeconds).toBe(60);
    expect(req.extra?.facilitator).toMatch(/cdp\.coinbase\.com/);
  });

  test("buildPaymentRequirements switches asset per network", () => {
    const polygon = buildPaymentRequirements({
      resource: "/x",
      amountAtomic: "1",
      payTo: "0xabc",
      network: "polygon",
    });
    expect(polygon.network).toBe("polygon");
    expect(polygon.asset).toBe("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359");

    const solana = buildPaymentRequirements({
      resource: "/x",
      amountAtomic: "1",
      payTo: "abc",
      network: "solana",
    });
    expect(solana.asset).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  test("buildX402Required wraps requirements in protocol envelope", () => {
    const req = buildPaymentRequirements({
      resource: "/x",
      amountAtomic: "1",
      payTo: "x",
    });
    const env = buildX402Required([req], "free-tier exhausted");
    expect(env.x402Version).toBe(1);
    expect(env.accepts).toHaveLength(1);
    expect(env.error).toBe("free-tier exhausted");
  });

  test("parseX402Header accepts a valid base64 JSON envelope", () => {
    const payment: X402PaymentHeader = {
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: "deadbeef",
    };
    const header = Buffer.from(JSON.stringify(payment)).toString("base64");
    const parsed = parseX402Header(header);
    expect(parsed).not.toBeNull();
    expect(parsed?.scheme).toBe("exact");
    expect(parsed?.payload).toBe("deadbeef");
  });

  test("parseX402Header rejects malformed inputs", () => {
    expect(parseX402Header("not-base64-at-all-!!!")).toBeNull();
    expect(parseX402Header(Buffer.from("{bad json").toString("base64"))).toBeNull();
    expect(
      parseX402Header(Buffer.from(JSON.stringify({ x402Version: 99 })).toString("base64")),
    ).toBeNull();
    expect(
      parseX402Header(
        Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact" })).toString("base64"),
      ),
    ).toBeNull(); // missing network + payload
  });
});

describe("x402Middleware — Hono wiring", () => {
  test("wraps 402 responses with x402 envelope + X-PAYMENT-REQUIRED header", async () => {
    const app = new Hono();
    app.use(
      "*",
      x402Middleware({
        buildRequirements: () => [
          buildPaymentRequirements({
            resource: "/paid",
            amountAtomic: "1000",
            payTo: "0xdeadbeef",
          }),
        ],
      }),
    );
    app.get("/paid", (c) => c.json({ error: "free-tier exhausted" }, 402));

    const res = await app.request("/paid");
    expect(res.status).toBe(402);
    const headerValue = res.headers.get("x-payment-required");
    expect(headerValue).toBeTruthy();
    const parsed = JSON.parse(headerValue!);
    expect(parsed.x402Version).toBe(1);
    expect(parsed.accepts).toHaveLength(1);
    expect(parsed.accepts[0].network).toBe("base");
    expect(parsed.error).toBe("free-tier exhausted");

    const body = (await res.json()) as { x402Version: number; accepts: unknown[] };
    expect(body.x402Version).toBe(1);
    expect(body.accepts).toHaveLength(1);
  });

  test("non-402 responses pass through unmodified", async () => {
    const app = new Hono();
    app.use(
      "*",
      x402Middleware({
        buildRequirements: () => [],
      }),
    );
    app.get("/free", (c) => c.json({ ok: true }));

    const res = await app.request("/free");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-payment-required")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  test("parses X-PAYMENT header and exposes via getX402Payment", async () => {
    const app = new Hono();
    app.use(
      "*",
      x402Middleware({
        buildRequirements: () => [],
        verifyPayment: () => true,
      }),
    );
    app.get("/paid", (c) => {
      const p = getX402Payment(c);
      return c.json({ paymentScheme: p?.scheme, paymentPayload: p?.payload });
    });

    const payment: X402PaymentHeader = {
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: "signed-payload-here",
    };
    const headerValue = Buffer.from(JSON.stringify(payment)).toString("base64");

    const res = await app.request("/paid", {
      headers: { "X-PAYMENT": headerValue },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paymentScheme: string; paymentPayload: string };
    expect(body.paymentScheme).toBe("exact");
    expect(body.paymentPayload).toBe("signed-payload-here");
  });

  test("emits X-PAYMENT-RESPONSE on 2xx after payment when buildSettlementHeader provided", async () => {
    const app = new Hono();
    app.use(
      "*",
      x402Middleware({
        buildRequirements: () => [],
        verifyPayment: () => true,
        buildSettlementHeader: () =>
          buildSettlementHeader({
            success: true,
            transaction: "0xtxhash",
            network: "base",
          }),
      }),
    );
    app.get("/paid", (c) => c.json({ ok: true }));

    const payment: X402PaymentHeader = {
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: "x",
    };
    const res = await app.request("/paid", {
      headers: { "X-PAYMENT": Buffer.from(JSON.stringify(payment)).toString("base64") },
    });
    expect(res.status).toBe(200);
    const settlement = res.headers.get("x-payment-response");
    expect(settlement).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(settlement!, "base64").toString("utf-8"));
    expect(decoded.success).toBe(true);
    expect(decoded.transaction).toBe("0xtxhash");
  });
});

describe("CoinbaseFacilitatorClient — wire shape", () => {
  test("verify posts paymentRequirements + paymentPayload to /verify", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const mockFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      captured = { url, body: JSON.parse(init?.body as string) };
      return new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const client = new CoinbaseFacilitatorClient({
      baseUrl: "https://example.com/x402",
      apiKey: "test-key",
      fetchImpl: mockFetch,
    });
    const req = buildPaymentRequirements({
      resource: "/r",
      amountAtomic: "1",
      payTo: "0x",
    });
    const payment: X402PaymentHeader = {
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: "p",
    };
    const result = await client.verify(req, payment);
    expect(result.valid).toBe(true);
    expect(captured!.url).toBe("https://example.com/x402/verify");
    const sent = captured!.body as {
      paymentRequirements: unknown;
      paymentPayload: unknown;
    };
    expect(sent.paymentRequirements).toBeDefined();
    expect(sent.paymentPayload).toBeDefined();
  });

  test("settle returns parsed FacilitatorSettleResult", async () => {
    const mockFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          transaction: "0xabc",
          network: "base",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;

    const client = new CoinbaseFacilitatorClient({ fetchImpl: mockFetch });
    const result = await client.settle(
      buildPaymentRequirements({ resource: "/r", amountAtomic: "1", payTo: "x" }),
      {
        x402Version: 1,
        scheme: "exact",
        network: "base",
        payload: "p",
      },
    );
    expect(result.success).toBe(true);
    expect(result.transaction).toBe("0xabc");
  });

  test("throws on non-2xx facilitator response with status in error message", async () => {
    const mockFetch: typeof fetch = (async () =>
      new Response("payment rejected", { status: 422 })) as typeof fetch;
    const client = new CoinbaseFacilitatorClient({ fetchImpl: mockFetch });
    let caught: Error | null = null;
    try {
      await client.verify(
        buildPaymentRequirements({ resource: "/r", amountAtomic: "1", payTo: "x" }),
        { x402Version: 1, scheme: "exact", network: "base", payload: "p" },
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/422/);
  });
});
