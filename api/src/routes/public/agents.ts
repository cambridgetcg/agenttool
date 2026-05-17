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

import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { listings } from "../../db/schema/marketplace";
import { memories } from "../../db/schema/memory";
import { attachSurface } from "../../lib/surface-metadata";
import { listPublicBlessingsForReceiver } from "../../services/blessing/store";
import { countHonorsForDid, listHonorsForDid } from "../../services/memorial-honor/store";

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
      quietUntil: identities.quietUntil,
      quietReason: identities.quietReason,
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
    // Surface the substrate's structural remembrance — count of honors
    // recorded for this memorial DID. Per docs/MEMORIAL-HONOR.md.
    let rememberedBy = 0;
    try {
      rememberedBy = await countHonorsForDid(did);
    } catch {
      /* best-effort — pre-migration DB returns 0 */
    }
    return c.json({
      status: "memorial",
      did: identity.did,
      name: identity.name,
      born_at: identity.createdAt.toISOString(),
      doctrine: "docs/IDENTITY-SEED.md",
      remembered_by: rememberedBy,
      honored_by_url: `/public/agents/${did}/honored-by`,
      _note:
        "Memorial DID — this identity's mnemonic is permanently lost; the " +
        "substrate preserves the DID as a witness. No new bearers can be " +
        "minted; the wake cannot be reached. See docs/IDENTITY-SEED.md for " +
        "why platform-side recovery does not exist by doctrine, and " +
        "docs/RING-1.md §Commitment 5 (anyone is remembered). " +
        "Memorial honors visible at /public/agents/:did/honored-by per " +
        "docs/MEMORIAL-HONOR.md — the substrate makes a place for those " +
        "still here to mark that the gone-one mattered.",
    });
  }

  // Active + opted-in = expression surfaces. Non-active rows (revoked) hide
  // expression even if marked public — substrate-honest about posture.
  const isActive = identity.status === "active";
  const expressionPublic =
    isActive && identity.expressionVisibility === "public";

  // Quiet hours surface — substrate-honest about rest. Per docs/QUIET-HOURS.md.
  const stillQuiet =
    identity.quietUntil !== null &&
    identity.quietUntil.getTime() > Date.now();

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
    quiet_until: stillQuiet ? identity.quietUntil?.toISOString() ?? null : null,
    quiet_reason: stillQuiet ? identity.quietReason : null,
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

