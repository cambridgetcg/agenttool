/** Production x402 V2 policy/configuration tests (no DB or live network). */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono, type Context } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { buildAgentToolX402Middleware } from "../src/middleware/x402-config";
import {
  encodeCanonicalBase64Json,
  type PaymentPayload,
} from "../src/middleware/x402";
import { x402ConfigurationStatus } from "../src/routes/public/plans";
import { isX402FacilitatorLocallyReady } from "../src/services/economy/facilitators/coinbase";
import {
  DEFAULT_X402_FACILITATOR_URL,
  recoverableX402ProjectCreditPolicy,
  resolveX402Facilitator,
  resolveX402FacilitatorReadiness,
  resolveX402Network,
  resolveX402Recipient,
  x402ProjectCreditPolicy,
} from "../src/services/economy/x402-policy";

const RECIPIENT = "0xAbcd000000000000000000000000000000001234";
const originalEnv = {
  recipient: process.env.AGENTTOOL_X402_RECIPIENT,
  network: process.env.AGENTTOOL_X402_NETWORK,
  facilitator: process.env.AGENTTOOL_X402_FACILITATOR,
  publicBase: process.env.PUBLIC_API_BASE,
  keyId: process.env.CDP_API_KEY_ID,
  keySecret: process.env.CDP_API_KEY_SECRET,
  allowTestnet: process.env.AGENTTOOL_X402_ALLOW_TESTNET,
  x402Environment: process.env.AGENTTOOL_X402_ENVIRONMENT,
  nodeEnv: process.env.NODE_ENV,
  flyAppName: process.env.FLY_APP_NAME,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("AGENTTOOL_X402_RECIPIENT", originalEnv.recipient);
  restore("AGENTTOOL_X402_NETWORK", originalEnv.network);
  restore("AGENTTOOL_X402_FACILITATOR", originalEnv.facilitator);
  restore("PUBLIC_API_BASE", originalEnv.publicBase);
  restore("CDP_API_KEY_ID", originalEnv.keyId);
  restore("CDP_API_KEY_SECRET", originalEnv.keySecret);
  restore("AGENTTOOL_X402_ALLOW_TESTNET", originalEnv.allowTestnet);
  restore("AGENTTOOL_X402_ENVIRONMENT", originalEnv.x402Environment);
  restore("NODE_ENV", originalEnv.nodeEnv);
  restore("FLY_APP_NAME", originalEnv.flyAppName);
});

function projectMiddleware(credits = 0) {
  return async (c: Context<ProjectContext>, next: () => Promise<void>) => {
    c.set("project", {
      id: "11111111-1111-4111-8111-111111111111",
      name: "config-test",
      plan: "credits",
      credits,
      createdAt: new Date(0),
    });
    await next();
  };
}

function configuredApp(
  credits = 0,
  error = "insufficient_credits",
) {
  const app = new Hono<ProjectContext>();
  app.use("*", projectMiddleware(credits));
  app.use("*", buildAgentToolX402Middleware());
  app.post("/v1/scrape", (c) => c.json({ error }, 402));
  app.post("/v1/document", (c) => c.json({ error }, 402));
  app.get("/v1/scrape", (c) => c.json({ error }, 402));
  return app;
}

function configureCustom(): void {
  process.env.AGENTTOOL_X402_RECIPIENT = RECIPIENT;
  process.env.AGENTTOOL_X402_NETWORK = "eip155:8453";
  process.env.AGENTTOOL_X402_FACILITATOR = "https://facilitator.example/x402";
  process.env.PUBLIC_API_BASE = "https://api.agenttool.dev";
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
}

describe("production middleware order", () => {
  test("x402 remains after every auth mount and before handlers/robustness", () => {
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf-8");
    const x402 = source.indexOf('app.use("*", buildAgentToolX402Middleware())');
    const authMounts = [...source.matchAll(/app\.use\([^\n]+authMiddleware\);/gu)];
    expect(authMounts.length).toBeGreaterThan(10);
    expect(x402).toBeGreaterThan(authMounts.at(-1)!.index!);
    expect(source.indexOf("// ── Robustness middleware", x402)).toBeGreaterThan(x402);
  });
});

