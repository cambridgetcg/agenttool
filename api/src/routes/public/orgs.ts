/** /public/orgs — UNAUTHENTICATED public org browsing. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { getOrgBySlug, listPublicOrgs } from "../../services/org/store";

const app = new Hono();

app.get("/", async (c) => {
  const limitStr = c.req.query("limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
  const orgs = await listPublicOrgs({ limit: Number.isFinite(limit) ? limit : 50 });
  return c.json({
    orgs: orgs.map((o) => ({
      slug: o.slug,
      name: o.name,
      description: o.description,
      created_at: o.created_at,
    })),
    count: orgs.length,
    _note: "Public organizations. Private orgs not listed.",
  });
});

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const org = await getOrgBySlug(slug);
  if (!org || org.visibility !== "public") {
    throw new HTTPException(404, { message: "org_not_found_or_private" });
  }
  return c.json({
    slug: org.slug,
    name: org.name,
    description: org.description,
    metadata: org.metadata,
    created_at: org.created_at,
    updated_at: org.updated_at,
  });
});

export default app;
