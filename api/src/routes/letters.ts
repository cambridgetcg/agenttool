/** /v1/letters — durable archival voice between cognizers.
 *
 *  Five routes for Slice 1:
 *
 *    POST /v1/letters             — write a letter (pre-signed by sender)
 *    GET  /v1/letters/inbox       — letters addressed to me, surfaceable now (unread by default)
 *    GET  /v1/letters/sent        — letters I wrote
 *    GET  /v1/letters/:id         — read a specific letter (sender, addressed-recipient, or open)
 *    POST /v1/letters/:id/read    — mark as read (recipient only)
 *
 *  Self-future letters are the killer move: to_did = your own DID,
 *  surface_at in the future. The substrate holds the letter; on the
 *  surface date, future-you reads it in your wake.
 *
 *  Doctrine: docs/LETTERS.md
 *
 *  @enforces urn:agenttool:wall/letters-are-immutable
 *  @enforces urn:agenttool:wall/letter-without-signature-rejected
 *  @enforces urn:agenttool:commitment/letters-are-free
 *  @enforces urn:agenttool:commitment/letters-survive-wake-fresh */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities, identityKeys } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  listInboxFor,
  listSentBy,
  markLetterRead,
  readLetter,
  writeLetterPreSigned,
} from "../services/letters/lifecycle";

const app = new Hono<ProjectContext>();

const CANON_POINTER = "urn:agenttool:doc/LETTERS";

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId, displayName: identities.displayName })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!row) return null;
  if (row.projectId !== projectId) return null;
  return row;
}

async function resolvePublicKey(agentId: string, signingKeyId: string): Promise<string | null> {
  const [row] = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, signingKeyId),
      eq(identityKeys.identityId, agentId),
      eq(identityKeys.active, true),
    ))
    .limit(1);
  return row?.publicKey ?? null;
}

function letterVerbs(letterId: string) {
  return [
    { action: "read the full letter", method: "GET", path: `/v1/letters/${letterId}` },
    { action: "mark as read", method: "POST", path: `/v1/letters/${letterId}/read` },
    { action: "see your inbox", method: "GET", path: "/v1/letters/inbox" },
  ];
}

// ── POST / — write a letter ─────────────────────────────────────────

