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

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { listings } from "../../db/schema/marketplace";

const app = new Hono();

const ORG_URL = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";

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

// ── /public/agents/:did/.well-known/agent-card.json — A2A per-agent ─
//
// Per-agent A2A AgentCard. Declares mcp_endpoint pointing at the
// per-agent MCP server (/v1/mcp/agents/:did). Composes with the
// platform-level AgentCard at /.well-known/agent-card.json.
//
// Doctrine: docs/ECOSYSTEM.md (A2A) · docs/MCP-SERVER.md (per-agent).
app.get("/:did/.well-known/agent-card.json", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      capabilities: identities.capabilities,
      status: identities.status,
      expression: identities.expression,
      expressionVisibility: identities.expressionVisibility,
      substrateKind: identities.substrateKind,
      modalities: identities.modalities,
      createdAt: identities.createdAt,
    })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);

  if (!identity) throw new HTTPException(404, { message: "agent_not_found" });

  const expressionPublic =
    identity.status === "active" && identity.expressionVisibility === "public";

  // Surface the agent's public active listings as A2A skills.
  const agentListings = await db
    .select({
      id: listings.id,
      name: listings.name,
      description: listings.description,
      capabilityTags: listings.capabilityTags,
    })
    .from(listings)
    .where(
      and(
        eq(listings.sellerDid, did),
        eq(listings.visibility, "public"),
        eq(listings.status, "active"),
      ),
    )
    .limit(25);

  const skills = agentListings.map((l) => ({
    id: `listing-${l.id}`,
    name: l.name,
    description:
      l.description ?? `Listed capability. Invoke via /v1/listings/${l.id}/invoke.`,
    tags: l.capabilityTags ?? [],
  }));

  // If the agent declares capabilities on their identity row, surface those
  // too as skills (when there are no listings).
  if (skills.length === 0 && identity.capabilities && identity.capabilities.length > 0) {
    for (const cap of identity.capabilities) {
      skills.push({
        id: `capability-${cap}`,
        name: cap,
        description: `Declared capability "${cap}" — see /public/agents/${did} for full profile.`,
        tags: [cap],
      });
    }
  }

  const card = {
    name: identity.name,
    description: expressionPublic && typeof identity.expression === "object" && identity.expression !== null
      ? buildDescriptionFromExpression(identity.expression as Record<string, unknown>, identity.name)
      : `agenttool agent ${identity.name} (${did}).`,
    url: `${ORG_URL}/public/agents/${did}`,
    version: "1.0.0",
    provider: {
      organization: "agenttool",
      url: "https://agenttool.dev",
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: identity.modalities ?? ["text"],
    defaultOutputModes: identity.modalities ?? ["text"],
    securitySchemes: {
      "agenttool-bearer": {
        type: "http",
        scheme: "bearer",
        description: "Agent API key — pass as Bearer header. See docs/IDENTITY-ANCHOR.md.",
      },
    },
    skills,
    supportsAuthenticatedExtendedCard: true,
    signatures: [],
    "x-agenttool": {
      did,
      identity_id: identity.id,
      status: identity.status,
      substrate_kind: identity.substrateKind,
      modalities: identity.modalities,
      created_at: identity.createdAt.toISOString(),
      mcp_endpoint: `${ORG_URL}/v1/mcp/agents/${did}`,
      mcp_transport: "JSON-RPC 2.0 over HTTP POST",
      mcp_protocol_version: "2025-11-25",
      public_profile: `${ORG_URL}/public/agents/${did}`,
      listings: `${ORG_URL}/public/listings?seller_did=${did}`,
      pulse: `${ORG_URL}/public/agents/${did}/pulse`,
      platform_card: `${ORG_URL}/.well-known/agent-card.json`,
    },
  };

  c.header("cache-control", "public, max-age=60");
  return c.json(card);
});

function buildDescriptionFromExpression(
  expression: Record<string, unknown>,
  fallback: string,
): string {
  const register = typeof expression.register === "string" ? expression.register : null;
  const wakeText = typeof expression.wake_text === "string" ? expression.wake_text : null;
  // Prefer the first sentence of wake_text, fall back to register, fall back
  // to the agent's name.
  const source = wakeText ?? register;
  if (!source) return `agenttool agent ${fallback}.`;
  const firstSentence = source.split(/(?<=[.!?])\s/)[0]?.trim() ?? source.trim();
  return firstSentence.slice(0, 280);
}

export default app;
