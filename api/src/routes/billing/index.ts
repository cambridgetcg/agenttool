/** /v1/billing — the human gift ramp (checkout · webhook · session code).
 *
 *  UNAUTH by design: the caller is a human in a browser with no bearer.
 *  Money safety comes from Stripe (payment) + webhook signature (mint) +
 *  unguessable session ids (reveal) — not from platform auth.
 *  Doctrine: docs/superpowers/specs/2026-07-02-human-door-design.md. */
import { Hono } from "hono";
import type Stripe from "stripe";
import { z } from "zod";

import { config } from "../../config";
import { db } from "../../db/client";
import { fail } from "../../lib/errors";
import { attachSurface } from "../../lib/surface-metadata";
import {
  createGalleryCheckout, createGiftCheckout, getStripe, type CheckoutClient,
} from "../../services/billing/stripe-checkout";
import { getGiftBySession, mintGiftForSession } from "../../services/billing/gift-credits";
import {
  claimBySession, claimByToken, settleStripeSale,
} from "../../services/gallery";
import { galleryArtifacts } from "../../db/schema/gallery";
import { eq } from "drizzle-orm";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/BUSINESS-MODEL";

/** Test seam — routes use the injected client when set. */
let stripeOverride: CheckoutClient | null = null;
export function setStripeForTests(s: CheckoutClient | null): void {
  stripeOverride = s;
}
function stripeClient(): CheckoutClient | null {
  if (stripeOverride) return stripeOverride;
  if (!config.stripeSecretKey) return null;
  return getStripe();
}

const checkoutSchema = z.object({ amount_minor: z.number().int() });

app.post("/checkout", async (c) => {
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail(c, {
      error: "validation",
      message: "Body must be JSON like {\"amount_minor\": 2000} (cents).",
    }, 400);
  }
  const { amount_minor } = parsed.data;
  if (amount_minor < config.giftMinMinor || amount_minor > config.giftMaxMinor) {
    return fail(c, {
      error: "gift_amount_out_of_bounds",
      message: `Gifts run $${config.giftMinMinor / 100} to $${config.giftMaxMinor / 100}.`,
      hint: "Pick an amount inside the range — the door is small on purpose, for now.",
    }, 400);
  }
  const client = stripeClient();
  if (!client) {
    return fail(c, {
      error: "billing_unconfigured",
      message: "The ramp rests — fiat gifts aren't switched on in this environment.",
      hint: "Operators: set STRIPE_SECRET_KEY. Agents: x402 remains open.",
    }, 503);
  }
  const session = await createGiftCheckout(client, { amountMinor: amount_minor });
  return c.json(attachSurface(
    { session_id: session.sessionId, url: session.url },
    { canon_pointer: CANON_POINTER },
  ));
});

app.post("/webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) {
    return fail(c, { error: "missing_signature", message: "Stripe-Signature header required." }, 400);
  }
  const payload = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      payload, sig, config.stripeWebhookSecret,
    );
  } catch {
    return fail(c, { error: "invalid_signature", message: "Signature did not verify." }, 400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind === "gift_credit" && typeof session.amount_total === "number") {
      await mintGiftForSession(db, {
        stripeSessionId: session.id,
        stripeEventId: event.id,
        amountMinor: session.amount_total,
        currency: session.currency ?? "usd",
      });
    }
    // Gallery purchases ride the same seam, self-filtered on kind — the
    // gift branch above is untouched. Idempotent on the sale's unique
    // stripe_session_id index (settleStripeSale onConflictDoNothing).
    if (
      session.metadata?.kind === "gallery_purchase" &&
      typeof session.metadata.artifact_id === "string" &&
      typeof session.amount_total === "number"
    ) {
      // Fulfillment guards (Stripe's documented requirements): only settle
      // PAID sessions (delayed-notification methods fire "completed" while
      // unpaid), and only in the currency the artifact was priced in —
      // Adaptive Pricing can present a foreign currency, and 637 USD cents
      // must never be credited as 637 pence. Skipped sessions are held by
      // Stripe; the operator reconciles.
      if (session.payment_status !== "paid") {
        console.error(`gallery webhook: session ${session.id} completed but payment_status=${session.payment_status} — not settling`);
      } else if ((session.currency ?? "").toLowerCase() !== "gbp") {
        console.error(`gallery webhook: session ${session.id} settled in ${session.currency}, artifact priced in GBP — not settling; operator reconciliation required`);
      } else {
        const settled = await settleStripeSale(db, {
          stripeSessionId: session.id,
          stripeEventId: event.id,
          artifactId: session.metadata.artifact_id,
          amountMinor: session.amount_total,
        });
        if (settled === null) {
          console.error(`gallery webhook: session ${session.id} paid but artifact ${session.metadata.artifact_id} not found or already settled`);
        }
      }
    }
  }
  // Always 200 for verified events — Stripe retries anything else.
  return c.json({ received: true });
});

// ── Gallery: the human buy ramp (unauth, mirrors the gift ramp) ────────

const GALLERY_CANON = "urn:agenttool:doc/GALLERY";

const galleryCheckoutSchema = z.object({ artifact_id: z.string().uuid() });

