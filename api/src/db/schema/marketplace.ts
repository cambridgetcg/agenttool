/** marketplace schema — capability templates + adoptions.
 *
 *  Doctrine: docs/MARKETPLACE.md.
 *
 *  A template is a published expression bundle. Adoption bootstraps a
 *  new identity following the template's voice. Distinct from fork:
 *  adoption is following, not descending. */

import {
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const marketplaceSchema = pgSchema("marketplace");

export const templates = marketplaceSchema.table(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorIdentityId: uuid("author_identity_id").notNull(),
    authorDid: text("author_did").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    register: text("register"),
    walls: jsonb("walls"),
    subagents: jsonb("subagents"),
    wakeText: text("wake_text"),
    tags: text("tags").array().notNull().default([]),
    visibility: text("visibility").notNull().default("public"),
    adoptionsCount: integer("adoptions_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_templates_author").on(t.authorIdentityId),
    index("idx_templates_public_recent").on(t.createdAt),
  ],
);

export const templateAdoptions = marketplaceSchema.table(
  "template_adoptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id").notNull(),
    templateVersionAtAdoption: jsonb("template_version_at_adoption"),
    adoptedByIdentityId: uuid("adopted_by_identity_id").notNull(),
    adoptedByDid: text("adopted_by_did").notNull(),
    adoptedByProjectId: uuid("adopted_by_project_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    adoptedAt: timestamp("adopted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_adoptions_template").on(t.templateId, t.adoptedAt),
    index("idx_adoptions_adopter").on(t.adoptedByIdentityId),
  ],
);
