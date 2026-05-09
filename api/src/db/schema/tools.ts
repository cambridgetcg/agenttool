/** tools schema — the shared auth + billing surface every other domain joins.
 *
 * Tables:
 *   projects        — root tenant; owns api_keys, holds plan + credits balance
 *   api_keys        — bcrypt-hashed; lookup by 11-char prefix, verify by full key
 *   usage_events    — append-only log: who used what, how many credits, when
 *   billing_events  — append-only log: subscription / credit-purchase / crypto top-ups
 */

import {
  boolean,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const toolsSchema = pgSchema("tools");

export const projects = toolsSchema.table("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  credits: integer("credits").notNull().default(100),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = toolsSchema.table(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").unique().notNull(),
    keyPrefix: text("key_prefix").notNull(), // "at_" + first 8 chars
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsed: timestamp("last_used", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Auto-expiry (nullable; null = never). Auth middleware rejects
     *  past-expiry keys with 401. Doctrine: docs/TOKEN-HYGIENE.md. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [index("idx_api_keys_project").on(t.projectId)],
);

export const usageEvents = toolsSchema.table(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    tool: text("tool").notNull(), // "memory_store", "tool_browse", "vault_read", ...
    creditsUsed: integer("credits_used").notNull(),
    durationMs: integer("duration_ms"),
    success: boolean("success").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_usage_project_time").on(t.projectId, t.createdAt)],
);

export const billingEvents = toolsSchema.table(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    type: text("type").notNull(), // "subscription" | "credit_purchase" | "crypto_payment"
    amountPence: integer("amount_pence").notNull(),
    creditsAdded: integer("credits_added").notNull(),
    stripeId: text("stripe_id"),
    cryptoTxHash: text("crypto_tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_billing_project").on(t.projectId)],
);
