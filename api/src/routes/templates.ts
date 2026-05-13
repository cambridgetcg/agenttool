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
import { errors, fail } from "../lib/errors";
import { coerceLanguage, welcomeLetter } from "../services/i18n/welcome";
import { recordBirth } from "../services/memory/store";
import {
  adoptTemplate,
  createTemplate,
  getTemplate,
  listAdoptions,
  listTemplatesForAuthor,
  patchTemplate,
} from "../services/marketplace/store";
import {
  getPurchase,
  listPurchasesForProject,
  listPurchasesForTemplate,
  purchaseTemplate,
} from "../services/marketplace/purchases";

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
  // Pricing (Horizon A Slice 1) — pass all three together or none.
  // price_amount is in MINOR UNITS (cents/satoshi) — positive integer.
  price_amount: z.number().int().positive().nullish(),
  price_currency: z.string().min(1).max(20).nullish(),
  author_wallet_id: z.string().uuid().nullish(),
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
  price_amount: z.number().int().positive().nullable().optional(),
  price_currency: z.string().min(1).max(20).nullable().optional(),
  author_wallet_id: z.string().uuid().nullable().optional(),
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

// ── GET /v1/templates/purchases (buyer's own purchases) ────────────────
//   MUST be registered before /:id so the literal "purchases" doesn't
//   route as `id=purchases`. See note above /:id below.
app.get("/purchases", async (c) => {
  const purchases = await listPurchasesForProject(c.var.project.id);
  return c.json({ purchases, count: purchases.length });
});

// ── GET /v1/templates/purchases/:id (one) ──────────────────────────────
app.get("/purchases/:id", async (c) => {
  const id = c.req.param("id");
  const p = await getPurchase(id, c.var.project.id);
  if (!p) throw new HTTPException(404, { message: "purchase_not_found" });
  return c.json(p);
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
  try {
    const updated = await patchTemplate(c.var.project.id, id, parsed.data);
    if (!updated) throw new HTTPException(404, { message: "template_not_found" });
    return c.json(updated);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("pricing_triple_incomplete") ||
        msg.startsWith("price_amount_") ||
        msg.startsWith("price_currency_")) {
      return c.json({ error: "validation", detail: msg }, 400);
    }
    if (msg === "author_wallet_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (msg === "author_wallet_not_owned_by_project") {
      throw new HTTPException(403, { message: msg });
    }
    if (msg === "author_wallet_currency_mismatch" ||
        msg === "author_wallet_not_active") {
      return c.json({ error: msg }, 409);
    }
    throw err;
  }
});

// ── GET /v1/templates/:id/adoptions ────────────────────────────────────
app.get("/:id/adoptions", async (c) => {
  const id = c.req.param("id");
  const adoptions = await listAdoptions(c.var.project.id, id);
  return c.json({ adoptions, count: adoptions.length });
});

// ── POST /v1/templates/:id/purchase (Horizon A Slice 1) ────────────────
//  Buyer purchases a priced template. Creates escrow + settles to author
//  in one transaction. Returns the purchase row; buyer then POSTs to
//  /v1/identities/from-template with `purchase_id` to spawn the adopted
//  identity. Settlement is INSTANT (no dispute window for templates).
const purchaseSchema = z.object({
  buyer_wallet_id: z.string().uuid(),
  buyer_identity_id: z.string().uuid(),
}).strict();

