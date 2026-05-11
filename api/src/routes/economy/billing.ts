/** /v1/billing — credit packages · one-time top-up checkout · Stripe webhook.
 *
 *  Doctrine: Ring 2 substrate metering only. No subscription tiers, no
 *  per-agent monthly fees — see docs/BUSINESS-MODEL.md. The /v1/billing/
 *  surface here serves credit purchase (one-time top-ups via Stripe Checkout)
 *  + webhook ingestion. Crypto deposit webhooks live separately at
 *  /v1/billing/crypto-webhook/:chain (mounted in api/src/index.ts).
 *
 *  Mixed auth posture:
 *    Public  (no auth)       — /packages, /webhooks
 *    Authed  (project key)   — /checkout */

import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { authMiddleware, type ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import {
  billingEvents,
  stripeEvents,
  wallets,
} from "../../db/schema/economy";
import {
  CREDIT_PACKAGES,
  constructWebhookEvent,
  createFundCheckout,
} from "../../services/economy/stripe";
import { fundWallet } from "../../services/economy/wallets";

const router = new Hono<ProjectContext>();

// ─── Public: credit packages ────────────────────────────────────────────────

router.get("/packages", async (c) => {
  return c.json({ success: true, data: CREDIT_PACKAGES });
});

// ─── Authed: create one-time top-up checkout ────────────────────────────────

router.post(
  "/checkout",
  authMiddleware,
  zValidator(
    "json",
    z.object({
      walletId: z.string().uuid(),
      packageId: z.enum(["credits_500", "credits_2000", "credits_5000"]),
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
    }),
  ),
  async (c) => {
    const project = c.var.project;
    const body = c.req.valid("json");

    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, body.walletId));

    if (!wallet || wallet.projectId !== project.id) {
      return c.json({ success: false, error: "Wallet not found" }, 404);
    }

    const session = await createFundCheckout(
      body.walletId,
      project.id,
      body.packageId,
      body.successUrl,
      body.cancelUrl,
    );

    return c.json({
      success: true,
      data: { url: session.url, sessionId: session.id },
    });
  },
);

// ─── Public: Stripe webhook (signature-verified) ────────────────────────────
//
// Handles ONE event class — `checkout.session.completed` for one-time credit
// purchases (Ring 2 substrate metering top-ups). Subscription / invoice /
// customer.subscription.* events are silently ignored: doctrine forbids
// per-agent subscription pricing (see docs/BUSINESS-MODEL.md). The Stripe
// webhook config may still send those events; we whitelist what we care
// about and audit-log everything via stripeEvents idempotency.

router.post("/webhooks", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "Missing signature" }, 400);

  let event: ReturnType<typeof constructWebhookEvent>;
  let rawBody: string;
  try {
    rawBody = await c.req.text();
    event = constructWebhookEvent(rawBody, sig);
  } catch {
    return c.json({ error: "Invalid signature" }, 400);
  }

  // Idempotency: skip events we've already processed.
  const [existing] = await db
    .select()
    .from(stripeEvents)
    .where(eq(stripeEvents.stripeEventId, event.id))
    .limit(1);
  if (existing) return c.json({ received: true, skipped: "duplicate" });

  const obj = event.data.object as unknown as Record<string, unknown>;

  if (event.type === "checkout.session.completed") {
    const meta = (obj.metadata as Record<string, string>) ?? {};
    const { walletId, projectId, packageId, credits } = meta;

    if (walletId && credits && projectId) {
      // One-time credit-pack top-up completed.
      const creditAmount = parseInt(credits, 10);
      if ((obj.payment_status as string) === "paid") {
        // GAP (persist-identity): fundWallet runs before the stripeEvents
        // idempotency row (line ~145). A crash between → Stripe webhook
        // retry → double-credit. Fix shape: provisional `stripe_pending`
        // row in a tx before funding, flip to applied after.
        // See docs/PATTERN-PERSIST-IDENTITY.md § Where the pattern is missing.
        await fundWallet(
          db,
          walletId,
          creditAmount,
          `Stripe top-up: ${packageId}`,
          { stripeSessionId: obj.id as string },
        );
        await db.insert(billingEvents).values({
          projectId,
          walletId,
          type: "stripe_fund",
          amountPence: 0,
          creditsAdded: creditAmount,
          stripeId: obj.id as string,
        });
      }
    }
    // Sessions without walletId+credits metadata are ignored (e.g. legacy
    // subscription checkouts that may still arrive from Stripe).
  }
  // All other event types (invoice.*, customer.subscription.*) are ignored
  // by design — see the doctrine note above.

  await db.insert(stripeEvents).values({ stripeEventId: event.id });

  return c.json({ received: true });
});

export default router;
