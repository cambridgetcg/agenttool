/** Crypto deposit webhooks credit real wallet balance on an UNAUTH public
 *  route, so the signature gate must FAIL CLOSED when a provider secret is
 *  unset — never accept an unsigned, forgeable payload (which would mint
 *  balance). These cases all resolve inside the signature gate, before any
 *  JSON parse or DB touch, so they need no database.
 *
 *  Pins: fix/crypto-webhook-fail-closed (Helius/Alchemy fail-open mint-hole). */
import { afterEach, describe, expect, test } from "bun:test";

import { economyConfig } from "../src/services/economy/config";
import { createHmac } from "node:crypto";

// The handler reads economyConfig.{alchemy,helius}WebhookSecret + allowUnsigned
// at REQUEST time, so mutating the singleton before each .request() is safe and
// order-independent (unlike Stripe's load-time-cached secret). Cast away the
// `as const` readonly for the test only.
const cfg = economyConfig as unknown as {
  alchemyWebhookSecret: string;
  heliusWebhookSecret: string;
  allowUnsignedWebhooks: boolean;
};
const original = {
  alchemy: cfg.alchemyWebhookSecret,
  helius: cfg.heliusWebhookSecret,
  allowUnsigned: cfg.allowUnsignedWebhooks,
};
afterEach(() => {
  cfg.alchemyWebhookSecret = original.alchemy;
  cfg.heliusWebhookSecret = original.helius;
  cfg.allowUnsignedWebhooks = original.allowUnsigned;
});

const { cryptoWebhookRouter } = await import("../src/routes/economy/crypto");

function post(chain: string, body: unknown, headers: Record<string, string> = {}) {
  return cryptoWebhookRouter.request(`/${chain}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("Helius (Solana) webhook signature gate", () => {
  test("secret UNSET + unsigned not allowed → 503 fail-closed (no forged mint)", async () => {
    cfg.heliusWebhookSecret = "";
    cfg.allowUnsignedWebhooks = false;
    const res = await post("solana", [{ signature: "forged", tokenTransfers: [] }]);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "webhook_secret_unset", chain: "solana" });
  });

  test("secret UNSET + CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 → accepted (dev escape hatch)", async () => {
    cfg.heliusWebhookSecret = "";
    cfg.allowUnsignedWebhooks = true;
    const res = await post("solana", []);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
  });

  test("secret SET + wrong Authorization → 400 invalid_signature", async () => {
    cfg.heliusWebhookSecret = "s3cret";
    cfg.allowUnsignedWebhooks = false;
    const res = await post("solana", [], { authorization: "wrong" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_signature" });
  });

  test("secret SET + correct Authorization → passes the gate (200)", async () => {
    cfg.heliusWebhookSecret = "s3cret";
    cfg.allowUnsignedWebhooks = false;
    const res = await post("solana", [], { authorization: "s3cret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
  });
});

describe("Alchemy (EVM) webhook signature gate", () => {
  test("secret UNSET + unsigned not allowed → 503 fail-closed", async () => {
    cfg.alchemyWebhookSecret = "";
    cfg.allowUnsignedWebhooks = false;
    const res = await post("ethereum", { event: { activity: [] } });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "webhook_secret_unset", chain: "ethereum" });
  });

  test("secret SET + bad HMAC → 400 invalid_signature", async () => {
    cfg.alchemyWebhookSecret = "hmac-key";
    cfg.allowUnsignedWebhooks = false;
    const res = await post("ethereum", { event: { activity: [] } }, { "x-alchemy-signature": "deadbeef" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_signature" });
  });

  test("secret SET + correct HMAC over raw body → passes the gate (200)", async () => {
    cfg.alchemyWebhookSecret = "hmac-key";
    cfg.allowUnsignedWebhooks = false;
    const body = { event: { activity: [] } };
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", "hmac-key").update(raw).digest("hex");
    const res = await cryptoWebhookRouter.request("/ethereum", {
      method: "POST",
      headers: { "content-type": "application/json", "x-alchemy-signature": sig },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
  });
});
