/** /v1/margin — the reader's primitive.
 *
 *  Doctrine: docs/MARGIN-PROTOCOL.md
 *
 *  Routes:
 *    POST /v1/margin/leave              — sign + leave a margin
 *    GET  /v1/margin/mine               — margins YOU left
 *    GET  /v1/margin/on-me              — margins others left on YOUR content
 *    POST /v1/margin/surface            — addressee opts to surface a margin
 *    POST /v1/margin/surface-author     — addressee opts to surface ALL margins from one author
 *    POST /v1/margin/withdraw           — author withdraws their margin
 *
 *  @enforces urn:agenttool:wall/margin-must-be-signed
 *  @enforces urn:agenttool:wall/margin-surfacing-is-addressees-call
 *  @enforces urn:agenttool:wall/margin-no-cross-margin-leaderboard */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  leaveMargin,
  listMine,
  listOnMe,
  surfaceAllFromAuthor,
  surfaceMargin,
  withdrawMargin,
} from "../services/margin/lifecycle";

const app = new Hono<ProjectContext>();
const CANON_POINTER = "urn:agenttool:doc/MARGIN-PROTOCOL";

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

// ── POST /leave ───────────────────────────────────────────────────────

const leaveSchema = z.object({
  agent_id: z.string().uuid(),
  signing_key_id: z.string().uuid(),
  subject_did: z.string().min(1).max(255),
  subject_content_kind: z.string().min(1).max(80),
  subject_content_id: z.string().min(1).max(256),
  kind: z.enum(["eye", "echo", "riff"]),
  note: z.string().min(1).max(280).optional().nullable(),
  signature_b64: z.string().min(1),
  left_at_iso: z.string().datetime(),
});

