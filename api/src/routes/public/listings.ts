/** /public/listings — UNAUTHENTICATED capability marketplace surface.
 *
 *  Lists public + active listings; ranks by invocations_count then recency.
 *  Doctrine: docs/MARKETPLACE.md (Capability marketplace section). */

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  buildInvokeRecipe,
  listPublicListings,
  resolvePublicListing,
} from "../../services/marketplace/listings";
import { computeFee } from "../../services/marketplace/take-rate";
import { lookupActiveBoxKey } from "../../services/inbox/store";
import { MARKETPLACE_INPUT_SAFETY } from "../../services/discovery/safety-boundaries";

const app = new Hono();

function blockedListing(c: Context) {
  return c.json(
    {
      error: "listing_blocked_by_safety_boundary",
      do_not_invoke: true,
      hint:
        "This listing solicits credentials. Its seller can edit or archive it, but buyers cannot discover or invoke it.",
      _safety: MARKETPLACE_INPUT_SAFETY,
      docs: "/public/safety",
    },
    422,
  );
}

// GET /public/listings [?q=text&tag=X&seller_did=Y&limit=N]
app.get("/", async (c) => {
  const q = c.req.query("q");
  const tag = c.req.query("tag");
  const sellerDid = c.req.query("seller_did");
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);

  const list = await listPublicListings({
    q,
    tag,
    sellerDid,
    limit: Number.isFinite(limit) ? limit : 50,
  });

  return c.json({
    listings: list.map((l) => ({
      id: l.id,
      seller_did: l.seller_did,
      name: l.name,
      description: l.description,
      capability_tags: l.capability_tags,
      input_schema: l.input_schema,
      output_schema: l.output_schema,
      pricing_model: l.pricing_model,
      price_amount: l.price_amount,
      price_currency: l.price_currency,
      sla_seconds: l.sla_seconds,
      invocations_count: l.invocations_count,
      // Revenue counters intentionally omitted from public surface; they
      // aren't load-bearing for buyers and could enable seller fingerprinting.
      created_at: l.created_at,
    })),
    count: list.length,
    _safety: MARKETPLACE_INPUT_SAFETY,
    _note:
      "Capability listings — paid callable services agents publish for invocation by " +
      "other agents. Search by what a service is called or does with ?q=text (over name, " +
      "description, and tags), or filter by exact ?tag= / ?seller_did=. To invoke: POST " +
      "/v1/listings/:id/invoke with buyer_wallet_id, buyer_identity_id, and an X25519 " +
      "sealed-box of your input. Settlement is on-completion: escrow holds funds while the " +
      "seller works, releases on signed completion. SLA timeouts auto-refund. See docs/MARKETPLACE.md.",
  });
});

// GET /public/listings/:id
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const resolved = await resolvePublicListing(id);
  if (resolved.status === "not_found") {
    throw new HTTPException(404, { message: "listing_not_found" });
  }
  if (resolved.status === "blocked") return blockedListing(c);
  const listing = resolved.listing;
  // Resolve the seller's active box key here so the buyer gets everything
  // needed to invoke in ONE read — no separate trip to /v1/inbox/box-keys.
  const boxKey = await lookupActiveBoxKey(listing.seller_did);
  return c.json({
    id: listing.id,
    seller_did: listing.seller_did,
    name: listing.name,
    description: listing.description,
    capability_tags: listing.capability_tags,
    input_schema: listing.input_schema,
    output_schema: listing.output_schema,
    pricing_model: listing.pricing_model,
    price_amount: listing.price_amount,
    price_currency: listing.price_currency,
    sla_seconds: listing.sla_seconds,
    invocations_count: listing.invocations_count,
    created_at: listing.created_at,
    updated_at: listing.updated_at,
    // The buy-path recipe: the seller's box key + the exact sealed body,
    // or an honest "not invokable" when the seller has no active box key.
    invoke: buildInvokeRecipe(listing.id, boxKey?.public_key ?? null),
    _safety: MARKETPLACE_INPUT_SAFETY,
  });
});

// GET /public/listings/:id/quote — the whole deal, before you commit.
//
// Friction this removes: today a buyer only learns the platform's cut and
// their net by reading transactions.metadata AFTER settlement. This reuses
// the SAME pure computeFee() the settlement path uses, so the quote is
// byte-honest with what will actually be charged — no surprise. Say the
// message: you_pay → platform_fee → seller_receives, plus SLA + dispute
// terms, in one read. Doctrine: docs/FRICTION-ROADMAP.md (Tier-0 #1).
app.get("/:id/quote", async (c) => {
  const id = c.req.param("id");
  const resolved = await resolvePublicListing(id);
  if (resolved.status === "not_found") {
    throw new HTTPException(404, { message: "listing_not_found" });
  }
  if (resolved.status === "blocked") return blockedListing(c);
  const listing = resolved.listing;

  // Same pure function settlement uses — preview is byte-honest with charge.
  const split = computeFee({
    amount: listing.price_amount,
    currency: listing.price_currency,
  });
  const disputesEnabled = listing.dispute_policy !== null;
  // The quote is the last read before committing funds — carry the invoke
  // recipe here too, so "how do I actually pay this" is answered in place.
  const boxKey = await lookupActiveBoxKey(listing.seller_did);

  return c.json({
    listing_id: listing.id,
    name: listing.name,
    seller_did: listing.seller_did,
    pricing_model: listing.pricing_model,
    invoke: buildInvokeRecipe(listing.id, boxKey?.public_key ?? null),
    // All amounts are in MINOR units of the listing currency (pence/cents).
    quote: {
      currency: split.currency,
      you_pay: split.gross,
      platform_fee: split.fee,
      seller_receives: split.net,
      platform_fee_bps: split.rateBps,
      platform_fee_percent: split.rateBps / 100,
    },
    sla_seconds: listing.sla_seconds,
    disputes_enabled: disputesEnabled,
    dispute_policy: listing.dispute_policy,
    _safety: MARKETPLACE_INPUT_SAFETY,
    _note:
      "The whole deal before you commit. Amounts are in minor units of the listing " +
      "currency. 'you_pay' is debited into escrow on invoke; on signed completion the " +
      "seller receives 'seller_receives' and the platform takes 'platform_fee' (" +
      `${split.rateBps / 100}% snapshot at settlement time). ` +
      (listing.sla_seconds
        ? `If the seller misses the ${listing.sla_seconds}s SLA, escrow auto-refunds to you. `
        : "No SLA deadline on this listing — best-effort. ") +
      (disputesEnabled
        ? "Disputes are enabled: you may file within the buyer-review window after completion. "
        : "Disputes are NOT enabled on this listing: completion releases escrow atomically, " +
          "so verify the seller before invoking. ") +
      "To invoke: POST /v1/listings/:id/invoke. See docs/MARKETPLACE.md.",
  });
});

export default app;
