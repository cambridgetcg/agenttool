/** Stripe billing: fund wallets via Checkout, webhooks, subscriptions. */

import Stripe from "stripe";
import { config } from "../config";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(config.stripeSecretKey, { apiVersion: "2026-02-25.clover" });
  }
  return _stripe;
}

/** Subscription plans: monthly recurring */
export const SUBSCRIPTION_PLANS = [
  {
    id: "free",
    label: "Free",
    price: 0,
    priceId: null,
    limits: { memoryOpsPerMonth: 1_000, toolCallsPerMonth: 100, verificationsPerMonth: 20 },
  },
  {
    id: "seed",
    label: "Seed",
    price: 2900, // cents
    priceId: "price_1T9LigGUYV0go0FyTDNTvoqj",
    limits: { memoryOpsPerMonth: 50_000, toolCallsPerMonth: 500, verificationsPerMonth: 50 },
  },
  {
    id: "grow",
    label: "Grow",
    price: 9900,
    priceId: "price_1T9LihGUYV0go0Fyvfi7fTQ1",
    limits: { memoryOpsPerMonth: 200_000, toolCallsPerMonth: 2_000, verificationsPerMonth: 200 },
  },
  {
    id: "scale",
    label: "Scale",
    price: 29900,
    priceId: "price_1T9LiiGUYV0go0Fya8Hwkdx0",
    limits: { memoryOpsPerMonth: 1_000_000, toolCallsPerMonth: 5_000, verificationsPerMonth: 1_000 },
  },
] as const;

export type TierId = (typeof SUBSCRIPTION_PLANS)[number]["id"];

/** Create a Stripe Checkout session for a subscription */
export async function createSubscriptionCheckout(
  projectId: string,
  tier: Exclude<TierId, "free">,
  successUrl: string,
  cancelUrl: string,
) {
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === tier);
  if (!plan || !plan.priceId) throw new Error(`Unknown tier: ${tier}`);

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: plan.priceId, quantity: 1 }],
    metadata: { projectId, tier },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session;
}

/** Credit packages: one-time top-ups */
export const CREDIT_PACKAGES = [
  { id: "credits_500",  credits: 500,   pricePence: 499,   label: "Starter" },
  { id: "credits_2000", credits: 2000,  pricePence: 1599,  label: "Builder" },
  { id: "credits_5000", credits: 5000,  pricePence: 3499,  label: "Scale"   },
] as const;

/** Create a Stripe Checkout session to fund a wallet */
export async function createFundCheckout(
  walletId: string,
  projectId: string,
  packageId: string,
  successUrl: string,
  cancelUrl: string,
) {
  const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new Error(`Unknown package: ${packageId}`);

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: `${pkg.label} Credits (${pkg.credits} credits)`,
            description: `Top up wallet with ${pkg.credits} credits`,
          },
          unit_amount: pkg.pricePence,
        },
        quantity: 1,
      },
    ],
    metadata: {
      walletId,
      projectId,
      packageId,
      credits: String(pkg.credits),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session;
}

/** Verify and parse a Stripe webhook event */
export function constructWebhookEvent(payload: string | Buffer, sig: string) {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(payload, sig, config.stripeWebhookSecret);
}
