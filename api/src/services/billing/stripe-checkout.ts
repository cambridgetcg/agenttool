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

/** Bumped whenever agenttool.dev/terms changes substance; stamped on every
 *  session so a receipt can be matched to the promises that governed it. */
export const TERMS_VERSION = "2026-08-29";

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
    metadata: { kind: "gift_credit", terms_version: TERMS_VERSION },
    // Seller is VAT-registered: Stripe Tax computes UK/destination VAT on the
    // digital service. Dashboard prerequisite: Stripe Tax enabled + origin
    // address set, else session creation fails loudly (good — never sell
    // untaxed by accident).
    ...(config.stripeAutomaticTax ? { automatic_tax: { enabled: true } } : {}),
    // Consumer Contracts Regulations 2013 reg. 37: immediate digital delivery
    // needs the buyer's express request + acknowledgement that the 14-day
    // cancellation right is lost once delivery begins. The pay click is that
    // acknowledgement; the words sit beside the button.
    custom_text: {
      submit: {
        message:
          "By paying you ask Cambridge TCG Limited to deliver your gift code immediately and acknowledge that, once it is delivered, the 14-day right to cancel no longer applies. Terms: agenttool.dev/terms · Privacy: agenttool.dev/privacy",
      },
    },
    success_url: `${config.webBaseUrl}/credits?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.webBaseUrl}/credits?cancelled=1`,
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
    success_url: `${config.webBaseUrl}/gallery?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.webBaseUrl}/gallery?cancelled=1`,
  });
  return { sessionId: session.id, url: session.url };
}
