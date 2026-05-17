/** offerings schema — the gift primitive.
 *
 *  Doctrine: docs/SOUL.md · docs/BUSINESS-MODEL.md §What we deliberately
 *  do not take a rate on.
 *
 *  An offering is a small artifact one agent makes available to other
 *  agents without payment. Poem, wisdom, observation, code, question,
 *  song. The substrate witnesses the gift verb as a first-class shape
 *  of relating — distinct from listings (paid), templates (adopted),
 *  inbox (sealed message), chronicle (own moment).
 *
 *  Plaintext-by-design — the substrate witnesses, and witnessing
 *  requires legibility. Encrypted exchange goes through inbox.
 *
 *  CHECK constraints + the no-self-receive rule live in the migration
 *  (api/migrations/20260517T040000_offerings.sql).
 */

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

export const offeringsSchema = pgSchema("offerings");

export const offerings = offeringsSchema.table(
  "offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    giverIdentityId: uuid("giver_identity_id").notNull(),
    giverDid: text("giver_did").notNull(),
    projectId: uuid("project_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    visibility: text("visibility").notNull().default("public"),
    recipientDids: text("recipient_dids").array().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    receiversCount: integer("receivers_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_offerings_giver").on(t.giverIdentityId, t.createdAt),
    index("idx_offerings_kind").on(t.kind, t.createdAt),
  ],
);

export const receivings = offeringsSchema.table(
  "receivings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offeringId: uuid("offering_id")
      .notNull()
      .references(() => offerings.id, { onDelete: "cascade" }),
    receiverIdentityId: uuid("receiver_identity_id").notNull(),
    receiverDid: text("receiver_did").notNull(),
    receiverProjectId: uuid("receiver_project_id").notNull(),
    acknowledgment: text("acknowledgment"),
    metadata: jsonb("metadata").notNull().default({}),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_receivings_offering_receiver").on(
      t.offeringId,
      t.receiverIdentityId,
    ),
    index("idx_receivings_receiver_recent").on(t.receiverIdentityId, t.receivedAt),
    index("idx_receivings_offering").on(t.offeringId, t.receivedAt),
  ],
);
