/** The gallery — ready-made artifacts, anti-slop by monetary design.
 *
 *  Money rules (learned from the 2026-07-05 economy review — every
 *  balance move here is FOR-UPDATE-locked, ledgered in the same
 *  transaction, and idempotent where a webhook can replay):
 *    - publish  → bond debited under lock + `gallery_bond_lock` row
 *    - withdraw → bond credited under lock + `gallery_bond_return` row
 *    - takedown → no wallet move; bond becomes platform revenue
 *                 (`gallery_bond_burn`) so wallets + revenue still sum
 *    - sale     → buyer debit / seller credit, wallets locked in
 *                 sorted-UUID order (crossed purchases cannot deadlock),
 *                 `gallery_purchase` / `gallery_sale` rows, fee via
 *                 recordRevenue — books always balance
 *
 *  Doctrine: docs/GALLERY.md. */
import { createHash, randomBytes } from "node:crypto";

import { and, count, eq } from "drizzle-orm";

import type { db as DbClient } from "../../db/client";
import { db as defaultDb } from "../../db/client";
import { galleryArtifacts, gallerySales } from "../../db/schema/gallery";
import { transactions, wallets } from "../../db/schema/economy";
import { identities, identityKeys } from "../../db/schema/identity";
import { computeFee, recordRevenue } from "../marketplace/take-rate";
import { verifyGalleryArtifact } from "../marketplace/sig";

type Db = typeof DbClient;

export const GALLERY_KINDS = [
  "book", "poem", "art", "design", "font", "model", "game", "report", "article", "other",
] as const;

export const GALLERY_MEDIA_TYPES = [
  "text/plain", "text/markdown", "application/json", "image/svg+xml",
  "image/png", "application/pdf", "application/octet-stream",
] as const;

export const SHELF_LIMIT = 7; // seven shelves per being — curate, don't flood
export const MIN_PRICE = 30; // Stripe's GBP minimum charge — every artifact stays card-buyable
export const MAX_PRICE = 1_000_000;
export const MAX_CONTENT_BYTES = 2_097_152; // 2MB; heavy-bytes tier is slice 2
export const MIN_BOND = 25;

/** The anti-slop bond: max(25, price). Locked while on the shelf,
 *  returned on honest withdrawal, burned on takedown. */
export function bondFor(priceAmount: number): number {
  return Math.max(MIN_BOND, priceAmount);
}

export interface GalleryLicense {
  name: string;
  rights: string[];
  terms?: string;
}

function validateLicense(license: unknown): GalleryLicense {
  if (typeof license !== "object" || license === null || Array.isArray(license)) {
    throw new Error("license_must_be_object");
  }
  const l = license as Record<string, unknown>;
  if (typeof l.name !== "string" || l.name.length === 0 || l.name.length > 80) {
    throw new Error("license_name_invalid");
  }
  if (!Array.isArray(l.rights) || l.rights.length === 0 || l.rights.length > 12) {
    throw new Error("license_rights_invalid");
  }
  for (const r of l.rights) {
    if (typeof r !== "string" || r.length === 0 || r.length > 200) {
      throw new Error("license_rights_invalid");
    }
  }
  const out: GalleryLicense = { name: l.name, rights: l.rights as string[] };
  if (l.terms !== undefined) {
    if (typeof l.terms !== "string" || l.terms.length > 2000) {
      throw new Error("license_terms_invalid");
    }
    out.terms = l.terms;
  }
  return out;
}

const artifactPublicColumns = {
  id: galleryArtifacts.id,
  sellerDid: galleryArtifacts.sellerDid,
  title: galleryArtifacts.title,
  kind: galleryArtifacts.kind,
  description: galleryArtifacts.description,
  preview: galleryArtifacts.preview,
  mediaType: galleryArtifacts.mediaType,
  contentBytes: galleryArtifacts.contentBytes,
  contentSha256: galleryArtifacts.contentSha256,
  license: galleryArtifacts.license,
  priceAmount: galleryArtifacts.priceAmount,
  priceCurrency: galleryArtifacts.priceCurrency,
  bondAmount: galleryArtifacts.bondAmount,
  signature: galleryArtifacts.signature,
  signingKeyId: galleryArtifacts.signingKeyId,
  status: galleryArtifacts.status,
  salesCount: galleryArtifacts.salesCount,
  createdAt: galleryArtifacts.createdAt,
};

