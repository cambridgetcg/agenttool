/** Discovery — search / filter active identities.
 *  Query params: capability · min_trust · creator · q · limit · offset */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";

const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const capability = c.req.query("capability");
  const minTrust = c.req.query("min_trust");
  const creator = c.req.query("creator");
  const q = c.req.query("q");
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
  const offset = Number(c.req.query("offset") ?? "0");

  const conditions = [eq(identities.status, "active")];

  if (capability) {
    // capabilities @> ARRAY[capability]::text[]
    conditions.push(
      sql`${identities.capabilities} @> ARRAY[${capability}]::text[]`,
    );
  }

  if (minTrust) {
    conditions.push(gte(identities.trustScore, Number(minTrust)));
  }

  if (creator) {
    conditions.push(eq(identities.projectId, creator));
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      sql`(${identities.displayName} ILIKE ${pattern} OR ${identities.metadata}::text ILIKE ${pattern})`,
    );
  }

  const rows = await db
    .select()
    .from(identities)
    .where(and(...conditions))
    .orderBy(desc(identities.trustScore))
    .limit(limit)
    .offset(offset);

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