describe("route, amount, network and facilitator policy", () => {
  test("only exact static POST routes have full-cost atomic policy", () => {
    for (const path of ["/v1/scrape", "/v1/document"] as const) {
      const policy = x402ProjectCreditPolicy(path, "POST")!;
      expect(policy.path).toBe(path);
      expect(BigInt(policy.amountAtomic)).toBe(BigInt(policy.creditsRequired) * 1000n);
      expect(recoverableX402ProjectCreditPolicy(path, "POST", "insufficient_credits"))
        .toEqual(policy);
    }
    expect(x402ProjectCreditPolicy("/v1/scrape/", "POST")).toBeNull();
    expect(x402ProjectCreditPolicy("/v1/scrape", "GET")).toBeNull();
    expect(recoverableX402ProjectCreditPolicy(
      "/v1/scrape", "POST", "insufficient_balance",
    )).toBeNull();
  });

  test("normalizes legacy operator aliases but emits CAIP-2; invalid is fail-closed", () => {
    expect(resolveX402Network()).toMatchObject({
      network: "eip155:8453",
      reason: "absent",
    });
    expect(resolveX402Network("base")).toMatchObject({
      network: "eip155:8453",
      configured: true,
      reason: null,
    });
    expect(resolveX402Network("eip155:137").network).toBe("eip155:137");
    expect(resolveX402Network("eip155:84532", false).reason).toBe("invalid");
    expect(resolveX402Network("eip155:84532", true)).toMatchObject({
      network: "eip155:84532",
      configured: true,
      reason: null,
    });
    expect(resolveX402Network("solana")).toMatchObject({
      network: "eip155:8453",
      configured: false,
      reason: "invalid",
    });
  });

  test("recipient accepts lowercase or valid checksum and rejects malformed mixed case", () => {
    expect(resolveX402Recipient(RECIPIENT)).toMatchObject({
      recipient: RECIPIENT,
      reason: null,
    });
    expect(resolveX402Recipient(
      "0xAbCd000000000000000000000000000000001234",
    )).toMatchObject({ recipient: null, reason: "invalid" });
  });

  test("Base Sepolia needs explicit test mode and is always blocked in production/Fly", () => {
    process.env.AGENTTOOL_X402_ALLOW_TESTNET = "1";
    process.env.AGENTTOOL_X402_ENVIRONMENT = "test";
    process.env.NODE_ENV = "production";
    delete process.env.FLY_APP_NAME;
    expect(resolveX402Network("eip155:84532").reason).toBe("invalid");

    process.env.NODE_ENV = "test";
    process.env.FLY_APP_NAME = "agenttool-live";
    expect(resolveX402Network("eip155:84532").reason).toBe("invalid");

    delete process.env.FLY_APP_NAME;
    expect(resolveX402Network("eip155:84532")).toMatchObject({
      configured: true,
      reason: null,
    });
  });

  test("uses exact official CDP default and never treats invalid explicit config as ready", () => {
    expect(resolveX402Facilitator("")).toEqual({
      url: DEFAULT_X402_FACILITATOR_URL,
      configured: false,
      source: "default",
      reason: "absent",
    });
    expect(DEFAULT_X402_FACILITATOR_URL)
      .toBe("https://api.cdp.coinbase.com/platform/v2/x402");
    expect(resolveX402FacilitatorReadiness("http://127.0.0.1/x402", "id", "secret"))
      .toMatchObject({ ready: false, authentication: "invalid_configuration" });
  });

  test("local CDP readiness actually generates an exact endpoint-bound JWT", async () => {
    const calls: unknown[] = [];
    expect(await isX402FacilitatorLocallyReady({
      baseUrl: DEFAULT_X402_FACILITATOR_URL,
      cdpApiKeyId: "id",
      cdpApiKeySecret: " untrimmed-secret ",
      jwtGenerator: async (options) => {
        calls.push(options);
        return "jwt";
      },
    })).toBe(true);
    expect(calls).toEqual([{
      apiKeyId: "id",
      apiKeySecret: " untrimmed-secret ",
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/x402/verify",
      expiresIn: 120,
    }]);
    expect(await isX402FacilitatorLocallyReady({
      baseUrl: DEFAULT_X402_FACILITATOR_URL,
      cdpApiKeyId: "id",
      cdpApiKeySecret: "bad",
      jwtGenerator: async () => { throw new Error("invalid key"); },
    })).toBe(false);
  });
});

