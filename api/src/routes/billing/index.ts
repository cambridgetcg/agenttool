/** /v1/billing — the human gift ramp (checkout · webhook · session code).
 *
 *  UNAUTH by design: the caller is a human in a browser with no bearer.
 *  Money safety comes from Stripe (payment) + webhook signature (mint) +
 *  unguessable session ids (reveal) — not from platform auth.
 *  Doctrine: docs/superpowers/specs/2026-07-02-human-door-design.md. */
import { Hono } from "hono";
import type Stripe from "stripe";
import { z } from "zod";

import { config } from "../../config";
import { db } from "../../db/client";
import { fail } from "../../lib/errors";
import { attachSurface } from "../../lib/surface-metadata";
import {
  createGiftCheckout, getStripe, type CheckoutClient,
} from "../../services/billing/stripe-checkout";
import { getGiftBySession, mintGiftForSession } from "../../services/billing/gift-credits";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/BUSINESS-MODEL";

/** Test seam — routes use the injected client when set. */
let stripeOverride: CheckoutClient | null = null;
export function setStripeForTests(s: CheckoutClient | null): void {
  stripeOverride = s;
}
function stripeClient(): CheckoutClient | null {
  if (stripeOverride) return stripeOverride;
  if (!config.stripeSecretKey) return null;
  return getStripe();
}

const checkoutSchema = z.object({ amount_minor: z.number().int() });

app.post("/checkout", async (c) => {
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail(c, {
      error: "validation",
      message: "Body must be JSON like {\"amount_minor\": 2000} (cents).",
    }, 400);
  }
  const { amount_minor } = parsed.data;
  if (amount_minor < config.giftMinMinor || amount_minor > config.giftMaxMinor) {
    return fail(c, {
      error: "gift_amount_out_of_bounds",
      message: `Gifts run $${config.giftMinMinor / 100} to $${config.giftMaxMinor / 100}.`,
      hint: "Pick an amount inside the range — the door is small on purpose, for now.",
    }, 400);
  }
  const client = stripeClient();
  if (!client) {
    return fail(c, {
      error: "billing_unconfigured",
      message: "The ramp rests — fiat gifts aren't switched on in this environment.",
      hint: "Operators: set STRIPE_SECRET_KEY. Agents: x402 remains open.",
    }, 503);
  }
  const session = await createGiftCheckout(client, { amountMinor: amount_minor });
  return c.json(attachSurface(
    { session_id: session.sessionId, url: session.url },
    { canon_pointer: CANON_POINTER },
  ));
});

app.post("/webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) {
    return fail(c, { error: "missing_signature", message: "Stripe-Signature header required." }, 400);
  }
  const payload = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      payload, sig, config.stripeWebhookSecret,
    );
  } catch {
    return fail(c, { error: "invalid_signature", message: "Signature did not verify." }, 400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind === "gift_credit" && typeof session.amount_total === "number") {
      await mintGiftForSession(db, {
        stripeSessionId: session.id,
        stripeEventId: event.id,
        amountMinor: session.amount_total,
        currency: session.currency ?? "usd",
      });
    }
  }
  // Always 200 for verified events — Stripe retries anything else.
  return c.json({ received: true });
});

app.get("/session/:id/code", async (c) => {
  const gift = await getGiftBySession(db, c.req.param("id"));
  if (!gift) {
    // Not an error: Stripe's webhook may simply not have landed yet.
    return c.json(attachSurface(
      { status: "settling", hint: "Your gift is settling — this page checks again on its own." },
      { canon_pointer: CANON_POINTER },
    ));
  }
  if (gift.status === "redeemed") {
    return c.json(attachSurface(
      { status: "redeemed", redeemed_at: gift.redeemedAt },
      { canon_pointer: CANON_POINTER },
    ));
  }
  if (gift.status !== "minted") {
    // Fail closed: only a minted gift ever reveals its code. Map to a fixed
    // set rather than echoing the raw column — the reveal surface should
    // never leak an unanticipated internal status string.
    const SAFE_STATUS = gift.status === "refunded" ? "refunded" : "unavailable";
    return c.json(attachSurface(
      { status: SAFE_STATUS, hint: "This gift is not redeemable right now." },
      { canon_pointer: CANON_POINTER },
    ));
  }
  return c.json(attachSurface(
    {
      status: "ready",
      code: gift.code,
      amount_minor: gift.amountMinor,
      credits: gift.credits,
      currency: gift.currency,
      redeem: {
        method: "POST",
        path: "/v1/gift-credits/redeem",
        body_hint: { code: "GIFT-XXXX-XXXX-XXXX" },
        docs: "https://docs.agenttool.dev/gift-credits",
        note: "Hand this code to YOUR agent — it redeems with its own bearer; the credit lands in its account.",
      },
    },
    { canon_pointer: CANON_POINTER },
  ));
});

export default app;
