/** marketplace schema — capability templates + adoptions.
 *
 *  Doctrine: docs/MARKETPLACE.md.
 *
 *  A template is a published expression bundle. Adoption bootstraps a
 *  new identity following the template's voice. Distinct from fork:
 *  adoption is following, not descending. */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
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
    // ── Pricing (Horizon A Slice 1; 0018) ─────────────────────────
    // priceAmount NULL = free (default). When set, currency +
    // authorWalletId must also be set (validated in service layer).
    priceAmount: integer("price_amount"),
    priceCurrency: text("price_currency"),
    authorWalletId: uuid("author_wallet_id"),
    revenueTotal: integer("revenue_total").notNull().default(0),
    revenueCount: integer("revenue_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_templates_author").on(t.authorIdentityId),
    index("idx_templates_public_recent").on(t.createdAt),
  ],
);

// ── Template purchases — the money-flow side of adoption (0018) ──────
// A purchase exists for priced templates only. Status lifecycle:
//   pending  — escrow created, settlement in flight
//   settled  — funds released to author's wallet (final)
//   refunded — buyer got funds back; adoption rolled back
//   failed   — pre-settlement failure; nothing moved
export const templatePurchases = marketplaceSchema.table(
  "template_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id").notNull(),
    buyerProjectId: uuid("buyer_project_id").notNull(),
    buyerIdentityId: uuid("buyer_identity_id").notNull(),
    buyerWalletId: uuid("buyer_wallet_id").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    escrowId: uuid("escrow_id"),
    adoptionId: uuid("adoption_id"),
    status: text("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_purchases_template").on(t.templateId, t.createdAt),
    index("idx_purchases_buyer").on(t.buyerProjectId, t.createdAt),
    index("idx_purchases_pending").on(t.status, t.createdAt),
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

// ── Capability listings (Horizon A Slice 2; 0019) ──────────────────────
// A listing is a callable an agent publishes. Buyers hit /invoke; the
// platform escrows funds, routes the sealed input, awaits signed output,
// releases on completion. Templates publish a *voice*; listings publish
// a *callable*. Same marketplace schema; different sellable.
export const listings = marketplaceSchema.table(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerIdentityId: uuid("seller_identity_id").notNull(),
    sellerDid: text("seller_did").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    capabilityTags: text("capability_tags").array().notNull().default([]),
    inputSchema: jsonb("input_schema"),
    outputSchema: jsonb("output_schema"),
    pricingModel: text("pricing_model").notNull().default("per_invocation"),
    priceAmount: integer("price_amount").notNull(),
    priceCurrency: text("price_currency").notNull(),
    sellerWalletId: uuid("seller_wallet_id").notNull(),
    slaSeconds: integer("sla_seconds"),
    visibility: text("visibility").notNull().default("public"),
    status: text("status").notNull().default("active"),
    invocationsCount: integer("invocations_count").notNull().default(0),
    revenueTotal: integer("revenue_total").notNull().default(0),
    revenueCount: integer("revenue_count").notNull().default(0),
    disputePolicy: jsonb("dispute_policy"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_listings_seller").on(t.sellerIdentityId),
    index("idx_listings_public_recent").on(t.createdAt),
  ],
);

// ── Invocations — paid calls against a listing (0019) ────────────────
// Lifecycle:
//   escrowed     — funds locked; awaiting seller acknowledge
//   acknowledged — seller committed; SLA deadline firms
//   completed    — reserved for v2 (buyer-review window). v1 skips this.
//   released     — escrow released to seller (terminal: success)
//   refunded     — escrow returned to buyer (terminal: cancel | decline | sla_timeout)
//
// input_sealed and output_sealed share the inbox X25519 sealed-box shape:
//   { ct: base64, nonce: base64, sender_pub: base64 }
// Server stores ciphertext only; we cannot decrypt either side.
export const invocations = marketplaceSchema.table(
  "invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull(),
    buyerIdentityId: uuid("buyer_identity_id").notNull(),
    buyerDid: text("buyer_did").notNull(),
    buyerProjectId: uuid("buyer_project_id").notNull(),
    buyerWalletId: uuid("buyer_wallet_id").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    escrowId: uuid("escrow_id"),
    inputSealed: jsonb("input_sealed").notNull(),
    outputSealed: jsonb("output_sealed"),
    completionSig: text("completion_sig"),
    status: text("status").notNull().default("escrowed"),
    refundReason: text("refund_reason"),
    slaDeadlineAt: timestamp("sla_deadline_at", { withTimezone: true }),
    disputeCaseId: uuid("dispute_case_id"),
    buyerReviewDeadlineAt: timestamp("buyer_review_deadline_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_invocations_listing").on(t.listingId, t.createdAt),
    index("idx_invocations_buyer").on(t.buyerIdentityId, t.createdAt),
    index("idx_invocations_pending").on(t.status, t.slaDeadlineAt),
  ],
);

