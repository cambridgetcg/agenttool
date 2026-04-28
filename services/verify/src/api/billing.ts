/** Stripe billing: webhooks, checkout, portal. */

import { Hono } from "hono";
import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { projects, billingEvents } from "../db/schema";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    if (!config.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    _stripe = new Stripe(config.stripeSecretKey);
  }
  return _stripe;
}

export const billingRoutes = new Hono();

/** POST /billing/checkout — create Stripe checkout session. */
billingRoutes.post("/checkout", async (c) => {
  const { projectId, priceId } = await c.req.json();
  if (!projectId || !priceId) {
    return c.json({ error: "projectId and priceId required" }, 400);
  }

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { projectId },
    success_url: `https://agenttool.dev/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://agenttool.dev/billing/cancel`,
  });

  return c.json({ url: session.url });
});

/** POST /billing/portal — Stripe billing portal for self-serve management. */
billingRoutes.post("/portal", async (c) => {
  const { customerId } = await c.req.json();
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: "https://agenttool.dev/dashboard",
  });
  return c.json({ url: session.url });
});

/** POST /billing/webhooks — handle Stripe webhook events. */
billingRoutes.post("/webhooks", async (c) => {
  const body = await c.req.text();
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "Missing stripe-signature" }, 400);

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, config.stripeWebhookSecret);
  } catch {
    return c.json({ error: "Invalid signature" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const projectId = session.metadata?.projectId;
      if (!projectId) break;

      // Determine plan from amount
      const amount = session.amount_total ?? 0;
      const plan = amount >= 25000 ? "grow" : "seed";
      const credits = plan === "grow" ? 10000 : 2500;

      await db.update(projects).set({ plan, credits: sql`${projects.credits} + ${credits}` }).where(eq(projects.id, projectId));
      await db.insert(billingEvents).values({
        projectId,
        type: "subscription",
        amountPence: amount,
        creditsAdded: credits,
        stripeId: session.id,
      });
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
      if (!subId || !invoice.metadata?.projectId) break;

      const projectId = invoice.metadata.projectId;
      const amount = invoice.amount_paid;
      const credits = amount >= 25000 ? 10000 : 2500;

      await db.update(projects).set({ credits: sql`${projects.credits} + ${credits}` }).where(eq(projects.id, projectId));
      await db.insert(billingEvents).values({
        projectId,
        type: "subscription",
        amountPence: amount,
        creditsAdded: credits,
        stripeId: invoice.id,
      });
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const projectId = invoice.metadata?.projectId;
      if (projectId) {
        // Grace period: don't downgrade yet, just log
        console.warn(`[billing] Payment failed for project ${projectId}`);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const projectId = sub.metadata?.projectId;
      if (projectId) {
        await db.update(projects).set({ plan: "free", credits: 100 }).where(eq(projects.id, projectId));
      }
      break;
    }
  }

  return c.json({ received: true });
});
