/** Webhook: signature is the gate, event id is the idempotency key. */
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
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
const {
  default: billing,
  setStripeSessionLookupForTests,
} = await import("../src/routes/billing");
const { db } = await import("../src/db/client");
const {
  getGiftBySession,
  redeemGift,
} = await import("../src/services/billing/gift-credits");
const { projects } = await import("../src/db/schema/tools");
const { config } = await import("../src/config");
const originalWebhookSecret = config.stripeWebhookSecret;
config.stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
afterAll(() => {
  config.stripeWebhookSecret = originalWebhookSecret;
});

const stripe = new Stripe("sk_test_dummy");

function eventPayload(
  sessionId: string,
  eventId: string,
  options: {
    type?: "checkout.session.completed" | "checkout.session.async_payment_succeeded";
    paymentStatus?: "paid" | "unpaid" | "no_payment_required";
    currency?: string;
  } = {},
): string {
  return JSON.stringify({
    id: eventId,
    object: "event",
    type: options.type ?? "checkout.session.completed",
    data: {
      object: {
        id: sessionId, object: "checkout.session",
        amount_total: 2000,
        currency: options.currency ?? "usd",
        payment_status: options.paymentStatus ?? "paid",
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

  test("does not mint an unpaid or wrong-currency gift checkout", async () => {
    for (const options of [
      { paymentStatus: "unpaid" as const },
      { currency: "gbp" },
    ]) {
      const sessionId = `cs_${crypto.randomUUID()}`;
      const eventId = `evt_${crypto.randomUUID()}`;
      const payload = eventPayload(sessionId, eventId, options);
      const sig = await stripe.webhooks.generateTestHeaderStringAsync({
        payload,
        secret: "whsec_test_secret",
      });

      expect((await post(payload, sig)).status).toBe(200);
      expect(await getGiftBySession(db, sessionId)).toBeNull();
    }
  });

  test("mints after a delayed payment actually succeeds", async () => {
    const sessionId = `cs_${crypto.randomUUID()}`;
    const eventId = `evt_${crypto.randomUUID()}`;
    const payload = eventPayload(sessionId, eventId, {
      type: "checkout.session.async_payment_succeeded",
    });
    const sig = await stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: "whsec_test_secret",
    });

    expect((await post(payload, sig)).status).toBe(200);
    expect((await getGiftBySession(db, sessionId))?.credits).toBe(20000);
  });

  test("refund invalidates a redeemed gift and claws back available project credits", async () => {
    const sessionId = `cs_${crypto.randomUUID()}`;
    const mintEventId = `evt_${crypto.randomUUID()}`;
    const mintPayload = eventPayload(sessionId, mintEventId);
    const mintSig = await stripe.webhooks.generateTestHeaderStringAsync({
      payload: mintPayload,
      secret: "whsec_test_secret",
    });
    expect((await post(mintPayload, mintSig)).status).toBe(200);

    const gift = await getGiftBySession(db, sessionId);
    expect(gift?.code).toBeTruthy();
    const [project] = await db
      .insert(projects)
      .values({ name: `gift-refund-${crypto.randomUUID()}`, credits: 100 })
      .returning();
    await redeemGift(db, { code: gift!.code!, projectId: project.id });

    const refundEventId = `evt_${crypto.randomUUID()}`;
    const paymentIntent = `pi_${crypto.randomUUID()}`;
    const refundPayload = JSON.stringify({
      id: refundEventId,
      object: "event",
      type: "charge.refunded",
      data: {
        object: {
          id: `ch_${crypto.randomUUID()}`,
          object: "charge",
          payment_intent: paymentIntent,
        },
      },
    });
    const refundSig = await stripe.webhooks.generateTestHeaderStringAsync({
      payload: refundPayload,
      secret: "whsec_test_secret",
    });
    setStripeSessionLookupForTests(async (received) => {
      expect(received).toBe(paymentIntent);
      return sessionId;
    });
    try {
      expect((await post(refundPayload, refundSig)).status).toBe(200);
      expect((await post(refundPayload, refundSig)).status).toBe(200);
    } finally {
      setStripeSessionLookupForTests(null);
    }

    const reversed = await getGiftBySession(db, sessionId);
    expect(reversed?.status).toBe("refunded");
    expect(reversed?.code).toBeNull();
    const [after] = await db
      .select({ credits: projects.credits })
      .from(projects)
      .where(eq(projects.id, project.id));
    expect(after?.credits).toBe(100);
  });
});