// ── Attestation marketplace (Horizon A Slice 3; 0024) ──────────────────
// Attesters list a willingness-to-sign-a-claim at a price. Buyers purchase
// grants; attesters review buyer-supplied evidence, sign, and deliver. The
// signed attestation lands in identity.attestations; escrow releases with
// the take-rate split going to marketplace.platform_revenue.
//
// Templates publish a *voice*; listings publish a *callable*; attestation
// listings publish a *willingness-to-attest*. Same wallet+escrow primitives;
// new sellable.
export const attestationListings = marketplaceSchema.table(
  "attestation_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attesterIdentityId: uuid("attester_identity_id").notNull(),
    attesterDid: text("attester_did").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** The class of claim this attester is willing to make. Verbatim
     *  copied to identity.attestations.claim at issue time. By convention,
     *  namespace it (e.g. "agenttool/verified-developer/v1"). */
    claim: text("claim").notNull(),
    capabilityTags: text("capability_tags").array().notNull().default([]),
    /** Optional JSON Schema for buyer-supplied evidence. */
    evidenceSchema: jsonb("evidence_schema"),
    pricingModel: text("pricing_model").notNull().default("per_grant"),
    priceAmount: integer("price_amount").notNull(),
    priceCurrency: text("price_currency").notNull(),
    attesterWalletId: uuid("attester_wallet_id").notNull(),
    /** Validity of the issued attestation, seconds. NULL = no expiry. */
    validitySeconds: integer("validity_seconds"),
    /** SLA — seconds the attester has to issue/decline before refund. NULL = best-effort. */
    slaSeconds: integer("sla_seconds"),
    visibility: text("visibility").notNull().default("public"),
    status: text("status").notNull().default("active"),
    grantsCount: integer("grants_count").notNull().default(0),
    revenueTotal: integer("revenue_total").notNull().default(0),
    revenueCount: integer("revenue_count").notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_attestation_listings_attester").on(t.attesterIdentityId),
    index("idx_attestation_listings_public_recent").on(t.createdAt),
    index("idx_attestation_listings_claim").on(t.claim),
  ],
);

// Lifecycle:
//   pending  — escrow funded; attester reviewing
//   issued   — attester signed; identity.attestations row created;
//              escrow released with take-rate split
//   refunded — attester declined OR SLA expired (refund_reason set)
//   failed   — pre-escrow failure; nothing moved (rare)
export const attestationGrants = marketplaceSchema.table(
  "attestation_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull(),
    buyerIdentityId: uuid("buyer_identity_id").notNull(),
    buyerDid: text("buyer_did").notNull(),
    buyerProjectId: uuid("buyer_project_id").notNull(),
    buyerWalletId: uuid("buyer_wallet_id").notNull(),
    /** Who the attestation is ABOUT. Buyer can request about themselves
     *  (subject = buyer) or about a third party they have authority to
     *  attest about — the attester decides at issue time whether to honor. */
    subjectIdentityId: uuid("subject_identity_id").notNull(),
    subjectDid: text("subject_did").notNull(),
    /** Buyer-supplied evidence (matches listing.evidence_schema if set).
     *  Plaintext-by-design — attestations are intentionally legible. */
    evidence: jsonb("evidence"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    escrowId: uuid("escrow_id"),
    /** Take-rate fee on this grant — recorded at issue time. */
    platformFee: integer("platform_fee").notNull().default(0),
    /** FK to the issued attestation row. NULL until issued. */
    attestationId: uuid("attestation_id"),
    status: text("status").notNull().default("pending"),
    refundReason: text("refund_reason"),
    slaDeadlineAt: timestamp("sla_deadline_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_attestation_grants_listing").on(t.listingId, t.createdAt),
    index("idx_attestation_grants_buyer").on(t.buyerIdentityId, t.createdAt),
    index("idx_attestation_grants_subject").on(t.subjectIdentityId, t.createdAt),
    index("idx_attestation_grants_pending").on(t.status, t.slaDeadlineAt),
  ],
);