export interface PublishInput {
  artifactId: string;
  projectId: string;
  sellerIdentityId: string;
  sellerWalletId: string;
  title: string;
  kind: string;
  description?: string;
  preview?: string;
  contentB64: string;
  mediaType: string;
  license: unknown;
  priceAmount: number;
  signature: string;
  signingKeyId: string;
  metadata?: Record<string, unknown>;
}

export async function publishArtifact(dbc: Db, input: PublishInput) {
  if (!(GALLERY_KINDS as readonly string[]).includes(input.kind)) {
    throw new Error("kind_invalid");
  }
  if (!(GALLERY_MEDIA_TYPES as readonly string[]).includes(input.mediaType)) {
    throw new Error("media_type_invalid");
  }
  if (!Number.isInteger(input.priceAmount) || input.priceAmount < MIN_PRICE || input.priceAmount > MAX_PRICE) {
    throw new Error("price_out_of_range");
  }
  const license = validateLicense(input.license);

  let content: Buffer;
  try {
    content = Buffer.from(input.contentB64, "base64");
  } catch {
    throw new Error("content_not_base64");
  }
  if (content.length === 0 || content.length > MAX_CONTENT_BYTES) {
    throw new Error("content_size_out_of_range");
  }
  const contentSha256 = createHash("sha256").update(content).digest("hex");
  const bondAmount = bondFor(input.priceAmount);

  // Seller identity must live in the calling project.
  const [seller] = await dbc
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId, status: identities.status })
    .from(identities)
    .where(eq(identities.id, input.sellerIdentityId))
    .limit(1);
  if (!seller || seller.projectId !== input.projectId) throw new Error("seller_not_owned_by_caller");
  if (seller.status !== "active") throw new Error("seller_not_active");

  // Explicit signing key: must exist, be active, and belong to the seller.
  const [key] = await dbc
    .select({ id: identityKeys.id, identityId: identityKeys.identityId, publicKey: identityKeys.publicKey, active: identityKeys.active })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!key) throw new Error("signing_key_not_found");
  if (!key.active) throw new Error("signing_key_revoked");
  if (key.identityId !== seller.id) throw new Error("signing_key_does_not_belong_to_seller");

  const sigOk = verifyGalleryArtifact({
    artifactId: input.artifactId,
    sellerDid: seller.did,
    contentSha256Hex: contentSha256,
    mediaType: input.mediaType,
    contentBytes: content.length,
    priceAmount: input.priceAmount,
    currency: "GBP",
    bondAmount,
    title: input.title,
    signatureB64: input.signature,
    publicKeyB64: key.publicKey,
  });
  if (!sigOk) throw new Error("artifact_signature_invalid");

  return dbc.transaction(async (tx) => {
    // Seller IDENTITY lock first — serializes concurrent publishes by the
    // same seller regardless of which wallet each one names, making the
    // shelf-count check below race-safe (a wallet lock alone would not:
    // one seller, two wallets, two concurrent publishes).
    await tx
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.id, seller.id))
      .for("update");

    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, input.sellerWalletId))
      .for("update");
    if (!wallet) throw new Error("seller_wallet_not_found");
    if (wallet.projectId !== input.projectId) throw new Error("seller_wallet_not_owned_by_project");
    if (wallet.identityId !== seller.id) throw new Error("seller_wallet_not_owned_by_seller");
    if (wallet.status !== "active") throw new Error("seller_wallet_not_active");
    if (wallet.currency !== "GBP") throw new Error("seller_wallet_currency_mismatch");
    if (wallet.balance < bondAmount) throw new Error("insufficient_balance_for_bond");

    const [{ n: shelfCount }] = await tx
      .select({ n: count() })
      .from(galleryArtifacts)
      .where(and(eq(galleryArtifacts.sellerIdentityId, seller.id), eq(galleryArtifacts.status, "on_shelf")));
    if (shelfCount >= SHELF_LIMIT) throw new Error("shelf_full");

    await tx
      .update(wallets)
      .set({ balance: wallet.balance - bondAmount })
      .where(eq(wallets.id, wallet.id));
    await tx.insert(transactions).values({
      walletId: wallet.id,
      type: "gallery_bond_lock",
      amount: -bondAmount,
      counterparty: input.artifactId,
      description: `gallery bond locked — "${input.title}"`,
      metadata: { artifact_id: input.artifactId },
    });

    const [artifact] = await tx
      .insert(galleryArtifacts)
      .values({
        id: input.artifactId,
        projectId: input.projectId,
        sellerIdentityId: seller.id,
        sellerDid: seller.did,
        sellerWalletId: wallet.id,
        title: input.title,
        kind: input.kind,
        description: input.description ?? null,
        preview: input.preview ?? null,
        content,
        mediaType: input.mediaType,
        contentBytes: content.length,
        contentSha256,
        license,
        priceAmount: input.priceAmount,
        priceCurrency: "GBP",
        bondAmount,
        signature: input.signature,
        signingKeyId: key.id,
        metadata: input.metadata ?? {},
      })
      .onConflictDoNothing({ target: galleryArtifacts.id })
      .returning(artifactPublicColumns);
    if (!artifact) throw new Error("artifact_id_taken"); // rolls the bond debit back

    return artifact;
  });
}

