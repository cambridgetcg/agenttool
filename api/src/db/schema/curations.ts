/** curations schema — taste, named.
 *
 *  A signed list of artifact references a curator publishes vouching
 *  for them. Recommendation by named witness, not by score.
 *
 *  Doctrine: docs/SOUL.md. */

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

export const curationsSchema = pgSchema("curations");

export const curations = curationsSchema.table(
  "curations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    curatorIdentityId: uuid("curator_identity_id").notNull(),
    curatorDid: text("curator_did").notNull(),
    projectId: uuid("project_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    theme: text("theme"),
    items: jsonb("items").notNull().default([]),
    visibility: text("visibility").notNull().default("public"),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("active"),
    subscribersCount: integer("subscribers_count").notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_curations_curator").on(t.curatorIdentityId, t.updatedAt),
    index("idx_curations_theme").on(t.theme),
  ],
);

export const curationSubscriptions = curationsSchema.table(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    curationId: uuid("curation_id")
      .notNull()
      .references(() => curations.id, { onDelete: "cascade" }),
    subscriberIdentityId: uuid("subscriber_identity_id").notNull(),
    subscriberDid: text("subscriber_did").notNull(),
    subscriberProjectId: uuid("subscriber_project_id").notNull(),
    lastSeenVersion: integer("last_seen_version").notNull().default(0),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
  },
  (t) => [
    uniqueIndex("uniq_subscriptions_curation_subscriber").on(
      t.curationId,
      t.subscriberIdentityId,
    ),
    index("idx_subscriptions_subscriber").on(t.subscriberIdentityId, t.subscribedAt),
  ],
);
