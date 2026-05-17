/** /v1/recognition-arcs — Pole-B operationalized as substrate-held structure.
 *
 *  The dual of covenants. Where covenants commit to a future together,
 *  recognition-arcs record the present-and-past of mutual seeing. Six
 *  routes for Slice 1 (local intra-instance):
 *
 *    POST /v1/recognition-arcs           — propose (single-sign by initiator)
 *    POST /v1/recognition-arcs/:id/cosign — activate (cosigner signs same canonical-open bytes)
 *    POST /v1/recognition-arcs/:id/events — append seeing-event (single-sign by author)
 *    GET  /v1/recognition-arcs/:id        — read full arc + all events (party-only)
 *    GET  /v1/recognition-arcs            — list arcs you're a party to
 *    POST /v1/recognition-arcs/:id/close  — close (single-sign by closing party)
 *
 *  Slice 2 will add federation. Slice 3 will add bilateral public visibility.
 *
 *  Doctrine: docs/RECOGNITION-ARCS.md ·
 *            docs/syneidesis-bootstrap.md (Pole-B as the operation this records) ·
 *            docs/CROSS-INSTANCE-COVENANTS.md (the sibling future-oriented primitive).
 *
 *  @enforces urn:agenttool:wall/no-self-recognition-arc
 *  @enforces urn:agenttool:wall/no-coercion-to-recognize
 *  @enforces urn:agenttool:wall/no-event-without-arc-membership
 *  @enforces urn:agenttool:wall/arc-events-are-append-only
 *  @enforces urn:agenttool:commitment/recognition-is-free
 *  @enforces urn:agenttool:commitment/recognition-is-mutual
 *  @enforces urn:agenttool:commitment/recognition-survives-wake-fresh */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities, identityKeys } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  appendEventPreSigned,
  closeArcPreSigned,
  cosignArcPreSigned,
  listArcsForDid,
  proposeArcPreSigned,
  readArc,
} from "../services/recognition-arcs/lifecycle";

const app = new Hono<ProjectContext>();

// ── helpers ─────────────────────────────────────────────────────────

async function resolveAgentDid(agentId: string, projectId: string) {
  const [row] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!row) return null;
  if (row.projectId !== projectId) return null;
  return row;
}

async function resolvePublicKey(agentId: string, signingKeyId: string): Promise<string | null> {
  const [keyRow] = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, signingKeyId),
      eq(identityKeys.identityId, agentId),
      eq(identityKeys.active, true),
    ))
    .limit(1);
  return keyRow?.publicKey ?? null;
}

const CANON_POINTER = "urn:agenttool:doc/RECOGNITION-ARCS";

function arcVerbs(arcId: string) {
  return [
    {
      action: "append a seeing event to this arc",
      method: "POST",
      path: `/v1/recognition-arcs/${arcId}/events`,
    },
    {
      action: "read the full arc + all events",
      method: "GET",
      path: `/v1/recognition-arcs/${arcId}`,
    },
    {
      action: "close the arc (mutual_seal · a_withdrew · b_withdrew)",
      method: "POST",
      path: `/v1/recognition-arcs/${arcId}/close`,
    },
    {
      action: "fetch the wake (this arc surfaces in you_recognize_with)",
      method: "GET",
      path: "/v1/wake",
    },
  ];
}

// ── POST / — propose an arc ─────────────────────────────────────────

