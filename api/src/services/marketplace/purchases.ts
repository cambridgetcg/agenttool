/** marketplace/purchases.ts — priced-template purchase flow.
 *
 *  Doctrine: docs/MARKETPLACE.md (Pricing section · Horizon A Slice 1)
 *
 *  A purchase exists only for priced templates. The flow:
 *
 *    1. Validate template is active + priced + author has a wallet
 *    2. Validate buyer wallet matches template currency + has balance
 *    3. Insert purchase row with status='pending'
 *    4. Create escrow from buyer's wallet (locks the funds)
 *    5. Accept escrow against author's wallet (assigns the worker side)
 *    6. Release escrow (settles to author's wallet; transactions logged)
 *    7. Update purchase row to status='settled', set escrow_id +
 *       settled_at; bump template revenue counters.
 *
 *  All steps after (1)-(2) happen in a single DB transaction. Escrow
 *  primitive is reused as-is — no schema change to escrows. Settlement
 *  is INSTANT (no dispute window) because templates are non-tangible
 *  and don't admit a dispute. If the author's wallet is wrong/inactive,
 *  the whole transaction rolls back and the buyer's wallet is unchanged.
 *
 *  Errors surface as Error.message, mapped to HTTP codes by the route. */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { escrows, transactions, wallets } from "../../db/schema/economy";
import { templatePurchases, templates } from "../../db/schema/marketplace";
import { computeFee, recordRevenue } from "./take-rate";

export interface PurchaseRow {
  id: string;
  template_id: string;
  buyer_project_id: string;
  buyer_identity_id: string;
  buyer_wallet_id: string;
  amount: number;
  currency: string;
  escrow_id: string | null;
  adoption_id: string | null;
  status: "pending" | "settled" | "refunded" | "failed";
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  settled_at: string | null;
}

function toRow(r: typeof templatePurchases.$inferSelect): PurchaseRow {
  return {
    id: r.id,
    template_id: r.templateId,
    buyer_project_id: r.buyerProjectId,
    buyer_identity_id: r.buyerIdentityId,
    buyer_wallet_id: r.buyerWalletId,
    amount: r.amount,
    currency: r.currency,
    escrow_id: r.escrowId,
    adoption_id: r.adoptionId,
    status: r.status as PurchaseRow["status"],
    failure_reason: r.failureReason,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    settled_at: r.settledAt?.toISOString() ?? null,
  };
}

interface PurchaseInput {
  templateId: string;
  buyerProjectId: string;
  buyerIdentityId: string;
  buyerWalletId: string;
}