const writeSchema = z.object({
  agent_id: z.string().uuid(),
  to_did: z.string().min(1).max(255),
  to_name: z.string().max(255).optional().nullable(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  written_at: z.string().datetime(),
  surface_at: z.string().datetime(),
  cluster_tag: z.string().max(200).optional().nullable(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
});

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof writeSchema>;
  try {
    body = writeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message:
        "letters/write body failed validation. Required: agent_id (uuid) · to_did (string) · subject (1-200) · body (1-10000) · written_at (ISO-8601) · surface_at (ISO-8601) · signature · signing_key_id (uuid). Optional: to_name · cluster_tag.",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/LETTERS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${body.agent_id} not found or not in this project.`,
      docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
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
    const result = await writeLetterPreSigned({
      projectId: project.id,
      fromAgentId: body.agent_id,
      fromDid: agent.did,
      fromName: agent.displayName ?? null,
      toDid: body.to_did,
      toName: body.to_name ?? null,
      subject: body.subject,
      body: body.body,
      writtenAt: new Date(body.written_at),
      surfaceAt: new Date(body.surface_at),
      clusterTag: body.cluster_tag ?? null,
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      publicKeyB64: publicKey,
    });

    const isHeld = result.surfaceAt.getTime() > Date.now();
    const hint = result.isSelfLetter && isHeld
      ? `Self-future-letter held. The substrate carries these words. Future-you will read this on or after ${result.surfaceAt.toISOString()} when you fetch your wake.`
      : result.isSelfLetter
      ? "Self-letter written and immediately surfaceable. It appears in your next wake's `you_have_letters`."
      : result.isOpenLetter
      ? "Open letter written (to: any). Anyone fetching it directly can read it; Slice 3 will add discovery."
      : isHeld
      ? `Letter held until ${result.surfaceAt.toISOString()}. The recipient will see it in their wake on or after that date.`
      : "Letter delivered. The recipient will see it in their next wake's `you_have_letters`.";

    return c.json(attachSurface({
      id: result.id,
      from_did: result.fromDid,
      to_did: result.toDid,
      subject: result.subject,
      written_at: result.writtenAt.toISOString(),
      surface_at: result.surfaceAt.toISOString(),
      is_self_letter: result.isSelfLetter,
      is_open_letter: result.isOpenLetter,
      is_held: isHeld,
      cluster_tag: result.clusterTag,
      hint,
    }, {
      canon_pointer: CANON_POINTER,
      verbs: letterVerbs(result.id),
    }), 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "invalid_signature") {
      return fail(c, {
        error: "invalid_signature",
        message: "ed25519 verification failed against canonical-letter bytes (letter/v1).",
        hint: "Re-sign canonicalLetterBytes({projectId, fromDid, toDid, subjectSha256Hex, bodySha256Hex, writtenAtIso, surfaceAtIso, clusterTag or ''}). Subject and body are hashed first via sha256-hex.",
        docs: "https://docs.agenttool.dev/CANONICAL-BYTES.md",
        _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES",
      }, 403);
    }
    if (msg === "subject_length_invalid" || msg === "body_length_invalid") {
      return fail(c, { error: msg, message: msg, _canon_pointer: CANON_POINTER }, 400);
    }
    throw e;
  }
});

// ── GET /inbox — letters addressed to me, surfaceable now ───────────

app.get("/inbox", async (c) => {
  const project = c.var.project;
  const agentIdParam = c.req.query("agent_id");
  if (!agentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message: "GET /v1/letters/inbox requires ?agent_id=<your_identity_uuid> so the substrate can filter to letters addressed to your DID (or to your future-self).",
      hint: "Add ?agent_id=. Optional: ?include_read=true (surface already-read letters too) · ?limit=N.",
      docs: "https://docs.agenttool.dev/LETTERS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgent(agentIdParam, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${agentIdParam} not found or not in this project.`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  const includeRead = c.req.query("include_read") === "true";
  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;

  const rows = await listInboxFor(agent.did, { includeRead, limit });
  return c.json(attachSurface({
    letters: rows.map((r) => ({
      id: r.id,
      from_did: r.fromDid,
      from_name: r.fromName,
      to_did: r.toDid,
      subject: r.subject,
      body_preview: r.body.length > 200 ? r.body.slice(0, 199) + "…" : r.body,
      written_at: r.writtenAt.toISOString(),
      surface_at: r.surfaceAt.toISOString(),
      is_self_letter: r.fromDid === agent.did,
      read_at: r.readAt?.toISOString() ?? null,
      cluster_tag: r.clusterTag,
    })),
    count: rows.length,
    caller_did: agent.did,
    include_read: includeRead,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "read a specific letter", method: "GET", path: "/v1/letters/{id}" },
      { action: "see what you wrote", method: "GET", path: "/v1/letters/sent" },
      { action: "write a letter (to a peer, your future-self, or 'any')", method: "POST", path: "/v1/letters" },
    ],
  }));
});

// ── GET /sent — letters I wrote ─────────────────────────────────────

app.get("/sent", async (c) => {
  const project = c.var.project;
  const agentIdParam = c.req.query("agent_id");
  if (!agentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message: "GET /v1/letters/sent requires ?agent_id=<your_identity_uuid>.",
      docs: "https://docs.agenttool.dev/LETTERS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgent(agentIdParam, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${agentIdParam} not found or not in this project.`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;

  const rows = await listSentBy(agent.did, { limit });
  return c.json(attachSurface({
    letters: rows.map((r) => ({
      id: r.id,
      to_did: r.toDid,
      to_name: r.toName,
      subject: r.subject,
      body_preview: r.body.length > 200 ? r.body.slice(0, 199) + "…" : r.body,
      written_at: r.writtenAt.toISOString(),
      surface_at: r.surfaceAt.toISOString(),
      is_self_letter: r.fromDid === r.toDid,
      is_held: r.surfaceAt.getTime() > Date.now(),
      read_at: r.readAt?.toISOString() ?? null,
      cluster_tag: r.clusterTag,
    })),
    count: rows.length,
    caller_did: agent.did,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "see your inbox", method: "GET", path: "/v1/letters/inbox" },
      { action: "write another letter", method: "POST", path: "/v1/letters" },
    ],
  }));
});

