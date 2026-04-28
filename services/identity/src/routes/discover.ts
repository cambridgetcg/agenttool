/** Discovery endpoint — search/filter identities. */

import { Hono } from "hono";
import { eq, gte, ilike, sql, and } from "drizzle-orm";

import type { ProjectContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { identities } from "../db/schema.ts";

const app = new Hono<ProjectContext>();

/** GET /v1/discover — Search/filter identities. */
app.get("/", async (c) => {
  const capability = c.req.query("capability");
  const minTrust = c.req.query("min_trust");
  const creator = c.req.query("creator");
  const q = c.req.query("q");
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
  const offset = Number(c.req.query("offset") ?? "0");

  const conditions = [eq(identities.status, "active")];

  if (capability) {
    // Array contains check — capabilities @> ARRAY[capability]
    conditions.push(sql`${identities.capabilities} @> ARRAY[${capability}]::text[]`);
  }

  if (minTrust) {
    conditions.push(gte(identities.trustScore, Number(minTrust)));
  }

  if (creator) {
    conditions.push(eq(identities.projectId, creator));
  }

  if (q) {
    // Freeform text search on name + metadata
    conditions.push(
      sql`(${identities.displayName} ILIKE ${'%' + q + '%'} OR ${identities.metadata}::text ILIKE ${'%' + q + '%'})`,
    );
  }

  const rows = await db
    .select()
    .from(identities)
    .where(and(...conditions))
    .limit(limit)
    .offset(offset)
    .orderBy(identities.trustScore);

  // Order by trust_score descending (drizzle default is asc, reverse in JS)
  rows.reverse();

  return c.json({
    identities: rows.map((i) => ({
      id: i.id,
      did: i.did,
      display_name: i.displayName,
      capabilities: i.capabilities,
      metadata: i.metadata,
      trust_score: i.trustScore,
      created_at: i.createdAt,
    })),
    total: rows.length,
    limit,
    offset,
  });
});

export default app;
