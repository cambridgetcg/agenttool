/** Webhook: signature is the gate, event id is the idempotency key. */
import { describe, expect, test } from "bun:test";
import Stripe from "stripe";

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

// Dynamic imports, not static: ESM hoists static `import` declarations above
// this module's own top-level statements, so `config` (and anything that
// imports it, transitively including the route below) would evaluate — and
// cache `stripeWebhookSecret` — before the env var above is set. `await
// import(...)` runs exactly where it appears, after the assignment.
//
// That guards THIS file's own hoisting, but not cross-file races: when
// `bun test` runs multiple files in one process, a sibling file's static
// import chain (e.g. any route that pulls in `db/client` → `config`) can
// reach `config`'s module-eval before this file's assignment above runs,
// permanently caching `stripeWebhookSecret` as "" for the whole process
// (config is a plain object evaluated once). Belt-and-braces: mutate the
// already-loaded singleton directly so this test is correct regardless of
// import order across files. (Surfaced 2026-07-02 by tests/gift-credits-
// redeem.test.ts landing in the same run — see task-7-report.md.)
const { default: billing } = await import("../src/routes/billing");
const { db } = await import("../src/db/client");
const { getGiftBySession } = await import("../src/services/billing/gift-credits");
const { config } = await import("../src/config");
config.stripeWebhookSecret = "whsec_test_secret";

const stripe = new Stripe("sk_test_dummy");

function eventPayload(sessionId: string, eventId: string): string {
  return JSON.stringify({
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId, object: "checkout.session",
        amount_total: 2000, currency: "usd",
        metadata: { kind: "gift_credit" },
      },
    },
  });
}

async function post(payload: string, sig?: string) {
  return billing.request("/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(sig ? { "stripe-signature": sig } : {}) },
    body: payload,
  });
}

describe("POST /v1/billing/webhook", () => {
  test("rejects missing/invalid signatures", async () => {
    const payload = eventPayload(`cs_${crypto.randomUUID()}`, `evt_${crypto.randomUUID()}`);
    expect((await post(payload)).status).toBe(400);
    expect((await post(payload, "t=1,v1=deadbeef")).status).toBe(400);
  });

  test("valid signature mints once; replay mints nothing", async () => {
    const sessionId = `cs_${crypto.randomUUID()}`;
    const eventId = `evt_${crypto.randomUUID()}`;
    const payload = eventPayload(sessionId, eventId);
    // NB: sync generateTestHeaderString throws under Bun — the "stripe" package
    // resolves to its worker build here, whose default CryptoProvider (SubtleCrypto)
    // only supports async. The webhook route itself uses constructEventAsync, which
    // works fine; this only affects how the test computes the mock signature.
    const sig = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_test_secret" });

    const res = await post(payload, sig);
    expect(res.status).toBe(200);
    expect((await res.json()).received).toBe(true);

    const gift = await getGiftBySession(db, sessionId);
    expect(gift?.credits).toBe(20000);

    const replay = await post(payload, sig);
    expect(replay.status).toBe(200);
    const again = await getGiftBySession(db, sessionId);
    expect(again?.id).toBe(gift?.id);
  });
});