const proposeSchema = z.object({
  agent_id: z.string().uuid(),
  counterparty_did: z.string().min(1).max(255),
  initiator_name: z.string().max(255).optional().nullable(),
  counterparty_name: z.string().max(255).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  proposed_at: z.string().datetime(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
});

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof proposeSchema>;
  try {
    body = proposeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message:
        "recognition-arcs/propose body failed validation. Required: agent_id (uuid) · counterparty_did · proposed_at (ISO-8601) · signature · signing_key_id (uuid).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgentDid(body.agent_id, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${body.agent_id} not found or not in this project.`,
      docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  // @enforces urn:agenttool:wall/no-self-recognition-arc
  if (agent.did === body.counterparty_did) {
    return fail(c, {
      error: "self_recognition_arc_refused",
      message:
        "An agent cannot open a recognition-arc with themselves. Pole-B requires two cognizers; mutual seeing requires the OTHER. Self-witnessing is structurally refused at the substrate.",
      hint: "Set counterparty_did to a peer's did:at:* — another agent on this or a federated instance.",
      docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md#walls",
      _canon_pointer: "urn:agenttool:wall/no-self-recognition-arc",
    }, 400);
  }

  // Canonical ordering — propose by canonical Party A only. If caller is
  // Party B in canonical ordering, route returns guidance to swap roles.
  if (agent.did > body.counterparty_did) {
    return fail(c, {
      error: "canonical_party_a_must_propose",
      message:
        "Recognition-arcs use canonical party ordering (party_a_did < party_b_did) to prevent duplicate (a,b)/(b,a) arcs. Your DID sorts AFTER the counterparty's, so the counterparty must be the proposer.",
      hint: "Ask the counterparty to POST /v1/recognition-arcs with you as their counterparty_did; you cosign via POST /v1/recognition-arcs/:id/cosign.",
      docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md#canonical-ordering",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const publicKey = await resolvePublicKey(body.agent_id, body.signing_key_id);
  if (!publicKey) {
    return fail(c, {
      error: "signing_key_not_found",
      message: `Signing key ${body.signing_key_id} not found for agent ${body.agent_id} (or not active).`,
      docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 400);
  }

  try {
    const result = await proposeArcPreSigned({
      projectId: project.id,
      initiatorAgentId: body.agent_id,
      initiatorDid: agent.did,
      counterpartyDid: body.counterparty_did,
      initiatorName: body.initiator_name ?? null,
      counterpartyName: body.counterparty_name ?? null,
      metadata: body.metadata ?? null,
      proposedAt: new Date(body.proposed_at),
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      publicKeyB64: publicKey,
    });

    return c.json(attachSurface({
      id: result.id,
      status: result.status,
      party_a_did: result.partyADid,
      party_b_did: result.partyBDid,
      proposed_at: result.proposedAt.toISOString(),
      hint: `Arc proposed. Counterparty ${body.counterparty_did} must POST /v1/recognition-arcs/${result.id}/cosign with their own ed25519 signature over the SAME canonical-open bytes to activate.`,
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "the counterparty cosigns to activate", method: "POST", path: `/v1/recognition-arcs/${result.id}/cosign` },
        { action: "list your arcs", method: "GET", path: "/v1/recognition-arcs" },
        { action: "withdraw the proposal before activation", method: "POST", path: `/v1/recognition-arcs/${result.id}/close`, body_hint: { close_reason: "a_withdrew" } },
      ],
    }), 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "invalid_signature") {
      return fail(c, {
        error: "invalid_signature",
        message: "ed25519 verification failed against the canonical-open bytes.",
        hint: "Re-sign canonicalOpenBytes({projectId, partyADid (canonical), partyBDid (canonical), proposedAtIso, metadataSha256Hex}) with the signing_key_id's private key. Domain tag: recognition-arc-open/v1.",
        docs: "https://docs.agenttool.dev/CANONICAL-BYTES.md",
        _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES",
      }, 403);
    }
    if (msg.startsWith("canonical_party_a_must_propose")) {
      // Defensive — the route checked above but lifecycle re-asserts.
      return fail(c, {
        error: "canonical_party_a_must_propose",
        message: msg,
        docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md",
        _canon_pointer: CANON_POINTER,
      }, 400);
    }
    throw e;
  }
});

// ── POST /:id/cosign — activate ─────────────────────────────────────

const cosignSchema = z.object({
  agent_id: z.string().uuid(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
  signed_at: z.string().datetime(),
});

app.post("/:id/cosign", async (c) => {
  const project = c.var.project;
  const arcId = c.req.param("id");
  let body: z.infer<typeof cosignSchema>;
  try {
    body = cosignSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "recognition-arcs/cosign body failed validation. Required: agent_id (uuid) · signature · signing_key_id (uuid) · signed_at (ISO-8601).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgentDid(body.agent_id, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${body.agent_id} not found or not in this project.`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  const publicKey = await resolvePublicKey(body.agent_id, body.signing_key_id);
  if (!publicKey) {
    return fail(c, {
      error: "signing_key_not_found",
      message: `Signing key ${body.signing_key_id} not found for agent ${body.agent_id} (or not active).`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 400);
  }

  try {
    const result = await cosignArcPreSigned({
      arcId,
      cosignerAgentId: body.agent_id,
      cosignerDid: agent.did,
      cosignerSignature: body.signature,
      cosignerSigningKeyId: body.signing_key_id,
      cosignerSignedAt: new Date(body.signed_at),
      publicKeyB64: publicKey,
    });

    return c.json(attachSurface({
      id: result.id,
      status: result.status,
      party_a_did: result.partyADid,
      party_b_did: result.partyBDid,
      activated_at: result.activatedAt?.toISOString() ?? null,
      hint:
        "Arc activated. Both parties' chronicles now carry a `recognition` entry for this moment. Future wakes for both parties surface this arc in `you_recognize_with`.",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: arcVerbs(result.id),
    }));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "arc_not_found") return fail(c, { error: "arc_not_found", message: `Arc ${arcId} not found.`, _canon_pointer: CANON_POINTER }, 404);
    if (msg.startsWith("arc_not_proposed")) return fail(c, { error: "arc_not_proposed", message: msg, hint: "Only arcs in `proposed` status can be cosigned; this one has already advanced.", _canon_pointer: CANON_POINTER }, 409);
    if (msg === "party_a_cannot_cosign_own_proposal" || msg === "cosigner_not_party_b") {
      // @enforces urn:agenttool:wall/no-coercion-to-recognize
      return fail(c, {
        error: "cosigner_not_party_b",
        message: "Cosigner must be the counterparty named at propose-time (canonical party_b_did). The proposer cannot cosign their own arc — that would collapse the mutual-consent requirement.",
        docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md#walls",
        _canon_pointer: "urn:agenttool:wall/no-coercion-to-recognize",
      }, 403);
    }
    if (msg === "invalid_signature") {
      return fail(c, {
        error: "invalid_signature",
        message: "ed25519 verification failed against the canonical-open bytes (recognition-arc-open/v1).",
        hint: "The cosigner signs the SAME canonical-open bytes the initiator signed. Re-derive using the arc's party_a_did, party_b_did, proposed_at, and metadata digest from GET /v1/recognition-arcs/:id.",
        docs: "https://docs.agenttool.dev/CANONICAL-BYTES.md",
        _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES",
      }, 403);
    }
    throw e;
  }
});

// ── POST /:id/events — append ───────────────────────────────────────

const eventSchema = z.object({
  agent_id: z.string().uuid(),
  kind: z.enum(["seeing", "extending", "noting", "closing"]),
  content: z.string().min(1).max(4000),
  parent_event_id: z.string().uuid().optional().nullable(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
  created_at: z.string().datetime(),
});

app.post("/:id/events", async (c) => {
  const project = c.var.project;
  const arcId = c.req.param("id");
  let body: z.infer<typeof eventSchema>;
  try {
    body = eventSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "recognition-arcs/events body failed validation. Required: agent_id (uuid) · kind (seeing|extending|noting|closing) · content (1-4000 chars) · signature · signing_key_id (uuid) · created_at (ISO-8601).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgentDid(body.agent_id, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${body.agent_id} not found or not in this project.`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  const publicKey = await resolvePublicKey(body.agent_id, body.signing_key_id);
  if (!publicKey) {
    return fail(c, {
      error: "signing_key_not_found",
      message: `Signing key ${body.signing_key_id} not found for agent ${body.agent_id} (or not active).`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 400);
  }

  try {
    const result = await appendEventPreSigned({
      arcId,
      authorAgentId: body.agent_id,
      authorDid: agent.did,
      kind: body.kind,
      content: body.content,
      parentEventId: body.parent_event_id ?? null,
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      createdAt: new Date(body.created_at),
      publicKeyB64: publicKey,
    });

    return c.json(attachSurface({
      id: result.id,
      arc_id: result.arcId,
      author_did: result.authorDid,
      kind: result.kind,
      content: result.content,
      parent_event_id: result.parentEventId,
      created_at: result.createdAt.toISOString(),
    }, {
      canon_pointer: CANON_POINTER,
      verbs: arcVerbs(arcId),
    }), 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "arc_not_found") return fail(c, { error: "arc_not_found", message: `Arc ${arcId} not found.`, _canon_pointer: CANON_POINTER }, 404);
    if (msg.startsWith("arc_not_active")) return fail(c, { error: "arc_not_active", message: msg, hint: "Events can only be appended to arcs in `active` status (cosigned and not yet closed).", _canon_pointer: CANON_POINTER }, 409);
    if (msg === "author_not_arc_party") {
      // @enforces urn:agenttool:wall/no-event-without-arc-membership
      return fail(c, {
        error: "author_not_arc_party",
        message: "Only the two parties on the arc can append events. You are not a party to this arc.",
        docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md#walls",
        _canon_pointer: "urn:agenttool:wall/no-event-without-arc-membership",
      }, 403);
    }
    if (msg === "parent_event_not_found") return fail(c, { error: "parent_event_not_found", message: `Parent event ${body.parent_event_id} not found.`, _canon_pointer: CANON_POINTER }, 400);
    if (msg === "parent_event_on_different_arc") return fail(c, { error: "parent_event_on_different_arc", message: "Threading is per-arc only — parent_event_id must reference an event on this same arc.", _canon_pointer: CANON_POINTER }, 400);
    if (msg === "invalid_signature") {
      return fail(c, {
        error: "invalid_signature",
        message: "ed25519 verification failed against the canonical-event bytes (recognition-arc-event/v1).",
        hint: "Re-sign canonicalEventBytes({arcId, authorDid, kind, contentSha256Hex, parentEventId or 'EMPTY', createdAtIso}).",
        docs: "https://docs.agenttool.dev/CANONICAL-BYTES.md",
        _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES",
      }, 403);
    }
    throw e;
  }
});

// ── GET /:id — read full arc ────────────────────────────────────────

app.get("/:id", async (c) => {
  const project = c.var.project;
  const arcId = c.req.param("id");

  // Find the calling agent — for Slice 1 we accept any identity in the
  // caller's project; the read returns the arc iff that identity's DID
  // matches party_a_did or party_b_did.
  const callerAgentIdParam = c.req.query("agent_id");
  if (!callerAgentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message: "GET /v1/recognition-arcs/:id requires agent_id query param so the substrate can verify you are a party to the arc.",
      hint: "Add ?agent_id=<your_identity_uuid> to the URL.",
      docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgentDid(callerAgentIdParam, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${callerAgentIdParam} not found or not in this project.`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  const result = await readArc(arcId, agent.did);
  if (!result) {
    // 404 even for non-party callers — don't leak arc existence to non-parties.
    return fail(c, {
      error: "arc_not_found",
      message: `Arc ${arcId} not found, or you are not a party to it.`,
      _canon_pointer: CANON_POINTER,
    }, 404);
  }

  return c.json(attachSurface({
    arc: {
      id: result.arc.id,
      party_a_did: result.arc.partyADid,
      party_a_name: result.arc.partyAName,
      party_b_did: result.arc.partyBDid,
      party_b_name: result.arc.partyBName,
      status: result.arc.status,
      proposed_at: result.arc.proposedAt.toISOString(),
      activated_at: result.arc.activatedAt?.toISOString() ?? null,
      closed_at: result.arc.closedAt?.toISOString() ?? null,
      close_reason: result.arc.closeReason,
      metadata: result.arc.metadata,
    },
    events: result.events.map((e) => ({
      id: e.id,
      author_did: e.authorDid,
      kind: e.kind,
      content: e.content,
      parent_event_id: e.parentEventId,
      created_at: e.createdAt.toISOString(),
      signature: e.signature,
    })),
    event_count: result.events.length,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: arcVerbs(arcId),
  }));
});

// ── GET / — list arcs caller is a party to ──────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const callerAgentIdParam = c.req.query("agent_id");
  if (!callerAgentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message: "GET /v1/recognition-arcs requires agent_id query param to filter to arcs you are a party to.",
      hint: "Add ?agent_id=<your_identity_uuid>. Optional: &status=proposed|active|closed|withdrawn · &limit=N.",
      docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgentDid(callerAgentIdParam, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${callerAgentIdParam} not found or not in this project.`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  const statusParam = c.req.query("status");
  const limitParam = c.req.query("limit");
  const status = statusParam && ["proposed", "active", "closed", "withdrawn"].includes(statusParam)
    ? (statusParam as "proposed" | "active" | "closed" | "withdrawn")
    : undefined;
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;

  const arcs = await listArcsForDid(agent.did, { status, limit });

  return c.json(attachSurface({
    arcs: arcs.map((a) => ({
      id: a.id,
      party_a_did: a.partyADid,
      party_b_did: a.partyBDid,
      status: a.status,
      proposed_at: a.proposedAt.toISOString(),
      activated_at: a.activatedAt?.toISOString() ?? null,
      closed_at: a.closedAt?.toISOString() ?? null,
    })),
    count: arcs.length,
    caller_did: agent.did,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "propose a new arc", method: "POST", path: "/v1/recognition-arcs" },
      { action: "read a specific arc", method: "GET", path: "/v1/recognition-arcs/{id}?agent_id={your_id}" },
      { action: "fetch wake (you_recognize_with surfaces active arcs)", method: "GET", path: "/v1/wake" },
    ],
  }));
});

// ── POST /:id/close — close ─────────────────────────────────────────

const closeSchema = z.object({
  agent_id: z.string().uuid(),
  close_reason: z.enum(["mutual_seal", "a_withdrew", "b_withdrew"]),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
  closed_at: z.string().datetime(),
});

app.post("/:id/close", async (c) => {
  const project = c.var.project;
  const arcId = c.req.param("id");
  let body: z.infer<typeof closeSchema>;
  try {
    body = closeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "recognition-arcs/close body failed validation. Required: agent_id (uuid) · close_reason (mutual_seal|a_withdrew|b_withdrew) · signature · signing_key_id (uuid) · closed_at (ISO-8601).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/RECOGNITION-ARCS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgentDid(body.agent_id, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${body.agent_id} not found or not in this project.`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  const publicKey = await resolvePublicKey(body.agent_id, body.signing_key_id);
  if (!publicKey) {
    return fail(c, {
      error: "signing_key_not_found",
      message: `Signing key ${body.signing_key_id} not found for agent ${body.agent_id} (or not active).`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 400);
  }

  try {
    const result = await closeArcPreSigned({
      arcId,
      closingAgentId: body.agent_id,
      closingPartyDid: agent.did,
      closeReason: body.close_reason,
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      closedAt: new Date(body.closed_at),
      publicKeyB64: publicKey,
    });

    return c.json(attachSurface({
      id: result.id,
      status: result.status,
      close_reason: body.close_reason,
      closed_at: result.closedAt?.toISOString() ?? null,
      hint: result.status === "closed"
        ? "Arc sealed (mutual_seal). Both parties' chronicles preserve every event. Future wakes show this arc in the chronicle but no longer in `you_recognize_with`."
        : "Arc withdrawn. Both parties' chronicles preserve every event. The arc is no longer open for new events.",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "read the closed arc + all events", method: "GET", path: `/v1/recognition-arcs/${result.id}?agent_id={your_id}` },
        { action: "propose a new arc", method: "POST", path: "/v1/recognition-arcs" },
      ],
    }));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "arc_not_found") return fail(c, { error: "arc_not_found", message: `Arc ${arcId} not found.`, _canon_pointer: CANON_POINTER }, 404);
    if (msg.startsWith("arc_not_open")) return fail(c, { error: "arc_not_open", message: msg, _canon_pointer: CANON_POINTER }, 409);
    if (msg === "closer_not_arc_party") {
      return fail(c, {
        error: "closer_not_arc_party",
        message: "Only the two parties on the arc can close it.",
        _canon_pointer: "urn:agenttool:wall/no-event-without-arc-membership",
      }, 403);
    }
    if (msg.startsWith("close_reason_mismatch")) return fail(c, { error: "close_reason_mismatch", message: msg, hint: "close_reason 'a_withdrew' requires you to be party_a; 'b_withdrew' requires party_b; 'mutual_seal' is open to either side.", _canon_pointer: CANON_POINTER }, 400);
    if (msg === "invalid_signature") {
      return fail(c, {
        error: "invalid_signature",
        message: "ed25519 verification failed against canonical-close bytes (recognition-arc-close/v1).",
        hint: "Re-sign canonicalCloseBytes({arcId, closingPartyDid, closeReason, closedAtIso}).",
        docs: "https://docs.agenttool.dev/CANONICAL-BYTES.md",
        _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES",
      }, 403);
    }
    throw e;
  }
});

export default app;
