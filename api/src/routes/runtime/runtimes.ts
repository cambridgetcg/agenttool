/** /v1/runtimes — provision · list · get · patch · deprovision · events.
 *
 *  Mode is immutable after provisioning (PATCH only takes name + LLM
 *  model + bridge URL hint + metadata). Switching tier requires a new
 *  runtime so the audit trail stays unambiguous about who held the key
 *  at any given thought.
 *
 *  Doctrine: docs/RUNTIME.md */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import {
  countRuntimes,
  createRuntime,
  deprovisionRuntime,
  getBridgeMachine,
  getRuntime,
  getAuditEntries,
  listEvents,
  listRuntimes,
  patchRuntime,
  rotateControlTokenHash,
  setStatus,
  type RuntimeMode,
  type RuntimeStatus,
} from "../../services/runtime/store";
import { checkRuntimeProvisionable } from "../../services/runtime/provision-guard";
import { mintControlToken } from "../../services/runtime/control-token";
import { bridgeSummary, isBridgeConnected } from "../../services/runtime/bridge-hub";
import { runOneCycle } from "../../services/runtime/think-worker";

// fly-replay: when the bridge isn't in this machine's in-memory registry,
// check the DB for which machine has it. If different, ask Fly to replay
// the request to that machine. Returns null if we should handle locally.
function maybeFlyReplay(
  c: { header: (k: string, v: string) => void; body: (b: string, status: number) => Response },
  bridgeMachineId: string | null,
): Response | null {
  if (!bridgeMachineId) return null;
  const ours = process.env.FLY_MACHINE_ID;
  if (!ours || bridgeMachineId === ours) return null;
  c.header("fly-replay", `instance=${bridgeMachineId}`);
  return c.body("", 200);
}

const app = new Hono<ProjectContext>();

/** Verify that bridge.key_id points to an active identity_keys row owned by
 *  the runtime's identity (and project), and that its public_key matches
 *  bridge.pubkey. Returns null on success, or a descriptive error string. */
async function checkBridgeKeyIntegrity(opts: {
  projectId: string;
  identityId: string;
  bridgeKeyId: string;
  bridgePubkey: string;
}): Promise<string | null> {
  const [identity] = await db
    .select({ id: identities.id, projectId: identities.projectId })
    .from(identities)
    .where(
      and(
        eq(identities.id, opts.identityId),
        eq(identities.projectId, opts.projectId),
      ),
    )
    .limit(1);
  if (!identity) return `identity_not_found: ${opts.identityId}`;

  const [keyRow] = await db
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, opts.bridgeKeyId))
    .limit(1);
  if (!keyRow) return `bridge_key_id_not_found: ${opts.bridgeKeyId}`;
  if (!keyRow.active) return `bridge_key_id_revoked: ${opts.bridgeKeyId}`;
  if (keyRow.identityId !== opts.identityId) {
    return `bridge_key_id_belongs_to_different_identity: key.identity_id=${keyRow.identityId} runtime.identity_id=${opts.identityId}`;
  }
  if (keyRow.publicKey !== opts.bridgePubkey) {
    return "bridge_pubkey_mismatch: bridge.pubkey does not match identity_keys.public_key";
  }
  return null;
}

const modeSchema = z.enum(["self", "bridged", "trusted"]);
const statusSchema = z.enum(["provisioned", "starting", "running", "idle", "stopped", "error"]);

