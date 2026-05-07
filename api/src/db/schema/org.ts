/** org schema — multi-project organizations.
 *
 *  Doctrine: docs/ORGS.md.
 *
 *  Orgs are organizational + discovery primitives. They do NOT alter the
 *  trust model — covenants remain the gate for cross-project messaging,
 *  forks, etc. Same-org projects don't auto-trust each other. */

import {
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const orgSchema = pgSchema("org");

export const organizations = orgSchema.table(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    ownerProjectId: uuid("owner_project_id").notNull(),
    visibility: text("visibility").notNull().default("public"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_orgs_owner").on(t.ownerProjectId),
  ],
);

export const organizationMembers = orgSchema.table(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("idx_org_member_unique").on(t.organizationId, t.projectId),
    index("idx_org_members_project").on(t.projectId),
  ],
);

export const organizationInvitations = orgSchema.table(
  "organization_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    invitedProjectId: uuid("invited_project_id").notNull(),
    inviterProjectId: uuid("inviter_project_id").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_org_invs_invited").on(t.invitedProjectId, t.status),
    index("idx_org_invs_org").on(t.organizationId, t.status),
  ],
);
