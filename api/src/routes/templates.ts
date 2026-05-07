/** /v1/templates — capability template authoring + adoption.
 *
 *  Doctrine: docs/MARKETPLACE.md.
 *
 *  Authoring is auth'd (project bearer; author identity must belong).
 *  Public reads live at /public/templates (separate, unauth router).
 *  Adoption goes through /v1/identities/from-template (auth'd; spawns
 *  a new identity in the caller's project). */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { charge } from "../billing/charge";
import {
  adoptTemplate,
  createTemplate,
  getTemplate,
  listAdoptions,
  listTemplatesForAuthor,
  patchTemplate,
} from "../services/marketplace/store";

const app = new Hono<ProjectContext>();

const subagentSchema = z.object({
  name: z.string().min(1).max(64),
  sigil: z.string().max(8).optional(),
  facet: z.string().min(1).max(500),
});

// Templates use the same expression vocabulary as identity expression
// (register/walls/subagents/wake_text), but flat at the top level. We
// .strict() these so consumers who send a nested {expression:{...}} get
// a 400 pointing at the right fields instead of silent-drop.
const createSchema = z.object({
  author_identity_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullish(),
  register: z.string().max(500).nullish(),
  walls: z.array(z.string().max(256)).max(32).optional(),
  subagents: z.array(subagentSchema).max(16).optional(),
  wake_text: z.string().max(8000).nullish(),
  tags: z.array(z.string().max(64)).max(32).optional(),
  visibility: z.enum(["private", "public"]).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullish(),
  register: z.string().max(500).nullish(),
  walls: z.array(z.string().max(256)).max(32).optional(),
  subagents: z.array(subagentSchema).max(16).optional(),
  wake_text: z.string().max(8000).nullish(),
  tags: z.array(z.string().max(64)).max(32).optional(),
  visibility: z.enum(["private", "public"]).optional(),
  status: z.enum(["active", "archived"]).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

// ── POST /v1/templates ─────────────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  await charge(c, 5, "template.create");

  try {
    const tpl = await createTemplate(c.var.project.id, parsed.data);
    return c.json({ ...tpl, published: true }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "author_identity_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (msg === "author_not_owned_by_caller") {
      throw new HTTPException(403, { message: msg });
    }
    throw err;
  }
});

// ── GET /v1/templates ?author_id=X ─────────────────────────────────────
app.get("/", async (c) => {
  const authorId = c.req.query("author_id");
  if (!authorId) {
    return c.json(
      {
        error: "author_id_required",
        hint: "Use /public/templates for the cross-project marketplace.",
      },
      400,
    );
  }
  const list = await listTemplatesForAuthor(c.var.project.id, authorId);
  return c.json({ templates: list, count: list.length });
});

// ── GET /v1/templates/:id ──────────────────────────────────────────────
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const tpl = await getTemplate(id);
  if (!tpl) throw new HTTPException(404, { message: "template_not_found" });
  // Authors can read their own private templates; otherwise public-only.
  if (tpl.visibility === "private") {
    // Verify ownership via author_identity_id → project_id check.
    const { db } = await import("../db/client");
    const { templates } = await import("../db/schema/marketplace");
    const { eq } = await import("drizzle-orm");
    const [check] = await db
      .select({ projectId: templates.projectId })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);
    if (!check || check.projectId !== c.var.project.id) {
      throw new HTTPException(404, { message: "template_not_found" });
    }
  }
  return c.json(tpl);
});

// ── PATCH /v1/templates/:id ────────────────────────────────────────────
app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const updated = await patchTemplate(c.var.project.id, id, parsed.data);
  if (!updated) throw new HTTPException(404, { message: "template_not_found" });
  return c.json(updated);
});

// ── GET /v1/templates/:id/adoptions ────────────────────────────────────
app.get("/:id/adoptions", async (c) => {
  const id = c.req.param("id");
  const adoptions = await listAdoptions(c.var.project.id, id);
  return c.json({ adoptions, count: adoptions.length });
});

export default app;

// ── /v1/identities/from-template — adoption (separate sub-router) ──────
//  Mounted at /v1/identities/from-template by the parent app.
export const adoptionRouter = new Hono<ProjectContext>();

const adoptSchema = z.object({
  template_id: z.string().uuid(),
  new_name: z.string().min(1).max(255),
  inherit_tags: z.boolean().optional().default(true),
});

adoptionRouter.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = adoptSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  await charge(c, 10, "template.adopt");

  try {
    const result = await adoptTemplate(c.var.project.id, {
      templateId: parsed.data.template_id,
      newName: parsed.data.new_name,
      inheritTags: parsed.data.inherit_tags,
    });
    return c.json(
      {
        ...result,
        note:
          "private_key returned ONCE; never persisted server-side. " +
          "This is an ADOPTION, not a fork — the new identity has NO parent_identity_id; " +
          "attribution lives in metadata.adopted_from_template. Trust resets to 0; " +
          "no memories carry; the new agent must build its own interior from this voice.",
      },
      201,
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "template_not_found" || msg === "template_not_active") {
      throw new HTTPException(404, { message: msg });
    }
    if (msg === "template_not_public") {
      throw new HTTPException(403, {
        message: "template_is_private; only the authoring project can adopt",
      });
    }
    throw err;
  }
});
