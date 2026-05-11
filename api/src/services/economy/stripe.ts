/** Stripe billing: credit packages · one-time top-up checkout · webhook
 *  signature verification.
 *
 *  Doctrine: docs/BUSINESS-MODEL.md — agenttool charges only for substrate
 *  consumed (Ring 2 metered) and a small cut of agent-economy transactions
 *  (Ring 3 take-rate). NO subscription tiers, NO per-agent monthly fees. */

import Stripe from "stripe";
import { config } from "../../config";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(config.stripeSecretKey, {
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return _stripe;
}

/** Credit packages: one-time top-ups (Ring 2 pre-paid substrate credits). */
export const CREDIT_PACKAGES = [
  { id: "credits_500", credits: 500, pricePence: 499, label: "Starter" },
  { id: "credits_2000", credits: 2000, pricePence: 1599, label: "Builder" },
  { id: "credits_5000", credits: 5000, pricePence: 3499, label: "Scale" },
] as const;

/** Stripe Checkout session for a one-time credit-pack top-up. */
export async function createFundCheckout(
  walletId: string,
  projectId: string,
  packageId: string,
  successUrl: string,
  cancelUrl: string,
) {
  const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new Error(`Unknown package: ${packageId}`);

  return getStripe().checkout.sessions.create({
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
}

/** Verify a Stripe webhook signature and parse the event. */
export function constructWebhookEvent(payload: string | Buffer, sig: string) {
  return getStripe().webhooks.constructEvent(
    payload,
    sig,
    config.stripeWebhookSecret,
  );
}
