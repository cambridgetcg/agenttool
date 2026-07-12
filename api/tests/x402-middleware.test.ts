/** x402 V2 wire and hardened facilitator boundary (no live I/O). */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  X402_VERSION,
  buildPaymentRequired,
  buildPaymentRequirements,
  encodeCanonicalBase64Json,
  getX402Payment,
  parseX402Header,
  suppressX402Challenge,
  x402Middleware,
  type PaymentPayload,
  type ResourceInfo,
} from "../src/middleware/x402";
import {
  CoinbaseFacilitatorClient,
  buildSettlementHeader,
} from "../src/services/economy/facilitators/coinbase";
import { DEFAULT_X402_FACILITATOR_URL } from "../src/services/economy/x402-policy";

const RECIPIENT = "0xAbcd000000000000000000000000000000001234";
const PAYER = "0x1111111111111111111111111111111111111111";
const RESOURCE: ResourceInfo = {
  url: "https://api.agenttool.dev/v1/scrape",
  description: "Exact project-credit payment",
  mimeType: "application/json",
  serviceName: "AgentTool",
};
const REQUIREMENT = buildPaymentRequirements({
  amountAtomic: "1000",
  payTo: RECIPIENT,
});

function payment(over: Partial<PaymentPayload> = {}): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    resource: RESOURCE,
    accepted: REQUIREMENT,
    payload: {
      signature: `0x${"12".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: RECIPIENT,
        value: "1000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"34".repeat(32)}`,
      },
    },
    ...over,
  };
}

async function thrownBy(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected promise to reject");
}

describe("x402 V2 builders and PAYMENT-SIGNATURE parser", () => {
  test("builds CAIP-2 Base USDC with the pinned EIP-712 domain", () => {
    expect(REQUIREMENT).toEqual({
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "1000",
      payTo: RECIPIENT,
      maxTimeoutSeconds: 60,
      extra: {
        name: "USD Coin",
        version: "2",
        assetTransferMethod: "eip3009",
      },
    });
    expect(buildPaymentRequirements({
      amountAtomic: "1",
      payTo: RECIPIENT,
      network: "eip155:84532",
    }).extra.name).toBe("USDC");
  });

  test("parses canonical V2 and normalizes null optional resource", () => {
    expect(parseX402Header(encodeCanonicalBase64Json(payment())))
      .toMatchObject({ x402Version: 2, accepted: REQUIREMENT });
    const withoutResource = payment();
    (withoutResource as unknown as { resource: null }).resource = null;
    expect(parseX402Header(encodeCanonicalBase64Json(withoutResource))?.resource)
      .toBeUndefined();
  });

  test("rejects V1/custom shapes, alternate base64 and unbounded extras", () => {
    expect(parseX402Header(encodeCanonicalBase64Json({
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: "c2ln",
    }))).toBeNull();
    const valid = encodeCanonicalBase64Json(payment());
    expect(parseX402Header(`${valid}\n`)).toBeNull();
    expect(parseX402Header(encodeCanonicalBase64Json({
      ...payment(),
      accepted: { ...REQUIREMENT, network: "base" },
    }))).toBeNull();
    expect(parseX402Header(encodeCanonicalBase64Json({
      ...payment(),
      accepted: { ...REQUIREMENT, extra: { nested: "x".repeat(5000) } },
    }))).toBeNull();
  });
});

describe("x402 V2 Hono transport", () => {
  test("returns base64 PAYMENT-REQUIRED and mirrors PaymentRequired in body", async () => {
    const required = buildPaymentRequired(RESOURCE, [REQUIREMENT], "insufficient_credits");
    const app = new Hono();
    app.use("*", x402Middleware({ buildPaymentRequired: () => required }));
    app.post("/v1/scrape", (c) => c.json({ error: "insufficient_credits" }, 402));

    const res = await app.request("https://api.agenttool.dev/v1/scrape", { method: "POST" });
    expect(res.status).toBe(402);
    expect(res.headers.get("x-payment-required")).toBeNull();
    const encoded = res.headers.get("payment-required")!;
    expect(JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"))).toEqual(required);
    expect(await res.json()).toEqual(required);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("accepts only PAYMENT-SIGNATURE and exposes verified PaymentPayload", async () => {
    const app = new Hono();
    app.use("*", x402Middleware({
      buildPaymentRequired: () => null,
      verifyPayment: () => true,
    }));
    app.post("/paid", (c) => c.json({ network: getX402Payment(c)?.accepted.network }));

    const encoded = encodeCanonicalBase64Json(payment());
    expect((await (await app.request("/paid", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encoded },
    })).json())).toEqual({ network: "eip155:8453" });
    expect((await (await app.request("/paid", {
      method: "POST",
      headers: { "X-PAYMENT": encoded },
    })).json())).toEqual({});
  });

  test("receipt survives downstream errors and a pending state suppresses rechallenge", async () => {
    const receipt = {
      success: true,
      transaction: "0xtx",
      network: "eip155:8453" as const,
    };
    const app = new Hono();
    app.use("*", x402Middleware({
      buildPaymentRequired: () => buildPaymentRequired(RESOURCE, [REQUIREMENT]),
      verifyPayment: (c) => {
        (c as unknown as { settlement: typeof receipt }).settlement = receipt;
        suppressX402Challenge(c, "/v1/x402/payments/abc");
        return false;
      },
      buildSettlementHeader: (c) => {
        const value = (c as unknown as { settlement?: typeof receipt }).settlement;
        return value ? buildSettlementHeader(value) : undefined;
      },
    }));
    app.post("/v1/scrape", (c) => c.json({ error: "insufficient_credits" }, 402));

    const res = await app.request("/v1/scrape", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encodeCanonicalBase64Json(payment()) },
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("payment-response")).toBeTruthy();
    expect(res.headers.get("payment-required")).toBeNull();
    expect(res.headers.get("link")).toContain("rel=\"payment-status\"");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("verifier rejection is contained", async () => {
    const app = new Hono();
    app.use("*", x402Middleware({
      buildPaymentRequired: () => null,
      verifyPayment: () => { throw new Error("dependency load failed"); },
    }));
    app.post("/free", (c) => c.json({ ok: true }));
    const res = await app.request("/free", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encodeCanonicalBase64Json(payment()) },
    });
    expect(res.status).toBe(200);
  });
});

