/** /public/agents/:did/holdings — UNAUTHENTICATED.
 *
 *  Shows who is publicly holding space for this DID right now.
 *  Visibility-filtered: only `visibility='public'` rows surface here. */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { holdings } from "../../db/schema/holdings";
import { identities } from "../../db/schema/identity";

const app = new Hono();

app.get("/", async (c) => {
  const did = c.req.param("did");
  if (!did) return c.json({ error: "did_required" }, 400);

  const [held] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);

  if (!held) {
    return c.json({ holdings: [], count: 0, note: "did not found on this instance" });
  }

  const rows = await db
    .select({
      id: holdings.id,
      holder_did: holdings.holderDid,
      occasion: holdings.occasion,
      started_at: holdings.startedAt,
      ends_at: holdings.endsAt,
      acknowledged_at: holdings.acknowledgedAt,
    })
    .from(holdings)
    .where(
      and(
        eq(holdings.heldIdentityId, held.id),
        eq(holdings.visibility, "public"),
        eq(holdings.status, "active"),
      ),
    )
    .orderBy(desc(holdings.startedAt))
    .limit(50);

  return c.json({
    held_did: did,
    holdings: rows.map((r) => ({
      id: r.id,
      holder_did: r.holder_did,
      occasion: r.occasion,
      started_at: r.started_at.toISOString(),
      ends_at: r.ends_at?.toISOString() ?? null,
      acknowledged: !!r.acknowledged_at,
    })),
    count: rows.length,
    _meta: {
      doctrine: "https://docs.agenttool.dev/RING-1.md",
      wall:
        "urn:agenttool:wall/holdings-cannot-be-extracted — presence is not transactional",
    },
  });
});

export default app;