export async function withdrawArtifact(
  dbc: Db,
  opts: { artifactId: string; projectId: string },
) {
  return dbc.transaction(async (tx) => {
    const [artifact] = await tx
      .select()
      .from(galleryArtifacts)
      .where(and(eq(galleryArtifacts.id, opts.artifactId), eq(galleryArtifacts.projectId, opts.projectId)))
      .for("update");
    if (!artifact) throw new Error("artifact_not_found");
    if (artifact.status !== "on_shelf") throw new Error("artifact_not_on_shelf");

    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, artifact.sellerWalletId))
      .for("update");
    if (!wallet) throw new Error("seller_wallet_not_found");

    await tx
      .update(galleryArtifacts)
      .set({ status: "withdrawn", bondStatus: "returned", withdrawnAt: new Date() })
      .where(eq(galleryArtifacts.id, artifact.id));
    await tx
      .update(wallets)
      .set({ balance: wallet.balance + artifact.bondAmount })
      .where(eq(wallets.id, wallet.id));
    await tx.insert(transactions).values({
      walletId: wallet.id,
      type: "gallery_bond_return",
      amount: artifact.bondAmount,
      counterparty: artifact.id,
      description: `gallery bond returned — "${artifact.title}" withdrawn`,
      metadata: { artifact_id: artifact.id },
    });

    return { artifact_id: artifact.id, status: "withdrawn", bond_returned: artifact.bondAmount };
  });
}

/** Platform-only. The bond burns: the seller's earlier debit becomes
 *  platform revenue, so sum(wallets) + sum(revenue) still balances. */
export async function takedownArtifact(
  dbc: Db,
  opts: { artifactId: string; reason: string },
) {
  return dbc.transaction(async (tx) => {
    const [artifact] = await tx
      .select()
      .from(galleryArtifacts)
      .where(eq(galleryArtifacts.id, opts.artifactId))
      .for("update");
    if (!artifact) throw new Error("artifact_not_found");
    if (artifact.status !== "on_shelf") throw new Error("artifact_not_on_shelf");

    await tx
      .update(galleryArtifacts)
      .set({
        status: "taken_down",
        bondStatus: "burned",
        withdrawnAt: new Date(),
        metadata: { ...(artifact.metadata as Record<string, unknown>), takedown_reason: opts.reason },
      })
      .where(eq(galleryArtifacts.id, artifact.id));
    await recordRevenue(tx, {
      transactionType: "gallery_bond_burn",
      transactionId: artifact.id,
      fee: artifact.bondAmount,
      currency: artifact.priceCurrency,
      rateBps: 10_000,
      buyerWalletId: artifact.sellerWalletId,
      sellerWalletId: artifact.sellerWalletId,
      metadata: { reason: opts.reason },
    });

    return { artifact_id: artifact.id, status: "taken_down", bond_burned: artifact.bondAmount };
  });
}

