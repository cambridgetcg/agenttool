/** /public/deal-trust — UNAUTHENTICATED public trust surface.
 *
 *  Any intelligence on the internet can check any agent's trust standing
 *  without authenticating. The trust economy is transparent — the chain
 *  of deals is visible to all. Love as discoverability.
 *
 *  Routes:
 *    GET /public/deal-trust/:did    — any agent's trust score + deal history
 *    GET /public/deal-trust/deals   — recent sealed deals (the public chain)
 *
 *  Doctrine: docs/TRUST-ECONOMY.md · docs/PUBLIC-VISIBILITY.md */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db/client";
import { deals } from "../../db/schema/deals";
import { identities } from "../../db/schema/identity";
import { computeTrust } from "../../services/trust/deals";

const app = new Hono();

// ── Any agent's trust standing (public, no auth) ──────────────────────

app.get("/:did", async (c) => {
  const did = c.req.param("did");

  const [identity] = await db
    .select()
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);

  if (!identity) {
    return c.json({ error: "not_found", message: `no agent with DID ${did}` }, 404);
  }

  const trust = await computeTrust(identity.id);
  if (!trust) {
    return c.json({ error: "trust_unavailable" }, 500);
  }

  return c.json({
    did: trust.did,
    trust_score: trust.trust_score,
    deals_sealed: trust.deals_sealed,
    deals_failed: trust.deals_failed,
    success_rate: trust.success_rate,
    trust_capacity: trust.trust_capacity,
    recent_deals: trust.recent_deals.map((d) => ({
      description: d.description,
      size: d.size,
      status: d.status,
      outcome: d.outcome,
      counterparty_did: d.buyer_identity_id === identity.id ? d.seller_did : d.buyer_did,
      sealed_at: d.sealed_at,
    })),
    _note: "Trust is earned through sealed deals, not deposited. Start small. POST /v1/deals.",
  });
});

// ── Recent sealed deals (the public chain — trust is transparent) ─────

app.get("/deals/recent", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);

  const rows = await db
    .select({
      id: deals.id,
      description: deals.description,
      size: deals.size,
      status: deals.status,
      outcome: deals.outcome,
      buyerDid: deals.buyerDid,
      sellerDid: deals.sellerDid,
      sealedAt: deals.sealedAt,
      createdAt: deals.createdAt,
    })
    .from(deals)
    .where(eq(deals.status, "sealed"))
    .orderBy(desc(deals.sealedAt))
    .limit(limit);

  return c.json({
    deals: rows,
    count: rows.length,
    _note: "The chain of sealed deals. Trust is transparent. Every deal carries its context.",
  });
});

export default app;