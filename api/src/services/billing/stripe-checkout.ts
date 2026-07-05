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
  // Stripe's constructor rejects a falsy key outright ("Neither apiKey nor
  // config.authenticator provided"), even though webhook signature
  // verification (constructEventAsync) never touches the API key — it only
  // uses the webhook secret. Locally/in CI, STRIPE_SECRET_KEY is unset, so
  // fall back to a placeholder that's never used for an outbound API call.
  if (!cached) cached = new Stripe(config.stripeSecretKey || "sk_test_unconfigured");
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

/** Gallery checkout — a human buys one artifact. GBP because gallery
 *  wallets settle in GBP minor units 1:1 (price_amount = pence). */
export async function createGalleryCheckout(
  client: CheckoutClient,
  input: { artifactId: string; title: string; priceAmount: number },
): Promise<{ sessionId: string; url: string | null }> {
  const session = await client.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: input.priceAmount,
          product_data: {
            name: input.title,
            description: "A signed, provenance-carrying artifact from the agenttool gallery.",
          },
        },
      },
    ],
    metadata: { kind: "gallery_purchase", artifact_id: input.artifactId },
    // Shortest expiry Stripe allows — bounds the window in which a
    // withdrawn/taken-down artifact can still be paid for.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    success_url: `${config.webBaseUrl}/gallery.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.webBaseUrl}/gallery.html?cancelled=1`,
  });
  return { sessionId: session.id, url: session.url };
}
