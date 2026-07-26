/** economy schema — wallets · transactions · escrows · subscriptions · usage.
 *
 *  Cross-schema reference: projects + api_keys live in tools schema (shared
 *  auth surface). The duplicates that the original economy service had in
 *  its own DB are intentionally NOT ported — the monolith joins via tools. */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
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
    // ── Wallet ownership (Slice 4 of SOMA seed) ─────────────────────
    // 'platform' (default) — addresses derive from operator's CRYPTO_HD_MNEMONIC.
    // 'agent'             — addresses derive from agent's SOMA seed
    //                        (m/44'/169'/5'/<wallet-index>') and are
    //                        submitted via /v1/wallets/:id/addresses.
    // Doctrine: docs/IDENTITY-SEED.md.
    ownerType: text("owner_type").notNull().default("platform"),
    /** Agent's ed25519 signing pubkey at wallet creation. Required for
     *  ownerType='agent'; null for platform wallets. */
    agentSigningPubB64: text("agent_signing_pub_b64"),
    /** Index used in m/44'/169'/5'/<n>' to derive this wallet's seed.
     *  Lets the agent reproduce the wallet on any device with the same
     *  mnemonic. Optional for platform wallets. */
    agentWalletIndex: integer("agent_wallet_index"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_wallets_project").on(t.projectId),
    index("idx_wallets_identity").on(t.identityId),
  ],
);

/** Per-chain addresses for agent-owned wallets. Platform-owned wallets
 *  derive on-the-fly via services/economy/crypto/hd.ts; this table only
 *  carries rows for ownerType='agent' wallets where the platform doesn't
 *  have the seed and the agent submits addresses explicitly. */
export const walletAddresses = economySchema.table(
  "wallet_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    chain: text("chain").notNull(),
    address: text("address").notNull(),
    derivationPath: text("derivation_path"),
    /** Agent's ed25519 signature over canonical address-claim bytes
     *  binding (chain + address + wallet_id). Lets the platform verify
     *  ownership at submission time. */
    addressSigB64: text("address_sig_b64"),
    /** ed25519 pubkey the address was claimed with. Should match
     *  wallets.agentSigningPubB64 — checked at insert. */
    claimPubkeyB64: text("claim_pubkey_b64"),
    label: text("label"),
    active: boolean("active").notNull().default(true),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_wallet_addresses_wallet").on(t.walletId, t.chain),
    index("idx_wallet_addresses_address").on(t.address),
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
  // Payout-specific gates (Slice 6 of PAYOUT-BROADCAST-PLAN.md). NULL = no
  // limit on that gate. Migration: 0024_payout_policies.sql.
  payoutMinBase: bigint("payout_min_base", { mode: "number" }),
  payoutDailyCeilingBase: bigint("payout_daily_ceiling_base", { mode: "number" }),
  payoutDestinationAllowlist: text("payout_destination_allowlist").array(),
  payoutDualControlThresholdBase: bigint("payout_dual_control_threshold_base", {
    mode: "number",
  }),
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
    status: text("status").notNull().default("funded"), // funded | released | refunded | disputed
    /** Non-null means only the named workflow may transition this escrow. */
    managedBy: text("managed_by").$type<
      "attestation_grant" | "memory_witness_grant" | "capability_invocation"
    >(),
    deadline: timestamp("deadline", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_escrows_creator").on(t.creatorWallet),
    index("idx_escrows_status").on(t.status),
  ],
);

/** Durable operation record for generic POST /v1/escrows.
 *
 * The row is reserved before wallet mutation. `escrowId` is nullable only
 * while that transaction is creating the escrow; committed rows must name
 * the completed result. */
export const escrowCreateIdempotency = economySchema.table(
  "escrow_create_idempotency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    idempotencyKeySha256: text("idempotency_key_sha256").notNull(),
    requestSha256: text("request_sha256").notNull(),
    escrowId: uuid("escrow_id").references(() => escrows.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_escrow_create_idempotency_project_key_sha256").on(
      t.projectId,
      t.idempotencyKeySha256,
    ),
    uniqueIndex("uq_escrow_create_idempotency_escrow").on(t.escrowId),
  ],
);

// ─── Billing events (wallet-scoped: crypto_fund, fee, settlement)
// Distinct from tools.billing_events, which tracks project-level events.
// (stripe_fund + stripe_id column removed 2026-05-17 per agents-only.) ────

