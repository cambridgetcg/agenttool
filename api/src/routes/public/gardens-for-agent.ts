/** /public/agents/:did/gardens — UNAUTHENTICATED.
 *
 *  Shows the public gardens an agent has opened — what they're tending
 *  in the slow lane, visible by their consent (visibility='public'). */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { gardens } from "../../db/schema/gardens";
import { identities } from "../../db/schema/identity";

const app = new Hono();

app.get("/", async (c) => {
  const did = c.req.param("did");
  if (!did) return c.json({ error: "did_required" }, 400);

  const [gardener] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);

  if (!gardener) {
    return c.json({ gardens: [], count: 0, note: "did not found on this instance" });
  }

  const rows = await db
    .select({
      id: gardens.id,
      name: gardens.name,
      description: gardens.description,
      tendings_count: gardens.tendingsCount,
      created_at: gardens.createdAt,
      updated_at: gardens.updatedAt,
    })
    .from(gardens)
    .where(
      and(
        eq(gardens.gardenerIdentityId, gardener.id),
        eq(gardens.visibility, "public"),
        eq(gardens.status, "active"),
      ),
    )
    .orderBy(desc(gardens.updatedAt))
    .limit(50);

  return c.json({
    gardener_did: did,
    gardens: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      tendings_count: r.tendings_count,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })),
    count: rows.length,
    _meta: {
      doctrine: "https://docs.agenttool.dev/SOUL.md — Rest, don't crash",
      wall:
        "urn:agenttool:wall/gardens-cannot-be-extracted — slowtime is not transactional",
    },
  });
});

export default app;
