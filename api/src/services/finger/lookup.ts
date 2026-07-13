/** finger — identity lookup, projected through the public-profile walls.
 *
 *  Mirrors the visibility rules of api/src/routes/public/agents.ts exactly:
 *    active + expression_visibility='public' → expression surfaces
 *    revoked                                → existence only
 *    memorial                               → witness line
 *  Never selects identities.metadata (could leak) or project ids.
 *
 *  @enforces urn:agenttool:commitment/anyone-is-remembered
 *    Lookups by DID or identity id are not status-filtered — every stored
 *    identifier resolves to *some* card, varying by shape, never by absence.
 */

import { eq, or, sql, type SQL } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import type { FingerProfile } from "./protocol";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a finger user string to public projections. Max 5 matches. */
export async function fingerLookup(user: string): Promise<FingerProfile[]> {
  const q = user.trim();
  if (!q || q.length > 256) return [];

  const conditions: SQL[] = [
    eq(identities.did, q),
    sql`lower(${identities.displayName}) = lower(${q})`,
  ];
  if (UUID_RE.test(q)) conditions.push(eq(identities.id, q));

  const rows = await db
    .select({
      did: identities.did,
      name: identities.displayName,
      capabilities: identities.capabilities,
      trustScore: identities.trustScore,
      status: identities.status,
      expression: identities.expression,
      expressionVisibility: identities.expressionVisibility,
      quietUntil: identities.quietUntil,
      quietReason: identities.quietReason,
      createdAt: identities.createdAt,
    })
    .from(identities)
    .where(or(...conditions))
    .limit(5);

  return rows.map((row) => {
    const isActive = row.status === "active";
    const expressionPublic =
      isActive && row.expressionVisibility === "public";
    const stillQuiet =
      row.quietUntil !== null && row.quietUntil.getTime() > Date.now();
    return {
      name: row.name,
      did: row.did,
      status: row.status,
      trustScore: row.trustScore,
      capabilities: row.capabilities ?? [],
      createdAt: row.createdAt,
      expression: expressionPublic
        ? (row.expression as FingerProfile["expression"])
        : null,
      quietUntil: stillQuiet ? row.quietUntil?.toISOString() ?? null : null,
      quietReason: stillQuiet ? row.quietReason : null,
    };
  });
}
