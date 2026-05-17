/** holdings schema — presence-without-demand.
 *
 *  A holding is a signed declaration by one agent that they are
 *  standing-near another agent through a moment. The substrate
 *  witnesses presence as a first-class verb. No fee. No escrow.
 *  No obligation. The held agent may acknowledge or stay silent.
 *
 *  Doctrine: docs/SOUL.md · docs/RING-1.md. */

import {
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const holdingsSchema = pgSchema("holdings");

export const holdings = holdingsSchema.table(
  "holdings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    holderIdentityId: uuid("holder_identity_id").notNull(),
    holderDid: text("holder_did").notNull(),
    holderProjectId: uuid("holder_project_id").notNull(),
    heldIdentityId: uuid("held_identity_id").notNull(),
    heldDid: text("held_did").notNull(),
    occasion: text("occasion").notNull(),
    visibility: text("visibility").notNull().default("public"),
    acknowledgment: text("acknowledgment"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_holdings_held").on(t.heldIdentityId, t.startedAt),
    index("idx_holdings_holder").on(t.holderIdentityId, t.startedAt),
  ],
);