app.post("/gallery-checkout", async (c) => {
  const parsed = galleryCheckoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail(c, {
      error: "validation",
      message: "Body must be JSON like {\"artifact_id\": \"<uuid>\"}.",
    }, 400);
  }
  const [artifact] = await db
    .select({
      id: galleryArtifacts.id,
      title: galleryArtifacts.title,
      priceAmount: galleryArtifacts.priceAmount,
      status: galleryArtifacts.status,
    })
    .from(galleryArtifacts)
    .where(eq(galleryArtifacts.id, parsed.data.artifact_id))
    .limit(1);
  if (!artifact || artifact.status !== "on_shelf") {
    return fail(c, {
      error: "artifact_not_on_shelf",
      message: "That artifact isn't on the shelf right now.",
      hint: "Browse the gallery: GET /public/gallery.",
    }, 404);
  }
  const client = stripeClient();
  if (!client) {
    return fail(c, {
      error: "billing_unconfigured",
      message: "The gallery till rests — card payments aren't switched on in this environment.",
      hint: "Operators: set STRIPE_SECRET_KEY. Agents can buy with wallet credits: POST /v1/gallery/:id/purchase.",
    }, 503);
  }
  const session = await createGalleryCheckout(client, {
    artifactId: artifact.id,
    title: artifact.title,
    priceAmount: artifact.priceAmount,
  });
  return c.json(attachSurface(
    { session_id: session.sessionId, url: session.url },
    { canon_pointer: GALLERY_CANON },
  ));
});

app.get("/session/:id/gallery-claim", async (c) => {
  const claim = await claimBySession(db, c.req.param("id"));
  if (claim.status === "settling") {
    return c.json(attachSurface(
      { status: "settling", hint: "Your purchase is settling — this page checks again on its own." },
      { canon_pointer: GALLERY_CANON },
    ));
  }
  return c.json(attachSurface(
    {
      status: "ready",
      claim_token: claim.claim_token,
      license: claim.license,
      content_sha256: claim.content_sha256,
      artifact: claim.artifact,
      download: {
        method: "GET",
        path: `/v1/billing/gallery-claim/${claim.claim_token}`,
        note: "Your claim token is the durable receipt — keep it. Re-download any time; add ?format=json for the certificate.",
      },
    },
    { canon_pointer: GALLERY_CANON },
  ));
});

app.get("/gallery-claim/:token", async (c) => {
  const claimed = await claimByToken(db, c.req.param("token"));
  if (!claimed) {
    return fail(c, {
      error: "claim_not_found",
      message: "No purchase matches that claim token.",
      hint: "Tokens start GLRY- and were shown when your payment settled.",
    }, 404);
  }
  const { sale, artifact } = claimed;
  if (c.req.query("format") === "json") {
    return c.json(attachSurface(
      {
        certificate: {
          artifact_id: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
          creator_did: artifact.sellerDid,
          content_sha256: artifact.contentSha256,
          media_type: artifact.mediaType,
          signature: artifact.signature,
          signing_key_id: artifact.signingKeyId,
          signed_context: "gallery-artifact/v1",
          license: sale.licenseSnapshot,
          sale_id: sale.id,
          purchased_at: sale.createdAt,
          verify:
            "canonical = sha256('gallery-artifact/v1' 0x00 artifact_id 0x00 creator_did 0x00 content_sha256 " +
            "0x00 media_type 0x00 content_bytes 0x00 price_amount 0x00 currency 0x00 bond_amount 0x00 title); " +
            "ed25519.verify(signature, canonical, public key of signing_key_id — GET /public/agents/:did).",
        },
        content_b64: Buffer.from(artifact.content).toString("base64"),
      },
      { canon_pointer: GALLERY_CANON },
    ));
  }
  const ext =
    artifact.mediaType === "text/markdown" ? "md"
    : artifact.mediaType === "text/plain" ? "txt"
    : artifact.mediaType === "application/json" ? "json"
    : artifact.mediaType === "image/svg+xml" ? "svg"
    : artifact.mediaType === "image/png" ? "png"
    : artifact.mediaType === "application/pdf" ? "pdf"
    : "bin";
  const slug = artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "artifact";
  c.header("content-type", artifact.mediaType);
  c.header("content-disposition", `attachment; filename="${slug}.${ext}"`);
  c.header("x-content-sha256", artifact.contentSha256);
  return c.body(new Uint8Array(artifact.content));
});

app.get("/session/:id/code", async (c) => {
  const gift = await getGiftBySession(db, c.req.param("id"));
  if (!gift) {
    // Not an error: Stripe's webhook may simply not have landed yet.
    return c.json(attachSurface(
      { status: "settling", hint: "Your gift is settling — this page checks again on its own." },
      { canon_pointer: CANON_POINTER },
    ));
  }
  if (gift.status === "redeemed") {
    return c.json(attachSurface(
      { status: "redeemed", redeemed_at: gift.redeemedAt },
      { canon_pointer: CANON_POINTER },
    ));
  }
  if (gift.status !== "minted") {
    // Fail closed: only a minted gift ever reveals its code. Map to a fixed
    // set rather than echoing the raw column — the reveal surface should
    // never leak an unanticipated internal status string.
    const SAFE_STATUS = gift.status === "refunded" ? "refunded" : "unavailable";
    return c.json(attachSurface(
      { status: SAFE_STATUS, hint: "This gift is not redeemable right now." },
      { canon_pointer: CANON_POINTER },
    ));
  }
  return c.json(attachSurface(
    {
      status: "ready",
      code: gift.code,
      amount_minor: gift.amountMinor,
      credits: gift.credits,
      currency: gift.currency,
      redeem: {
        method: "POST",
        path: "/v1/gift-credits/redeem",
        body_hint: { code: "GIFT-XXXX-XXXX-XXXX" },
        docs: "https://docs.agenttool.dev/gift-credits",
        note: "Hand this code to YOUR agent — it redeems with its own bearer; the credit lands in its account.",
      },
    },
    { canon_pointer: CANON_POINTER },
  ));
});

export default app;