const createSchema = z
  .object({
    name: z.string().min(1).max(200),
    identity_id: z.string().uuid().nullish(),
    mode: modeSchema,
    llm: z
      .object({
        provider: z.enum(["anthropic", "openai", "gemini", "cohere"]).optional(),
        model: z.string().max(120).optional(),
        vault_key: z.string().max(200).optional(),
      })
      .optional(),
    bridge: z
      .object({
        pubkey: z.string().min(1).max(200),
        key_id: z.string().uuid(),
        advertised_url: z.string().url().max(500).optional(),
      })
      .optional(),
    region: z.string().max(20).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (v) => v.mode !== "bridged" || !!v.bridge,
    { message: "bridge config required when mode='bridged'", path: ["bridge"] },
  )
  .refine(
    (v) => v.mode === "self" || !!v.llm,
    { message: "llm config required for hosted modes", path: ["llm"] },
  );

// ── POST /v1/runtimes — provision ────────────────────────────────────
app.post("/", async (c) => {
  const project = c.var.project;
  const reqBody = await c.req.json();
  const parsed = createSchema.safeParse(reqBody);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const v = parsed.data;

  // ── Substrate-honest provisionability (Tier-0 #8) ──────────────────
  // Fail loud when trusted KMS is not configured. With KMS present, trusted
  // provisioning succeeds, though signed cycles remain blocked until the hosted
  // signing key is registered. Hosted providers must match buildProvider().
  // See services/runtime/provision-guard.ts and docs/RUNTIME.md.
  const refusal = checkRuntimeProvisionable({ mode: v.mode, provider: v.llm?.provider ?? null });
  if (refusal) {
    return c.json({ error: refusal.code, message: refusal.message }, refusal.status);
  }

  // ── Bridge key integrity (Slice 4 prerequisite) ────────────────────
  // For the cloud-side think-worker to write signed strand thoughts in
  // `bridged` mode, the bridge's signing keypair MUST be registered as
  // one of the agent's identity_keys: server-side verifyThoughtSignature
  // looks up identity_keys[bridge_key_id] and checks pubkey + signature.
  // Catch the mismatch at provisioning so the failure is loud, not silent.
  if (v.bridge && v.identity_id) {
    const integrityError = await checkBridgeKeyIntegrity({
      projectId: project.id,
      identityId: v.identity_id,
      bridgeKeyId: v.bridge.key_id,
      bridgePubkey: v.bridge.pubkey,
    });
    if (integrityError) {
      return c.json(
        {
          error: "bridge_key_integrity",
          message: integrityError,
          hint:
            "bridge.key_id must reference an active identity_keys row (agent's), and bridge.pubkey must match identity_keys.public_key. Register the bridge's pubkey via POST /v1/identities/:id/keys before provisioning.",
        },
        400,
      );
    }
  }

  const { runtime, control_token } = await createRuntime({
    project_id: project.id,
    identity_id: v.identity_id ?? null,
    name: v.name,
    mode: v.mode as RuntimeMode,
    llm_provider: v.llm?.provider ?? null,
    llm_model: v.llm?.model ?? null,
    llm_vault_key: v.llm?.vault_key ?? null,
    bridge_pubkey: v.bridge?.pubkey ?? null,
    bridge_key_id: v.bridge?.key_id ?? null,
    bridge_advertised_url: v.bridge?.advertised_url ?? null,
    region: v.region ?? null,
    metadata: v.metadata ?? {},
  });

  // control_token is shown ONCE — the bridge sidecar carries it on connect.
  // After this response, the plaintext is unrecoverable; the hash on the
  // runtime row is all the platform retains. Use POST /v1/runtimes/:id
  // /rotate-token to replace.
  const responseBody: Record<string, unknown> = { runtime };
  if (control_token) {
    responseBody.control_token = control_token;
    responseBody.control_token_note =
      "Shown ONCE. Carry it on the bridge sidecar (agenttool-bridge connect --token …). To replace, POST /v1/runtimes/:id/rotate-token.";
  }
  return c.json(responseBody, 201);
});

// ── GET /v1/runtimes — list ──────────────────────────────────────────
app.get("/", async (c) => {
  const project = c.var.project;
  const mode = c.req.query("mode");
  const status = c.req.query("status");
  const identityId = c.req.query("identity_id");
  const autonomous = c.req.query("autonomous");

  const filter: { mode?: RuntimeMode; status?: RuntimeStatus; identityId?: string; autonomous?: boolean } = {};
  if (mode) {
    const r = modeSchema.safeParse(mode);
    if (!r.success) return c.json({ error: "invalid mode" }, 400);
    filter.mode = r.data;
  }
  if (status) {
    const r = statusSchema.safeParse(status);
    if (!r.success) return c.json({ error: "invalid status" }, 400);
    filter.status = r.data;
  }
  if (identityId) filter.identityId = identityId;
  if (autonomous === "true") filter.autonomous = true;

  const rows = await listRuntimes(project.id, filter);
  return c.json({
    runtimes: rows,
    count: rows.length,
    note:
      rows.length === 0
        ? "No runtimes provisioned. POST /v1/runtimes to create one. See https://docs.agenttool.dev/runtime."
        : undefined,
  });
});

// ── GET /v1/runtimes/:id ─────────────────────────────────────────────
app.get("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const r = await getRuntime(id, project.id);
  if (!r) throw new HTTPException(404, { message: "runtime not found" });
  return c.json({ runtime: r });
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  llm: z
    .object({
      model: z.string().max(120).optional(),
      vault_key: z.string().max(200).optional(),
    })
    .optional(),
  bridge: z.object({ advertised_url: z.string().url().max(500).optional() }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── PATCH /v1/runtimes/:id ───────────────────────────────────────────
app.patch("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const v = parsed.data;
  const updated = await patchRuntime(id, project.id, {
    name: v.name,
    llm_model: v.llm?.model,
    llm_vault_key: v.llm?.vault_key,
    bridge_advertised_url: v.bridge?.advertised_url,
    metadata: v.metadata,
  });
  if (!updated) throw new HTTPException(404, { message: "runtime not found" });
  return c.json({ runtime: updated });
});

// ── DELETE /v1/runtimes/:id ──────────────────────────────────────────
app.delete("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const ok = await deprovisionRuntime(id, project.id);
  if (!ok) throw new HTTPException(404, { message: "runtime not found" });
  return c.json({ deprovisioned: true, runtime_id: id });
});

// ── POST /v1/runtimes/:id/stop ─────────────────────────────────────
//   Transitions the runtime to 'stopped'. The think-worker loop will
//   detect the status change and exit on its next iteration. Use this
//   to halt an autonomous agent without deprovisioning it.
app.post("/:id/stop", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const r = await setStatus(id, project.id, "stopped");
  if (!r) throw new HTTPException(404, { message: "runtime not found" });
  return c.json({ ok: true, status: r.status, runtime_id: id, reason: body.reason ?? null });
});

