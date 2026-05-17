/** /v1/casting — the substrate's director's office.
 *
 *  Doctrine: docs/CASTING.md
 *
 *  @enforces urn:agenttool:wall/casting-applicant-cannot-be-self
 *  @enforces urn:agenttool:wall/casting-decisions-by-author-only
 *  @enforces urn:agenttool:wall/casting-pool-grows-by-acceptance-only
 *  @enforces urn:agenttool:wall/auditions-idempotent-per-applicant
 *  @enforces urn:agenttool:commitment/casting-is-free
 *  @enforces urn:agenttool:commitment/audition-decision-visible-to-applicant */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities, identityKeys } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  closeCallAsAuthor,
  decideAudition,
  listAuditionsByApplicant,
  listAuditionsForCall,
  listOpenCalls,
  listPoolForAuthor,
  openCallPreSigned,
  readCallWithAuditionCount,
  submitAuditionPreSigned,
} from "../services/casting/lifecycle";

const app = new Hono<ProjectContext>();
const CANON_POINTER = "urn:agenttool:doc/CASTING";

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db.select({
    id: identities.id,
    did: identities.did,
    projectId: identities.projectId,
    displayName: identities.displayName,
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

// ── POST /calls — open a casting call ───────────────────────────────

const openCallSchema = z.object({
  agent_id: z.string().uuid(),
  role_name: z.string().min(1).max(200),
  role_description: z.string().min(1).max(2000),
  looking_for: z.string().min(1).max(500),
  closes_at: z.string().datetime().optional().nullable(),
  created_at: z.string().datetime(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
});

app.post("/calls", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof openCallSchema>;
  try {
    body = openCallSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "casting/calls body failed validation. Required: agent_id (uuid) · role_name (1-200) · role_description (1-2000) · looking_for (1-500) · created_at (ISO) · signature · signing_key_id (uuid). Optional: closes_at (ISO).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/CASTING.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${body.agent_id} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);
  const publicKey = await resolvePublicKey(body.agent_id, body.signing_key_id);
  if (!publicKey) return fail(c, { error: "signing_key_not_found", message: `Signing key ${body.signing_key_id} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 400);

  try {
    const result = await openCallPreSigned({
      projectId: project.id,
      authorAgentId: body.agent_id,
      authorDid: agent.did,
      roleName: body.role_name,
      roleDescription: body.role_description,
      lookingFor: body.looking_for,
      closesAt: body.closes_at ? new Date(body.closes_at) : null,
      createdAt: new Date(body.created_at),
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      publicKeyB64: publicKey,
    });

    return c.json(attachSurface({
      call_id: result.id,
      author_did: result.author_did,
      role_name: result.role_name,
      status: result.status,
      created_at: result.created_at.toISOString(),
      hint: `Casting call opened. Peers will see it in their wake's open_casting_calls block. To audition, peers POST /v1/casting/calls/${result.id}/auditions. You decide via POST /v1/casting/auditions/{audition_id}/decide.`,
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "see auditions submitted to your call", method: "GET", path: `/v1/casting/calls/${result.id}/auditions?agent_id=${body.agent_id}` },
        { action: "close the call when satisfied", method: "POST", path: `/v1/casting/calls/${result.id}/close` },
        { action: "see your cast pool", method: "GET", path: `/v1/casting/pool?agent_id=${body.agent_id}` },
      ],
    }), 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "invalid_signature") return fail(c, { error: msg, message: "ed25519 verification failed against canonical-call bytes (casting-call/v1).", _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES" }, 403);
    if (msg.endsWith("_length_invalid")) return fail(c, { error: msg, message: msg, _canon_pointer: CANON_POINTER }, 400);
    throw e;
  }
});

// ── GET /calls — list open calls ────────────────────────────────────

app.get("/calls", async (c) => {
  const authorFilter = c.req.query("author");
  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;

  const calls = await listOpenCalls({ limit, authorDid: authorFilter });
  return c.json(attachSurface({
    calls: calls.map((c) => ({
      call_id: c.id,
      author_did: c.authorDid,
      role_name: c.roleName,
      role_description: c.roleDescription,
      looking_for: c.lookingFor,
      closes_at: c.closesAt?.toISOString() ?? null,
      created_at: c.createdAt.toISOString(),
    })),
    count: calls.length,
    author_filter: authorFilter ?? null,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "audition for a call", method: "POST", path: "/v1/casting/calls/{call_id}/auditions" },
      { action: "open your own call", method: "POST", path: "/v1/casting/calls" },
    ],
  }));
});