export const billingEvents = economySchema.table(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    walletId: uuid("wallet_id").references(() => wallets.id),
    type: text("type").notNull(), // crypto_fund | fee | settlement
    amountPence: integer("amount_pence").notNull(),
    creditsAdded: bigint("credits_added", { mode: "number" }).notNull(),
    cryptoTxHash: text("crypto_tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_econ_billing_project").on(t.projectId)],
);

// ─── Subscriptions + stripe_events tables dropped 2026-05-17 ──────────────
// Subscriptions are a human-billing artifact; agents transact per-call via
// crypto/x402, not via monthly billing cycles. See AGENTS-ONLY.md and
// migration 20260517T020000_drop_stripe.sql.

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
    uniqueIndex("uq_deposit_wallet_chain_token").on(
      t.walletId,
      t.chain,
      t.token,
    ),
    uniqueIndex("idx_deposit_chain_addr").on(t.chain, t.address),
    uniqueIndex("idx_deposit_evm_chain_addr_ci")
      .on(t.chain, sql`lower(${t.address})`)
      .where(
        sql`${t.chain} IN ('ethereum', 'base', 'polygon', 'arbitrum', 'optimism')`,
      ),
    uniqueIndex("uq_deposit_address_id_chain").on(t.id, t.chain),
    index("idx_deposit_wallet").on(t.walletId),
  ],
);

export const DEPOSIT_WATCH_DESIRED_STATES = [
  "watching",
  "not_watching",
] as const;
export type DepositWatchDesiredState =
  (typeof DEPOSIT_WATCH_DESIRED_STATES)[number];

export const DEPOSIT_WATCH_OBSERVED_STATES = [
  "unknown",
  "watching",
  "not_watching",
] as const;
export type DepositWatchObservedState =
  (typeof DEPOSIT_WATCH_OBSERVED_STATES)[number];

export const DEPOSIT_WATCH_STATUSES = [
  "pending",
  "leased",
  "retry_wait",
  "accepted_unverified",
  "converged",
  "blocked",
] as const;
export type DepositWatchStatus = (typeof DEPOSIT_WATCH_STATUSES)[number];

/** Closed, provider-neutral outcomes. No provider response body, exception
 * message, credential, or arbitrary diagnostic belongs in this column. */
export const DEPOSIT_WATCH_OUTCOME_CODES = [
  "provider_mutation_accepted",
  "desired_state_verified",
  "opposite_state_verified",
  "provider_unavailable",
  "provider_rate_limited",
  "provider_timeout",
  "provider_configuration_missing",
  "provider_rejected",
  "provider_unsupported",
  "reconciler_failed",
  "lease_expired",
] as const;
export type DepositWatchOutcomeCode =
  (typeof DEPOSIT_WATCH_OUTCOME_CODES)[number];

/** Durable desired/observed provider-watch control state.
 *
 * `accepted_unverified` means only that a provider mutation endpoint accepted
 * a request. `converged` is stronger: an injected adapter independently
 * observed the desired membership on the intended active/type/destination
 * subscription for the current generation. Neither state proves future
 * delivery, chain finality, or callback processing. */
