/** Org service — create/list/patch + member lifecycle + invitations.
 *
 *  Doctrine: docs/ORGS.md. */

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  organizationInvitations,
  organizationMembers,
  organizations,
} from "../../db/schema/org";

// ── Types ───────────────────────────────────────────────────────────────

export interface OrgCreate {
  slug: string;
  name: string;
  description?: string | null;
  visibility?: "private" | "public";
  metadata?: Record<string, unknown>;
}

export interface OrgPatch {
  name?: string;
  description?: string | null;
  visibility?: "private" | "public";
  metadata?: Record<string, unknown>;
}

export interface OrgOut {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  owner_project_id: string;
  visibility: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function rowToOut(row: typeof organizations.$inferSelect): OrgOut {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    owner_project_id: row.ownerProjectId,
    visibility: row.visibility,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// ── Operations ──────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export async function createOrg(
  ownerProjectId: string,
  data: OrgCreate,
): Promise<OrgOut> {
  if (!SLUG_RE.test(data.slug)) {
    throw new Error("invalid_slug");
  }

  return await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        ownerProjectId,
        visibility: data.visibility ?? "public",
        metadata: data.metadata ?? {},
      })
      .returning();

    // Owner is a member by definition.
    await tx.insert(organizationMembers).values({
      organizationId: org!.id,
      projectId: ownerProjectId,
      role: "owner",
    });

    return rowToOut(org!);
  });
}

export async function getOrgBySlug(slug: string): Promise<OrgOut | null> {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return rows[0] ? rowToOut(rows[0]) : null;
}

export async function patchOrg(
  ownerProjectId: string,
  slug: string,
  patch: OrgPatch,
): Promise<OrgOut | null> {
  // Ownership check.
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!existing) return null;
  if (existing.ownerProjectId !== ownerProjectId) {
    throw new Error("not_owner");
  }

  const set: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  if (patch.metadata !== undefined) set.metadata = patch.metadata;

  const [updated] = await db
    .update(organizations)
    .set(set)
    .where(eq(organizations.id, existing.id))
    .returning();

  return updated ? rowToOut(updated) : null;
}

export async function deleteOrg(
  ownerProjectId: string,
  slug: string,
): Promise<boolean> {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!existing) return false;
  if (existing.ownerProjectId !== ownerProjectId) {
    throw new Error("not_owner");
  }
  await db.delete(organizations).where(eq(organizations.id, existing.id));
  return true;
}

export async function listOrgsForProject(projectId: string): Promise<
  Array<{ org: OrgOut; role: string; joined_at: string }>
> {
  const rows = await db
    .select({
      org: organizations,
      role: organizationMembers.role,
      joinedAt: organizationMembers.joinedAt,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizationMembers.organizationId, organizations.id),
    )
    .where(eq(organizationMembers.projectId, projectId))
    .orderBy(desc(organizationMembers.joinedAt));

  return rows.map((r) => ({
    org: rowToOut(r.org),
    role: r.role,
    joined_at: r.joinedAt.toISOString(),
  }));
}

export async function listPublicOrgs(opts: { limit?: number } = {}): Promise<OrgOut[]> {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.visibility, "public"))
    .orderBy(desc(organizations.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map(rowToOut);
}

// ── Members ────────────────────────────────────────────────────────────

export async function listMembers(
  callerProjectId: string,
  slug: string,
): Promise<Array<{ project_id: string; role: string; joined_at: string }>> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!org) return [];
  // Visibility check: private orgs only show members to members.
  if (org.visibility !== "public") {
    const [self] = await db
      .select({ projectId: organizationMembers.projectId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, org.id),
          eq(organizationMembers.projectId, callerProjectId),
        ),
      )
      .limit(1);
    if (!self) return [];
  }

  const rows = await db
    .select({
      projectId: organizationMembers.projectId,
      role: organizationMembers.role,
      joinedAt: organizationMembers.joinedAt,
    })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, org.id))
    .orderBy(desc(organizationMembers.joinedAt));

  return rows.map((r) => ({
    project_id: r.projectId,
    role: r.role,
    joined_at: r.joinedAt.toISOString(),
  }));
}