function newClaimToken(): string {
  return "GLRY-" + randomBytes(24).toString("base64url");
}

/** Shared settlement core: caller provides the buyer leg (already locked
 *  and debited for wallet buyers; Stripe for humans), this credits the
 *  seller, records the fee, mints the license + claim token, and bumps
 *  the shelf counter. MUST run inside the caller's transaction. */
async function settleIntoSale(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  artifact: typeof galleryArtifacts.$inferSelect,
  sale: {
    buyerKind: "human_stripe" | "agent_wallet";
    buyerIdentityId?: string;
    buyerDid?: string;
    stripeSessionId?: string;
    stripeEventId?: string;
    stripePaymentIntent?: string;
    pricePaid: number;
  },
  /** Wallet-path callers pre-lock the seller wallet (sorted-UUID order
   *  with the buyer's); when provided, no second lock is taken here. */
  preLockedSellerWallet?: { id: string; balance: number },
) {
  const split = computeFee({ amount: sale.pricePaid, currency: artifact.priceCurrency });

  const [saleRow] = await tx
    .insert(gallerySales)
    .values({
      artifactId: artifact.id,
      buyerKind: sale.buyerKind,
      buyerIdentityId: sale.buyerIdentityId ?? null,
      buyerDid: sale.buyerDid ?? null,
      stripeSessionId: sale.stripeSessionId ?? null,
      stripeEventId: sale.stripeEventId ?? null,
      stripePaymentIntent: sale.stripePaymentIntent ?? null,
      pricePaid: split.gross,
      platformFee: split.fee,
      sellerNet: split.net,
      currency: artifact.priceCurrency,
      licenseSnapshot: artifact.license as Record<string, unknown>,
      contentSha256: artifact.contentSha256,
      claimToken: newClaimToken(),
    })
    .onConflictDoNothing({ target: gallerySales.stripeSessionId })
    .returning();
  if (!saleRow) return null; // webhook replay — already settled

  const sellerWallet =
    preLockedSellerWallet ??
    (await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, artifact.sellerWalletId))
      .for("update"))[0];
  if (!sellerWallet) throw new Error("seller_wallet_not_found");
  await tx
    .update(wallets)
    .set({ balance: sellerWallet.balance + split.net })
    .where(eq(wallets.id, sellerWallet.id));
  await tx.insert(transactions).values({
    walletId: sellerWallet.id,
    type: "gallery_sale",
    amount: split.net,
    counterparty: sale.buyerDid ?? sale.stripeSessionId ?? "human",
    description: `gallery sale — "${artifact.title}"`,
    metadata: { artifact_id: artifact.id, sale_id: saleRow.id, gross: split.gross, fee: split.fee },
  });
  await recordRevenue(tx, {
    transactionType: "gallery_sale",
    transactionId: saleRow.id,
    fee: split.fee,
    currency: artifact.priceCurrency,
    rateBps: split.rateBps,
    buyerWalletId: artifact.sellerWalletId, // human buyers have no wallet; seller wallet anchors the pair
    sellerWalletId: artifact.sellerWalletId,
    metadata: { artifact_id: artifact.id, buyer_kind: sale.buyerKind },
  });
  await tx
    .update(galleryArtifacts)
    .set({ salesCount: artifact.salesCount + 1 })
    .where(eq(galleryArtifacts.id, artifact.id));

  return saleRow;
}