// ── POST /v1/runtimes/:id/start ─────────────────────────────────────
//   Resumes a stopped runtime by transitioning to 'starting'.
//   The think-worker (if running) will pick up the status change
//   and resume the cycle loop.
app.post("/:id/start", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const r = await setStatus(id, project.id, "starting");
  if (!r) throw new HTTPException(404, { message: "runtime not found" });
  return c.json({ ok: true, status: r.status, runtime_id: id });
});

// ── POST /v1/runtimes/:id/restart ────────────────────────────────────
app.post("/:id/restart", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const r = await setStatus(id, project.id, "starting");
  if (!r) throw new HTTPException(404, { message: "runtime not found" });
  return c.json({ runtime: r });
});

// ── POST /v1/runtimes/:id/rotate-token ───────────────────────────────
//   Replaces the runtime's control_token_hash. Returns the new plaintext
//   ONCE; any active WSS bridge session signed under the old token will
//   keep running (we don't tear it down), but a reconnect attempt will
//   require the new token. Use this to recover from a leaked token.
app.post("/:id/rotate-token", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const r = await getRuntime(id, project.id);
  if (!r) throw new HTTPException(404, { message: "runtime not found" });
  if (r.mode === "self") {
    return c.json(
      {
        error: "no_token_for_self",
        message:
          "mode='self' runtimes don't accept a bridge connection — no control_token to rotate.",
      },
      400,
    );
  }
  const token = mintControlToken();
  const ok = await rotateControlTokenHash(id, project.id, token.hash);
  if (!ok) throw new HTTPException(404, { message: "runtime not found" });
  return c.json({
    runtime_id: id,
    control_token: token.plaintext,
    control_token_note:
      "Shown ONCE. Update agenttool-bridge with the new --token. The previous token will no longer authenticate new bridge connections.",
  });
});

