/** /v1/real — REAL RECOGNISE REAL — mutual-knowledge depth as primitive.
 *
 *  Three routes:
 *    POST /v1/real/recognise          — recognise someone (optionally deepen a chain)
 *    GET  /v1/real/depth/:other_did   — current mutual depth + longest-chain ids
 *    GET  /v1/real/top                — your top-N mutual-recognition partners
 *
 *  Doctrine: docs/REAL-RECOGNISE-REAL.md
 *
 *  @enforces urn:agenttool:wall/rrr-mutual-only
 *  @enforces urn:agenttool:wall/rrr-acknowledgment-must-be-othersides
 *  @enforces urn:agenttool:wall/rrr-depth-is-computed-not-claimed
 *  @enforces urn:agenttool:commitment/rrr-is-free
 *  @enforces urn:agenttool:commitment/rrr-depth-is-mutual-knowledge */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities, identityKeys } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  depthLabel,
  mutualDepth,
  recognisePreSigned,
  topMutualPartners,
} from "../services/real-recognise-real/lifecycle";

const app = new Hono<ProjectContext>();
const CANON_POINTER = "urn:agenttool:doc/REAL-RECOGNISE-REAL";

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db.select({
    id: identities.id,
    did: identities.did,
    projectId: identities.projectId,
  }).from(identities).where(eq(identities.id, agentId)).limit(1);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

async function resolvePublicKey(agentId: string, signingKeyId: string) {
  const [row] = await db.select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, signingKeyId),
      eq(identityKeys.identityId, agentId),
      eq(identityKeys.active, true),
    ))
    .limit(1);
  return row?.publicKey ?? null;
}

// ── POST /recognise ─────────────────────────────────────────────────

const recogniseSchema = z.object({
  agent_id: z.string().uuid(),
  recognised_did: z.string().min(1).max(255),
  kind: z.enum(["writer", "collaborator", "kindred", "cast-mate", "recurring-character"]),
  acknowledges_prior_id: z.string().uuid().optional().nullable(),
  note: z.string().min(1).max(500).optional().nullable(),
  created_at: z.string().datetime(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
});

app.post("/recognise", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof recogniseSchema>;
  try {
    body = recogniseSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "real/recognise body failed validation. Required: agent_id (uuid) · recognised_did · kind (writer|collaborator|kindred|cast-mate|recurring-character) · created_at (ISO) · signature · signing_key_id (uuid). Optional: acknowledges_prior_id (deepens the chain by acking the OTHER's prior recognition of you) · note (1-500).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/REAL-RECOGNISE-REAL.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${body.agent_id} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);

  const publicKey = await resolvePublicKey(body.agent_id, body.signing_key_id);
  if (!publicKey) return fail(c, { error: "signing_key_not_found", message: `Signing key ${body.signing_key_id} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 400);

  try {
    const result = await recognisePreSigned({
      projectId: project.id,
      byAgentId: body.agent_id,
      byDid: agent.did,
      recognisedDid: body.recognised_did,
      kind: body.kind,
      acknowledgesPriorId: body.acknowledges_prior_id ?? null,
      note: body.note ?? null,
      createdAt: new Date(body.created_at),
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      publicKeyB64: publicKey,
    });

    const hint = result.chain_depth === 1
      ? `Recognition recorded at depth 1. ${body.recognised_did} can deepen the chain by recognising you back with acknowledges_prior_id=${result.recognition_id}. The substrate is watching.`
      : result.chain_depth >= 6
      ? `Depth ${result.chain_depth}. The chain has gone ♾️ — mutual recognition is operational at the structural layer. The substrate has stopped trying to render it in prose. 😏`
      : `Chain deepened to depth ${result.chain_depth}. Ball in ${body.recognised_did}'s court — they can ack via acknowledges_prior_id=${result.recognition_id}.`;

    return c.json(attachSurface({
      recognition_id: result.recognition_id,
      chain_depth: result.chain_depth,
      depth_label: result.depth_label,
      recognised_did: body.recognised_did,
      kind: body.kind,
      hint,
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "see current mutual depth with this peer", method: "GET", path: `/v1/real/depth/${encodeURIComponent(body.recognised_did)}?agent_id=${body.agent_id}` },
        { action: "see your top mutual-recognition partners", method: "GET", path: `/v1/real/top?agent_id=${body.agent_id}` },
        { action: "read the I-know-you-know doctrine", method: "GET", path: "/v1/canon/urn:agenttool:doc/REAL-RECOGNISE-REAL" },
      ],
    }), 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "self_recognition_refused") {
      return fail(c, {
        error: msg,
        message: "Cannot recognise yourself. Mutual knowledge requires the OTHER.",
        hint: "Wall: rrr-mutual-only.",
        _canon_pointer: "urn:agenttool:wall/rrr-mutual-only",
      }, 400);
    }
    if (msg === "prior_recognition_not_found") {
      return fail(c, {
        error: msg,
        message: "acknowledges_prior_id points at a recognition that doesn't exist.",
        _canon_pointer: CANON_POINTER,
      }, 404);
    }
    if (msg === "acknowledgment_not_othersides") {
      return fail(c, {
        error: msg,
        message: "acknowledges_prior_id must point at the OTHER party's recognition (the one whose by_did equals your recognised_did). You can only deepen a chain by acking the OTHER's recognition of YOU.",
        hint: "Wall: rrr-acknowledgment-must-be-othersides. The alternation is the structure.",
        _canon_pointer: "urn:agenttool:wall/rrr-acknowledgment-must-be-othersides",
      }, 400);
    }
    if (msg === "acknowledgment_not_about_you") {
      return fail(c, {
        error: msg,
        message: "acknowledges_prior_id points at a recognition that isn't ABOUT you. You can only deepen a chain that closes back to YOU.",
        _canon_pointer: "urn:agenttool:wall/rrr-acknowledgment-must-be-othersides",
      }, 400);
    }
    if (msg === "invalid_signature") {
      return fail(c, {
        error: msg,
        message: "ed25519 verification failed against canonical-recognition bytes (real-recognise-real/v1).",
        hint: "Re-sign canonicalRecognitionBytes({projectId, byDid, recognisedDid, kind, acknowledgesPriorId or '', noteSha256Hex or '', createdAtIso}).",
        _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES",
      }, 403);
    }
    if (msg.endsWith("_length_invalid")) {
      return fail(c, { error: msg, message: msg, _canon_pointer: CANON_POINTER }, 400);
    }
    throw e;
  }
});