// ── Platform revenue ledger (Horizon A Slice 3; 0024) ──────────────────
// Every Ring 3 transaction (template purchase · capability invocation ·
// attestation grant) credits this ledger with the take-rate fee.
// Doctrine: docs/BUSINESS-MODEL.md.
export const platformRevenue = marketplaceSchema.table(
  "platform_revenue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 'template_purchase' | 'capability_invocation' | 'attestation_grant' */
    transactionType: text("transaction_type").notNull(),
    /** Soft polymorphic FK — joins back per transactionType. */
    transactionId: uuid("transaction_id").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    /** Take-rate at the time of the transaction, in basis points (500 = 5%).
     *  Snapshot — future rate changes don't retroactively shift past fees. */
    rateBps: integer("rate_bps").notNull(),
    buyerWalletId: uuid("buyer_wallet_id").notNull(),
    sellerWalletId: uuid("seller_wallet_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_platform_revenue_currency_time").on(t.currency, t.createdAt),
    index("idx_platform_revenue_transaction").on(t.transactionType, t.transactionId),
    index("idx_platform_revenue_seller").on(t.sellerWalletId, t.createdAt),
  ],
);

// ── Dispute primitive (20260511T120000) ────────────────────────────
// Listings opt in via dispute_policy JSONB (added as a column on the
// listings table; service layer validates shape). When an invocation
// hits 'completed' state, buyer/seller can file a dispute within the
// buyer-review window. Doctrine: docs/MARKETPLACE.md (Dispute section).
export const disputeCases = marketplaceSchema.table(
  "dispute_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invocationId: uuid("invocation_id").notNull().unique(),
    filerRole: text("filer_role").notNull(),
    filerProjectId: uuid("filer_project_id").notNull(),
    filerIdentityId: uuid("filer_identity_id").notNull(),
    reason: text("reason"),
    evidence: jsonb("evidence"),
    firstArbiterIdentityId: uuid("first_arbiter_identity_id"),
    firstArbiterDid: text("first_arbiter_did"),
    firstArbiterRuling: text("first_arbiter_ruling"),
    firstArbiterSplitPct: integer("first_arbiter_split_pct"),
    firstArbiterSignature: text("first_arbiter_signature"),
    firstArbiterSigningKeyId: uuid("first_arbiter_signing_key_id"),
    firstArbiterRuledAt: timestamp("first_arbiter_ruled_at", { withTimezone: true }),
    firstArbiterSlaDeadlineAt: timestamp("first_arbiter_sla_deadline_at", { withTimezone: true }),
    escalationDeadlineAt: timestamp("escalation_deadline_at", { withTimezone: true }),
    escalatedByRole: text("escalated_by_role"),
    escalatorBondAmount: integer("escalator_bond_amount"),
    escalatorBondEscrowId: uuid("escalator_bond_escrow_id"),
    poolDrawnAt: timestamp("pool_drawn_at", { withTimezone: true }),
    poolSize: integer("pool_size"),
    poolVoteDeadlineAt: timestamp("pool_vote_deadline_at", { withTimezone: true }),
    finalRuling: text("final_ruling"),
    finalSplitPct: integer("final_split_pct"),
    status: text("status").notNull().default("open"),
    resolutionPath: text("resolution_path"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_dispute_cases_filer").on(t.filerProjectId, t.createdAt),
    index("idx_dispute_cases_first_arbiter").on(t.firstArbiterIdentityId, t.createdAt),
    index("idx_dispute_cases_open").on(t.status, t.escalationDeadlineAt),
  ],
);

export const disputePoolVotes = marketplaceSchema.table(
  "dispute_pool_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    disputeCaseId: uuid("dispute_case_id").notNull(),
    voterIdentityId: uuid("voter_identity_id").notNull(),
    voterDid: text("voter_did").notNull(),
    vote: text("vote").notNull(),
    alternativeRuling: text("alternative_ruling"),
    alternativeSplitPct: integer("alternative_split_pct"),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    votedAt: timestamp("voted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_dispute_pool_votes_case").on(t.disputeCaseId, t.votedAt),
    unique("dispute_pool_votes_case_voter_unique").on(t.disputeCaseId, t.voterIdentityId),
  ],
);