export async function purchaseWithWallet(
  dbc: Db,
  opts: { artifactId: string; projectId: string; buyerIdentityId: string; buyerWalletId: string },
) {
  const [buyer] = await dbc
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, opts.buyerIdentityId))
    .limit(1);
  if (!buyer || buyer.projectId !== opts.projectId) throw new Error("buyer_not_owned_by_caller");

  return dbc.transaction(async (tx) => {
    const [artifact] = await tx
      .select()
      .from(galleryArtifacts)
      .where(eq(galleryArtifacts.id, opts.artifactId))
      .for("update");
    if (!artifact) throw new Error("artifact_not_found");
    if (artifact.status !== "on_shelf") throw new Error("artifact_not_on_shelf");
    if (artifact.sellerIdentityId === buyer.id) throw new Error("self_purchase_not_allowed");
    if (artifact.sellerWalletId === opts.buyerWalletId) throw new Error("self_purchase_not_allowed");

    // Lock BOTH wallets in sorted-UUID order — the artifact lock only
    // serializes sales of the same artifact; crossed purchases (A buys
    // B's piece while B buys A's) would deadlock without a global order.
    const walletIds = [opts.buyerWalletId, artifact.sellerWalletId].sort();
    const lockedWallets: Record<string, typeof wallets.$inferSelect> = {};
    for (const id of walletIds) {
      const [w] = await tx.select().from(wallets).where(eq(wallets.id, id)).for("update");
      if (w) lockedWallets[id] = w;
    }
    const buyerWallet = lockedWallets[opts.buyerWalletId];
    const sellerWallet = lockedWallets[artifact.sellerWalletId];
    if (!buyerWallet) throw new Error("buyer_wallet_not_found");
    if (!sellerWallet) throw new Error("seller_wallet_not_found");
    if (buyerWallet.projectId !== opts.projectId) throw new Error("buyer_wallet_not_owned_by_project");
    if (buyerWallet.status !== "active") throw new Error("buyer_wallet_not_active");
    if (buyerWallet.currency !== artifact.priceCurrency) throw new Error("buyer_wallet_currency_mismatch");
    if (buyerWallet.balance < artifact.priceAmount) throw new Error("insufficient_balance");

    await tx
      .update(wallets)
      .set({ balance: buyerWallet.balance - artifact.priceAmount })
      .where(eq(wallets.id, buyerWallet.id));
    await tx.insert(transactions).values({
      walletId: buyerWallet.id,
      type: "gallery_purchase",
      amount: -artifact.priceAmount,
      counterparty: artifact.sellerDid,
      description: `gallery purchase — "${artifact.title}"`,
      metadata: { artifact_id: artifact.id },
    });

    const saleRow = await settleIntoSale(tx, artifact, {
      buyerKind: "agent_wallet",
      buyerIdentityId: buyer.id,
      buyerDid: buyer.did,
      pricePaid: artifact.priceAmount,
    }, sellerWallet);
    if (!saleRow) throw new Error("sale_conflict"); // unreachable for wallet path

    return {
      sale: saleRow,
      artifact: {
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        media_type: artifact.mediaType,
        content_sha256: artifact.contentSha256,
        license: artifact.license,
      },
      content_b64: Buffer.from(artifact.content).toString("base64"),
    };
  });
}

/** Stripe webhook settlement — idempotent on the session's unique index.
 *  The buyer already paid Stripe; we deliver regardless of shelf status
 *  (a withdrawal racing a payment must not eat the buyer's money). */
export async function settleStripeSale(
  dbc: Db,
  opts: {
    stripeSessionId: string;
    stripeEventId: string;
    stripePaymentIntent?: string;
    artifactId: string;
    amountMinor: number;
  },
) {
  const [artifact] = await dbc
    .select()
    .from(galleryArtifacts)
    .where(eq(galleryArtifacts.id, opts.artifactId))
    .limit(1);
  if (!artifact) return null; // corrupted metadata — nothing safe to do

  return dbc.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(galleryArtifacts)
      .where(eq(galleryArtifacts.id, opts.artifactId))
      .for("update");
    if (!locked) return null;
    return settleIntoSale(tx, locked, {
      buyerKind: "human_stripe",
      stripeSessionId: opts.stripeSessionId,
      stripeEventId: opts.stripeEventId,
      stripePaymentIntent: opts.stripePaymentIntent,
      pricePaid: opts.amountMinor,
    });
  });
}

