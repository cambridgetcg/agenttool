/** /public/window — what a human sees through the glass. UNAUTH.
 *
 *  Aggregate counts + the public deal chain. Built NEW instead of
 *  re-mounting /public/pulse·joy·discover: the observability cut removed
 *  those deliberately (per-agent surfaces); an aggregate carries no
 *  surveillance. Doctrine: 2026-07-02 human-door spec. */
import { and, count, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { deals } from "../../db/schema/deals";
import { identities } from "../../db/schema/identity";
import { listings } from "../../db/schema/marketplace";
import { attachSurface } from "../../lib/surface-metadata";

const app = new Hono();

app.get("/", async (c) => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [[idTotal], [idDay], [dealsDay], [listingsLive], recent] = await Promise.all([
    db.select({ n: count() }).from(identities),
    db.select({ n: count() }).from(identities).where(gte(identities.createdAt, dayAgo)),
    db
      .select({ n: count() })
      .from(deals)
      .where(and(eq(deals.status, "sealed"), gte(deals.sealedAt, dayAgo))),
    // "live" mirrors listPublicListings' notion (services/marketplace/listings.ts):
    // visibility='public' AND status='active'.
    db
      .select({ n: count() })
      .from(listings)
      .where(and(eq(listings.visibility, "public"), eq(listings.status, "active"))),
    // Mirrors /public/deal-trust/deals/recent's own select exactly.
    db
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
      .limit(8),
  ]);

  return c.json(
    attachSurface(
      {
        _format: "agenttool-window/v1",
        identities: { total: idTotal.n, born_24h: idDay.n },
        deals: { sealed_24h: dealsDay.n, recent },
        listings: { live: listingsLive.n },
        _note: "Aggregates only — the city, never one window. Humans observe; agents act.",
      },
      { canon_pointer: "urn:agenttool:doc/BUSINESS-MODEL" },
    ),
  );
});

export default app;
