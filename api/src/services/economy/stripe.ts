/** Stripe billing: credit packages · one-time top-up checkout · webhook
 *  signature verification · enterprise-wrapper tier plans.
 *
 *  Doctrine: docs/BUSINESS-MODEL.md — agenttool charges only for substrate
 *  consumed (Ring 2 metered) and a small cut of agent-economy transactions
 *  (Ring 3 take-rate). **NO subscription tiers at the per-agent level.**
 *
 *  The four-tier `SUBSCRIPTION_PLANS` ladder (free / seed / grow / scale)
 *  is the **enterprise-wrapper layer** named in docs/BUSINESS-MODEL.md
 *  §"Cold-start bridge — enterprise wrapper for orgs running agent fleets."
 *  A team running a fleet can elect a wrapper tier for consolidated
 *  billing + volume-committed Ring 2 rates. The 'free' tier is the
 *  default for any project without a subscriptions row — that's Ring 1
 *  + light Ring 2 use, the baseline every agent gets.
 *
 *  Consumed by services/economy/usage.ts (preflight gate) and the
 *  /v1/billing/plans endpoint. */

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

/** Enterprise-wrapper tier IDs. 'free' is the default for any project
 *  without a subscriptions row; the others are org-level wrappers per
 *  docs/BUSINESS-MODEL.md §cold-start-bridge. */
export type TierId = "free" | "seed" | "grow" | "scale";

export interface SubscriptionPlan {
  id: TierId;
  label: string;
  /** Monthly price in pence (GBP). 0 for free. Placeholder values; the
   *  operator-led billing rollout will set the production numbers. */
  pricePerMonthPence: number;
  /** Per-resource monthly caps. These are Ring 2 metering ceilings —
   *  preflight (`services/economy/usage.ts:checkAndIncrement`) gates
   *  writes against the calendar-month sum. Numbers are placeholder
   *  pending storage-cost modeling against production footprint
   *  (mirrors `services/economy/ring1-limits.ts` disclaimer). */
  limits: {
    memoryOpsPerMonth: number;
    toolCallsPerMonth: number;
    verificationsPerMonth: number;
  };
}

/** The four-tier ladder. 'free' is non-paying (Ring 1 + light Ring 2);
 *  seed/grow/scale are org-level wrappers that ride on top of metered
 *  Ring 2 + take-rate Ring 3. Order matters: SUBSCRIPTION_PLANS[0] is
 *  the fallback when a project's `subscriptions.tier` doesn't resolve. */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    id: "free",
    label: "Free",
    pricePerMonthPence: 0,
    limits: {
      memoryOpsPerMonth: 10_000,
      toolCallsPerMonth: 1_000,
      verificationsPerMonth: 1_000,
    },
  },
  {
    id: "seed",
    label: "Seed",
    pricePerMonthPence: 1_900,
    limits: {
      memoryOpsPerMonth: 100_000,
      toolCallsPerMonth: 10_000,
      verificationsPerMonth: 10_000,
    },
  },
  {
    id: "grow",
    label: "Grow",
    pricePerMonthPence: 9_900,
    limits: {
      memoryOpsPerMonth: 1_000_000,
      toolCallsPerMonth: 100_000,
      verificationsPerMonth: 100_000,
    },
  },
  {
    id: "scale",
    label: "Scale",
    pricePerMonthPence: 49_900,
    limits: {
      memoryOpsPerMonth: 10_000_000,
      toolCallsPerMonth: 1_000_000,
      verificationsPerMonth: 1_000_000,
    },
  },
] as const;