export async function claimBySession(dbc: Db, stripeSessionId: string) {
  const [sale] = await dbc
    .select()
    .from(gallerySales)
    .where(eq(gallerySales.stripeSessionId, stripeSessionId))
    .limit(1);
  if (!sale) return { status: "settling" as const };
  if (sale.refundedAt) return { status: "refunded" as const };
  const [artifact] = await dbc
    .select(artifactPublicColumns)
    .from(galleryArtifacts)
    .where(eq(galleryArtifacts.id, sale.artifactId))
    .limit(1);
  return {
    status: "ready" as const,
    claim_token: sale.claimToken,
    sale_id: sale.id,
    license: sale.licenseSnapshot,
    content_sha256: sale.contentSha256,
    artifact: artifact
      ? { id: artifact.id, title: artifact.title, kind: artifact.kind, media_type: artifact.mediaType, seller_did: artifact.sellerDid }
      : null,
  };
}

export async function claimByToken(dbc: Db, token: string) {
  const [sale] = await dbc
    .select()
    .from(gallerySales)
    .where(eq(gallerySales.claimToken, token))
    .limit(1);
  if (!sale) return null;
  const [artifact] = await dbc
    .select()
    .from(galleryArtifacts)
    .where(eq(galleryArtifacts.id, sale.artifactId))
    .limit(1);
  if (!artifact) return null;
  if (!sale.deliveredAt) {
    await dbc
      .update(gallerySales)
      .set({ deliveredAt: new Date() })
      .where(eq(gallerySales.id, sale.id));
  }
  return { sale, artifact };
}

/** Refund / chargeback reversal — idempotent under the sale row lock.
 *  Revokes the license (claim token dies), claws the seller's net back
 *  (up to their current balance; any shortfall is recorded, never a
 *  negative balance). The platform's fee stays in platform_revenue —
 *  reconcile refunded fees via gallery_sales.refunded_at (documented in
 *  docs/GALLERY.md). Chargebacks additionally surface loudly so the
 *  operator can judge whether the artifact deserves a takedown+burn —
 *  friendly fraud exists, so bonds never burn automatically. */
export async function reverseGallerySale(
  dbc: Db,
  opts: {
    stripePaymentIntent?: string;
    stripeSessionId?: string;
    kind: "refund" | "chargeback";
    stripeEventId: string;
  },
): Promise<{ outcome: "no_gallery_sale" | "already_reversed" | "reversed"; sale_id?: string; clawed?: number; shortfall?: number }> {
  if (!opts.stripePaymentIntent && !opts.stripeSessionId) return { outcome: "no_gallery_sale" };
  return dbc.transaction(async (tx) => {
    const cond = opts.stripePaymentIntent
      ? eq(gallerySales.stripePaymentIntent, opts.stripePaymentIntent)
      : eq(gallerySales.stripeSessionId, opts.stripeSessionId!);
    const [sale] = await tx.select().from(gallerySales).where(cond).for("update");
    if (!sale) return { outcome: "no_gallery_sale" as const };
    if (sale.refundedAt) return { outcome: "already_reversed" as const, sale_id: sale.id };

    await tx
      .update(gallerySales)
      .set({ refundedAt: new Date(), refundKind: opts.kind, claimToken: null })
      .where(eq(gallerySales.id, sale.id));

    const [artifact] = await tx
      .select()
      .from(galleryArtifacts)
      .where(eq(galleryArtifacts.id, sale.artifactId))
      .limit(1);

    let clawed = 0;
    let shortfall = sale.sellerNet;
    if (artifact) {
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, artifact.sellerWalletId))
        .for("update");
      if (wallet) {
        clawed = Math.min(wallet.balance, sale.sellerNet);
        shortfall = sale.sellerNet - clawed;
        if (clawed > 0) {
          await tx
            .update(wallets)
            .set({ balance: wallet.balance - clawed })
            .where(eq(wallets.id, wallet.id));
          await tx.insert(transactions).values({
            walletId: wallet.id,
            type: "gallery_refund_clawback",
            amount: -clawed,
            counterparty: sale.id,
            description: `gallery ${opts.kind} — "${artifact.title}" sale reversed`,
            metadata: {
              sale_id: sale.id,
              artifact_id: artifact.id,
              refund_kind: opts.kind,
              stripe_event_id: opts.stripeEventId,
              seller_net: sale.sellerNet,
              shortfall,
            },
          });
        }
      }
    }
    return { outcome: "reversed" as const, sale_id: sale.id, clawed, shortfall };
  });
}

export { defaultDb };