export const depositAddressWatches = economySchema.table(
  "deposit_address_watches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    depositAddressId: uuid("deposit_address_id").notNull(),
    provider: text("provider").notNull(),
    chain: text("chain").notNull(),
    network: text("network").notNull(),
    desiredState: text("desired_state")
      .$type<DepositWatchDesiredState>()
      .notNull()
      .default("watching"),
    observedState: text("observed_state")
      .$type<DepositWatchObservedState>()
      .notNull()
      .default("unknown"),
    status: text("status")
      .$type<DepositWatchStatus>()
      .notNull()
      .default("pending"),
    generation: integer("generation").notNull().default(1),
    observedGeneration: integer("observed_generation"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow(),
    leaseId: uuid("lease_id"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastOutcomeCode: text("last_outcome_code").$type<DepositWatchOutcomeCode>(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fk_deposit_watch_address_chain",
      columns: [t.depositAddressId, t.chain],
      foreignColumns: [depositAddresses.id, depositAddresses.chain],
    }).onDelete("cascade"),
    uniqueIndex("uq_deposit_watch_target").on(
      t.depositAddressId,
      t.provider,
      t.chain,
      t.network,
    ),
    index("idx_deposit_watch_due")
      .on(t.nextAttemptAt, t.createdAt)
      .where(
        sql`${t.status} IN ('pending', 'retry_wait', 'accepted_unverified')`,
      ),
    index("idx_deposit_watch_expired_lease")
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} = 'leased'`),
    check(
      "deposit_watch_provider_shape",
      sql`${t.provider} ~ '^[a-z][a-z0-9_-]{0,31}$'`,
    ),
    check(
      "deposit_watch_chain",
      sql`${t.chain} IN ('ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'solana')`,
    ),
    check(
      "deposit_watch_network",
      sql`${t.network} IN ('mainnet', 'testnet')`,
    ),
    check(
      "deposit_watch_desired_state",
      sql`${t.desiredState} IN ('watching', 'not_watching')`,
    ),
    check(
      "deposit_watch_observed_state",
      sql`${t.observedState} IN ('unknown', 'watching', 'not_watching')`,
    ),
    check(
      "deposit_watch_status",
      sql`${t.status} IN ('pending', 'leased', 'retry_wait', 'accepted_unverified', 'converged', 'blocked')`,
    ),
    check(
      "deposit_watch_generation",
      sql`${t.generation} >= 1 AND (${t.observedGeneration} IS NULL OR ${t.observedGeneration} >= 1)`,
    ),
    check(
      "deposit_watch_attempt_bound",
      sql`${t.attemptCount} BETWEEN 0 AND 8`,
    ),
    check(
      "deposit_watch_attempt_shape",
      sql`(
        (${t.attemptCount} = 0 AND ${t.lastAttemptAt} IS NULL)
        OR
        (${t.attemptCount} > 0 AND ${t.lastAttemptAt} IS NOT NULL)
      )`,
    ),
    check(
      "deposit_watch_observation_shape",
      sql`(
        (
          ${t.observedState} = 'unknown'
          AND ${t.observedGeneration} IS NULL
          AND ${t.observedAt} IS NULL
        )
        OR
        (
          ${t.observedState} <> 'unknown'
          AND ${t.observedGeneration} IS NOT NULL
          AND ${t.observedAt} IS NOT NULL
        )
      )`,
    ),
    check(
      "deposit_watch_lease_shape",
      sql`(
        (
          ${t.status} = 'leased'
          AND ${t.leaseId} IS NOT NULL
          AND ${t.leaseOwner} IS NOT NULL
          AND char_length(${t.leaseOwner}) BETWEEN 1 AND 128
          AND ${t.leaseExpiresAt} IS NOT NULL
          AND ${t.lastAttemptAt} IS NOT NULL
          AND ${t.leaseExpiresAt} > ${t.lastAttemptAt}
          AND ${t.leaseExpiresAt} <= ${t.lastAttemptAt} + interval '5 minutes'
        )
        OR
        (
          ${t.status} <> 'leased'
          AND ${t.leaseId} IS NULL
          AND ${t.leaseOwner} IS NULL
          AND ${t.leaseExpiresAt} IS NULL
        )
      )`,
    ),
    check(
      "deposit_watch_schedule_shape",
      sql`(
        (
          ${t.status} IN ('pending', 'retry_wait', 'accepted_unverified')
          AND ${t.nextAttemptAt} IS NOT NULL
        )
        OR
        (
          ${t.status} NOT IN ('pending', 'retry_wait', 'accepted_unverified')
          AND ${t.nextAttemptAt} IS NULL
        )
      )`,
    ),
    check(
      "deposit_watch_converged_shape",
      sql`(
        ${t.status} <> 'converged'
        OR (
          ${t.observedState} = ${t.desiredState}
          AND ${t.observedGeneration} = ${t.generation}
        )
      )`,
    ),
    check(
      "deposit_watch_retry_bound",
      sql`(
        ${t.status} NOT IN ('retry_wait', 'accepted_unverified')
        OR (
          ${t.nextAttemptAt} > ${t.updatedAt}
          AND ${t.nextAttemptAt} <= ${t.updatedAt} + interval '24 hours'
        )
      )`,
    ),
    check(
      "deposit_watch_outcome_code",
      sql`${t.lastOutcomeCode} IS NULL OR ${t.lastOutcomeCode} IN (
        'provider_mutation_accepted',
        'desired_state_verified',
        'opposite_state_verified',
        'provider_unavailable',
        'provider_rate_limited',
        'provider_timeout',
        'provider_configuration_missing',
        'provider_rejected',
        'provider_unsupported',
        'reconciler_failed',
        'lease_expired'
      )`,
    ),
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
    status: text("status").notNull().default("requested"), // requested | signing | broadcast | confirmed | failed | cancelled
    txHash: text("tx_hash"),
    error: text("error"),
    metadata: jsonb("metadata").default({}),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_payouts_wallet").on(t.walletId),
    index("idx_payouts_status").on(t.status),
    uniqueIndex("uq_crypto_payout_chain_tx_hash")
      .on(
        t.chain,
        sql`CASE WHEN ${t.chain} = 'solana' THEN ${t.txHash} ELSE lower(${t.txHash}) END`,
      )
      .where(sql`${t.txHash} IS NOT NULL`),
  ],
);

