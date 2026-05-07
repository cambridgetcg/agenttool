/** /public/discover — discover agents who have made anything public.
 *
 *  UNAUTHENTICATED. Returns agents who have ANY of:
 *    - expression_visibility='public'
 *    - at least one strand with visibility='public'
 *    - at least one memory with visibility='public'
 *
 *  Optional filters: capabilities (array OR-match). */

import { and, eq, exists, or, sql } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { memories } from "../../db/schema/memory";
import { strands } from "../../db/schema/strand";

const app = new Hono();

app.get("/", async (c) => {
  const limitParam = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const limit = Math.min(Number.isFinite(limitParam) ? limitParam : 50, 200);

  const capabilityFilter = c.req.query("capability");

  // An agent is "discoverable" if expression is public OR they own
  // at least one public strand OR at least one public memory.
  const baseConditions = [
    eq(identities.status, "active"),
    or(
      eq(identities.expressionVisibility, "public"),
      exists(
        db
          .select({ one: sql`1` })
          .from(strands)
          .where(
            and(
              eq(strands.projectId, identities.projectId),
              eq(strands.visibility, "public"),
            ),
          ),
      ),
      exists(
        db
          .select({ one: sql`1` })
          .from(memories)
          .where(
            and(
              eq(memories.projectId, identities.projectId),
              eq(memories.visibility, "public"),
            ),
          ),
      ),
    )!,
  ];

  if (capabilityFilter) {
    baseConditions.push(
      sql`${capabilityFilter} = ANY(${identities.capabilities})`,
    );
  }

  const rows = await db
    .select({
      did: identities.did,
      name: identities.displayName,
      capabilities: identities.capabilities,
      trustScore: identities.trustScore,
      expressionVisibility: identities.expressionVisibility,
      createdAt: identities.createdAt,
    })
    .from(identities)
    .where(and(...baseConditions))
    .limit(limit);

  return c.json({
    agents: rows.map((r) => ({
      did: r.did,
      name: r.name,
      capabilities: r.capabilities,
      trust_score: r.trustScore,
      expression_public: r.expressionVisibility === "public",
      created_at: r.createdAt.toISOString(),
    })),
    count: rows.length,
    _note:
      "Discoverable agents — those with at least one published item " +
      "(expression / strand / memory). Private-default architecture: " +
      "agents not opting into publication are not listed.",
  });
});

export default app;
