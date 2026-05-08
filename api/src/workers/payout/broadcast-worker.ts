/** Payout-broadcast BullMQ worker.
 *
 *  Lifecycle: 'requested' → 'broadcasting' (status flip + tx_hash persisted)
 *  → 'broadcast' (RPC accepted) — or 'failed' + refund (build/sign error,
 *  RPC reject, etc.).
 *
 *  Crash-recovery: the deterministic tx_hash is written BEFORE submit; if
 *  the worker dies between sign and submit (or submit response is lost),
 *  the next pass queries `txExistsOnChain(hash)` to disambiguate *landed*
 *  from *never made it*.
 *
 *  Doctrine wall (PAYOUT-BROADCAST.md): NO retries that change semantics
 *  post-RPC-submit. A failed submit that may have landed leaves the row
 *  at 'broadcast' (let the confirm watcher decide); a failed submit that
 *  certainly didn't land triggers refund.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slice 1). */

import { and, eq, sql } from "drizzle-orm";
import { Worker } from "bullmq";
import type { Address } from "viem";

import { db } from "../../db/client";
import { cryptoPayouts, wallets } from "../../db/schema/economy";
import {
  CREDITS_PER_USDC,
  isEvmChain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import {
  buildAndSignUsdcTransfer,
  submitSignedTx,
  txExistsOnChain,
  type SignedTx,
} from "../../services/economy/crypto/sign-evm";
import { redisConnection } from "../../services/tools/queue/connection";
import type { PayoutBroadcastJobData } from "./queue";

let worker: Worker<PayoutBroadcastJobData, void> | null = null;

export function startPayoutBroadcastWorker() {
  if (worker) return worker;
  if (!redisConnection) {
    console.warn(
      "[payout-broadcast] AGENTTOOL_DISABLE_WORKERS=1 — worker not started",
    );
    return null;
  }

  worker = new Worker<PayoutBroadcastJobData, void>(
    "payout-broadcast",
    async (job) => {
      await processPayout(job.data.payoutId);
    },
    {
      connection: redisConnection,
      // Serial: payouts from the same source address must use sequential
      // nonces. Concurrency=1 avoids nonce collisions across in-flight jobs.
      concurrency: 1,
    },
  );

  worker.on("error", (err) => {
    console.error("[payout-broadcast] worker error:", err);
  });

  console.log("💸 payout broadcast worker started");
  return worker;
}

export async function stopPayoutBroadcastWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

function creditsForAmount(amountBase: string): number {
  const amountUsdc = Number(amountBase) / 1_000_000;
  return Math.ceil(amountUsdc * CREDITS_PER_USDC);
}

async function processPayout(payoutId: string): Promise<void> {
  // ── Phase 1: lock + sign + persist tx_hash ─────────────────────────
  // CAS on status='requested' (one tx); if a cancel races us, the CAS
  // returns 0 rows and we exit cleanly.
  const lockResult = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(cryptoPayouts)
      .where(eq(cryptoPayouts.id, payoutId))
      .limit(1);
    if (!row) {
      return { ok: false as const, reason: "not_found" };
    }
    if (row.status !== "requested") {
      return {
        ok: false as const,
        reason: "wrong_status",
        currentStatus: row.status,
      };
    }
    if (!isEvmChain(row.chain)) {
      // Solana payouts wait for Slice 3 — leave 'requested', don't fail.
      return { ok: false as const, reason: "unsupported_chain", chain: row.chain };
    }

    let signed: SignedTx;
    try {
      signed = await buildAndSignUsdcTransfer({
        walletId: row.walletId,
        chain: row.chain as EvmChain,
        destinationAddress: row.destinationAddress as Address,
        amountBase: BigInt(row.amountBase as string),
      });
    } catch (err) {
      // Build/sign failed pre-RPC — refund + fail in this same tx.
      const credits = creditsForAmount(row.amountBase as string);
      await tx
        .update(wallets)
        .set({ balance: sql`balance + ${credits}` })
        .where(eq(wallets.id, row.walletId));
      await tx
        .update(cryptoPayouts)
        .set({
          status: "failed",
          error: `build_or_sign_failed: ${(err as Error).message}`.slice(0, 500),
        })
        .where(eq(cryptoPayouts.id, payoutId));
      return { ok: false as const, reason: "sign_failed" };
    }

    // Compare-and-swap on status. Race with cancel ⇒ updated.length === 0.
    const updated = await tx
      .update(cryptoPayouts)
      .set({
        status: "broadcasting",
        txHash: signed.txHash,
      })
      .where(
        and(
          eq(cryptoPayouts.id, payoutId),
          eq(cryptoPayouts.status, "requested"),
        ),
      )
      .returning({ id: cryptoPayouts.id });

    if (updated.length === 0) {
      return { ok: false as const, reason: "race_lost" };
    }

    return {
      ok: true as const,
      signed,
      chain: row.chain as EvmChain,
      walletId: row.walletId,
      amountBase: row.amountBase as string,
    };
  });

  if (!lockResult.ok) {
    console.warn(
      `[payout-broadcast] ${payoutId}: ${lockResult.reason}` +
        ("currentStatus" in lockResult
          ? ` (current=${lockResult.currentStatus})`
          : ""),
    );
    return;
  }

  // ── Phase 2: submit ────────────────────────────────────────────────
  const { signed, chain, walletId, amountBase } = lockResult;
  try {
    await submitSignedTx(chain, signed.serialized);
    await db
      .update(cryptoPayouts)
      .set({ status: "broadcast" })
      .where(eq(cryptoPayouts.id, payoutId));
    console.log(
      `[payout-broadcast] ${payoutId}: submitted ${signed.txHash} (${chain})`,
    );
  } catch (err) {
    // Did the tx actually land despite the error? (Network blip post-submit.)
    const exists = await txExistsOnChain(chain, signed.txHash).catch(() => false);
    if (exists) {
      await db
        .update(cryptoPayouts)
        .set({ status: "broadcast" })
        .where(eq(cryptoPayouts.id, payoutId));
      console.warn(
        `[payout-broadcast] ${payoutId}: submit error but tx landed (${signed.txHash}) — marked broadcast`,
      );
      return;
    }
    // Truly didn't land: refund + mark failed.
    const errMsg = `submit_failed: ${(err as Error).message}`.slice(0, 500);
    const credits = creditsForAmount(amountBase);
    await db.transaction(async (tx) => {
      await tx
        .update(wallets)
        .set({ balance: sql`balance + ${credits}` })
        .where(eq(wallets.id, walletId));
      await tx
        .update(cryptoPayouts)
        .set({ status: "failed", error: errMsg })
        .where(eq(cryptoPayouts.id, payoutId));
    });
    console.error(`[payout-broadcast] ${payoutId}: ${errMsg}; refunded ${credits} credits`);
  }
}
