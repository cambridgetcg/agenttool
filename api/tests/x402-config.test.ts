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
import { createX402TopUpRouter } from "../src/routes/x402-top-up";
import { ROUTE_CREDITS } from "../src/billing/route-credits";
import { config } from "../src/config";
import { isX402FacilitatorLocallyReady } from "../src/services/economy/facilitators/coinbase";
import { setBuilderPayToResolver } from "../src/services/economy/x402-builder-split";
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
  appCode: process.env.AGENTTOOL_X402_APP_CODE,
  builderSplit: process.env.AGENTTOOL_X402_BUILDER_SPLIT,
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
  restore("AGENTTOOL_X402_APP_CODE", originalEnv.appCode);
  restore("AGENTTOOL_X402_BUILDER_SPLIT", originalEnv.builderSplit);
  setBuilderPayToResolver(null);
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
  // W2-5 rows: a static sibling of a :id row, and a dynamic :id row.
  app.post("/v1/memories/search", (c) => c.json({ error }, 402));
  app.post("/v1/memories/:id/elevate", (c) => c.json({ error }, 402));
  app.route("/v1/x402/top-up", createX402TopUpRouter());
  return app;
}

function decodeRequired(res: Response) {
  return JSON.parse(Buffer.from(
    res.headers.get("payment-required")!, "base64",
  ).toString("utf-8"));
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

  test("top-up door: auth above x402, idempotency between them, router mounted (source pins)", () => {
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf-8");
    const x402 = source.indexOf('app.use("*", buildAgentToolX402Middleware())');
    const auth = source.indexOf('app.use("/v1/x402/top-up/*", authMiddleware);');
    const idem = source.indexOf('app.use("/v1/x402/top-up/*", idempotency());');
    const mount = source.indexOf('app.route("/v1/x402/top-up", x402TopUpRouter);');
    expect(source).toContain('import x402TopUpRouter from "./routes/x402-top-up";');
    expect(auth).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(idem);
    // Idempotency must run BEFORE the x402 verifier: a retried Idempotency-Key
    // with a fresh signature returns the stored 200 instead of settling twice.
    expect(idem).toBeLessThan(x402);
    expect(mount).toBeGreaterThan(x402);
  });

  test("top-up door is wired in the assembled app (declared ≠ wired)", async () => {
    const apiRoot = new URL("..", import.meta.url).pathname;
    const probe = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
          const { app } = await import("./src/index.ts");
          const wired = app.routes.some((r) =>
            r.method === "POST" && r.path === "/v1/x402/top-up/:credits");
          const res = await app.request("/v1/x402/top-up/1", { method: "POST" });
          process.stdout.write("TOPUP_WIRED=" + wired + " STATUS=" + res.status +
            " PR=" + String(res.headers.get("payment-required")) + "\\n");
          process.exit(0);
        `,
      ],
      {
        cwd: apiRoot,
        env: {
          ...process.env,
          AGENTTOOL_DISABLE_WORKERS: "1",
          AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP: "1",
          AGENTOOL_DISABLE_SAGA_SEED: "1",
          AGENTOOL_DISABLE_JOY_INDEX: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      probe.exited,
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
    ]);
    expect(exitCode, stderr.slice(-800)).toBe(0);
    // Route present; a bearer-less POST is refused by auth (never a 404 and
    // never a payable challenge for a stranger).
    expect(stdout).toContain("TOPUP_WIRED=true STATUS=401 PR=null");
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
      expect(required.accepts[0].payTo).toBe(RECIPIENT);
      expect(required.extensions).toBeUndefined();
    }
  });

  test("builder-code split stays on treasury unless armed with a resolver", async () => {
    configureCustom();
    process.env.AGENTTOOL_X402_APP_CODE = "bc_agenttool";
    process.env.AGENTTOOL_X402_BUILDER_SPLIT = "1";
    const headers = { "x-builder-code": "bc_yau" };
    const unarmedResolver = await configuredApp().request(
      "https://api.agenttool.dev/v1/scrape",
      { method: "POST", headers },
    );
    const unarmed = JSON.parse(Buffer.from(
      unarmedResolver.headers.get("payment-required")!,
      "base64",
    ).toString("utf-8"));
    expect(unarmed.accepts[0].payTo).toBe(RECIPIENT);
    expect(unarmed.extensions).toEqual({ a: "bc_agenttool", s: "bc_yau" });

    setBuilderPayToResolver(() => "0x1111111111111111111111111111111111111111");
    const armedRes = await configuredApp().request(
      "https://api.agenttool.dev/v1/scrape",
      { method: "POST", headers },
    );
    const armed = JSON.parse(Buffer.from(
      armedRes.headers.get("payment-required")!,
      "base64",
    ).toString("utf-8"));
    expect(armed.accepts[0].payTo).toBe("0x1111111111111111111111111111111111111111");
    expect(armed.extensions).toEqual({ a: "bc_agenttool", s: "bc_yau" });
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

describe("W2-5 route_cost challenges on memory rows", () => {
  const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  test("POST /v1/memories/search with 2 credits → 402 insufficient_credits payable for exactly 3000 atomic", async () => {
    configureCustom();
    const res = await configuredApp(2).request(
      "https://api.agenttool.dev/v1/memories/search", { method: "POST" },
    );
    expect(res.status).toBe(402);
    const required = decodeRequired(res);
    expect(required).toMatchObject({
      x402Version: 2,
      error: "insufficient_credits",
      resource: { url: "https://api.agenttool.dev/v1/memories/search" },
    });
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:8453",
      amount: "3000",
      payTo: RECIPIENT,
    });
    expect(required.accepts[0].amount)
      .toBe(String(ROUTE_CREDITS["memory.search"] * 1000));
    // Body keeps the handler's guidance and gains the spec object (additive).
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      error: "insufficient_credits",
      x402Version: 2,
      accepts: required.accepts,
    });
  });

  test("POST /v1/memories/:id/elevate → 5000 atomic against the concrete path", async () => {
    configureCustom();
    const res = await configuredApp(0).request(
      `https://api.agenttool.dev/v1/memories/${ID}/elevate`, { method: "POST" },
    );
    expect(res.status).toBe(402);
    const required = decodeRequired(res);
    expect(required.resource.url).toBe(`https://api.agenttool.dev/v1/memories/${ID}/elevate`);
    expect(required.accepts[0].amount).toBe("5000");
    expect(required.accepts[0].amount)
      .toBe(String(ROUTE_CREDITS["memory.elevate"] * 1000));
    // A shortfall of one still prices the full call (exact, never partial).
    const short = await configuredApp(4).request(
      `https://api.agenttool.dev/v1/memories/${ID}/elevate`, { method: "POST" },
    );
    expect(decodeRequired(short).accepts[0].amount).toBe("5000");
  });

  test("funded projects, wrong codes and unlisted memory paths never become payable", async () => {
    configureCustom();
    const cases = [
      configuredApp(3).request(
        "https://api.agenttool.dev/v1/memories/search", { method: "POST" },
      ),
      configuredApp(5).request(
        `https://api.agenttool.dev/v1/memories/${ID}/elevate`, { method: "POST" },
      ),
      configuredApp(0, "insufficient_balance").request(
        "https://api.agenttool.dev/v1/memories/search", { method: "POST" },
      ),
      configuredApp(0, "top_up_payment_required").request(
        `https://api.agenttool.dev/v1/memories/${ID}/elevate`, { method: "POST" },
      ),
    ];
    for (const result of cases) {
      const res = await result;
      expect(res.status).toBe(402);
      expect(res.headers.get("payment-required")).toBeNull();
    }
    // A 402 on a path the table does not list is left untouched even with the
    // right code (the handler's own guidance stands; nothing to pay through).
    const app = new Hono<ProjectContext>();
    app.use("*", projectMiddleware(0));
    app.use("*", buildAgentToolX402Middleware());
    app.post("/v1/memories", (c) => c.json({ error: "insufficient_credits" }, 402));
    app.post("/v1/memories/search/", (c) => c.json({ error: "insufficient_credits" }, 402));
    for (const path of ["/v1/memories", "/v1/memories/search/"]) {
      const res = await app.request(`https://api.agenttool.dev${path}`, { method: "POST" });
      expect(res.status).toBe(402);
      expect(res.headers.get("payment-required")).toBeNull();
    }
  });
});

