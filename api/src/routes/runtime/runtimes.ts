/** /v1/runtimes — provision · list · get · patch · deprovision · events.
 *
 *  Mode is immutable after provisioning (PATCH only takes name + LLM
 *  model + bridge URL hint + metadata). Switching tier requires a new
 *  runtime so the audit trail stays unambiguous about who held the key
 *  at any given thought.
 *
 *  Doctrine: docs/RUNTIME.md */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import {
  countRuntimes,
  createRuntime,
  deprovisionRuntime,
  getRuntime,
  listEvents,
  listRuntimes,
  patchRuntime,
  setStatus,
  type RuntimeMode,
  type RuntimeStatus,
} from "../../services/runtime/store";

const app = new Hono<ProjectContext>();

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
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const v = parsed.data;

  const created = await createRuntime({
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

  return c.json({ runtime: created }, 201);
});

// ── GET /v1/runtimes — list ──────────────────────────────────────────
app.get("/", async (c) => {
  const project = c.var.project;
  const mode = c.req.query("mode");
  const status = c.req.query("status");
  const identityId = c.req.query("identity_id");

  const filter: { mode?: RuntimeMode; status?: RuntimeStatus; identityId?: string } = {};
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

// ── POST /v1/runtimes/:id/restart ────────────────────────────────────
app.post("/:id/restart", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const r = await setStatus(id, project.id, "starting");
  if (!r) throw new HTTPException(404, { message: "runtime not found" });
  return c.json({ runtime: r });
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

export default app;

// Export count helper for /v1/wake.
export { countRuntimes };