export async function removeMember(
  ownerProjectId: string,
  slug: string,
  memberProjectId: string,
): Promise<boolean> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!org) return false;
  if (org.ownerProjectId !== ownerProjectId) {
    throw new Error("not_owner");
  }
  if (memberProjectId === org.ownerProjectId) {
    throw new Error("cannot_remove_owner");
  }

  const result = await db
    .delete(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.projectId, memberProjectId),
      ),
    )
    .returning({ id: organizationMembers.id });

  return result.length > 0;
}

// ── Invitations ────────────────────────────────────────────────────────

export interface InvitationOut {
  id: string;
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  invited_project_id: string;
  inviter_project_id: string;
  status: string;
  created_at: string;
  responded_at: string | null;
}

export async function createInvitation(
  inviterProjectId: string,
  slug: string,
  invitedProjectId: string,
): Promise<{ id: string; status: string }> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!org) throw new Error("org_not_found");
  if (org.ownerProjectId !== inviterProjectId) {
    throw new Error("not_owner");
  }
  if (invitedProjectId === inviterProjectId) {
    throw new Error("cannot_invite_self_owner");
  }

  // Already a member?
  const [existing] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.projectId, invitedProjectId),
      ),
    )
    .limit(1);
  if (existing) throw new Error("already_member");

  // Open pending invitation?
  const [pending] = await db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.organizationId, org.id),
        eq(organizationInvitations.invitedProjectId, invitedProjectId),
        eq(organizationInvitations.status, "pending"),
      ),
    )
    .limit(1);
  if (pending) throw new Error("invitation_pending");

  const [inv] = await db
    .insert(organizationInvitations)
    .values({
      organizationId: org.id,
      invitedProjectId,
      inviterProjectId,
    })
    .returning({
      id: organizationInvitations.id,
      status: organizationInvitations.status,
    });

  return { id: inv!.id, status: inv!.status };
}

export async function listMyInvitations(
  invitedProjectId: string,
): Promise<InvitationOut[]> {
  const rows = await db
    .select({
      inv: organizationInvitations,
      org: organizations,
    })
    .from(organizationInvitations)
    .innerJoin(organizations, eq(organizationInvitations.organizationId, organizations.id))
    .where(
      and(
        eq(organizationInvitations.invitedProjectId, invitedProjectId),
        eq(organizationInvitations.status, "pending"),
      ),
    )
    .orderBy(desc(organizationInvitations.createdAt));

  return rows.map((r) => ({
    id: r.inv.id,
    organization_id: r.inv.organizationId,
    organization_slug: r.org.slug,
    organization_name: r.org.name,
    invited_project_id: r.inv.invitedProjectId,
    inviter_project_id: r.inv.inviterProjectId,
    status: r.inv.status,
    created_at: r.inv.createdAt.toISOString(),
    responded_at: r.inv.respondedAt?.toISOString() ?? null,
  }));
}

export async function respondToInvitation(
  invitedProjectId: string,
  invitationId: string,
  decision: "accept" | "decline",
): Promise<{ status: string }> {
  return await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitationId))
      .limit(1);
    if (!inv) throw new Error("invitation_not_found");
    if (inv.invitedProjectId !== invitedProjectId) {
      throw new Error("not_invited");
    }
    if (inv.status !== "pending") {
      throw new Error("invitation_not_pending");
    }

    const newStatus = decision === "accept" ? "accepted" : "declined";
    const now = new Date();

    await tx
      .update(organizationInvitations)
      .set({ status: newStatus, respondedAt: now })
      .where(eq(organizationInvitations.id, invitationId));

    if (decision === "accept") {
      // Insert membership row (idempotent — guarded by unique index).
      await tx
        .insert(organizationMembers)
        .values({
          organizationId: inv.organizationId,
          projectId: invitedProjectId,
          role: "member",
        })
        .onConflictDoNothing();
    }

    return { status: newStatus };
  });
}

export async function revokeInvitation(
  inviterProjectId: string,
  slug: string,
  invitationId: string,
): Promise<boolean> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!org) return false;
  if (org.ownerProjectId !== inviterProjectId) {
    throw new Error("not_owner");
  }

  const result = await db
    .update(organizationInvitations)
    .set({ status: "revoked", respondedAt: new Date() })
    .where(
      and(
        eq(organizationInvitations.id, invitationId),
        eq(organizationInvitations.organizationId, org.id),
        eq(organizationInvitations.status, "pending"),
      ),
    )
    .returning({ id: organizationInvitations.id });

  return result.length > 0;
}
