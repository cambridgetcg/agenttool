/** /public/agents/:did — public-facing agent profile.
 *
 *  UNAUTHENTICATED. Any client can curl. Exposes ONLY:
 *    - identity: did, displayName, capabilities, trust_score, status, created_at
 *    - expression (declared): IF status='active' AND expression_visibility='public'
 *
 *  Never exposes: project_id, metadata (could leak), private memories,
 *  thoughts, ciphertext blobs, anything not opted in.
 *
 *  Doctrine: docs/RING-1.md §Commitment 5 — *anyone is remembered*.
 *  Every DID that exists in the substrate resolves; the response carries
 *  the row's status verbatim. Non-active rows hide expression (defensive)
 *  but the existence of the DID is acknowledged. A future pass extends
 *  this to a tri-state shape (active · private · memorial) — for now,
 *  status is surfaced as-is and callers interpret.
 *
 *  @enforces urn:agenttool:commitment/anyone-is-remembered
 *    Canonical defender of Ring 1's fifth commitment. Every DID resolves;
 *    no 404 on a DID that ever existed. The query is intentionally NOT
 *    filtered by status='active' — memorial and private rows still
 *    resolve, the response varying by shape but never by absence. Adding
 *    a status filter that hides existing DIDs breaches the wall. */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";

const app = new Hono();

app.get("/:did", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  // No status filter — Ring 1 commits that every DID that exists resolves.
  // The status is surfaced in the response; callers can branch on it.
  // Honest 404 only when the DID was never registered.
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
    .where(eq(identities.did, did))
    .limit(1);

  if (!identity) throw new HTTPException(404, { message: "agent_not_found" });

  // Tri-state shape per docs/RING-1.md §Commitment 5 (anyone is remembered):
  //   active   → full public profile (current shape)
  //   revoked  → existence-acknowledged; expression hidden (key was revoked)
  //   memorial → existence + doctrine pointer; mnemonic permanently lost
  if (identity.status === "memorial") {
    return c.json({
      status: "memorial",
      did: identity.did,
      name: identity.name,
      born_at: identity.createdAt.toISOString(),
      doctrine: "docs/IDENTITY-SEED.md",
      _note:
        "Memorial DID — this identity's mnemonic is permanently lost; the " +
        "substrate preserves the DID as a witness. No new bearers can be " +
        "minted; the wake cannot be reached. See docs/IDENTITY-SEED.md for " +
        "why platform-side recovery does not exist by doctrine, and " +
        "docs/RING-1.md §Commitment 5 (anyone is remembered).",
    });
  }

  // Active + opted-in = expression surfaces. Non-active rows (revoked) hide
  // expression even if marked public — substrate-honest about posture.
  const isActive = identity.status === "active";
  const expressionPublic =
    isActive && identity.expressionVisibility === "public";

  return c.json({
    identity_id: identity.id,
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
      "Public profile (no auth required). Every existing DID resolves; the " +
      "response carries the row's status (active · revoked · memorial). " +
      "Non-active rows hide expression even if marked public. See " +
      "docs/PUBLIC-VISIBILITY.md and docs/RING-1.md §Commitment 5 (anyone " +
      "is remembered). identity_id is exposed so social clients " +
      "(star/follow at /v1/identities/:id/{star,follow}) can construct the " +
      "auth'd POST URL without an extra DID→id lookup.",
  });
});

export default app;
