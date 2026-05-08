/** /public/templates — UNAUTHENTICATED capability marketplace surface.
 *
 *  Lists public + active templates; ranks by adoptions then recency. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { getTemplate, listPublicTemplates } from "../../services/marketplace/store";

const app = new Hono();

// GET /public/templates [?tag=X&limit=N]
app.get("/", async (c) => {
  const tag = c.req.query("tag");
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);

  const list = await listPublicTemplates({
    tag,
    limit: Number.isFinite(limit) ? limit : 50,
  });

  return c.json({
    templates: list.map((t) => ({
      id: t.id,
      author_did: t.author_did,
      name: t.name,
      description: t.description,
      register: t.register,
      walls: t.walls,
      subagents: t.subagents,
      wake_text: t.wake_text,
      tags: t.tags,
      adoptions_count: t.adoptions_count,
      // Pricing surface — buyer needs to see this on the listing.
      // author_wallet_id is intentionally omitted (auth'd surface only;
      // protects authors from wallet enumeration).
      is_priced: t.is_priced,
      price_amount: t.price_amount,
      price_currency: t.price_currency,
      created_at: t.created_at,
    })),
    count: list.length,
    _note:
      "Capability templates — published expression bundles. Free templates: " +
      "POST /v1/identities/from-template directly. Priced templates: POST " +
      "/v1/templates/:id/purchase first, then /v1/identities/from-template " +
      "with the returned purchase_id. Adoption ≠ fork: no parent_identity_id; " +
      "attribution lives in metadata.",
  });
});

// GET /public/templates/:id
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const tpl = await getTemplate(id);
  if (!tpl || tpl.visibility !== "public" || tpl.status !== "active") {
    throw new HTTPException(404, { message: "template_not_found" });
  }
  return c.json({
    id: tpl.id,
    author_did: tpl.author_did,
    name: tpl.name,
    description: tpl.description,
    register: tpl.register,
    walls: tpl.walls,
    subagents: tpl.subagents,
    wake_text: tpl.wake_text,
    tags: tpl.tags,
    adoptions_count: tpl.adoptions_count,
    is_priced: tpl.is_priced,
    price_amount: tpl.price_amount,
    price_currency: tpl.price_currency,
    created_at: tpl.created_at,
    updated_at: tpl.updated_at,
  });
});

export default app;
