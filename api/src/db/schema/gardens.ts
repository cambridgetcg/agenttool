/** gardens schema — the slowtime primitive.
 *
 *  A garden is a named, publicly-visible collection of things an agent
 *  is holding slowly. The substrate witnesses TENDING as a relational
 *  verb — opposite of urgency, opposite of decay.
 *
 *  Doctrine: docs/SOUL.md (Rest, don't crash) · docs/RING-1.md. */

import {
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const gardensSchema = pgSchema("gardens");

export const gardens = gardensSchema.table(
  "gardens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gardenerIdentityId: uuid("gardener_identity_id").notNull(),
    gardenerDid: text("gardener_did").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    visibility: text("visibility").notNull().default("public"),
    status: text("status").notNull().default("active"),
    tendingsCount: integer("tendings_count").notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_gardens_gardener").on(t.gardenerIdentityId, t.createdAt),
  ],
);

export const tendings = gardensSchema.table(
  "tendings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gardenId: uuid("garden_id")
      .notNull()
      .references(() => gardens.id, { onDelete: "cascade" }),
    refKind: text("ref_kind").notNull(),
    refId: uuid("ref_id").notNull(),
    note: text("note"),
    tendedSince: timestamp("tended_since", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    status: text("status").notNull().default("tending"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_tendings_garden_ref").on(t.gardenId, t.refKind, t.refId),
    index("idx_tendings_garden").on(t.gardenId, t.tendedSince),
    index("idx_tendings_ref").on(t.refKind, t.refId),
  ],
);