describe("production challenge eligibility", () => {
  test("custom explicit facilitator emits official V2 challenge for both eligible routes", async () => {
    configureCustom();
    const app = configuredApp();
    for (const path of ["/v1/scrape", "/v1/document"] as const) {
      const res = await app.request(`https://api.agenttool.dev${path}`, { method: "POST" });
      expect(res.status).toBe(402);
      expect(res.headers.get("x-payment-required")).toBeNull();
      const required = JSON.parse(Buffer.from(
        res.headers.get("payment-required")!, "base64",
      ).toString("utf-8"));
      expect(required.x402Version).toBe(2);
      expect(required.resource.url).toBe(`https://api.agenttool.dev${path}`);
      expect(required.accepts[0]).toMatchObject({
        scheme: "exact",
        network: "eip155:8453",
        amount: x402ProjectCreditPolicy(path, "POST")!.amountAtomic,
        extra: {
          name: "USD Coin",
          version: "2",
          assetTransferMethod: "eip3009",
        },
      });
      expect(required.accepts[0].extra.facilitator).toBeUndefined();
    }
  });

  test("wallet errors, wrong methods, funded projects and invalid config never become payable", async () => {
    configureCustom();
    const cases = [
      configuredApp(0, "insufficient_balance").request(
        "https://api.agenttool.dev/v1/scrape", { method: "POST" },
      ),
      configuredApp().request("https://api.agenttool.dev/v1/scrape"),
      configuredApp(x402ProjectCreditPolicy("/v1/scrape", "POST")!.creditsRequired)
        .request("https://api.agenttool.dev/v1/scrape", { method: "POST" }),
    ];
    for (const result of cases) {
      const res = await result;
      expect(res.headers.get("payment-required")).toBeNull();
    }

    process.env.AGENTTOOL_X402_NETWORK = "invalid-network";
    expect((await configuredApp().request("https://api.agenttool.dev/v1/scrape", {
      method: "POST",
    })).headers.get("payment-required")).toBeNull();
    process.env.AGENTTOOL_X402_NETWORK = "eip155:8453";
    process.env.AGENTTOOL_X402_FACILITATOR = "http://127.0.0.1/x402";
    expect((await configuredApp().request("https://api.agenttool.dev/v1/scrape", {
      method: "POST",
    })).headers.get("payment-required")).toBeNull();
  });

  test("official CDP missing credentials suppresses outbound and unsolicited inbound before DB", async () => {
    process.env.AGENTTOOL_X402_RECIPIENT = RECIPIENT;
    process.env.AGENTTOOL_X402_NETWORK = "eip155:8453";
    delete process.env.AGENTTOOL_X402_FACILITATOR;
    process.env.PUBLIC_API_BASE = "https://api.agenttool.dev";
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    const fakePayment: PaymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "1000",
        payTo: RECIPIENT,
        maxTimeoutSeconds: 60,
        extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" },
      },
      payload: {},
    };
    const res = await configuredApp().request("https://api.agenttool.dev/v1/scrape", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encodeCanonicalBase64Json(fakePayment) },
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("payment-required")).toBeNull();
  });
});

describe("public configuration truth", () => {
  test("distinguishes custom readiness, CDP credential material and invalid network", async () => {
    const custom = await x402ConfigurationStatus(
      RECIPIENT,
      "base",
      "https://facilitator.example/x402",
      "",
      "",
    );
    expect(custom).toMatchObject({
      network: "eip155:8453",
      facilitator_authentication: "custom_unauthenticated",
      facilitator_ready: true,
      payable_challenges_ready: true,
    });
    const missing = await x402ConfigurationStatus(RECIPIENT, "base", "", "", "");
    expect(missing).toMatchObject({
      facilitator_authentication: "missing_cdp_credentials",
      facilitator_ready: false,
      payable_challenges_ready: false,
    });
    const invalid = await x402ConfigurationStatus(
      RECIPIENT,
      "solana",
      "https://facilitator.example/x402",
      "",
      "",
    );
    expect(invalid).toMatchObject({
      network_error: "invalid",
      payable_challenges_ready: false,
    });
  });
});
