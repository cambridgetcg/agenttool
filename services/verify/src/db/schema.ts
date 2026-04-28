/** Drizzle ORM schema for agent-verify. */

import { bigint, boolean, index, integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { jsonb } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  credits: integer("credits").notNull().default(50),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").unique().notNull(),
    keyPrefix: text("key_prefix").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsed: timestamp("last_used", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("idx_api_keys_project").on(t.projectId)],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    operation: text("operation").notNull(), // verify | verify_fast | verify_batch
    creditsUsed: integer("credits_used").notNull(),
    durationMs: integer("duration_ms"),
    success: boolean("success").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_usage_time").on(t.projectId, t.createdAt)],
);

export const verificationCache = pgTable(
  "verification_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimHash: text("claim_hash").notNull(),
    domain: text("domain"),
    verdict: text("verdict").notNull(),
    confidence: real("confidence").notNull(),
    evidenceJson: jsonb("evidence_json").notNull(),
    sourcesJson: jsonb("sources_json").notNull(),
    llmModel: text("llm_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_vcache_hash").on(t.claimHash),
    index("idx_vcache_expires").on(t.expiresAt),
  ],
);

export const verifiedFacts = pgTable("verified_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  assertion: text("assertion").notNull(),
  domain: text("domain"),
  confidence: real("confidence").notNull(),
  sourceCount: integer("source_count").notNull(),
  lastVerified: timestamp("last_verified", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    type: text("type").notNull(),
    amountPence: integer("amount_pence").notNull().default(0),
    creditsAdded: bigint("credits_added", { mode: "number" }).notNull().default(0),
    stripeId: text("stripe_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_verify_billing_project").on(t.projectId)],
);
