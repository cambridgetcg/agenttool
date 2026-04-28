/** POST /v1/billing/webhooks — handle Stripe webhook events. */

import { Hono } from "hono";
import type Stripe from "stripe";
import { config } from "../../config";
import {
  getStripe,
  handleCheckoutCompleted,
  handleInvoiceSucceeded,
  handleInvoiceFailed,
  handleSubscriptionDeleted,
} from "../../billing/stripe";

const app = new Hono();

/**
 * Stripe webhook handler.
 * NOTE: This route must NOT have auth middleware — Stripe calls it directly.
 * Signature verification provides authentication.
 */
app.post("/", async (c) => {
  const stripe = getStripe();
  const sig = c.req.header("stripe-signature");

  if (!sig) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  let event: Stripe.Event;
  try {
    const body = await c.req.text();
    event = stripe.webhooks.constructEvent(body, sig, config.stripeWebhookSecret);
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    case "invoice.payment_succeeded":
      await handleInvoiceSucceeded(event.data.object as Stripe.Invoice);
      break;

    case "invoice.payment_failed":
      await handleInvoiceFailed(event.data.object as Stripe.Invoice);
      break;

    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    default:
      // Unhandled event type — log and ignore
      console.info(`[webhook] Unhandled event type: ${event.type}`);
  }

  return c.json({ received: true });
});

export default app;
