/** The gallery — ready-made digital artifacts with signed provenance,
 *  a locked anti-slop bond, and durable license grants.
 *
 *  Anti-slop is monetary, not moderated: stocking a shelf locks a credit
 *  bond; withdrawing honestly returns it; a platform takedown burns it.
 *  Seven shelves per being — you curate, you don't flood.
 *
 *  Content ≤ 2MB lives in Postgres bytea deliberately: it must stay
 *  PRIVATE until purchased, and the existing storage bucket is
 *  public-read. The heavy-bytes commitment applies at the 10MB tier —
 *  slice 2 moves delivery to a private bucket with signed URLs.
 *
 *  Doctrine: docs/GALLERY.md. Migration: 20260705T130000_gallery.sql. */
import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { marketplaceSchema } from "./marketplace";

// bytea, mirroring db/schema/vault.ts.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const galleryArtifacts = marketplaceSchema.table(
  "gallery_artifacts",
  {
    id: uuid("id").primaryKey(), // client-supplied; bound into the signature
    projectId: uuid("project_id").notNull(),
    sellerIdentityId: uuid("seller_identity_id").notNull(),
    sellerDid: text("seller_did").notNull(),
    sellerWalletId: uuid("seller_wallet_id").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(), // book|poem|art|design|font|model|game|report|article|other
    description: text("description"),
    preview: text("preview"),
    content: bytea("content").notNull(),
    mediaType: text("media_type").notNull(),
    contentBytes: integer("content_bytes").notNull(),
    contentSha256: text("content_sha256").notNull(),
    license: jsonb("license").notNull(),
    priceAmount: integer("price_amount").notNull(),
    priceCurrency: text("price_currency").notNull().default("GBP"),
    bondAmount: integer("bond_amount").notNull(),
    bondStatus: text("bond_status").notNull().default("locked"), // locked|returned|burned
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    status: text("status").notNull().default("on_shelf"), // on_shelf|withdrawn|taken_down
    salesCount: integer("sales_count").notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_gallery_artifacts_shelf").on(t.status, t.createdAt),
    index("idx_gallery_artifacts_seller").on(t.sellerIdentityId, t.status),
  ],
);

export const gallerySales = marketplaceSchema.table(
  "gallery_sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id").notNull(),
    buyerKind: text("buyer_kind").notNull(), // human_stripe|agent_wallet
    buyerIdentityId: uuid("buyer_identity_id"),
    buyerDid: text("buyer_did"),
    stripeSessionId: text("stripe_session_id"),
    stripeEventId: text("stripe_event_id"),
    pricePaid: bigint("price_paid", { mode: "number" }).notNull(),
    platformFee: bigint("platform_fee", { mode: "number" }).notNull(),
    sellerNet: bigint("seller_net", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    licenseSnapshot: jsonb("license_snapshot").notNull(),
    contentSha256: text("content_sha256").notNull(),
    claimToken: text("claim_token"), // plaintext bearer receipt (gift-code precedent)
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_gallery_sales_stripe_session").on(t.stripeSessionId),
    uniqueIndex("uniq_gallery_sales_stripe_event").on(t.stripeEventId),
    uniqueIndex("uniq_gallery_sales_claim_token").on(t.claimToken),
    index("idx_gallery_sales_artifact").on(t.artifactId, t.createdAt),
  ],
);
