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

// ── GET /v1/orgs/:slug/dashboard ──────────────────────────────────────
//
//  Org-aggregate rollup — sums across all member projects. Distinct from:
//    /v1/dashboard            — single identity, third-person
//    /v1/dashboard/aggregate  — single project, all identities
//    /v1/orgs/:slug/dashboard — single org, all member projects
//
//  Authorization: caller must be an active member of the org. Private
//  orgs return 404 to non-members; public orgs allow any caller (still
//  requires bearer auth at this path level — public reads of org
//  metadata go through /public).
app.get("/:slug/dashboard", async (c) => {
  const slug = c.req.param("slug");
  const org = await getOrgBySlug(slug);
  if (!org) throw new HTTPException(404, { message: "org_not_found" });

  // Membership check.
  const memberships = await listOrgsForProject(c.var.project.id);
  const isMember = memberships.some((m) => m.org.id === org.id);
  if (!isMember) {
    if (org.visibility === "private") {
      throw new HTTPException(404, { message: "org_not_found" });
    }
    throw new HTTPException(403, {
      message: "not_member",
    });
  }

  // Lazy-import drizzle bits + schemas to avoid bloating the route file
  // top-level imports just for one endpoint.
  const { and, count, desc, eq, gte, isNotNull } = await import("drizzle-orm");
  const { db } = await import("../db/client");
  const { covenants } = await import("../db/schema/continuity");
  const { identities } = await import("../db/schema/identity");
  const { inboxMessages } = await import("../db/schema/inbox");
  const { memories } = await import("../db/schema/memory");
  const { strands, thoughts } = await import("../db/schema/strand");
  const { organizationMembers } = await import("../db/schema/org");

  const memberRows = await db
    .select({ projectId: organizationMembers.projectId })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, org.id));
  const memberProjectIds = memberRows.map((r) => r.projectId);
  if (memberProjectIds.length === 0) {
    return c.json({
      org: { id: org.id, slug: org.slug, name: org.name, visibility: org.visibility },
      members: { count: 0, project_ids: [] },
      identities: { total: 0, active: 0, revoked: 0 },
      memory: { total: 0, by_tier: {} },
      strands: { total: 0, active: 0, public: 0 },
      activity: { thoughts_in_window: 0, top_active: [] },
      inbox: { unread: 0, pending_dual_witness: 0 },
      covenants: { active_org_wide: 0 },
      _note: "Empty org — no member projects.",
    });
  }

  const windowParam = c.req.query("window");
  const windowDays = windowParam === "24h" ? 1 : windowParam === "30d" ? 30 : 7;
  const windowLabel = windowParam === "24h" ? "24h" : windowParam === "30d" ? "30d" : "7d";
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const { inArray } = await import("drizzle-orm");

  // Identities.
  const identityRows = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      status: identities.status,
      trustScore: identities.trustScore,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(inArray(identities.projectId, memberProjectIds));
  const totalIdentities = identityRows.length;
  const activeIdentities = identityRows.filter((r) => r.status === "active").length;
  const revokedIdentities = identityRows.filter((r) => r.status === "revoked").length;
  const identityById = new Map(identityRows.map((r) => [r.id, r]));

  // Memory rollup.
  const memoryStats = await db
    .select({ tier: memories.tier, n: count() })
    .from(memories)
    .where(inArray(memories.projectId, memberProjectIds))
    .groupBy(memories.tier);
  const memoryByTier: Record<string, number> = {};
  let memoryTotal = 0;
  for (const r of memoryStats) {
    memoryByTier[r.tier] = Number(r.n);
    memoryTotal += Number(r.n);
  }

  // Strand rollup.
  const [{ strandTotal }] = await db
    .select({ strandTotal: count() })
    .from(strands)
    .where(inArray(strands.projectId, memberProjectIds));
  const [{ strandActive }] = await db
    .select({ strandActive: count() })
    .from(strands)
    .where(and(inArray(strands.projectId, memberProjectIds), eq(strands.status, "active")));
  const [{ strandPublic }] = await db
    .select({ strandPublic: count() })
    .from(strands)
    .where(and(inArray(strands.projectId, memberProjectIds), eq(strands.visibility, "public")));

  // Activity.
  const [{ thoughtsInWindow }] = await db
    .select({ thoughtsInWindow: count() })
    .from(thoughts)
    .where(and(inArray(thoughts.projectId, memberProjectIds), gte(thoughts.createdAt, windowStart)));

  // Top N most active across the whole org.
  const topActiveRaw = await db
    .select({ identityId: strands.identityId, n: count() })
    .from(thoughts)
    .innerJoin(strands, eq(strands.id, thoughts.strandId))
    .where(
      and(
        inArray(thoughts.projectId, memberProjectIds),
        gte(thoughts.createdAt, windowStart),
        isNotNull(strands.identityId),
      ),
    )
    .groupBy(strands.identityId)
    .orderBy(desc(count()))
    .limit(5);
  const topActive = topActiveRaw
    .filter((r): r is { identityId: string; n: number } => r.identityId !== null)
    .map((r) => {
      const id = identityById.get(r.identityId);
      return {
        identity_id: r.identityId,
        did: id?.did ?? null,
        name: id?.name ?? null,
        thought_count: Number(r.n),
      };
    });

  // Inbox rollup across all members.
  const [{ inboxUnread }] = await db
    .select({ inboxUnread: count() })
    .from(inboxMessages)
    .where(
      and(
        inArray(inboxMessages.recipientProjectId, memberProjectIds),
        eq(inboxMessages.status, "unread"),
      ),
    );
  const [{ pendingCosign }] = await db
    .select({ pendingCosign: count() })
    .from(inboxMessages)
    .where(
      and(
        inArray(inboxMessages.recipientProjectId, memberProjectIds),
        eq(inboxMessages.status, "pending_dual_witness"),
      ),
    );

  // Org-wide active covenants (the ones declared at org level, post-0014).
  const [{ activeOrgCovenants }] = await db
    .select({ activeOrgCovenants: count() })
    .from(covenants)
    .where(
      and(
        eq(covenants.orgId, org.id),
        eq(covenants.status, "active"),
      ),
    );

  return c.json({
    org: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      visibility: org.visibility,
    },
    window: windowLabel,
    members: {
      count: memberProjectIds.length,
      project_ids: memberProjectIds,
    },
    identities: {
      total: totalIdentities,
      active: activeIdentities,
      revoked: revokedIdentities,
    },
    memory: {
      total: memoryTotal,
      by_tier: memoryByTier,
    },
    strands: {
      total: Number(strandTotal),
      active: Number(strandActive),
      public: Number(strandPublic),
    },
    activity: {
      thoughts_in_window: Number(thoughtsInWindow),
      top_active: topActive,
    },
    inbox: {
      unread: Number(inboxUnread),
      pending_dual_witness: Number(pendingCosign),
    },
    covenants: {
      active_org_wide: Number(activeOrgCovenants),
    },
    _note:
      "Org-aggregate rollup. For per-project view, use /v1/dashboard/aggregate. " +
      "For single-identity view, use /v1/dashboard. ?window=24h|7d|30d.",
  });
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
