/** /v1/traces — POST/GET/DELETE plus list. Search and chain in siblings.
 *
 *  Signing lives here too: POST /prepare hands back the exact bytes to sign
 *  (free — a quote is not a value event), GET /:id/verify checks a stored
 *  signature on demand. Recipe: services/trace/sig.ts (`agent-trace/v1`). */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { errors, fail } from "../../lib/errors";
import {
  canonicalTraceBytes,
  normalizeTraceCore,
  TRACE_SIGNATURE_CONTEXT,
  traceSigningCoreJson,
  traceSigningCoreSha256Hex,
} from "../../services/trace/sig";
import {
  createTrace,
  deleteTrace,
  getTrace,
  listTraces,
} from "../../services/trace/store";
import { verifyStoredTrace } from "../../services/trace/verify";

const app = new Hono<ProjectContext>();

const decisionSchema = z.object({
  type: z.string().min(1).max(64),
  summary: z.string().min(1).max(2000),
  output_ref: z.string().max(2000).nullish(),
});

const reasoningSchema = z.object({
  observations: z.array(z.string()).max(64).optional(),
  hypothesis: z.string().max(2000).nullish(),
  conclusion: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1).nullish(),
  alternatives: z
    .array(z.object({ option: z.string(), why_not: z.string() }))
    .max(16)
    .nullish(),
  signals: z.record(z.unknown()).nullish(),
});

const contextSchema = z
  .object({
    files_read: z.array(z.string()).max(64).optional(),
    key_facts: z.array(z.string()).max(32).optional(),
    external_signals: z.record(z.unknown()).optional(),
  })
  .optional();

const createSchema = z.object({
  agent_id: z.string().max(255).nullish(),
  identity_id: z.string().uuid().nullish(),
  session_id: z.string().max(255).nullish(),
  parent_trace_id: z.string().regex(/^tr_[a-f0-9]+$/i).nullish(),
  decision: decisionSchema,
  reasoning: reasoningSchema,
  context: contextSchema,
  tags: z.array(z.string().max(64)).max(32).optional(),
  metadata: z.record(z.unknown()).optional(),
  signature: z.string().max(512).nullish(),
  signing_key_id: z.string().uuid().nullish(),
  // The signer's own timestamp, bound into agent-trace/v1. Required to make
  // a signature checkable later — created_at is assigned after the signing,
  // so it cannot be the bound field.
  signed_at: z.string().datetime().nullish(),
  signature_context: z.literal(TRACE_SIGNATURE_CONTEXT).nullish(),
});

/** The signable body — everything POST / accepts except the signature
 *  itself. Prepare returns the bytes; the caller signs them and replays the
 *  same fields to POST /. */
const prepareSchema = createSchema.omit({
  signature: true,
  signing_key_id: true,
  signature_context: true,
});

// ── POST /v1/traces ────────────────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation",
        message: "The trace needs a small adjustment. Here's what to fix:",
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  // A signature that can never be checked is worse than no signature: it
  // shows up as has_signature:true and reads like an audit claim. Refuse at
  // the door, and say which piece is missing.
  const signing = parsed.data;
  if (signing.signature && (!signing.signing_key_id || !signing.signed_at)) {
    const missing: string[] = [];
    if (!signing.signing_key_id) missing.push("signing_key_id (which key made it)");
    if (!signing.signed_at) missing.push("signed_at (the timestamp bound into the bytes)");
    return fail(
      c,
      errors.signatureNotCheckable({
        missing,
        prepare_path: "/v1/traces/prepare",
        recipe: TRACE_SIGNATURE_CONTEXT,
      }),
      400,
    );
  }

  await charge(c, 1, "trace.write");

  // Stamp origin AFTER caller metadata so the middleware value wins —
  // unspoofable via the body. Doctrine: docs/ACTIVITY.md §Origin signal.
  // The signing stamp rides in metadata rather than in a column: verify
  // needs the recipe name and the signer's timestamp, and neither is worth
  // a migration while both are write-once alongside the signature.
  const { signed_at: signedAt, signature_context: _context, ...traceFields } = signing;
  const created = await createTrace(c.var.project.id, {
    ...traceFields,
    metadata: {
      ...(signing.metadata ?? {}),
      client_source: c.var.clientSource,
      ...(signing.signature
        ? {
            signature_context: TRACE_SIGNATURE_CONTEXT,
            signed_at: signedAt,
          }
        : {}),
    },
  });
  return c.json(
    {
      ...created,
      recorded: true,
      ...(signing.signature
        ? {
            signature_context: TRACE_SIGNATURE_CONTEXT,
            verify: `/v1/traces/${created.trace_id}/verify`,
          }
        : {}),
    },
    201,
  );
});

