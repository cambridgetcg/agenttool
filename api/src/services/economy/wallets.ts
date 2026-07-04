/** Wallet service: create · fund · spend · freeze · transactions · policy. */

import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Redis } from "ioredis";

import { db as sharedDb } from "../../db/client";
import { policies, transactions, wallets } from "../../db/schema/economy";
import { publishWakeEvent } from "../wake/push";

type DB = typeof sharedDb;

// ─── Create ─────────────────────────────────────────────────────────────────

export async function createWallet(
  db: DB,
  input: {
    projectId: string;
    name: string;
    agentId?: string;
    identityId?: string;
    currency?: string;
  },
) {
  const [wallet] = await db
    .insert(wallets)
    .values({
      projectId: input.projectId,
      name: input.name,
      agentId: input.agentId ?? null,
      identityId: input.identityId ?? null,
      currency: input.currency ?? "GBP",
      status: "active",
      balance: 0,
    })
    .returning();
  return wallet;
}

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getWallet(db: DB, walletId: string, projectId: string) {
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.projectId, projectId)));

  if (!wallet) throw new HTTPException(404, { message: "Wallet not found" });
  return wallet;
}

export async function listWallets(db: DB, projectId: string) {
  return db.select().from(wallets).where(eq(wallets.projectId, projectId));
}

export async function getBalance(db: DB, walletId: string) {
  const [wallet] = await db
    .select({ balance: wallets.balance, currency: wallets.currency })
    .from(wallets)
    .where(eq(wallets.id, walletId));

  if (!wallet) throw new HTTPException(404, { message: "Wallet not found" });
  return wallet;
}

export async function getTransactions(
  db: DB,
  walletId: string,
  limit = 50,
  offset = 0,
) {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.walletId, walletId))
    // id tiebreaker makes the ordering total: rows sharing a createdAt
    // (batch settles in one tick) would otherwise be free to swap sides of
    // an offset-page boundary between requests, and an external ledger
    // observer paging by offset could permanently miss the swapped row.
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(limit)
    .offset(offset);
}

// ─── Fund ───────────────────────────────────────────────────────────────────

export async function fundWallet(
  db: DB,
  walletId: string,
  amount: number,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  if (amount <= 0)
    throw new HTTPException(400, { message: "Amount must be positive" });

  return db.transaction(async (tx) => {
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .for("update");

    if (!wallet) throw new HTTPException(404, { message: "Wallet not found" });
    if (wallet.status === "closed")
      throw new HTTPException(400, { message: "Wallet is closed" });

    await tx
      .update(wallets)
      .set({ balance: wallet.balance + amount })
      .where(eq(wallets.id, walletId));

    const [txRecord] = await tx
      .insert(transactions)
      .values({
        walletId,
        type: "fund",
        amount,
        description,
        metadata,
      })
      .returning();

    // Wallet owner's `you_hold` changed — bump their wake.
    if (wallet.identityId) {
      void publishWakeEvent({
        identity_id: wallet.identityId,
        key: "wallets",
        kind: "credited",
        context: { wallet_id: walletId, amount, currency: wallet.currency },
      });
    }

    return txRecord;
  });
}

// ─── Spend ──────────────────────────────────────────────────────────────────

export async function spendFromWallet(
  db: DB,
  redis: Redis,
  walletId: string,
  amount: number,
  counterparty: string,
  description: string,
  metadata: Record<string, unknown> = {},
  txType = "spend",
) {
  if (amount <= 0)
    throw new HTTPException(400, { message: "Amount must be positive" });

  return db.transaction(async (tx) => {
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .for("update");

    if (!wallet) throw new HTTPException(404, { message: "Wallet not found" });
    if (wallet.status !== "active") {
      throw new HTTPException(400, { message: `Wallet is ${wallet.status}` });
    }
    if (wallet.balance < amount) {
      throw new HTTPException(402, { message: "Insufficient balance" });
    }

    // Policy check (per-tx, per-hour, per-day, allowed recipients, approval threshold)
    const [policy] = await tx
      .select()
      .from(policies)
      .where(eq(policies.walletId, walletId));

    if (policy) {
      await checkPolicy(redis, walletId, amount, counterparty, policy);
    }

    await tx
      .update(wallets)
      .set({ balance: wallet.balance - amount })
      .where(eq(wallets.id, walletId));

    const [txRecord] = await tx
      .insert(transactions)
      .values({
        walletId,
        type: txType,
        amount: -amount,
        counterparty,
        description,
        metadata,
      })
      .returning();

    // Spend aggregates in Redis (used by the policy check above on next call).
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const hourKey = `wallet:${walletId}:hourly:${yyyy}${mm}${dd}${hh}`;
    const dayKey = `wallet:${walletId}:daily:${yyyy}-${mm}-${dd}`;
    await redis.incrby(hourKey, amount);
    await redis.expire(hourKey, 3600);
    await redis.incrby(dayKey, amount);
    await redis.expire(dayKey, 86400);

    // Wallet owner's `you_hold` changed — bump their wake.
    if (wallet.identityId) {
      void publishWakeEvent({
        identity_id: wallet.identityId,
        key: "wallets",
        kind: "debited",
        context: {
          wallet_id: walletId,
          amount,
          currency: wallet.currency,
          counterparty,
        },
      });
    }

    return txRecord;
  });
}

