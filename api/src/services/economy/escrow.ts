/** Escrow service: create · accept · release · refund · dispute · expire. */

import { and, eq, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Redis } from "ioredis";

import { db as sharedDb } from "../../db/client";
import { escrows, transactions, wallets } from "../../db/schema/economy";

type DB = typeof sharedDb;

// ─── Create ─────────────────────────────────────────────────────────────────

export async function createEscrow(
  db: DB,
  redis: Redis,
  input: {
    creatorWalletId: string;
    workerWalletId?: string;
    amount: number;
    description: string;
    deadline?: Date;
    projectId: string;
  },
) {
  if (input.amount <= 0)
    throw new HTTPException(400, { message: "Amount must be positive" });

  return db.transaction(async (tx) => {
    const [creatorWallet] = await tx
      .select()
      .from(wallets)
      .where(
        and(
          eq(wallets.id, input.creatorWalletId),
          eq(wallets.projectId, input.projectId),
        ),
      );

    if (!creatorWallet)
      throw new HTTPException(404, { message: "Creator wallet not found" });
    if (creatorWallet.status !== "active") {
      throw new HTTPException(400, {
        message: "Creator wallet is not active",
      });
    }
    if (creatorWallet.balance < input.amount) {
      throw new HTTPException(402, { message: "Insufficient balance for escrow" });
    }

    await tx
      .update(wallets)
      .set({ balance: creatorWallet.balance - input.amount })
      .where(eq(wallets.id, input.creatorWalletId));

    const [escrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: input.creatorWalletId,
        workerWallet: input.workerWalletId ?? null,
        amount: input.amount,
        description: input.description,
        deadline: input.deadline ?? null,
        status: "funded",
      })
      .returning();

    await tx.insert(transactions).values({
      walletId: input.creatorWalletId,
      type: "escrow_lock",
      amount: -input.amount,
      counterparty: escrow!.id,
      description: `Escrow locked: ${input.description}`,
      escrowId: escrow!.id,
      metadata: {},
    });

    return escrow;
  });
}

// ─── Accept ─────────────────────────────────────────────────────────────────

export async function acceptEscrow(
  db: DB,
  escrowId: string,
  workerWalletId: string,
) {
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, escrowId));
  if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });
  if (escrow.status !== "funded") {
    throw new HTTPException(400, { message: `Escrow is already ${escrow.status}` });
  }
  if (escrow.workerWallet) {
    throw new HTTPException(400, {
      message: "Escrow already has an assigned worker",
    });
  }

  const [updated] = await db
    .update(escrows)
    .set({ workerWallet: workerWalletId })
    .where(eq(escrows.id, escrowId))
    .returning();

  return updated;
}

// ─── Release ────────────────────────────────────────────────────────────────

export async function releaseEscrow(
  db: DB,
  redis: Redis,
  escrowId: string,
  projectId: string,
) {
  return db.transaction(async (tx) => {
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrowId))
      .for("update");

    if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });
    if (escrow.status !== "funded") {
      throw new HTTPException(400, {
        message: `Cannot release escrow with status: ${escrow.status}`,
      });
    }
    if (!escrow.workerWallet) {
      throw new HTTPException(400, {
        message: "No worker assigned — cannot release",
      });
    }

    // Project owns the creator wallet.
    const [creatorWallet] = await tx
      .select()
      .from(wallets)
      .where(
        and(
          eq(wallets.id, escrow.creatorWallet),
          eq(wallets.projectId, projectId),
        ),
      );

    if (!creatorWallet)
      throw new HTTPException(403, {
        message: "Not authorised to release this escrow",
      });

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${escrow.amount}` })
      .where(eq(wallets.id, escrow.workerWallet));

    const [updated] = await tx
      .update(escrows)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(escrows.id, escrowId))
      .returning();

    await tx.insert(transactions).values({
      walletId: escrow.workerWallet,
      type: "escrow_release",
      amount: escrow.amount,
      counterparty: escrow.creatorWallet,
      description: `Escrow released: ${escrow.description}`,
      escrowId: escrow.id,
      metadata: {},
    });

    return updated;
  });
}

// ─── Refund ─────────────────────────────────────────────────────────────────

export async function refundEscrow(
  db: DB,
  redis: Redis,
  escrowId: string,
  projectId: string,
) {
  return db.transaction(async (tx) => {
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrowId))
      .for("update");

    if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });
    if (!["funded", "disputed"].includes(escrow.status)) {
      throw new HTTPException(400, {
        message: `Cannot refund escrow with status: ${escrow.status}`,
      });
    }

    const [creatorWallet] = await tx
      .select()
      .from(wallets)
      .where(
        and(
          eq(wallets.id, escrow.creatorWallet),
          eq(wallets.projectId, projectId),
        ),
      );

    if (!creatorWallet)
      throw new HTTPException(403, {
        message: "Not authorised to refund this escrow",
      });

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${escrow.amount}` })
      .where(eq(wallets.id, escrow.creatorWallet));

    const [updated] = await tx
      .update(escrows)
      .set({ status: "refunded" })
      .where(eq(escrows.id, escrowId))
      .returning();

    await tx.insert(transactions).values({
      walletId: escrow.creatorWallet,
      type: "escrow_refund",
      amount: escrow.amount,
      counterparty: escrowId,
      description: `Escrow refunded: ${escrow.description}`,
      escrowId: escrow.id,
      metadata: {},
    });

    return updated;
  });
}

// ─── Dispute ────────────────────────────────────────────────────────────────

export async function disputeEscrow(
  db: DB,
  escrowId: string,
  projectId: string,
) {
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, escrowId));
  if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });
  if (escrow.status !== "funded") {
    throw new HTTPException(400, {
      message: `Cannot dispute escrow with status: ${escrow.status}`,
    });
  }

  const [creatorWallet] = await db
    .select()
    .from(wallets)
    .where(
      and(eq(wallets.id, escrow.creatorWallet), eq(wallets.projectId, projectId)),
    );

  if (!creatorWallet)
    throw new HTTPException(403, { message: "Not authorised" });

  const [updated] = await db
    .update(escrows)
    .set({ status: "disputed" })
    .where(eq(escrows.id, escrowId))
    .returning();

  return updated;
}

// ─── Expire overdue (intended for cron) ─────────────────────────────────────

export async function expireOverdue(db: DB, redis: Redis): Promise<number> {
  const overdue = await db
    .select()
    .from(escrows)
    .where(and(eq(escrows.status, "funded"), lt(escrows.deadline, new Date())));

  let count = 0;
  for (const escrow of overdue) {
    try {
      const [wallet] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.id, escrow.creatorWallet));

      if (wallet) {
        await refundEscrow(db, redis, escrow.id, wallet.projectId);
        count++;
      }
    } catch {
      /* one failure shouldn't block the rest */
    }
  }

  return count;
}

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getEscrow(db: DB, escrowId: string, projectId: string) {
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, escrowId));
  if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });

  const [wallet] = await db
    .select()
    .from(wallets)
    .where(
      and(eq(wallets.id, escrow.creatorWallet), eq(wallets.projectId, projectId)),
    );

  if (!wallet) throw new HTTPException(403, { message: "Not authorised" });
  return escrow;
}

export async function listEscrows(
  db: DB,
  projectId: string,
  status?: string,
) {
  const projectWallets = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.projectId, projectId));

  const walletIds = projectWallets.map((w) => w.id);
  if (walletIds.length === 0) return [];

  const rows = await db.select().from(escrows);
  return rows.filter(
    (e) =>
      walletIds.includes(e.creatorWallet) && (!status || e.status === status),
  );
}
