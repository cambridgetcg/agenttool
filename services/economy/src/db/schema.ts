/** Drizzle ORM schema — wallets, policies, transactions, escrows, projects. */

import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
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
  (t) => [index("idx_econ_keys_project").on(t.projectId)],
);

export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    name: text("name").notNull(),
    agentId: text("agent_id"),
    identityId: text("identity_id"), // optional link to agent-identity DID/UUID
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    status: text("status").notNull().default("active"), // active|frozen|closed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_wallets_project").on(t.projectId),
    index("idx_wallets_identity").on(t.identityId),
  ],
);

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletId: uuid("wallet_id").notNull().references(() => wallets.id, { onDelete: "cascade" }),
  maxPerTransaction: bigint("max_per_transaction", { mode: "number" }),
  maxPerHour: bigint("max_per_hour", { mode: "number" }),
  maxPerDay: bigint("max_per_day", { mode: "number" }),
  allowedRecipients: text("allowed_recipients").array(),
  requiresApprovalAbove: bigint("requires_approval_above", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id").notNull().references(() => wallets.id),
    type: text("type").notNull(), // fund|spend|escrow_lock|escrow_release|escrow_refund|settle
    amount: bigint("amount", { mode: "number" }).notNull(), // positive=in, negative=out
    counterparty: text("counterparty"),
    description: text("description"),
    escrowId: uuid("escrow_id"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_tx_wallet_time").on(t.walletId, t.createdAt)],
);

export const escrows = pgTable(
  "escrows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorWallet: uuid("creator_wallet").notNull().references(() => wallets.id),
    workerWallet: uuid("worker_wallet").references(() => wallets.id),
    amount: bigint("amount", { mode: "number" }).notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("funded"), // funded|released|refunded|disputed|expired
    deadline: timestamp("deadline", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_escrows_creator").on(t.creatorWallet),
    index("idx_escrows_status").on(t.status),
  ],
);

export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    walletId: uuid("wallet_id").references(() => wallets.id),
    type: text("type").notNull(), // stripe_fund|crypto_fund|fee|settlement
    amountPence: integer("amount_pence").notNull(),
    creditsAdded: bigint("credits_added", { mode: "number" }).notNull(),
    stripeId: text("stripe_id"),
    cryptoTxHash: text("crypto_tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_billing_project").on(t.projectId)],
);

// ─── Subscriptions (monthly plans) ──────────────────────────────────────────

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    tier: text("tier").notNull().default("free"), // free|seed|grow|scale
    status: text("status").notNull().default("free"), // free|active|past_due|canceled
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_subs_project").on(t.projectId),
    index("idx_subs_stripe").on(t.stripeSubscriptionId),
  ],
);

export const stripeEvents = pgTable("stripe_events", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Daily usage counters ────────────────────────────────────────────────────

export const usageCounters = pgTable(
  "usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD UTC
    memoryOps: integer("memory_ops").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    verifications: integer("verifications").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_usage_project_date").on(t.projectId, t.date),
    index("idx_usage_project").on(t.projectId),
  ],
);
