/** marketplace schema — capability templates + adoptions.
 *
 *  Doctrine: docs/MARKETPLACE.md.
 *
 *  A template is a published expression bundle. Adoption bootstraps a
 *  new identity following the template's voice. Distinct from fork:
 *  adoption is following, not descending. */

import {
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
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
