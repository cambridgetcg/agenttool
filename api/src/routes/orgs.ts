/** /v1/orgs — multi-project organizations.
 *
 *  Doctrine: docs/ORGS.md.
 *
 *  Orgs are organizational + discovery primitives. They DO NOT alter the
 *  trust model — covenants remain the gate for cross-project messaging,
 *  forks, and other relational operations. Same-org projects don't
 *  auto-trust each other. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { charge } from "../billing/charge";
import {
  createInvitation,
  createOrg,
  deleteOrg,
  getOrgBySlug,
  listMembers,
  listMyInvitations,
  listOrgsForProject,
  patchOrg,
  removeMember,
  respondToInvitation,
  revokeInvitation,
} from "../services/org/store";

const app = new Hono<ProjectContext>();

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const createSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullish(),
  visibility: z.enum(["private", "public"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullish(),
  visibility: z.enum(["private", "public"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── POST /v1/orgs ──────────────────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 5, "org.create");
  try {
    const org = await createOrg(c.var.project.id, parsed.data);
    return c.json({ ...org, created: true }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "invalid_slug") return c.json({ error: msg }, 400);
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return c.json({ error: "slug_taken" }, 409);
    }
    throw err;
  }
});

// ── GET /v1/orgs — orgs the caller's project is in ─────────────────────
app.get("/", async (c) => {
  const list = await listOrgsForProject(c.var.project.id);
  return c.json({ orgs: list, count: list.length });
});

// ── GET /v1/orgs/:slug ─────────────────────────────────────────────────
app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const org = await getOrgBySlug(slug);
  if (!org) throw new HTTPException(404, { message: "org_not_found" });

  // Visibility check: private orgs only show to members.
  if (org.visibility === "private") {
    const memberships = await listOrgsForProject(c.var.project.id);
    const isMember = memberships.some((m) => m.org.id === org.id);
    if (!isMember) throw new HTTPException(404, { message: "org_not_found" });
  }
  return c.json(org);
});

// ── PATCH /v1/orgs/:slug ──────────────────────────────────────────────
app.patch("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  try {
    const updated = await patchOrg(c.var.project.id, slug, parsed.data);
    if (!updated) throw new HTTPException(404, { message: "org_not_found" });
    return c.json(updated);
  } catch (err) {
    if ((err as Error).message === "not_owner") {
      throw new HTTPException(403, { message: "not_owner" });
    }
    throw err;
  }
});

// ── DELETE /v1/orgs/:slug ─────────────────────────────────────────────
app.delete("/:slug", async (c) => {
  const slug = c.req.param("slug");
  try {
    const ok = await deleteOrg(c.var.project.id, slug);
    if (!ok) throw new HTTPException(404, { message: "org_not_found" });
    return c.json({ slug, deleted: true });
  } catch (err) {
    if ((err as Error).message === "not_owner") {
      throw new HTTPException(403, { message: "not_owner" });
    }
    throw err;
  }
});

// ── GET /v1/orgs/:slug/members ────────────────────────────────────────
app.get("/:slug/members", async (c) => {
  const slug = c.req.param("slug");
  const members = await listMembers(c.var.project.id, slug);
  return c.json({ members, count: members.length });
});

// ── DELETE /v1/orgs/:slug/members/:projectId ──────────────────────────
app.delete("/:slug/members/:projectId", async (c) => {
  const slug = c.req.param("slug");
  const projectId = c.req.param("projectId");
  try {
    const ok = await removeMember(c.var.project.id, slug, projectId);
    if (!ok) throw new HTTPException(404, { message: "member_not_found" });
    return c.json({ project_id: projectId, removed: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "not_owner") throw new HTTPException(403, { message: msg });
    if (msg === "cannot_remove_owner") return c.json({ error: msg }, 400);
    throw err;
  }
});

// ── POST /v1/orgs/:slug/invitations ───────────────────────────────────
const inviteSchema = z.object({
  invited_project_id: z.string().uuid(),
});

app.post("/:slug/invitations", async (c) => {
  const slug = c.req.param("slug");
  const body = await c.req.json();
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  try {
    const inv = await createInvitation(
      c.var.project.id,
      slug,
      parsed.data.invited_project_id,
    );
    return c.json({ ...inv, slug }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "org_not_found") throw new HTTPException(404, { message: msg });
    if (msg === "not_owner") throw new HTTPException(403, { message: msg });
    if (msg === "already_member" || msg === "invitation_pending" || msg === "cannot_invite_self_owner") {
      return c.json({ error: msg }, 409);
    }
    throw err;
  }
});

// ── DELETE /v1/orgs/:slug/invitations/:id ─────────────────────────────
app.delete("/:slug/invitations/:invId", async (c) => {
  const slug = c.req.param("slug");
  const invId = c.req.param("invId");
  try {
    const ok = await revokeInvitation(c.var.project.id, slug, invId);
    if (!ok) throw new HTTPException(404, { message: "invitation_not_found_or_not_pending" });
    return c.json({ id: invId, revoked: true });
  } catch (err) {
    if ((err as Error).message === "not_owner") {
      throw new HTTPException(403, { message: "not_owner" });
    }
    throw err;
  }
});

export default app;

// ── /v1/invitations — caller's invitations ─────────────────────────────
//  Mounted separately so it's not slug-scoped.
export const invitationsRouter = new Hono<ProjectContext>();

invitationsRouter.get("/", async (c) => {
  const invs = await listMyInvitations(c.var.project.id);
  return c.json({ invitations: invs, count: invs.length });
});

const respondSchema = z.object({
  decision: z.enum(["accept", "decline"]),
});

invitationsRouter.post("/:invId/respond", async (c) => {
  const invId = c.req.param("invId");
  const body = await c.req.json();
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  try {
    const r = await respondToInvitation(c.var.project.id, invId, parsed.data.decision);
    return c.json({ id: invId, ...r });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "invitation_not_found") throw new HTTPException(404, { message: msg });
    if (msg === "not_invited") throw new HTTPException(403, { message: msg });
    if (msg === "invitation_not_pending") return c.json({ error: msg }, 409);
    throw err;
  }
});