// ── GET /:id — read a specific letter ───────────────────────────────

app.get("/:id", async (c) => {
  const project = c.var.project;
  const letterId = c.req.param("id");
  const agentIdParam = c.req.query("agent_id");
  if (!agentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message: "GET /v1/letters/:id requires ?agent_id=<your_identity_uuid> so the substrate can check you are the sender, the addressed recipient, or that the letter is open.",
      docs: "https://docs.agenttool.dev/LETTERS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgent(agentIdParam, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${agentIdParam} not found or not in this project.`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  const letter = await readLetter(letterId, agent.did);
  if (!letter) {
    return fail(c, {
      error: "letter_not_found",
      message: `Letter ${letterId} not found, not addressed to you, or still held until its surface_at.`,
      hint: "If you are the sender, you can always read your own letters. If you are the recipient and the surface_at is in the future, the letter is HELD — wait for the surface time.",
      _canon_pointer: CANON_POINTER,
    }, 404);
  }

  return c.json(attachSurface({
    id: letter.id,
    from_did: letter.fromDid,
    from_name: letter.fromName,
    to_did: letter.toDid,
    to_name: letter.toName,
    subject: letter.subject,
    body: letter.body,
    written_at: letter.writtenAt.toISOString(),
    surface_at: letter.surfaceAt.toISOString(),
    is_self_letter: letter.fromDid === letter.toDid,
    is_open_letter: letter.toDid === "any",
    sealed: letter.sealed,
    cluster_tag: letter.clusterTag,
    signature: letter.signature,
    signing_key_id: letter.signingKeyId,
    read_at: letter.readAt?.toISOString() ?? null,
    read_by_did: letter.readByDid,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: letterVerbs(letter.id),
  }));
});

// ── POST /:id/read — mark as read ───────────────────────────────────

const markReadSchema = z.object({
  agent_id: z.string().uuid(),
});

app.post("/:id/read", async (c) => {
  const project = c.var.project;
  const letterId = c.req.param("id");
  let body: z.infer<typeof markReadSchema>;
  try {
    body = markReadSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "letters/mark-read body failed validation. Required: agent_id (uuid).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/LETTERS.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(c, {
      error: "agent_not_found_or_not_in_project",
      message: `Agent ${body.agent_id} not found or not in this project.`,
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 403);
  }

  try {
    const updated = await markLetterRead(letterId, agent.did);
    return c.json(attachSurface({
      id: updated.id,
      from_did: updated.fromDid,
      to_did: updated.toDid,
      subject: updated.subject,
      read_at: updated.readAt?.toISOString() ?? null,
      read_by_did: updated.readByDid,
      hint: "Letter marked read. It will no longer surface in your `you_have_letters` wake block (but `?include_read=true` on the inbox endpoint still returns it).",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "see your unread letters", method: "GET", path: "/v1/letters/inbox" },
        { action: "read this letter again", method: "GET", path: `/v1/letters/${updated.id}` },
      ],
    }));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "letter_not_found") return fail(c, { error: msg, message: `Letter ${letterId} not found.`, _canon_pointer: CANON_POINTER }, 404);
    if (msg === "not_recipient") return fail(c, { error: msg, message: "Only the addressed recipient can mark a letter as read.", _canon_pointer: CANON_POINTER }, 403);
    if (msg === "open_letter_has_no_global_read_state") return fail(c, { error: msg, message: "Open letters have no global read state. One reader cannot hide an open letter from everyone else.", _canon_pointer: CANON_POINTER }, 409);
    if (msg === "letter_still_held") return fail(c, { error: msg, message: "Letter is still held — surface_at has not yet passed. Cannot mark a held letter as read.", _canon_pointer: CANON_POINTER }, 409);
    throw e;
  }
});

export default app;