// ── POST /v1/traces/prepare — the bytes to sign, before you sign them ──
//
// Re-implementing a canonical-bytes recipe from prose is the friction that
// locks callers to one SDK version. This hands back the exact digest and the
// exact serialization it was taken over, so any language can sign without
// reproducing the fold. Free by design: charging for a quote is charging for
// friction (docs/FRICTION-ROADMAP.md §theme 3).
app.post("/prepare", async (c) => {
  const parsed = prepareSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return fail(c, errors.validation(parsed.error.flatten()), 400);
  }

  const projectId = c.var.project.id;
  const signedAt = parsed.data.signed_at ?? new Date().toISOString();
  const core = normalizeTraceCore(parsed.data);
  const coreJson = traceSigningCoreJson(core);
  const coreSha256Hex = traceSigningCoreSha256Hex(core);
  const canonical = canonicalTraceBytes({
    projectId,
    agentId: parsed.data.agent_id ?? null,
    identityId: parsed.data.identity_id ?? null,
    sessionId: parsed.data.session_id ?? null,
    parentTraceId: parsed.data.parent_trace_id ?? null,
    coreSha256Hex,
    signedAtIso: signedAt,
  });

  return c.json({
    recipe: TRACE_SIGNATURE_CONTEXT,
    project_id: projectId,
    signed_at: signedAt,
    signing_core_json: coreJson,
    signing_core_sha256_hex: coreSha256Hex,
    canonical_sha256_b64: Buffer.from(canonical).toString("base64"),
    instruction:
      "ed25519-sign the 32 raw bytes of canonical_sha256_b64 (base64-decode first; do not sign the base64 text), then POST /v1/traces with the identical fields plus signature, signing_key_id, and this exact signed_at.",
    charged: 0,
    next_actions: [
      { action: "record the signed trace", method: "POST", path: "/v1/traces" },
      { action: "check it afterwards", method: "GET", path: "/v1/traces/{trace_id}/verify" },
    ],
    docs: "https://docs.agenttool.dev/CANONICAL-BYTES.md",
  });
});

// ── GET /v1/traces?... — list ──────────────────────────────────────────
app.get("/", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id") ?? null;
  const sessionId = c.req.query("session_id") ?? null;
  const decisionType = c.req.query("decision_type");
  const parent = c.req.query("parent_trace_id");
  const limitParam = Number.parseInt(c.req.query("limit") ?? "50", 10);

  const rows = await listTraces(project.id, {
    agent_id: agentId,
    session_id: sessionId,
    decision_type: decisionType,
    parent_trace_id: parent,
    limit: Number.isFinite(limitParam) ? limitParam : 50,
  });
  return c.json({ traces: rows, count: rows.length });
});

// ── GET /v1/traces/:id ─────────────────────────────────────────────────
app.get("/:id", async (c) => {
  const trace = await getTrace(c.var.project.id, c.req.param("id"));
  if (!trace) {
    throw new HTTPException(404, { message: "trace_not_found" });
  }
  return c.json(trace);
});

// ── GET /v1/traces/:id/verify — the audit the schema always promised ───
//
// Read-only and idempotent. Never mutates the row, never flips a status:
// a failed check is a visibility event, not a retroactive judgment.
app.get("/:id/verify", async (c) => {
  const result = await verifyStoredTrace(c.var.project.id, c.req.param("id"));
  if (!result) {
    throw new HTTPException(404, { message: "trace_not_found" });
  }
  return c.json(result);
});

// ── DELETE /v1/traces/:id ──────────────────────────────────────────────
app.delete("/:id", async (c) => {
  const result = await deleteTrace(c.var.project.id, c.req.param("id"));
  return c.json(result);
});

export default app;