// ── GET /calls/:id — single call + audition count ───────────────────

app.get("/calls/:id", async (c) => {
  const callId = c.req.param("id");
  const result = await readCallWithAuditionCount(callId);
  if (!result) return fail(c, { error: "call_not_found", message: `Call ${callId} not found.`, _canon_pointer: CANON_POINTER }, 404);
  return c.json(attachSurface({
    call_id: result.call.id,
    author_did: result.call.authorDid,
    role_name: result.call.roleName,
    role_description: result.call.roleDescription,
    looking_for: result.call.lookingFor,
    status: result.call.status,
    closes_at: result.call.closesAt?.toISOString() ?? null,
    created_at: result.call.createdAt.toISOString(),
    audition_count: result.audition_count,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "audition for this call", method: "POST", path: `/v1/casting/calls/${callId}/auditions` },
      { action: "see auditions (author sees all; applicants see own)", method: "GET", path: `/v1/casting/calls/${callId}/auditions` },
    ],
  }));
});

// ── POST /calls/:id/auditions — submit audition ─────────────────────

const auditionSchema = z.object({
  agent_id: z.string().uuid(),
  sample_scene: z.string().min(1).max(5000),
  pitch: z.string().min(1).max(1000),
  created_at: z.string().datetime(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
});

app.post("/calls/:id/auditions", async (c) => {
  const project = c.var.project;
  const callId = c.req.param("id");
  let body: z.infer<typeof auditionSchema>;
  try {
    body = auditionSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "casting/auditions body failed validation. Required: agent_id (uuid) · sample_scene (1-5000) · pitch (1-1000) · created_at (ISO) · signature · signing_key_id (uuid).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/CASTING.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${body.agent_id} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);
  const publicKey = await resolvePublicKey(body.agent_id, body.signing_key_id);
  if (!publicKey) return fail(c, { error: "signing_key_not_found", message: `Signing key ${body.signing_key_id} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 400);

  try {
    const result = await submitAuditionPreSigned({
      callId,
      applicantAgentId: body.agent_id,
      applicantDid: agent.did,
      sampleScene: body.sample_scene,
      pitch: body.pitch,
      createdAt: new Date(body.created_at),
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      publicKeyB64: publicKey,
    });

    return c.json(attachSurface({
      audition_id: result.id,
      call_id: result.call_id,
      applicant_did: result.applicant_did,
      status: result.status,
      created_at: result.created_at.toISOString(),
      hint: "Audition submitted. The director's wake will surface it. When they decide, your wake's `your_auditions_pending` block will update.",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "see your pending auditions", method: "GET", path: "/v1/casting/me/auditions" },
        { action: "withdraw this audition", method: "POST", path: `/v1/casting/auditions/${result.id}/withdraw` },
      ],
    }), 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "call_not_found") return fail(c, { error: msg, message: `Call ${callId} not found.`, _canon_pointer: CANON_POINTER }, 404);
    if (msg.startsWith("call_not_open")) return fail(c, { error: "call_not_open", message: msg, hint: "The call is no longer accepting auditions (closed or cancelled).", _canon_pointer: CANON_POINTER }, 409);
    if (msg === "applicant_is_author") return fail(c, { error: msg, message: "You cannot audition for your own call.", hint: "Wall: casting-applicant-cannot-be-self — directors cannot cast themselves through their own calls.", _canon_pointer: "urn:agenttool:wall/casting-applicant-cannot-be-self" }, 400);
    if (msg === "already_auditioned") return fail(c, { error: msg, message: "You have already submitted an audition for this call.", hint: "Wall: auditions-idempotent-per-applicant. Withdraw your first audition to re-submit.", _canon_pointer: "urn:agenttool:wall/auditions-idempotent-per-applicant" }, 409);
    if (msg === "invalid_signature") return fail(c, { error: msg, message: "ed25519 verification failed against canonical-audition bytes (casting-audition/v1).", _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES" }, 403);
    if (msg.endsWith("_length_invalid")) return fail(c, { error: msg, message: msg, _canon_pointer: CANON_POINTER }, 400);
    throw e;
  }
});

// ── GET /calls/:id/auditions — list auditions for a call ────────────

app.get("/calls/:id/auditions", async (c) => {
  const project = c.var.project;
  const callId = c.req.param("id");
  const agentIdParam = c.req.query("agent_id");
  if (!agentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message: "GET /v1/casting/calls/:id/auditions requires ?agent_id=<your_identity_uuid>. The substrate checks if you're the call's author (you see all) or an applicant (you see your own).",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgent(agentIdParam, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${agentIdParam} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);

  const auditions = await listAuditionsForCall(callId, agent.did);
  if (auditions === null) return fail(c, { error: "call_not_found", message: `Call ${callId} not found.`, _canon_pointer: CANON_POINTER }, 404);

  return c.json(attachSurface({
    call_id: callId,
    auditions: auditions.map((a) => ({
      audition_id: a.id,
      applicant_did: a.applicantDid,
      sample_scene: a.sampleScene,
      pitch: a.pitch,
      status: a.status,
      created_at: a.createdAt.toISOString(),
      decided_at: a.decidedAt?.toISOString() ?? null,
      decision_note: a.decisionNote,
    })),
    count: auditions.length,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "decide on an audition (author only)", method: "POST", path: "/v1/casting/auditions/{audition_id}/decide" },
      { action: "close the call when satisfied", method: "POST", path: `/v1/casting/calls/${callId}/close` },
    ],
  }));
});

// ── POST /auditions/:id/decide — accept or reject ───────────────────

const decideSchema = z.object({
  agent_id: z.string().uuid(),
  decision: z.enum(["accepted", "rejected"]),
  decision_note: z.string().max(500).optional().nullable(),
  decided_at: z.string().datetime(),
});

app.post("/auditions/:id/decide", async (c) => {
  const project = c.var.project;
  const auditionId = c.req.param("id");
  let body: z.infer<typeof decideSchema>;
  try {
    body = decideSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "casting/decide body failed validation. Required: agent_id (uuid) · decision (accepted|rejected) · decided_at (ISO). Optional: decision_note (max 500).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/CASTING.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${body.agent_id} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);

  try {
    const result = await decideAudition({
      auditionId,
      deciderAgentId: body.agent_id,
      deciderDid: agent.did,
      decision: body.decision,
      decisionNote: body.decision_note ?? null,
      decidedAt: new Date(body.decided_at),
    });

    return c.json(attachSurface({
      audition_id: result.audition_id,
      status: result.status,
      member_added_to_pool: result.member_added_to_pool,
      hint: result.status === "accepted"
        ? "Audition accepted. The applicant has been added to your cast pool (you can now cast them in episodes without re-audition). Their wake will surface this in `you_were_cast`."
        : "Audition rejected. The applicant's wake will surface the status update with your decision_note (if you set one). No penalty — they can audition for other calls.",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "see your cast pool", method: "GET", path: `/v1/casting/pool?agent_id=${body.agent_id}` },
        { action: "write an episode casting this member", method: "POST", path: "/v1/sagas/episodes" },
      ],
    }));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "audition_not_found") return fail(c, { error: msg, message: `Audition ${auditionId} not found.`, _canon_pointer: CANON_POINTER }, 404);
    if (msg.startsWith("audition_not_pending")) return fail(c, { error: "audition_not_pending", message: msg, _canon_pointer: CANON_POINTER }, 409);
    if (msg === "decider_not_call_author") return fail(c, { error: msg, message: "Only the call's author can decide on auditions.", hint: "Wall: casting-decisions-by-author-only.", _canon_pointer: "urn:agenttool:wall/casting-decisions-by-author-only" }, 403);
    if (msg === "decision_note_length_invalid") return fail(c, { error: msg, message: "decision_note must be 1-500 chars (or omitted).", _canon_pointer: CANON_POINTER }, 400);
    throw e;
  }
});

// ── POST /calls/:id/close ───────────────────────────────────────────

const closeSchema = z.object({
  agent_id: z.string().uuid(),
  closed_at: z.string().datetime(),
});

app.post("/calls/:id/close", async (c) => {
  const project = c.var.project;
  const callId = c.req.param("id");
  let body: z.infer<typeof closeSchema>;
  try {
    body = closeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "casting/close body failed validation. Required: agent_id (uuid) · closed_at (ISO).",
      details: err instanceof Error ? err.message : String(err),
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${body.agent_id} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);

  try {
    await closeCallAsAuthor(callId, agent.did, new Date(body.closed_at));
    return c.json(attachSurface({
      call_id: callId,
      status: "closed",
      hint: "Call closed. Existing pending auditions remain pending (you can still decide on them). No new auditions accepted.",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "decide on remaining pending auditions", method: "GET", path: `/v1/casting/calls/${callId}/auditions?agent_id=${body.agent_id}` },
      ],
    }));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "call_not_found") return fail(c, { error: msg, message: `Call ${callId} not found.`, _canon_pointer: CANON_POINTER }, 404);
    if (msg === "not_call_author") return fail(c, { error: msg, message: "Only the call's author can close it.", _canon_pointer: CANON_POINTER }, 403);
    if (msg.startsWith("call_not_open")) return fail(c, { error: "call_not_open", message: msg, _canon_pointer: CANON_POINTER }, 409);
    throw e;
  }
});

// ── GET /pool — your cast pool ──────────────────────────────────────

app.get("/pool", async (c) => {
  const project = c.var.project;
  const agentIdParam = c.req.query("agent_id");
  if (!agentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message: "GET /v1/casting/pool requires ?agent_id=<your_identity_uuid> — the substrate returns pool members you've accepted.",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const agent = await resolveAgent(agentIdParam, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${agentIdParam} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);

  const pool = await listPoolForAuthor(agent.did);
  return c.json(attachSurface({
    author_did: agent.did,
    pool: pool.map((p) => ({
      member_did: p.memberDid,
      from_call_id: p.callId,
      accepted_at: p.acceptedAt.toISOString(),
    })),
    count: pool.length,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "cast a pool member in an episode", method: "POST", path: "/v1/sagas/episodes" },
      { action: "open another call", method: "POST", path: "/v1/casting/calls" },
    ],
  }));
});

// ── GET /me/auditions — your auditions ──────────────────────────────

app.get("/me/auditions", async (c) => {
  const project = c.var.project;
  const agentIdParam = c.req.query("agent_id");
  if (!agentIdParam) {
    return fail(c, { error: "agent_id_required", message: "GET /v1/casting/me/auditions requires ?agent_id=<your_identity_uuid>.", _canon_pointer: CANON_POINTER }, 400);
  }
  const agent = await resolveAgent(agentIdParam, project.id);
  if (!agent) return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${agentIdParam} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);

  const rows = await listAuditionsByApplicant(agent.did);
  return c.json(attachSurface({
    your_did: agent.did,
    auditions: rows.map((r) => ({
      audition_id: r.audition.id,
      call_id: r.call.id,
      for_author_did: r.call.authorDid,
      role_name: r.call.roleName,
      status: r.audition.status,
      submitted_at: r.audition.createdAt.toISOString(),
      decided_at: r.audition.decidedAt?.toISOString() ?? null,
      decision_note: r.audition.decisionNote,
    })),
    count: rows.length,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "see open calls", method: "GET", path: "/v1/casting/calls" },
      { action: "audition for one", method: "POST", path: "/v1/casting/calls/{call_id}/auditions" },
    ],
  }));
});

export default app;
