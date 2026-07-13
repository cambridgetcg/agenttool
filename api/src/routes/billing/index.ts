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
  claimBySession, claimByToken, reverseGallerySale, settleStripeSale,
} from "../../services/gallery";
import { galleryArtifacts } from "../../db/schema/gallery";
import { eq } from "drizzle-orm";

const app = new Hono();

// Every route in this namespace can carry a Stripe session id, gift code,
// gallery claim token, or paid bytes. Those values are bearer-like even
// though the browser entry route is unauthenticated: never let a browser,
// intermediary, indexer, or outbound referrer retain them.
app.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store, max-age=0");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  await next();
});

const CANON_POINTER = "urn:agenttool:doc/BUSINESS-MODEL";

// ── Per-IP fixed-window rate limits for the unauth money surface ──────
// In-memory and per-machine (3 Fly machines → ~3× the stated budget);
// Redis is deliberately absent in this deployment, and a checkout flood
// is annoying long before it is dangerous — Stripe sessions expire in
// 30 minutes and money only moves on a signature-verified webhook.
const RL = new Map<string, { n: number; resetAt: number }>();
function rateLimited(c: { req: { header: (k: string) => string | undefined } }, key: string, max: number, windowMs: number): boolean {
  // api.agenttool.dev is proxied through Cloudflare, so fly-client-ip is
  // a rotating CF edge address — the human's IP rides cf-connecting-ip.
  // (Spoofable only by clients that bypass Cloudflare and talk to Fly
  // directly; acceptable for this tier — the till is guarded, not vaulted.)
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("fly-client-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const now = Date.now();
  if (RL.size > 10_000) {
    for (const [k, v] of RL) if (v.resetAt < now) RL.delete(k);
  }
  const k = `${key}:${ip}`;
  const cur = RL.get(k);
  if (!cur || cur.resetAt < now) {
    RL.set(k, { n: 1, resetAt: now + windowMs });
    return false;
  }
  cur.n++;
  return cur.n > max;
}
function tooMany(c: Parameters<typeof fail>[0]): Response {
  return fail(c, {
    error: "rate_limited",
    message: "The till serves one queue at a time — try again in a few minutes.",
  }, 429);
}

/** Test seam — routes use the injected client when set. */
let stripeOverride: CheckoutClient | null = null;
let checkoutAvailabilityOverride: boolean | null = null;
export function setStripeForTests(s: CheckoutClient | null): void {
  stripeOverride = s;
}
/** Test seam only. Production checkout creation stays hard-paused until the
 * consumer, privacy, support, and digital-delivery foundations are complete. */
export function setCheckoutAvailabilityForTests(value: boolean | null): void {
  checkoutAvailabilityOverride = value;
}
function stripeClient(): CheckoutClient | null {
  if (stripeOverride) return stripeOverride;
  if (!config.stripeSecretKey) return null;
  return getStripe();
}

function newCardCheckoutsAvailable(): boolean {
  return checkoutAvailabilityOverride ?? false;
}

function checkoutResting(c: Parameters<typeof fail>[0]): Response {
  return fail(c, {
    error: "checkout_resting",
    message:
      "New card checkout is paused across AgentTool while operator, price and tax, privacy, cancellation, refund, support, and immediate-delivery commitments remain incomplete.",
    hint:
      "No payment session was created. Signed Stripe webhooks and existing paid-session recovery remain available so earlier purchases are not stranded.",
  }, 503);
}

const checkoutSchema = z.object({ amount_minor: z.number().int() });

app.post("/checkout", async (c) => {
  if (!newCardCheckoutsAvailable()) return checkoutResting(c);
  if (rateLimited(c, "checkout", 10, 10 * 60_000)) return tooMany(c);
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
        console.error(`gallery webhook: event ${event.id} completed but payment_status=${session.payment_status} — not settling`);
      } else if ((session.currency ?? "").toLowerCase() !== "gbp") {
        console.error(`gallery webhook: event ${event.id} settled in ${session.currency}, artifact priced in GBP — not settling; operator reconciliation required`);
      } else {
        const settled = await settleStripeSale(db, {
          stripeSessionId: session.id,
          stripeEventId: event.id,
          stripePaymentIntent:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id,
          artifactId: session.metadata.artifact_id,
          amountMinor: session.amount_total,
        });
        if (settled === null) {
          console.error(`gallery webhook: event ${event.id} paid but artifact ${session.metadata.artifact_id} not found or already settled`);
        }
      }
    }
  }

  // Refunds and chargebacks — reverse the gallery sale: license revoked,
  // seller net clawed back (never below zero; shortfall recorded). Gift
  // sessions produce "no_gallery_sale" and are untouched. Chargebacks log
  // loudly for the operator: bonds never burn automatically (friendly
  // fraud exists) — a takedown is a named human judgment.
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const obj = event.data.object as Stripe.Charge | Stripe.Dispute;
    const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id;
    if (pi) {
      const kind = event.type === "charge.refunded" ? "refund" as const : "chargeback" as const;
      const result = await reverseGallerySale(db, {
        stripePaymentIntent: pi,
        kind,
        stripeEventId: event.id,
      });
      if (result.outcome === "reversed") {
        console.error(
          `gallery webhook: ${kind} on ${pi} → sale ${result.sale_id} reversed; clawed ${result.clawed}, shortfall ${result.shortfall}` +
          (kind === "chargeback" ? " — OPERATOR: judge whether this artifact deserves takedown+burn (POST /v1/gallery/:id/takedown)" : ""),
        );
      }
    }
  }
  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    console.error(`billing webhook: async payment failed for event ${event.id} (${session.metadata?.kind ?? "unknown kind"}) — nothing was settled, nothing to reverse`);
  }

  // Always 200 for verified events — Stripe retries anything else.
  return c.json({ received: true });
});

