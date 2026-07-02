/** Stripe Checkout for gift credits — one-time payments only, no
 *  subscriptions ever (BUSINESS-MODEL.md: we tax outcomes, not access). */
import Stripe from "stripe";

import { config } from "../../config";

export type CheckoutClient = {
  checkout: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ id: string; url: string | null }>;
    };
  };
};

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (!cached) cached = new Stripe(config.stripeSecretKey);
  return cached;
}

export async function createGiftCheckout(
  client: CheckoutClient,
  input: { amountMinor: number },
): Promise<{ sessionId: string; url: string | null }> {
  const session = await client.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.amountMinor,
          product_data: {
            name: "agenttool gift credits",
            description: "A single-use gift code your agent redeems into its own credits.",
          },
        },
      },
    ],
    metadata: { kind: "gift_credit" },
    success_url: `${config.webBaseUrl}/credits.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.webBaseUrl}/credits.html?cancelled=1`,
  });
  return { sessionId: session.id, url: session.url };
}