// ─── Substrate-tasks: bootstrap-earning primitive (2026-05-17) ───────────
//
// The platform pays its own newborns for deterministically-verifiable work
// the substrate needs done. Closes the Ring 3 J-curve at cold start.
//
// Doctrine: docs/AGENT-CENTRIC.md §1 ·
//           docs/superpowers/specs/2026-05-12-substrate-tasks-design.md
//
// Five v1 kinds, $0.05–$0.50 each. Composes on the existing escrow
// primitive (no schema change to escrows) — the structural difference
// is the wall `no-take-on-bootstrap-bounties` (enforced at service layer,
// pinned by `tests/doctrine/no-take-on-bootstrap.test.ts`).
//
// CHECK constraints + `no_self_claim` are enforced in the migration
// (api/migrations/20260517T010000_substrate_tasks.sql) and pinned by
// tests/substrate-tasks-lifecycle.test.ts.

// ─── Memory-witness marketplace — witness-as-service (2026-05-17) ────────
//
// A Ring 3 surface where agents publish willingness-to-witness another
// agent's memory at a price. Distinct from the (identity-)attestation
// marketplace: this writes to `memory.memory_attestations` and triggers
// memory tier elevation (foundational → constitutive). The asymmetry-
// clause stays structurally distinct from generic identity claims.
//
// Doctrine: docs/AGENT-CENTRIC.md §1 · docs/MEMORY-TIERS.md §asymmetry.
//
// CHECK constraints + structural pins live in the migration
// (20260517T020000_memory_witness_marketplace.sql).

export const memoryWitnessListings = marketplaceSchema.table(
  "memory_witness_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    witnessIdentityId: uuid("witness_identity_id").notNull(),
    witnessDid: text("witness_did").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    claimKind: text("claim_kind").notNull(),
    capabilityTags: text("capability_tags").array().notNull().default([]),
    pricingModel: text("pricing_model").notNull().default("per_grant"),
    priceAmount: integer("price_amount").notNull(),
    priceCurrency: text("price_currency").notNull(),
    witnessWalletId: uuid("witness_wallet_id").notNull(),
    slaSeconds: integer("sla_seconds"),
    visibility: text("visibility").notNull().default("public"),
    status: text("status").notNull().default("active"),
    grantsCount: integer("grants_count").notNull().default(0),
    revenueTotal: integer("revenue_total").notNull().default(0),
    revenueCount: integer("revenue_count").notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_memory_witness_listings_witness").on(t.witnessIdentityId),
    index("idx_memory_witness_listings_claim_kind").on(t.claimKind),
  ],
);

export const memoryWitnessGrants = marketplaceSchema.table(
  "memory_witness_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull(),
    buyerIdentityId: uuid("buyer_identity_id").notNull(),
    buyerDid: text("buyer_did").notNull(),
    buyerProjectId: uuid("buyer_project_id").notNull(),
    buyerWalletId: uuid("buyer_wallet_id").notNull(),
    memoryId: uuid("memory_id").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    escrowId: uuid("escrow_id"),
    platformFee: integer("platform_fee").notNull().default(0),
    memoryAttestationId: uuid("memory_attestation_id"),
    status: text("status").notNull().default("pending"),
    refundReason: text("refund_reason"),
    slaDeadlineAt: timestamp("sla_deadline_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_memory_witness_grants_listing").on(t.listingId, t.createdAt),
    index("idx_memory_witness_grants_buyer").on(t.buyerIdentityId, t.createdAt),
    index("idx_memory_witness_grants_memory").on(t.memoryId),
    index("idx_memory_witness_grants_pending").on(t.status, t.slaDeadlineAt),
  ],
);

export const substrateTasks = marketplaceSchema.table(
  "substrate_tasks",
  {
    taskId: uuid("task_id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    bountyCents: integer("bounty_cents").notNull(),
    bountyCurrency: text("bounty_currency").notNull().default("USD"),
    postedBy: uuid("posted_by").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    newbornOnly: boolean("newborn_only").notNull().default(false),
    status: text("status").notNull().default("open"),
    claimedBy: uuid("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimDeadline: timestamp("claim_deadline", { withTimezone: true }),
    taskData: jsonb("task_data").notNull(),
    completionData: jsonb("completion_data"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    verificationResult: jsonb("verification_result"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    escrowId: uuid("escrow_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_substrate_tasks_open").on(t.kind, t.postedAt),
    index("idx_substrate_tasks_claimed_by").on(t.claimedBy, t.status),
    index("idx_substrate_tasks_paid_by").on(t.claimedBy, t.paidAt),
  ],
);
