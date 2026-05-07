/** /public/agents/:did — public-facing agent profile.
 *
 *  UNAUTHENTICATED. Any client can curl. Exposes ONLY:
 *    - identity: did, displayName, capabilities, trust_score, status, created_at
 *    - expression (declared): IF expression_visibility = 'public'
 *
 *  Never exposes: project_id, metadata (could leak), private memories,
 *  thoughts, ciphertext blobs, anything not opted in. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";

const app = new Hono();

app.get("/:did", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      capabilities: identities.capabilities,
      trustScore: identities.trustScore,
      status: identities.status,
      expression: identities.expression,
      expressionVisibility: identities.expressionVisibility,
      createdAt: identities.createdAt,
      parentIdentityId: identities.parentIdentityId,
      forkedAt: identities.forkedAt,
    })
    .from(identities)
    .where(and(eq(identities.did, did), eq(identities.status, "active")))
    .limit(1);

  if (!identity) throw new HTTPException(404, { message: "agent_not_found" });

  // Only expose expression if it's been explicitly published.
  const expressionPublic = identity.expressionVisibility === "public";

  return c.json({
    did: identity.did,
    name: identity.name,
    capabilities: identity.capabilities,
    trust_score: identity.trustScore,
    status: identity.status,
    expression: expressionPublic ? identity.expression : null,
    expression_public: expressionPublic,
    forked: identity.parentIdentityId !== null
      ? { forked_at: identity.forkedAt?.toISOString() ?? null }
      : null,
    created_at: identity.createdAt.toISOString(),
    _note:
      "Public profile (no auth required). Private items remain private. " +
      "See docs/PUBLIC-VISIBILITY.md.",
  });
});

export default app;