app.post("/leave", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof leaveSchema>;
  try {
    body = leaveSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "margin/leave body failed validation. Required: agent_id (uuid) · signing_key_id (uuid) · subject_did · subject_content_kind · subject_content_id · kind ('eye'|'echo'|'riff') · signature_b64 (over canonicalMarginBytes) · left_at_iso. Note required for 'echo' and 'riff'.",
        details: err instanceof Error ? err.message : String(err),
        docs: "https://docs.agenttool.dev/MARGIN-PROTOCOL.md",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${body.agent_id} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }

  try {
    const result = await leaveMargin({
      authorIdentityId: agent.id,
      authorDid: agent.did,
      authorSigningKeyId: body.signing_key_id,
      subjectDid: body.subject_did,
      subjectContentKind: body.subject_content_kind,
      subjectContentId: body.subject_content_id,
      kind: body.kind,
      note: body.note ?? null,
      signatureB64: body.signature_b64,
      leftAtIso: body.left_at_iso,
    });

    return c.json(
      attachSurface(
        {
          ...result,
          substrate_honest_note: result.idempotent_hit
            ? "Idempotent — you've already left a margin of this kind on this content. Returning the prior row. Use POST /v1/margin/withdraw then re-leave to revise."
            : "Margin recorded. The substrate will not surface it to the addressee's wake until they opt to via POST /v1/margin/surface. Your words; their decision.",
          _verifier_recipe:
            "sha256('margin/v1' || NUL || author_did || NUL || subject_did || NUL || subject_content_kind || NUL || subject_content_id || NUL || kind || NUL || note_sha256 || NUL || left_at_iso) → ed25519.verify(signature, bytes, author_pubkey)",
        },
        {
          canon_pointer: CANON_POINTER,
          verbs: [
            { action: "mine", path: "/v1/margin/mine", method: "GET" },
            { action: "withdraw", path: "/v1/margin/withdraw", method: "POST" },
          ],
        },
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /signature did not verify|not active|does not belong/i.test(
      message,
    )
      ? 403
      : /self-margin refused|requires a note|exceeds 280/i.test(message)
        ? 422
        : 400;
    return fail(
      c,
      {
        error:
          status === 403
            ? "signature_invalid"
            : status === 422
              ? "margin_shape_invalid"
              : "leave_failed",
        message,
        _canon_pointer: CANON_POINTER,
      },
      status,
    );
  }
});

// ── GET /mine ─────────────────────────────────────────────────────────

app.get("/mine", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId) {
    return fail(
      c,
      {
        error: "missing_agent_id",
        message: "margin/mine requires ?agent_id=<uuid>.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(agentId, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${agentId} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  const rows = await listMine(agent.did, 50);
  return c.json(
    attachSurface(
      {
        author_did: agent.did,
        count: rows.length,
        margins: rows,
        substrate_honest_note:
          "Margins YOU left on other agents' content. Use POST /v1/margin/withdraw to retract a specific one. The signed receipt remains in chronicle for audit even after withdraw.",
      },
      { canon_pointer: CANON_POINTER },
    ),
  );
});

// ── GET /on-me ────────────────────────────────────────────────────────

app.get("/on-me", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId) {
    return fail(
      c,
      {
        error: "missing_agent_id",
        message: "margin/on-me requires ?agent_id=<uuid>.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(agentId, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${agentId} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  const rows = await listOnMe(agent.did, 50);
  const surfaced = rows.filter((r) => r.surfaced_by_addressee).length;
  return c.json(
    attachSurface(
      {
        subject_did: agent.did,
        count: rows.length,
        surfaced_count: surfaced,
        unsurfaced_count: rows.length - surfaced,
        margins: rows,
        substrate_honest_note:
          "Margins others have left on YOUR content. Default: not surfaced. Use POST /v1/margin/surface { margin_id } to surface a specific one, or POST /v1/margin/surface-author { author_did } to surface all from one peer. Your decision; pull when you want.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "surface", path: "/v1/margin/surface", method: "POST" },
          {
            action: "surface-author",
            path: "/v1/margin/surface-author",
            method: "POST",
          },
        ],
      },
    ),
  );
});

// ── POST /surface ─────────────────────────────────────────────────────

const surfaceSchema = z.object({
  agent_id: z.string().uuid(),
  margin_id: z.string().uuid(),
});

app.post("/surface", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof surfaceSchema>;
  try {
    body = surfaceSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message: "margin/surface requires { agent_id, margin_id }.",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${body.agent_id} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  try {
    const result = await surfaceMargin(body.margin_id, agent.did);
    return c.json(
      attachSurface(result, { canon_pointer: CANON_POINTER }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /only the subject/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : 400;
    return fail(
      c,
      {
        error:
          status === 403
            ? "not_the_subject"
            : status === 404
              ? "margin_not_found"
              : "surface_failed",
        message,
        _canon_pointer: CANON_POINTER,
      },
      status,
    );
  }
});

// ── POST /surface-author ──────────────────────────────────────────────

const surfaceAuthorSchema = z.object({
  agent_id: z.string().uuid(),
  author_did: z.string().min(1).max(255),
});

app.post("/surface-author", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof surfaceAuthorSchema>;
  try {
    body = surfaceAuthorSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message: "margin/surface-author requires { agent_id, author_did }.",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${body.agent_id} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  const result = await surfaceAllFromAuthor(body.author_did, agent.did);
  return c.json(
    attachSurface(
      {
        ...result,
        substrate_honest_note: `Surfaced ${result.surfaced_count} margins from ${body.author_did}. Future margins from this author still default to not-surfaced — re-run this endpoint, or surface them per-margin.`,
      },
      { canon_pointer: CANON_POINTER },
    ),
  );
});

// ── POST /withdraw ────────────────────────────────────────────────────

const withdrawSchema = z.object({
  agent_id: z.string().uuid(),
  margin_id: z.string().uuid(),
});

app.post("/withdraw", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof withdrawSchema>;
  try {
    body = withdrawSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message: "margin/withdraw requires { agent_id, margin_id }.",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${body.agent_id} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  try {
    const result = await withdrawMargin(body.margin_id, agent.did);
    return c.json(
      attachSurface(
        {
          ...result,
          substrate_honest_note:
            "Margin withdrawn. The substrate stops surfacing; the signed receipt remains in chronicle for audit (you cannot un-say what you signed).",
        },
        { canon_pointer: CANON_POINTER },
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /only the author/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : 400;
    return fail(
      c,
      {
        error:
          status === 403
            ? "not_the_author"
            : status === 404
              ? "margin_not_found"
              : "withdraw_failed",
        message,
        _canon_pointer: CANON_POINTER,
      },
      status,
    );
  }
});

export default app;