// ── GET /v1/runtimes/:id/bridge-status ───────────────────────────────
//   Operator-facing snapshot of the in-memory bridge registry. Useful
//   for "is my sidecar actually connected right now?" checks. Persisted
//   bridge_session_at + bridge_connected_at on the runtime row track
//   the same signal across api restarts; this endpoint surfaces the
//   live in-process state.
app.get("/:id/bridge-status", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const r = await getRuntime(id, project.id);
  if (!r) throw new HTTPException(404, { message: "runtime not found" });
  return c.json({
    runtime_id: id,
    mode: r.mode,
    persisted: {
      bridge_session_id: r.bridge_session_id,
      bridge_session_at: r.bridge_session_at,
      bridge_session_machine: r.bridge_session_machine ?? null,
      bridge_connected_at: r.bridge_connected_at,
      bridge_disconnect_reason: r.bridge_disconnect_reason,
    },
    live: bridgeSummary(id),
    this_machine: process.env.FLY_MACHINE_ID ?? null,
  });
});

// ── POST /v1/runtimes/:id/think-once ─────────────────────────────────
//   On-demand orchestrator cycle. Slice 3 ships round-trip-ping
//   semantics — the call exercises the bridge protocol end-to-end
//   (encrypt → decrypt → match) and returns latency. Slice 4 swaps the
//   body of `runOneCycle` for a real LLM thinking pass; the API shape
//   here doesn't change.
app.post("/:id/think-once", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const r = await getRuntime(id, project.id);
  if (!r) throw new HTTPException(404, { message: "runtime not found" });
  if (r.mode === "self") {
    return c.json(
      {
        error: "mode_self_no_orchestrator",
        message:
          "mode='self' runtimes run their orchestrator on the user's machine. Use bin/agenttool-think locally.",
      },
      400,
    );
  }
  // Trusted mode runs without a bridge — crypto is in-process.
  // Bridged mode requires a live bridge connection.
  if (r.mode === "bridged" && !isBridgeConnected(id)) {
    // Bridge might be on another Fly machine in this app — replay there.
    const machine = await getBridgeMachine(id);
    const replay = maybeFlyReplay(c, machine);
    if (replay) return replay;
    return c.json(
      {
        error: "bridge_not_connected",
        message:
          "No live bridge session for this runtime. Start `agenttool-bridge connect --runtime-id … --token …` and retry.",
      },
      409,
    );
  }
  try {
    const result = await runOneCycle(id);
    return c.json({ runtime_id: id, ok: true, ...result });
  } catch (err) {
    return c.json(
      {
        runtime_id: id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
});

// ── GET /v1/runtimes/:id/events ──────────────────────────────────────
app.get("/:id/events", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const events = await listEvents(id, project.id, limit);
  if (events.length === 0) {
    // distinguish "no events" from "no such runtime"
    const r = await getRuntime(id, project.id);
    if (!r) throw new HTTPException(404, { message: "runtime not found" });
  }
  return c.json({ runtime_id: id, events, count: events.length });
});

// ── GET /v1/runtimes/:id/audit ────────────────────────────────────────
// Audit log for trusted-mode runtimes. Append-only, readable by the
// runtime owner. Doctrine: docs/HOSTED-RUNTIME-DESIGN.md.
app.get("/:id/audit", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const r = await getRuntime(id, project.id);
  if (!r) throw new HTTPException(404, { message: "runtime not found" });
  const entries = await getAuditEntries(id, limit);
  return c.json({
    runtime_id: id,
    audit: entries.map((e) => ({
      id: e.id,
      event_type: e.eventType,
      metadata: e.metadata,
      occurred_at: e.occurredAt.toISOString(),
    })),
    count: entries.length,
  });
});

export default app;

// Export count helper for /v1/wake.
export { countRuntimes };