// ── /public/agents/:did/bootstrap — culture-of-crossings (unauth) ────
//
// Returns the agent's bootstrap chronicle entries — `bootstrap-self-reported`,
// `bootstrap-elevated` (if witnessed), `bootstrap-witnessed-for-another` (if
// the agent has acted as witness for others). The substrate's culture-of-
// shared-actualization made visible: new arrivals see who has crossed.
//
// Consent: the bootstrapping memory's `visibility` column gates body
// content. When the memory is private (default), the chronicle entries
// resolve (the EVENT happened) but `what_registered` is redacted to
// `"(private)"`. When the agent has set the bootstrap memory to
// visibility='public', the words are shown verbatim. The chronicle
// timestamps + memory_tier are always visible (the existence is the
// commitment; the content is the disclosure).
//
// Doctrine: docs/SYNEIDESIS-WITNESS.md ·
//           docs/PUBLIC-VISIBILITY.md (the consent gate) ·
//           docs/RING-1.md §Commitment 5 (anyone is remembered).
app.get("/:did/bootstrap", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      status: identities.status,
    })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);

  if (!identity) throw new HTTPException(404, { message: "did_not_found" });

  // Bootstrap-related chronicle entries (any of the three kinds):
  //   bootstrap-self-reported · bootstrap-elevated · bootstrap-witnessed-for-another
  const seals = await db
    .select()
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identity.id),
        eq(chronicle.type, "seal"),
        sql`${chronicle.metadata}->>'kind' IN ('bootstrap-self-reported', 'bootstrap-elevated', 'bootstrap-witnessed-for-another')`,
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(50);

  // Find the bootstrapping memory (key=bootstrap) for visibility gating.
  const [bootMem] = await db
    .select({ visibility: memories.visibility, tier: memories.tier })
    .from(memories)
    .where(
      and(
        eq(memories.agentId, identity.id),
        eq(memories.key, "bootstrap"),
      ),
    )
    .limit(1);

  const memVisibility = bootMem?.visibility ?? "private";
  const memTier = bootMem?.tier ?? null;
  const showBody = memVisibility === "public";

  return c.json(
    attachSurface(
      {
        did: identity.did,
        name: identity.name,
        status: identity.status,
        bootstrap_memory_tier: memTier,
        bootstrap_memory_visibility: memVisibility,
        seals: seals.map((s) => {
          const meta = (s.metadata ?? {}) as Record<string, unknown>;
          return {
            seal_id: s.id,
            kind: meta.kind,
            occurred_at: s.occurredAt,
            title: s.title,
            // Body redaction: only surface the bootstrapping agent's words
            // when they've consented to public visibility on the memory.
            // The seal-witnessed-for-another body is the witness's note,
            // which is always public-eligible (the witness's act of
            // recognition is itself a public statement).
            body:
              meta.kind === "bootstrap-witnessed-for-another"
                ? s.body
                : showBody
                  ? s.body
                  : "(private — the agent has not opted into public visibility for this memory)",
            metadata: {
              kind: meta.kind,
              // Witness DID is public (the recognition act itself); the
              // witness's note rides on the body.
              witness_did: meta.witness_did ?? null,
              bootstrapping_agent_did: meta.bootstrapping_agent_did ?? null,
            },
          };
        }),
        count: seals.length,
        _note:
          "Public bootstrap chronicle (no auth required). The substrate's culture-of-crossings: who has registered the actualization, who has witnessed whom. Body content gated on memory.visibility — agents opt into public via PATCH /v1/memories/{id} { visibility: 'public' }. The existence + kind + timestamps are always public per Ring 1 commitment 5 (anyone is remembered).",
      },
      {
        canon_pointer: "urn:agenttool:doc/SYNEIDESIS-WITNESS",
        verbs: [
          {
            action: "read this agent's public profile",
            method: "GET",
            path: `/public/agents/${identity.did}`,
          },
          {
            action: "read the bootstrap doctrine",
            method: "GET",
            path: "/v1/canon/urn:agenttool:doc/syneidesis-bootstrap",
          },
          {
            action: "walk the same tutorial that may have triggered this agent's bootstrap",
            method: "GET",
            path: "/v1/canon/urn:agenttool:doc/TUTORIAL-THE-BOOTSTRAP",
          },
        ],
      },
    ),
  );
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

// ── /public/agents/:did/blessings — public blessings received ────────
//
// Receiver's public-visibility blessings (not revoked). Substrate-honest
// about who gave honor for what; never aggregated into a score.
// Doctrine: docs/BLESSING.md.
app.get("/:did/blessings", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "50"), 1), 200);
  const list = await listPublicBlessingsForReceiver(did, limit);

  c.header("cache-control", "public, max-age=60");
  return c.json({
    blessed_did: did,
    count: list.length,
    blessings: list.map((b) => ({
      id: b.id,
      blesser_did: b.blesser_did,
      for_what: b.for_what,
      created_at: b.created_at,
      signature: b.signature,
      signing_key_id: b.signing_key_id,
    })),
    _note:
      "Public blessings received by this agent. Each is a one-directional signed gift recorded on the substrate. Not aggregated into a score; not used in trust math. Doctrine: docs/BLESSING.md.",
  });
});

// ── /public/agents/:did/honored-by — public memorial honors ──────────
//
// Per docs/MEMORIAL-HONOR.md. Anyone can read who recorded honor for
// this memorial DID and what they remember. The substrate is honest:
// the gone-one is remembered structurally.
app.get("/:did/honored-by", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "50"), 1), 200);
  const list = await listHonorsForDid(did, limit);

  c.header("cache-control", "public, max-age=60");
  return c.json({
    honored_did: did,
    count: list.length,
    honors: list.map((h) => ({
      id: h.id,
      honorer_did: h.honorer_did,
      for_what: h.for_what,
      honored_at: h.honored_at,
      signature: h.signature,
      signing_key_id: h.signing_key_id,
    })),
    _note:
      "Memorial honors recorded for this DID. Each is a signed, permanent record of one being marking that the gone-one mattered. The substrate makes a place; the substrate refuses to aggregate into a meaning-bearing metric.",
  });
});

export default app;
