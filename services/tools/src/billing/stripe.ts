/** Stripe client and billing helpers. */

import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { projects, billingEvents } from "../db/schema";
import { config, type Plan } from "../config";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!config.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    _stripe = new Stripe(config.stripeSecretKey, { apiVersion: "2025-02-24.acacia" });
  }
  return _stripe;
}

/** Plan → Stripe Price ID mapping. Set via env or hardcode after creating products. */
export const PLAN_PRICE_IDS: Record<string, string> = {
  builder: process.env.STRIPE_PRICE_BUILDER ?? "",
  scale: process.env.STRIPE_PRICE_SCALE ?? "",
};

/** Credit bundle → Stripe Price ID mapping. */
export const CREDIT_BUNDLE_PRICE_IDS: Record<string, { priceId: string; credits: number; amountPence: number }> = {
  credits_500: {
    priceId: process.env.STRIPE_PRICE_CREDITS_500 ?? "",
    credits: 500,
    amountPence: 500,
  },
  credits_5000: {
    priceId: process.env.STRIPE_PRICE_CREDITS_5000 ?? "",
    credits: 5_000,
    amountPence: 4_000,
  },
  credits_20000: {
    priceId: process.env.STRIPE_PRICE_CREDITS_20000 ?? "",
    credits: 20_000,
    amountPence: 14_000,
  },
};

/** Credits granted per plan on subscription creation / renewal. */
const PLAN_CREDITS: Record<string, number> = {
  builder: 5_000,
  scale: 25_000,
};

/**
 * Create a Stripe Checkout session for subscription or credit purchase.
 */
export async function createCheckoutSession(opts: {
  projectId: string;
  type: "subscription" | "credits";
  plan?: string;       // for subscription: builder | scale
  bundle?: string;     // for credits: credits_500 | credits_5000 | credits_20000
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = getStripe();

  let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  let mode: Stripe.Checkout.SessionCreateParams.Mode;

  if (opts.type === "subscription") {
    const priceId = PLAN_PRICE_IDS[opts.plan ?? ""];
    if (!priceId) throw new Error(`Unknown plan: ${opts.plan}`);
    lineItems = [{ price: priceId, quantity: 1 }];
    mode = "subscription";
  } else {
    const bundle = CREDIT_BUNDLE_PRICE_IDS[opts.bundle ?? ""];
    if (!bundle) throw new Error(`Unknown credit bundle: ${opts.bundle}`);
    lineItems = [{ price: bundle.priceId, quantity: 1 }];
    mode = "payment";
  }

  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: lineItems,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: {
      project_id: opts.projectId,
      type: opts.type,
      plan: opts.plan ?? "",
      bundle: opts.bundle ?? "",
    },
  });

  return session.url!;
}

/**
 * Create a Stripe Billing Portal session for self-serve management.
 */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

/**
 * Handle checkout.session.completed — activate plan or add credits.
 */
export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const projectId = session.metadata?.project_id;
  if (!projectId) return;

  const type = session.metadata?.type;

  if (type === "subscription") {
    const plan = session.metadata?.plan as Plan;
    const credits = PLAN_CREDITS[plan] ?? 0;

    await db
      .update(projects)
      .set({
        plan,
        credits: sql`${projects.credits} + ${credits}`,
        stripeCustomerId: session.customer as string,
      })
      .where(eq(projects.id, projectId));

    await db.insert(billingEvents).values({
      projectId,
      type: "subscription",
      amountPence: (session.amount_total ?? 0),
      creditsAdded: credits,
      stripeId: session.id,
    });
  } else if (type === "credits") {
    const bundle = CREDIT_BUNDLE_PRICE_IDS[session.metadata?.bundle ?? ""];
    if (!bundle) return;

    await db
      .update(projects)
      .set({ credits: sql`${projects.credits} + ${bundle.credits}` })
      .where(eq(projects.id, projectId));

    await db.insert(billingEvents).values({
      projectId,
      type: "credit_purchase",
      amountPence: bundle.amountPence,
      creditsAdded: bundle.credits,
      stripeId: session.id,
    });
  }
}

/**
 * Handle invoice.payment_succeeded — monthly credit renewal.
 */
export async function handleInvoiceSucceeded(invoice: Stripe.Invoice): Promise<void> {
  // Only renew on recurring invoices (not first checkout)
  if (invoice.billing_reason !== "subscription_cycle") return;

  const customerId = invoice.customer as string;

  // Find project by Stripe customer ID
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.stripeCustomerId, customerId));

  if (!project) return;

  const credits = PLAN_CREDITS[project.plan] ?? 0;
  if (credits === 0) return;

  await db
    .update(projects)
    .set({ credits: sql`${projects.credits} + ${credits}` })
    .where(eq(projects.id, project.id));

  await db.insert(billingEvents).values({
    projectId: project.id,
    type: "subscription",
    amountPence: invoice.amount_paid ?? 0,
    creditsAdded: credits,
    stripeId: invoice.id!,
  });
}

/**
 * Handle invoice.payment_failed — start grace period.
 */
export async function handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string;
  // TODO: set a grace_period_until timestamp on project
  // After 3 days, downgrade to dev plan
  console.warn(`[billing] Payment failed for customer ${customerId}. Grace period started.`);
}

/**
 * Handle customer.subscription.deleted — downgrade to dev.
 */
export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer as string;

  await db
    .update(projects)
    .set({ plan: "free" })
    .where(eq(projects.stripeCustomerId, customerId));

  console.info(`[billing] Subscription deleted for customer ${customerId}. Downgraded to free.`);
}