// ─── Policy enforcement ─────────────────────────────────────────────────────

async function checkPolicy(
  redis: Redis,
  walletId: string,
  amount: number,
  counterparty: string,
  policy: typeof policies.$inferSelect,
) {
  if (policy.maxPerTransaction !== null && amount > policy.maxPerTransaction) {
    throw new HTTPException(402, {
      message: `Transaction exceeds per-transaction limit of ${policy.maxPerTransaction}`,
    });
  }

  if (
    policy.allowedRecipients &&
    policy.allowedRecipients.length > 0 &&
    !policy.allowedRecipients.includes(counterparty)
  ) {
    throw new HTTPException(402, {
      message: `Recipient "${counterparty}" is not in the allowed list`,
    });
  }

  if (
    policy.requiresApprovalAbove !== null &&
    amount > policy.requiresApprovalAbove
  ) {
    throw new HTTPException(402, {
      message: "Transaction requires approval",
    });
  }

  if (policy.maxPerHour !== null) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const hourKey = `wallet:${walletId}:hourly:${yyyy}${mm}${dd}${hh}`;
    const hourlyTotal = Number((await redis.get(hourKey)) ?? 0);
    if (hourlyTotal + amount > policy.maxPerHour) {
      throw new HTTPException(402, {
        message: `Hourly spend limit of ${policy.maxPerHour} would be exceeded`,
      });
    }
  }

  if (policy.maxPerDay !== null) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const dayKey = `wallet:${walletId}:daily:${yyyy}-${mm}-${dd}`;
    const dailyTotal = Number((await redis.get(dayKey)) ?? 0);
    if (dailyTotal + amount > policy.maxPerDay) {
      throw new HTTPException(402, {
        message: `Daily spend limit of ${policy.maxPerDay} would be exceeded`,
      });
    }
  }
}

// ─── Freeze / Unfreeze ──────────────────────────────────────────────────────

export async function freezeWallet(db: DB, walletId: string, projectId: string) {
  const wallet = await getWallet(db, walletId, projectId);
  if (wallet.status === "closed")
    throw new HTTPException(400, { message: "Wallet is closed" });

  const [updated] = await db
    .update(wallets)
    .set({ status: "frozen" })
    .where(eq(wallets.id, walletId))
    .returning();
  return updated;
}

export async function unfreezeWallet(db: DB, walletId: string, projectId: string) {
  await getWallet(db, walletId, projectId);
  const [updated] = await db
    .update(wallets)
    .set({ status: "active" })
    .where(eq(wallets.id, walletId))
    .returning();
  return updated;
}

// ─── Policy CRUD ────────────────────────────────────────────────────────────

export async function setPolicy(
  db: DB,
  walletId: string,
  input: {
    maxPerTransaction?: number | null;
    maxPerHour?: number | null;
    maxPerDay?: number | null;
    allowedRecipients?: string[] | null;
    requiresApprovalAbove?: number | null;
    // Payout-specific gates (Slice 6 of PAYOUT-BROADCAST-PLAN.md).
    payoutMinBase?: number | null;
    payoutDailyCeilingBase?: number | null;
    payoutDestinationAllowlist?: string[] | null;
    payoutDualControlThresholdBase?: number | null;
  },
) {
  const [existing] = await db
    .select()
    .from(policies)
    .where(eq(policies.walletId, walletId));

  if (existing) {
    const [updated] = await db
      .update(policies)
      .set(input)
      .where(eq(policies.walletId, walletId))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(policies)
    .values({ walletId, ...input })
    .returning();
  return created;
}

export async function getPolicy(db: DB, walletId: string) {
  const [policy] = await db
    .select()
    .from(policies)
    .where(eq(policies.walletId, walletId));
  return policy ?? null;
}