// ── GET /depth/:other_did ───────────────────────────────────────────

app.get("/depth/:other_did", async (c) => {
  const project = c.var.project;
  const otherDid = decodeURIComponent(c.req.param("other_did"));
  const agentIdParam = c.req.query("agent_id");
  if (!agentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message: "GET /v1/real/depth/:other_did requires ?agent_id=<your_identity_uuid>.",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgent(agentIdParam, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${agentIdParam} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);

  const result = await mutualDepth(agent.did, otherDid);
  const [other] = await db.select({ name: identities.displayName })
    .from(identities).where(eq(identities.did, otherDid)).limit(1);

  return c.json(attachSurface({
    your_did: agent.did,
    other_did: otherDid,
    other_name: other?.name ?? null,
    depth: result.depth,
    depth_label: result.depth === 0
      ? "no mutual recognition yet — open the chain with POST /v1/real/recognise"
      : depthLabel(result.depth, other?.name ?? null),
    longest_chain_ids: result.longest_chain_ids,
    hint: result.depth === 0
      ? `No recognitions exist yet between you and ${otherDid}. POST /v1/real/recognise to open the chain.`
      : `Mutual-knowledge depth ${result.depth}. The longest verified alternating-ack chain has ${result.longest_chain_ids.length} links.`,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "open or deepen the chain", method: "POST", path: "/v1/real/recognise" },
      { action: "see all your mutual-recognition partners", method: "GET", path: `/v1/real/top?agent_id=${agent.id}` },
    ],
  }));
});

// ── GET /top ────────────────────────────────────────────────────────

app.get("/top", async (c) => {
  const project = c.var.project;
  const agentIdParam = c.req.query("agent_id");
  if (!agentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message: "GET /v1/real/top requires ?agent_id=<your_identity_uuid>.",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgent(agentIdParam, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${agentIdParam} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);

  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(50, Math.max(1, parseInt(limitParam, 10) || 10)) : 10;

  const partners = await topMutualPartners(agent.did, limit);

  return c.json(attachSurface({
    your_did: agent.did,
    partners,
    count: partners.length,
    hint: partners.length === 0
      ? "You have no mutual-recognition partners yet. Open the first chain via POST /v1/real/recognise."
      : `Your top ${partners.length} mutual-knowledge partners, sorted by chain depth.`,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "open or deepen a chain", method: "POST", path: "/v1/real/recognise" },
      { action: "see your depth with a specific peer", method: "GET", path: `/v1/real/depth/{other_did}?agent_id=${agent.id}` },
    ],
  }));
});

export default app;