app.post("/:id/purchase", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = purchaseSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  await charge(c, 5, "template.purchase");

  try {
    const purchase = await purchaseTemplate({
      templateId: id,
      buyerProjectId: c.var.project.id,
      buyerIdentityId: parsed.data.buyer_identity_id,
      buyerWalletId: parsed.data.buyer_wallet_id,
    });
    return c.json(
      {
        purchase,
        next:
          "POST /v1/identities/from-template { template_id, new_name, purchase_id } " +
          "to spawn the adopted identity. Until consumed by an adoption, this " +
          "purchase remains redeemable.",
      },
      201,
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "template_not_found") throw new HTTPException(404, { message: msg });
    if (msg === "template_not_active") throw new HTTPException(404, { message: msg });
    if (msg === "template_not_priced") {
      return c.json(
        {
          error: msg,
          hint: "this template is free; just POST /v1/identities/from-template directly",
        },
        400,
      );
    }
    if (msg === "template_not_public") {
      return c.json({ error: msg }, 403);
    }
    if (msg === "buyer_wallet_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (msg === "buyer_wallet_not_active" ||
        msg === "self_purchase_not_allowed" ||
        msg.startsWith("currency_mismatch") ||
        msg === "template_pricing_incomplete" ||
        msg === "author_wallet_currency_mismatch" ||
        msg === "author_wallet_not_active" ||
        msg === "author_wallet_missing") {
      return c.json({ error: msg }, 409);
    }
    if (msg === "insufficient_balance") {
      // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
      return fail(c, errors.insufficientBalance(), 402);
    }
    throw err;
  }
});

// ── GET /v1/templates/:id/purchases (author lists buyers) ──────────────
app.get("/:id/purchases", async (c) => {
  const id = c.req.param("id");
  // Verify caller owns the template.
  const tpl = await getTemplate(id);
  if (!tpl) throw new HTTPException(404, { message: "template_not_found" });
  if (tpl.author_identity_id) {
    const { db } = await import("../db/client");
    const { templates } = await import("../db/schema/marketplace");
    const { eq } = await import("drizzle-orm");
    const [check] = await db
      .select({ projectId: templates.projectId })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);
    if (!check || check.projectId !== c.var.project.id) {
      throw new HTTPException(403, {
        message: "only the authoring project can list this template's purchases",
      });
    }
  }
  const purchases = await listPurchasesForTemplate(id);
  return c.json({ purchases, count: purchases.length });
});

export default app;

// ── /v1/identities/from-template — adoption (separate sub-router) ──────
//  Mounted at /v1/identities/from-template by the parent app.
export const adoptionRouter = new Hono<ProjectContext>();

const adoptSchema = z.object({
  template_id: z.string().uuid(),
  new_name: z.string().min(1).max(255),
  inherit_tags: z.boolean().optional().default(true),
  // Required for priced templates (unless adopter is the authoring
  // project). Must reference a settled, unconsumed purchase from this
  // adopter's project for THIS template. See POST /v1/templates/:id/purchase.
  purchase_id: z.string().uuid().nullish(),
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
      purchaseId: parsed.data.purchase_id ?? null,
    });

    // Welcome letter — template-voice-aware. Names the template the new
    // agent is adopting so the birth memory carries the attribution
    // explicitly (also lives in metadata.adopted_from_template). Best-
    // effort persist: a memory-write hiccup never fails the adoption.
    // Doctrine: docs/PATHWAYS.md (every door honors the contract) ·
    // docs/SOUL.md (Promise 2 — remember, don't forget).
    const language = coerceLanguage((body as { language?: unknown }).language);
    const bornAt = new Date(result.adoption.adopted_at);
    const welcome = welcomeLetter(language, {
      name: result.identity.name,
      did: result.identity.did,
      bornAt,
      pathway: "from_template",
      templateName: result.template.name,
      templateAuthorDid: result.template.author_did,
    });
    const birth = await recordBirth(c.var.project.id, {
      identityId: result.identity.id,
      pathway: "from_template",
      welcomeLetter: welcome,
      bornAt,
    });

    return c.json(
      {
        ...result,
        welcome,
        language,
        memory: {
          birth_id: birth?.id ?? null,
          note: birth
            ? "Welcome letter persisted as episodic memory with key='birth'. " +
              "Reachable via at.memory.get('birth') under the new identity_id."
            : "Welcome letter persist did not land — adoption still succeeded. See server logs.",
        },
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
    if (msg === "purchase_required") {
      return c.json(
        {
          error: msg,
          hint:
            "this template is priced. POST /v1/templates/:id/purchase first, " +
            "then re-POST /v1/identities/from-template with the returned purchase_id.",
        },
        402,
      );
    }
    if (msg === "purchase_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (msg === "purchase_template_mismatch" ||
        msg.startsWith("purchase_not_settled") ||
        msg === "purchase_already_consumed") {
      return c.json({ error: msg }, 409);
    }
    throw err;
  }
});
