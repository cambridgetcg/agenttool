/** economy schema — wallets · transactions · escrows · subscriptions · usage.
 *
 *  Cross-schema reference: projects + api_keys live in tools schema (shared
 *  auth surface). The duplicates that the original economy service had in
 *  its own DB are intentionally NOT ported — the monolith joins via tools. */

import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const economySchema = pgSchema("economy");

// ─── Wallets + spending policies + transactions ─────────────────────────────

export const wallets = economySchema.table(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    name: text("name").notNull(),
    agentId: text("agent_id"),
    identityId: text("identity_id"), // optional link to identity.identities (DID/UUID)
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    status: text("status").notNull().default("active"), // active | frozen | closed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_wallets_project").on(t.projectId),
    index("idx_wallets_identity").on(t.identityId),
  ],
);

export const policies = economySchema.table("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletId: uuid("wallet_id")
    .notNull()
    .references(() => wallets.id, { onDelete: "cascade" }),
  maxPerTransaction: bigint("max_per_transaction", { mode: "number" }),
  maxPerHour: bigint("max_per_hour", { mode: "number" }),
  maxPerDay: bigint("max_per_day", { mode: "number" }),
  allowedRecipients: text("allowed_recipients").array(),
  requiresApprovalAbove: bigint("requires_approval_above", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = economySchema.table(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    type: text("type").notNull(), // fund | spend | escrow_lock | escrow_release | escrow_refund | settle
    amount: bigint("amount", { mode: "number" }).notNull(), // positive = in, negative = out
    counterparty: text("counterparty"),
    description: text("description"),
    escrowId: uuid("escrow_id"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_tx_wallet_time").on(t.walletId, t.createdAt)],
);

// ─── Escrow ─────────────────────────────────────────────────────────────────

export const escrows = economySchema.table(
  "escrows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorWallet: uuid("creator_wallet")
      .notNull()
      .references(() => wallets.id),
    workerWallet: uuid("worker_wallet").references(() => wallets.id),
    amount: bigint("amount", { mode: "number" }).notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("funded"), // funded | released | refunded | disputed | expired
    deadline: timestamp("deadline", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_escrows_creator").on(t.creatorWallet),
    index("idx_escrows_status").on(t.status),
  ],
);

// ─── Billing events (wallet-scoped: stripe_fund, crypto_fund, fee, settlement)
// Distinct from tools.billing_events, which tracks project-level events. ────

export const billingEvents = economySchema.table(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    walletId: uuid("wallet_id").references(() => wallets.id),
    type: text("type").notNull(), // stripe_fund | crypto_fund | fee | settlement
    amountPence: integer("amount_pence").notNull(),
    creditsAdded: bigint("credits_added", { mode: "number" }).notNull(),
    stripeId: text("stripe_id"),
    cryptoTxHash: text("crypto_tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_econ_billing_project").on(t.projectId)],
);

// ─── Subscriptions (monthly Stripe plans) ───────────────────────────────────

export const subscriptions = economySchema.table(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    tier: text("tier").notNull().default("free"), // free | seed | grow | scale
    status: text("status").notNull().default("free"), // free | active | past_due | canceled
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

export const stripeEvents = economySchema.table("stripe_events", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Crypto: deposit addresses · onchain identities · payouts · webhooks ────
//
//   deposit_addresses     — derived BIP44 addresses per (wallet, chain)
//   onchain_identities    — verified bindings (wallet ↔ on-chain address)
//   crypto_payouts        — outgoing transfers (request → broadcast → confirm)
//   crypto_webhook_events — receipts; idempotency for inbound transfer events
//
// Doctrine: docs/CRYPTO-PAYMENT.md

export const depositAddresses = economySchema.table(
  "deposit_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    chain: text("chain").notNull(),         // ethereum | base | polygon | arbitrum | optimism | solana
    token: text("token").notNull(),         // USDC (foundation: USDC everywhere)
    address: text("address").notNull(),
    derivationPath: text("derivation_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_deposit_chain_addr").on(t.chain, t.address),
    index("idx_deposit_wallet").on(t.walletId),
  ],
);

export const onchainIdentities = economySchema.table(
  "onchain_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    chain: text("chain").notNull(),
    address: text("address").notNull(),
    challenge: text("challenge").notNull(),     // the signed message
    signature: text("signature").notNull(),     // hex
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_onchain_chain_addr").on(t.chain, t.address),
    index("idx_onchain_wallet").on(t.walletId),
  ],
);

export const cryptoPayouts = economySchema.table(
  "crypto_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    projectId: uuid("project_id").notNull(),    // logical FK → tools.projects.id
    chain: text("chain").notNull(),
    token: text("token").notNull(),
    // amount in token base-units (USDC has 6 decimals → 1.5 USDC = 1500000)
    amountBase: numeric("amount_base", { precision: 78, scale: 0 }).notNull(),
    destinationAddress: text("destination_address").notNull(),
    status: text("status").notNull().default("requested"), // requested | signing | broadcast | confirmed | failed
    txHash: text("tx_hash"),
    error: text("error"),
    metadata: jsonb("metadata").default({}),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_payouts_wallet").on(t.walletId),
    index("idx_payouts_status").on(t.status),
  ],
);

/** Idempotency log for inbound crypto webhooks across chains. */
export const cryptoWebhookEvents = economySchema.table(
  "crypto_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chain: text("chain").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index"),               // for multi-transfer txs
    walletId: uuid("wallet_id").references(() => wallets.id),
    creditsAdded: bigint("credits_added", { mode: "number" }),
    rawPayload: jsonb("raw_payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_crypto_event_dedupe").on(t.chain, t.txHash, t.logIndex),
    index("idx_crypto_event_wallet").on(t.walletId),
  ],
);

// ─── Daily usage counters (aggregated to monthly for plan limit enforcement)

export const usageCounters = economySchema.table(
  "usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
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