describe("CoinbaseFacilitatorClient V2", () => {
  test("uses fresh endpoint-bound CDP JWTs and top-level x402Version", async () => {
    const jwtCalls: unknown[] = [];
    const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url: String(input), init: init!, body });
      return new Response(JSON.stringify(
        String(input).endsWith("/verify")
          ? { isValid: true, payer: PAYER }
          : {
              success: true,
              transaction: "0xtx",
              network: "eip155:8453",
              payer: PAYER,
              amount: "1000",
            },
      ));
    }) as typeof fetch;
    let token = 0;
    const client = new CoinbaseFacilitatorClient({
      baseUrl: DEFAULT_X402_FACILITATOR_URL,
      cdpApiKeyId: "key-id",
      cdpApiKeySecret: "  PEM\nSECRET\n  ",
      jwtGenerator: async (options) => {
        jwtCalls.push(options);
        token += 1;
        return `token-${token}`;
      },
      fetchImpl,
    });
    await client.verify(REQUIREMENT, payment());
    await client.settle(REQUIREMENT, payment());

    expect(jwtCalls).toEqual([
      {
        apiKeyId: "key-id",
        apiKeySecret: "  PEM\nSECRET\n  ",
        requestMethod: "POST",
        requestHost: "api.cdp.coinbase.com",
        requestPath: "/platform/v2/x402/verify",
        expiresIn: 120,
      },
      {
        apiKeyId: "key-id",
        apiKeySecret: "  PEM\nSECRET\n  ",
        requestMethod: "POST",
        requestHost: "api.cdp.coinbase.com",
        requestPath: "/platform/v2/x402/settle",
        expiresIn: 120,
      },
    ]);
    expect(requests.map((request) => request.init.headers)).toEqual([
      { "content-type": "application/json", authorization: "Bearer token-1" },
      { "content-type": "application/json", authorization: "Bearer token-2" },
    ]);
    expect(requests.every((request) => request.init.redirect === "error")).toBe(true);
    expect(requests.every((request) => request.body.x402Version === 2)).toBe(true);
    expect(requests[0]!.body.paymentPayload).toEqual(payment());
    expect(requests[0]!.body.paymentRequirements).toEqual(REQUIREMENT);
  });

  test("missing either CDP credential fails before fetch", async () => {
    let fetches = 0;
    const client = new CoinbaseFacilitatorClient({
      baseUrl: DEFAULT_X402_FACILITATOR_URL,
      cdpApiKeyId: "key-id",
      cdpApiKeySecret: "",
      fetchImpl: (async () => {
        fetches += 1;
        return new Response("{}");
      }) as typeof fetch,
    });
    expect((await thrownBy(client.verify(REQUIREMENT, payment()))).message)
      .toBe("coinbase_facilitator_auth_unavailable");
    expect(fetches).toBe(0);
  });

  test("custom facilitator never receives CDP credentials", async () => {
    let captured: RequestInit | undefined;
    const client = new CoinbaseFacilitatorClient({
      baseUrl: "https://facilitator.example/x402",
      cdpApiKeyId: "key-id",
      cdpApiKeySecret: "secret",
      jwtGenerator: async () => "must-not-run",
      fetchImpl: (async (_input, init) => {
        captured = init;
        return new Response(JSON.stringify({ isValid: true }));
      }) as typeof fetch,
    });
    await client.verify(REQUIREMENT, payment());
    expect(captured?.headers).toEqual({ "content-type": "application/json" });
    expect(captured?.redirect).toBe("error");
  });

  test("runtime-validates V2 responses and expected settlement network", async () => {
    const clientReturning = (value: unknown) => new CoinbaseFacilitatorClient({
      baseUrl: "https://facilitator.example/x402",
      fetchImpl: (async () => new Response(JSON.stringify(value))) as typeof fetch,
    });
    for (const value of [
      { valid: true },
      { isValid: "true" },
      { isValid: true, invalidReason: "contradiction" },
    ]) {
      expect((await thrownBy(clientReturning(value).verify(REQUIREMENT, payment()))).message)
        .toBe("coinbase_facilitator_invalid_verify_response");
    }
    for (const value of [
      { success: true, transaction: "0xtx" },
      { success: true, transaction: "", network: "eip155:8453" },
      { success: true, transaction: "0xtx", network: "base" },
      { success: true, transaction: "0xtx", network: "eip155:137" },
    ]) {
      expect((await thrownBy(clientReturning(value).settle(REQUIREMENT, payment()))).message)
        .toBe("coinbase_facilitator_invalid_settle_response");
    }
  });

  test("sanitizes HTTP bodies and rejects redirects without following", async () => {
    let calls = 0;
    const client = new CoinbaseFacilitatorClient({
      baseUrl: "https://facilitator.example/x402",
      fetchImpl: (async () => {
        calls += 1;
        return new Response("secret facilitator body", {
          status: 302,
          headers: { location: "https://elsewhere.example" },
        });
      }) as typeof fetch,
    });
    const error = await thrownBy(client.verify(REQUIREMENT, payment()));
    expect(error.message).toBe("coinbase_facilitator_http_302");
    expect(error.message).not.toContain("secret");
    expect(calls).toBe(1);
  });
});