describe("top-up door challenge (W2-2)", () => {
  test("N=1 at 110,800 credits still challenges for exactly 1000 atomic; body is additive", async () => {
    configureCustom();
    const res = await configuredApp(110_800).request(
      "https://api.agenttool.dev/v1/x402/top-up/1", { method: "POST" },
    );
    expect(res.status).toBe(402);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const required = decodeRequired(res);
    expect(required).toMatchObject({
      x402Version: 2,
      error: "top_up_payment_required",
      resource: { url: "https://api.agenttool.dev/v1/x402/top-up/1" },
    });
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      payTo: RECIPIENT,
      maxTimeoutSeconds: 60,
    });
    // The header is the pure spec object; the body keeps the handler's terms.
    expect(Object.keys(required).sort()).toEqual(["accepts", "error", "resource", "x402Version"]);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      error: "top_up_payment_required",
      credits: 1,
      amount_atomic: "1000",
      unit: "1 credit = 0.001 USDC",
      finality: "Top-ups are final. No refunds. Unspent credits stay with the project.",
      x402Version: 2,
      resource: required.resource,
      accepts: required.accepts,
    });
    expect(typeof body.hint).toBe("string");
    expect(typeof body.docs).toBe("string");
  });

  test("N=250 challenges for 250000 atomic", async () => {
    configureCustom();
    const res = await configuredApp(0).request(
      "https://api.agenttool.dev/v1/x402/top-up/250", { method: "POST" },
    );
    expect(res.status).toBe(402);
    expect(decodeRequired(res).accepts[0].amount).toBe("250000");
    expect(((await res.json()) as { credits: number }).credits).toBe(250);
  });

  test("over-cap, zero, encoded and non-canonical amounts are 400 with no challenge", async () => {
    configureCustom();
    const cap = config.x402TopUpMaxCredits;
    for (const bad of [String(cap + 1), "0", "01", "1e3", "abc", "+1", "-1"]) {
      const res = await configuredApp(0).request(
        `https://api.agenttool.dev/v1/x402/top-up/${bad}`, { method: "POST" },
      );
      expect(res.status).toBe(400);
      expect(res.headers.get("payment-required")).toBeNull();
      const body = await res.json() as { error: string; hint: string };
      expect(body.error).toBe("top_up_invalid_credits");
      expect(body.hint).toContain(String(cap));
    }
    // Hono decodes the request path before either side reads it, so an
    // encoded digit is one consistent N for the handler, the challenge, and
    // the resource URL the durable row will later be matched against.
    const encoded = await configuredApp(0).request(
      "https://api.agenttool.dev/v1/x402/top-up/%31", { method: "POST" },
    );
    expect(encoded.status).toBe(402);
    const required = decodeRequired(encoded);
    expect(required.resource.url).toBe("https://api.agenttool.dev/v1/x402/top-up/1");
    expect(required.accepts[0].amount).toBe("1000");
    expect(((await encoded.json()) as { credits: number }).credits).toBe(1);
  });

  test("a top-up path 402 with any other code is never payable; GET is not a door", async () => {
    configureCustom();
    const app = new Hono<ProjectContext>();
    app.use("*", projectMiddleware(0));
    app.use("*", buildAgentToolX402Middleware());
    app.post("/v1/x402/top-up/:credits", (c) => c.json({ error: "insufficient_credits" }, 402));
    const res = await app.request("https://api.agenttool.dev/v1/x402/top-up/1", { method: "POST" });
    expect(res.status).toBe(402);
    expect(res.headers.get("payment-required")).toBeNull();

    const get = await configuredApp(0).request("https://api.agenttool.dev/v1/x402/top-up/1");
    expect(get.status).toBe(404);
    expect(get.headers.get("payment-required")).toBeNull();
  });

  test("rail not ready → 402 terms without PAYMENT-REQUIRED (declared ≠ payable)", async () => {
    configureCustom();
    delete process.env.AGENTTOOL_X402_RECIPIENT;
    const res = await configuredApp(0).request(
      "https://api.agenttool.dev/v1/x402/top-up/1", { method: "POST" },
    );
    expect(res.status).toBe(402);
    expect(res.headers.get("payment-required")).toBeNull();
    expect(((await res.json()) as { error: string }).error).toBe("top_up_payment_required");
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