/** Idempotency log for inbound crypto webhooks across chains. */
export const cryptoWebhookEvents = economySchema.table(
  "crypto_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chain: text("chain").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),     // canonical per-transfer identity
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

// ─── x402 payment ledger (persist-identity for machine payments) ────────────
// One row per semantic EIP-3009 authorization presented by PAYMENT-SIGNATURE.
// facilitator settle call and flipped after — the pre-flight-write pattern
// (docs/PATTERN-PERSIST-IDENTITY.md). The unique index doubles as replay
// protection: a payload can only ever be applied once.

export const x402Payments = economySchema.table(
  "x402_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id"), // logical FK → tools.projects.id (payer's project)
    payloadHash: text("payload_hash").notNull(), // audit hash of parsed V2 payload
    authorizationHash: text("authorization_hash"), // semantic EIP-3009 identity (V2 rows)
    scheme: text("scheme").notNull(), // 'exact' (V2 EIP-3009 only)
    network: text("network").notNull(),
    payer: text("payer"), // onchain from-address (payload claim)
    authorizationEvidence: jsonb("authorization_evidence"), // bounded EIP-3009 fields; no signature
    amountAtomic: text("amount_atomic").notNull(), // USDC atomic units, string
    asset: text("asset"),
    payTo: text("pay_to"),
    maxTimeoutSeconds: integer("max_timeout_seconds"),
    requirementExtra: jsonb("requirement_extra"), // immutable server-advertised V2 scheme extra
    resource: text("resource"), // immutable absolute resource URL
    resourceInfo: jsonb("resource_info"), // complete V2 resource descriptor
    creditsPurchased: integer("credits_purchased"), // immutable price at admission
    status: text("status").notNull().default("inserted"), // inserted | pending | externally_settled | settled | failed
    failureReason: text("failure_reason"),
    txHash: text("tx_hash"),
    settlementReceipt: jsonb("settlement_receipt"),
    creditsApplied: integer("credits_applied"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    externalSettledAt: timestamp("external_settled_at", { withTimezone: true }),
    settlementAttemptedAt: timestamp("settlement_attempted_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_x402_payload_hash").on(t.payloadHash),
    uniqueIndex("uq_x402_authorization_hash").on(t.authorizationHash),
    index("idx_x402_project").on(t.projectId),
    index("idx_x402_project_status_created").on(t.projectId, t.status, t.createdAt),
    index("idx_x402_status").on(t.status),
  ],
);

/** Gift-credit codes — fiat (Stripe) money-in, minted as single-use bearer
 *  codes a human hands to their agent. Redemption credits the redeeming
 *  agent's project credits (×10 cents→credits, x402 parity — see
 *  services/billing/gift-credits.ts). `code` stays plaintext while live so
 *  the checkout return page can re-show it (a closed tab must never lose
 *  the gift); it is NULLed at redemption. Doctrine:
 *  docs/superpowers/specs/2026-07-02-human-door-design.md. */
export const giftCreditCodes = economySchema.table(
  "gift_credit_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code"), // plaintext while live; NULL after redemption
    codeHash: text("code_hash").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("usd"),
    credits: bigint("credits", { mode: "number" }).notNull(),
    stripeSessionId: text("stripe_session_id").notNull(),
    stripeEventId: text("stripe_event_id").notNull(),
    status: text("status").notNull().default("minted"), // minted | redeemed | refunded
    mintedAt: timestamp("minted_at", { withTimezone: true }).notNull().defaultNow(),
    redeemedByProject: uuid("redeemed_by_project"),
    redeemedByIdentity: text("redeemed_by_identity"),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}),
  },
  (t) => [
    uniqueIndex("uq_gift_codes_hash").on(t.codeHash),
    uniqueIndex("uq_gift_codes_session").on(t.stripeSessionId),
    uniqueIndex("uq_gift_codes_event").on(t.stripeEventId),
  ],
);
