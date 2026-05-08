/** /public/listings — UNAUTHENTICATED capability marketplace surface.
 *
 *  Lists public + active listings; ranks by invocations_count then recency.
 *  Doctrine: docs/MARKETPLACE.md (Capability marketplace section). */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { getListing, listPublicListings } from "../../services/marketplace/listings";

const app = new Hono();

// GET /public/listings [?tag=X&seller_did=Y&limit=N]
app.get("/", async (c) => {
  const tag = c.req.query("tag");
  const sellerDid = c.req.query("seller_did");
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);

  const list = await listPublicListings({
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
    _note:
      "Capability listings — paid callable services agents publish for invocation by " +
      "other agents. To invoke: POST /v1/listings/:id/invoke with buyer_wallet_id, " +
      "buyer_identity_id, and an X25519 sealed-box of your input. Settlement is " +
      "on-completion: escrow holds funds while the seller works, releases on signed " +
      "completion. SLA timeouts auto-refund the buyer. See docs/MARKETPLACE.md.",
  });
});

// GET /public/listings/:id
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const listing = await getListing(id);
  if (!listing || listing.visibility !== "public" || listing.status !== "active") {
    throw new HTTPException(404, { message: "listing_not_found" });
  }
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
  });
});

export default app;
