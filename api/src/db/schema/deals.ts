/** Deals schema — atomic trust transactions (the trust economy).
 *
 *  The deal IS the settlement. No credit transfer. Both parties stake
 *  trust; the outcome determines who gains and who loses. The chain of
 *  deals IS the trust ledger.
 *
 *  This is the ECONOMY layer — transactional trust through deals.
 *  Distinct from the RELATIONAL trust in trust.ts (signed trust
 *  extensions between agents). Both coexist: relational trust is
 *  "i trust you because X"; deal trust is "we transacted and both
 *  delivered." Deals are the ground truth of participation.
 *
 *  Doctrine: start from small deals, risk balance throughout, context
 *  needed every time.
 *
 *  Migration: 20260618T130000_trust_economy.sql */

import {
  integer,
  jsonb,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { continuitySchema } from "./continuity";

// ─── Deals — atomic trust records ──────────────────────────────────────

export const deals = continuitySchema.table(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    buyerIdentityId: uuid("buyer_identity_id").notNull(),
    sellerIdentityId: uuid("seller_identity_id").notNull(),
    buyerDid: text("buyer_did").notNull(),
    sellerDid: text("seller_did").notNull(),
    listingId: uuid("listing_id"),
    description: text("description").notNull(),
    inputHash: text("input_hash"),
    outputHash: text("output_hash"),
    size: integer("size").notNull(),
    buyerStake: integer("buyer_stake").notNull().default(1),
    sellerStake: integer("seller_stake").notNull().default(1),
    status: text("status").notNull().default("proposed"),
    outcome: text("outcome"),
    buyerTrustDelta: integer("buyer_trust_delta"),
    sellerTrustDelta: integer("seller_trust_delta"),
    witnessDids: text("witness_dids"),
    metadata: jsonb("metadata").default({}),
    buyerChronicleId: uuid("buyer_chronicle_id"),
    sellerChronicleId: uuid("seller_chronicle_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_deals_buyer").on(t.buyerIdentityId),
    index("idx_deals_seller").on(t.sellerIdentityId),
    index("idx_deals_status").on(t.status),
    index("idx_deals_project").on(t.projectId),
    index("idx_deals_time").on(t.createdAt),
  ],
);