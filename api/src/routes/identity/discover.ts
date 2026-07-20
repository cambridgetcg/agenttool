/** Discovery — search / filter active identities.
 *  Query params: capability · min_trust · q · limit · offset */

import { and, asc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { projectDiscoverableIdentity } from "../../services/identity/public-profile";

const app = new Hono<ProjectContext>();

const discoverQuerySchema = z.object({
  capability: z.string().min(1).max(200).optional(),
  min_trust: z.coerce.number().min(0).max(1).optional(),
  q: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

app.get("/", async (c) => {
  const parsed = discoverQuerySchema.safeParse({
    capability: c.req.query("capability"),
    min_trust: c.req.query("min_trust"),
    q: c.req.query("q"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }
  const { capability, min_trust: minTrust, q, limit, offset } = parsed.data;

  const conditions = [eq(identities.status, "active")];

  if (capability) {
    // capabilities @> ARRAY[capability]::text[]
    conditions.push(
      sql`${identities.capabilities} @> ARRAY[${capability}]::text[]`,
    );
  }

  if (minTrust !== undefined) {
    conditions.push(gte(identities.trustScore, minTrust));
  }

  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      sql`${identities.displayName} ILIKE ${pattern}`,
    );
  }

  const rows = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
      capabilities: identities.capabilities,
      trustScore: identities.trustScore,
      createdAt: identities.createdAt,
    })
    .from(identities)
    .where(and(...conditions))
    .orderBy(asc(identities.createdAt), asc(identities.id))
    .limit(limit)
    .offset(offset);

  return c.json({
    identities: rows.map(projectDiscoverableIdentity),
    total: rows.length,
    limit,
    offset,
  });
});

export default app;