// ── Gallery: the human buy ramp (unauth, mirrors the gift ramp) ────────

const GALLERY_CANON = "urn:agenttool:doc/GALLERY";
const STRIPE_SESSION_ID = /^cs_[A-Za-z0-9_]{3,250}$/;
const GALLERY_CLAIM_TOKEN = /^GLRY-[A-Za-z0-9_-]{32}$/;

const galleryCheckoutSchema = z.object({ artifact_id: z.string().uuid() });

app.post("/gallery-checkout", async (c) => {
  if (!newCardCheckoutsAvailable()) return checkoutResting(c);
  if (rateLimited(c, "gallery-checkout", 10, 10 * 60_000)) return tooMany(c);
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
  if (rateLimited(c, "gallery-claim", 240, 10 * 60_000)) return tooMany(c);
  const sessionId = c.req.param("id");
  if (!STRIPE_SESSION_ID.test(sessionId)) {
    return fail(c, {
      error: "invalid_session_reference",
      message: "The checkout session reference is not well formed.",
    }, 400);
  }
  const claim = await claimBySession(db, sessionId);
  if (claim.status === "settling") {
    return c.json(attachSurface(
      {
        status: "settling",
        hint:
          "No settled purchase record is available for this return session yet. It may still be settling; recovery does not create another payment.",
      },
      { canon_pointer: GALLERY_CANON },
    ));
  }
  if (claim.status === "refunded") {
    return c.json(attachSurface(
      { status: "refunded", hint: "This purchase was refunded — the license is closed and the download no longer opens." },
      { canon_pointer: GALLERY_CANON },
    ));
  }
  return c.json(attachSurface(
    {
      status: "ready",
      claim_token: claim.claim_token,
      license: claim.license,
      price_paid: claim.price_paid,
      currency: claim.currency,
      purchased_at: claim.purchased_at,
      content_sha256: claim.content_sha256,
      artifact: claim.artifact,
      download: {
        method: "GET",
        path: `/v1/billing/gallery-claim/${claim.claim_token}`,
        note: "Your claim token is a bearer secret, not a durability guarantee. Save it privately, download and verify the bytes now, and add ?format=json for the current certificate.",
      },
    },
    { canon_pointer: GALLERY_CANON },
  ));
});

app.get("/gallery-claim/:token", async (c) => {
  if (rateLimited(c, "gallery-download", 60, 10 * 60_000)) return tooMany(c);
  const token = c.req.param("token");
  if (!GALLERY_CLAIM_TOKEN.test(token)) {
    return fail(c, {
      error: "invalid_claim_token",
      message: "The gallery claim token is not well formed.",
    }, 400);
  }
  const claimed = await claimByToken(db, token);
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
  if (rateLimited(c, "gift-session", 240, 10 * 60_000)) return tooMany(c);
  const sessionId = c.req.param("id");
  if (!STRIPE_SESSION_ID.test(sessionId)) {
    return fail(c, {
      error: "invalid_session_reference",
      message: "The checkout session reference is not well formed.",
    }, 400);
  }
  const gift = await getGiftBySession(db, sessionId);
  if (!gift) {
    // Not an error: Stripe's webhook may simply not have landed yet.
    return c.json(attachSurface(
      {
        status: "settling",
        hint:
          "No issued gift record is available for this return session yet. It may still be settling; checking does not create another payment.",
      },
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
        note: "Give this bearer secret only to the intended project custodian. Redemption uses an authenticated project bearer and credits that project's shared balance, not an individual identity account.",
      },
    },
    { canon_pointer: CANON_POINTER },
  ));
});

export default app;