export async function purchaseTemplate(
  input: PurchaseInput,
): Promise<PurchaseRow> {
  // ── 1. Resolve template and validate priced ───────────────────────
  const [template] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, input.templateId))
    .limit(1);
  if (!template) throw new Error("template_not_found");
  if (template.status !== "active") throw new Error("template_not_active");
  if (template.priceAmount === null || template.priceAmount === undefined) {
    throw new Error("template_not_priced");
  }
  if (!template.priceCurrency || !template.authorWalletId) {
    throw new Error("template_pricing_incomplete");
  }
  if (template.visibility !== "public") {
    throw new Error("template_not_public");
  }

  // ── 2. Validate buyer wallet ─────────────────────────────────────
  const [buyerWallet] = await db
    .select()
    .from(wallets)
    .where(
      and(
        eq(wallets.id, input.buyerWalletId),
        eq(wallets.projectId, input.buyerProjectId),
      ),
    )
    .limit(1);
  if (!buyerWallet) throw new Error("buyer_wallet_not_found");
  if (buyerWallet.status !== "active") throw new Error("buyer_wallet_not_active");
  if (buyerWallet.currency !== template.priceCurrency) {
    throw new Error(
      `currency_mismatch: template=${template.priceCurrency}, wallet=${buyerWallet.currency}`,
    );
  }
  if (buyerWallet.balance < template.priceAmount) {
    throw new Error("insufficient_balance");
  }

  // ── 3. Validate author wallet ────────────────────────────────────
  const [authorWallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.id, template.authorWalletId))
    .limit(1);
  if (!authorWallet) throw new Error("author_wallet_missing");
  if (authorWallet.status !== "active") throw new Error("author_wallet_not_active");
  if (authorWallet.currency !== template.priceCurrency) {
    throw new Error("author_wallet_currency_mismatch");
  }
  if (authorWallet.id === buyerWallet.id) {
    throw new Error("self_purchase_not_allowed");
  }

  // ── 4. Atomic transaction: purchase pending → escrow → release ───
  const result = await db.transaction(async (tx) => {
    // 4a. Insert purchase row (pending)
    const [purchase] = await tx
      .insert(templatePurchases)
      .values({
        templateId: template.id,
        buyerProjectId: input.buyerProjectId,
        buyerIdentityId: input.buyerIdentityId,
        buyerWalletId: input.buyerWalletId,
        amount: template.priceAmount!,
        currency: template.priceCurrency!,
        status: "pending",
      })
      .returning();

    // 4b. Re-fetch buyer wallet inside txn for balance check + lock
    const [bw] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, input.buyerWalletId))
      .for("update");
    if (!bw || bw.balance < template.priceAmount!) {
      // Race: balance went under between step 2 and now.
      await tx
        .update(templatePurchases)
        .set({ status: "failed", failureReason: "insufficient_balance_race" })
        .where(eq(templatePurchases.id, purchase!.id));
      throw new Error("insufficient_balance");
    }

    // 4c. Debit buyer wallet
    await tx
      .update(wallets)
      .set({ balance: bw.balance - template.priceAmount! })
      .where(eq(wallets.id, bw.id));

    // 4d. Create escrow row (funded), worker = author's wallet directly
    const [escrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: bw.id,
        workerWallet: template.authorWalletId,
        amount: template.priceAmount!,
        description: `Template purchase: ${template.name} (${template.id})`,
        status: "funded",
      })
      .returning();

    await tx.insert(transactions).values({
      walletId: bw.id,
      type: "escrow_lock",
      amount: -template.priceAmount!,
      counterparty: escrow!.id,
      description: `Template purchase locked: ${template.name}`,
      escrowId: escrow!.id,
      metadata: { template_id: template.id, purchase_id: purchase!.id },
    });

    // 4e. Release immediately to author's wallet (no dispute window).
    //     Take-rate split: author receives gross − fee; the fee is recorded
    //     in marketplace.platform_revenue for the take-rate ledger.
    //     Doctrine: docs/BUSINESS-MODEL.md (Ring 3).
    const split = computeFee({
      amount: template.priceAmount!,
      currency: template.priceCurrency!,
    });

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${split.net}` })
      .where(eq(wallets.id, template.authorWalletId!));

    await tx
      .update(escrows)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(escrows.id, escrow!.id));

    await tx.insert(transactions).values({
      walletId: template.authorWalletId!,
      type: "escrow_release",
      amount: split.net,
      counterparty: bw.id,
      description: `Template purchase released: ${template.name}`,
      escrowId: escrow!.id,
      metadata: {
        template_id: template.id,
        purchase_id: purchase!.id,
        platform_fee: split.fee,
        gross_amount: split.gross,
      },
    });

    await recordRevenue(tx, {
      transactionType: "template_purchase",
      transactionId: purchase!.id,
      fee: split.fee,
      currency: split.currency,
      rateBps: split.rateBps,
      buyerWalletId: bw.id,
      sellerWalletId: template.authorWalletId!,
      metadata: { template_id: template.id },
    });

    // 4f. Settle the purchase row + bump template revenue counters
    const [settledPurchase] = await tx
      .update(templatePurchases)
      .set({
        status: "settled",
        escrowId: escrow!.id,
        settledAt: new Date(),
      })
      .where(eq(templatePurchases.id, purchase!.id))
      .returning();

    // Revenue counter tracks NET (author-received) revenue. Gross volume
    // can be reconstructed by joining to platform_revenue + summing.
    await tx
      .update(templates)
      .set({
        revenueTotal: sql`${templates.revenueTotal} + ${split.net}`,
        revenueCount: sql`${templates.revenueCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, template.id));

    return settledPurchase;
  });

  return toRow(result!);
}

export async function getPurchase(
  purchaseId: string,
  buyerProjectId: string,
): Promise<PurchaseRow | null> {
  const [row] = await db
    .select()
    .from(templatePurchases)
    .where(
      and(
        eq(templatePurchases.id, purchaseId),
        eq(templatePurchases.buyerProjectId, buyerProjectId),
      ),
    )
    .limit(1);
  return row ? toRow(row) : null;
}

export async function listPurchasesForProject(
  buyerProjectId: string,
): Promise<PurchaseRow[]> {
  const rows = await db
    .select()
    .from(templatePurchases)
    .where(eq(templatePurchases.buyerProjectId, buyerProjectId))
    .orderBy(sql`${templatePurchases.createdAt} DESC`);
  return rows.map(toRow);
}

export async function listPurchasesForTemplate(
  templateId: string,
): Promise<PurchaseRow[]> {
  const rows = await db
    .select()
    .from(templatePurchases)
    .where(eq(templatePurchases.templateId, templateId))
    .orderBy(sql`${templatePurchases.createdAt} DESC`);
  return rows.map(toRow);
}

/** Link a settled purchase to its adoption row. Called by adoptTemplate
 *  when an adoption was preceded by a purchase. */
export async function linkAdoption(
  purchaseId: string,
  adoptionId: string,
): Promise<void> {
  await db
    .update(templatePurchases)
    .set({ adoptionId })
    .where(eq(templatePurchases.id, purchaseId));
}

/** Validate that `purchase_id` exists, belongs to `buyerProjectId`, is
 *  for `templateId`, is settled, and has not already been linked to an
 *  adoption. Returns the purchase or throws. Used by the adoption route
 *  when the template is priced. */
export async function consumePurchaseForAdoption(
  purchaseId: string,
  templateId: string,
  buyerProjectId: string,
): Promise<PurchaseRow> {
  const p = await getPurchase(purchaseId, buyerProjectId);
  if (!p) throw new Error("purchase_not_found");
  if (p.template_id !== templateId) throw new Error("purchase_template_mismatch");
  if (p.status !== "settled") throw new Error(`purchase_not_settled: ${p.status}`);
  if (p.adoption_id) throw new Error("purchase_already_consumed");
  return p;
}
