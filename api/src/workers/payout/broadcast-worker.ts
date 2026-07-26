/** Payout-broadcast BullMQ worker.
 *
 *  Lifecycle: 'requested' → 'broadcasting' (status flip + tx_hash persisted)
 *  → 'broadcast' (RPC accepted or positively found on-chain) — or 'failed'
 *  + refund only for a failure proved before RPC dispatch.
 *
 *  Crash-recovery: the deterministic tx_hash is written BEFORE submit. If
 *  the worker dies between sign and submit (or the submit response is lost),
 *  an operator can query `txExists*` using that persisted identity.
 *
 *  Doctrine wall (PAYOUT-BROADCAST.md): NO retries that change semantics
 *  post-RPC-submit. A submit error advances to `broadcast` only when lookup
 *  finds the tx. Lookup absence or failure remains `broadcasting`; neither
 *  proves non-submission, authorizes retry, or authorizes refund.
 *
 *  Chain dispatch: the BullMQ worker callback reads the row's chain and
 *  routes to `processEvmPayout` or `processSolanaPayout`. Each branch
 *  implements the same lock-CAS + sign + submit + classify shape with
 *  the chain's native libs (viem for EVM, @solana/web3.js for Solana).
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slices 1+3). */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { Worker } from "bullmq";
import type { Address } from "viem";

import { db } from "../../db/client";
import { cryptoPayouts } from "../../db/schema/economy";
import {
  isEvmChain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import {
  deriveEvmAddress,
  deriveSolanaAddress,
} from "../../services/economy/crypto/hd";
import { activeMnemonic } from "../../services/economy/crypto/network";
import {
  buildAndSignUsdcTransfer,
  submitSignedTx,
  txExistsOnChain,
  type SignedTx,
} from "../../services/economy/crypto/sign-evm";
import {
  buildAndSignSolanaUsdcTransfer,
  solanaTxExists,
  submitSolanaTx,
  type SignedSolanaTx,
} from "../../services/economy/crypto/sign-solana";
import { refundPayoutAndFail } from "../../services/economy/crypto/payout-refund";
import { redisConnection } from "../../services/tools/queue/connection";
import type { PayoutBroadcastJobData } from "./queue";
import {
  assertExpectedSubmitIdentity,
  resolveSubmitError,
} from "./submit-outcome";

let worker: Worker<PayoutBroadcastJobData, void> | null = null;
const SOURCE_IN_FLIGHT_STATUSES = ["broadcasting", "broadcast"] as const;

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
      try {
        await processPayout(job.data.payoutId);
      } catch {
        // Contain unexpected pre-submit failures as one terminal, ledger-
        // reconciled failure instead of leaving `requested` behind a retained
        // BullMQ job id. If the row already reached `broadcasting`, the helper
        // does nothing: post-submit ambiguity remains sticky.
        try {
          await containUnexpectedProcessingFailure(job.data.payoutId);
        } catch {
          // A retained failed job is deliberate here: containment itself was
          // unavailable, so silently re-enqueueing could cross an unknown RPC
          // boundary. The stable error contains no provider/endpoint detail.
          throw new Error("payout_failure_containment_unavailable");
        }
      }
    },
    {
      connection: redisConnection,
      // Serial: payouts from the same source address must use sequential
      // nonces (EVM) / blockhashes (Solana). Concurrency=1 avoids
      // collisions across in-flight jobs.
      concurrency: 1,
    },
  );

  worker.on("error", () => {
    // BullMQ/Redis errors can embed credential-bearing connection strings.
    console.error("[payout-broadcast] worker infrastructure unavailable");
  });
  worker.on("failed", (job) => {
    console.error(
      `[payout-broadcast] ${job?.data.payoutId ?? "unknown"}: job retained after containment failure; no automatic retry`,
    );
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

async function containUnexpectedProcessingFailure(
  payoutId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(cryptoPayouts)
      .where(eq(cryptoPayouts.id, payoutId))
      .limit(1);
    if (!row || row.status !== "requested") return;

    await refundPayoutAndFail(
      tx,
      row,
      "requested",
      "worker_pre_submit_failed",
    );
  });
}

/** Advance only the payout whose persisted operation identity still matches
 * the signed bytes submitted by this worker. Inspecting RETURNING keeps logs
 * and callers from claiming success after a concurrent state/identity change. */
async function markExpectedPayoutBroadcast(
  payoutId: string,
  expectedTxHash: string,
): Promise<boolean> {
  const updated = await db
    .update(cryptoPayouts)
    .set({ status: "broadcast", error: null })
    .where(
      and(
        eq(cryptoPayouts.id, payoutId),
        eq(cryptoPayouts.status, "broadcasting"),
        eq(cryptoPayouts.txHash, expectedTxHash),
      ),
    )
    .returning({ id: cryptoPayouts.id });

  return updated.length === 1;
}

// ── Top-level chain dispatcher ──────────────────────────────────────────

export async function processPayout(payoutId: string): Promise<void> {
  // Cheap read for chain dispatch. The chain-specific processors do their
  // own row read inside a transaction with CAS — this top-level read is
  // just to pick a branch.
  const [meta] = await db
    .select({ chain: cryptoPayouts.chain, status: cryptoPayouts.status })
    .from(cryptoPayouts)
    .where(eq(cryptoPayouts.id, payoutId))
    .limit(1);

  if (!meta) {
    console.warn(`[payout-broadcast] ${payoutId}: row not found`);
    return;
  }
  if (meta.status !== "requested") {
    console.warn(
      `[payout-broadcast] ${payoutId}: status=${meta.status}, skipping`,
    );
    return;
  }

  if (isEvmChain(meta.chain)) {
    return processEvmPayout(payoutId);
  }
  if (meta.chain === "solana") {
    return processSolanaPayout(payoutId);
  }
  console.warn(
    `[payout-broadcast] ${payoutId}: unsupported chain '${meta.chain}', leaving 'requested'`,
  );
}

// ── EVM branch ──────────────────────────────────────────────────────────

async function processEvmPayout(payoutId: string): Promise<void> {
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
      return { ok: false as const, reason: "wrong_branch", chain: row.chain };
    }

    // Per-source-address advisory lock serialises admission across replicas.
    // The durable in-flight gate below extends that serialization beyond this
    // transaction: one source cannot sign another payout until the prior
    // operation is confirmed or terminal. This deliberately trades per-wallet
    // throughput for nonce/signature correctness.
    const { address: fromAddress } = deriveEvmAddress(activeMnemonic(), row.walletId);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${fromAddress}, 0))`,
    );

    const [sourceInFlight] = await tx
      .select({ id: cryptoPayouts.id })
      .from(cryptoPayouts)
      .where(
        and(
          eq(cryptoPayouts.walletId, row.walletId),
          eq(cryptoPayouts.chain, row.chain),
          ne(cryptoPayouts.id, row.id),
          inArray(cryptoPayouts.status, [...SOURCE_IN_FLIGHT_STATUSES]),
        ),
      )
      .limit(1);
    if (sourceInFlight) {
      return { ok: false as const, reason: "source_in_flight" };
    }

    let signed: SignedTx;
    try {
      signed = await buildAndSignUsdcTransfer({
        walletId: row.walletId,
        chain: row.chain as EvmChain,
        destinationAddress: row.destinationAddress as Address,
        amountBase: BigInt(row.amountBase as string),
      });
    } catch {
      // Build/sign failed pre-RPC — refund + fail in this same tx.
      const refund = await refundPayoutAndFail(
        tx,
        row,
        "requested",
        "build_or_sign_failed",
      );
      return {
        ok: false as const,
        reason: refund.refunded
          ? "sign_failed"
          : refund.reason === "ledger_unreconciled" && refund.terminal
            ? "refund_unreconciled"
            : "race_lost",
      };
    }

    // Compare-and-swap on status. Race with cancel ⇒ updated.length === 0.
    // Persists tx_hash + status='broadcasting' atomically, *before* the
    // RPC submit. Canonical site of persist-identity-before-side-effect:
    // any crash after this commit is recoverable by chain lookup on tx_hash.
    // See docs/PATTERN-PERSIST-IDENTITY.md.
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
  const { signed, chain } = lockResult;
  try {
    const submittedHash = await submitSignedTx(chain, signed.serialized);
    assertExpectedSubmitIdentity("evm", signed.txHash, submittedHash);
    if (!(await markExpectedPayoutBroadcast(payoutId, signed.txHash))) {
      console.warn(
        `[payout-broadcast] ${payoutId}: submit accepted but payout identity/status changed before broadcast CAS; no state overwritten`,
      );
      return;
    }
    console.log(
      `[payout-broadcast] ${payoutId}: submitted ${signed.txHash} (${chain})`,
    );
  } catch {
    // The submit call crossed the RPC boundary. An error or a mismatched
    // returned hash is not evidence of non-submission: a response may have
    // been lost or malformed after the node accepted the bytes, and an
    // immediate lookup may race propagation. Reconcile only the locally
    // persisted expected hash; provider response details are discarded.
    const resolution = await resolveSubmitError(() =>
      txExistsOnChain(chain, signed.txHash),
    );
    if (resolution.nextStatus === "broadcast") {
      if (!(await markExpectedPayoutBroadcast(payoutId, signed.txHash))) {
        console.warn(
          `[payout-broadcast] ${payoutId}: expected tx found but payout identity/status changed before broadcast CAS; no state overwritten`,
        );
        return;
      }
      console.warn(
        `[payout-broadcast] ${payoutId}: submit error but tx landed (${signed.txHash}) — marked broadcast`,
      );
      return;
    }

    await db
      .update(cryptoPayouts)
      .set({ error: resolution.safeError })
      .where(
        and(
          eq(cryptoPayouts.id, payoutId),
          eq(cryptoPayouts.status, "broadcasting"),
        ),
      );
    console.error(
      `[payout-broadcast] ${payoutId}: submit outcome unknown (lookup=${resolution.lookup}); left broadcasting for operator reconciliation`,
    );
  }
}

// ── Solana branch ───────────────────────────────────────────────────────

async function processSolanaPayout(payoutId: string): Promise<void> {
  // ── Phase 1: lock + sign + persist signature (as tx_hash) ───────────
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
    if (row.chain !== "solana") {
      return { ok: false as const, reason: "wrong_branch", chain: row.chain };
    }

    // Same one-in-flight source gate as EVM. The payout-specific memo also
    // makes separately authorized Solana operations produce distinct bytes.
    const { address: fromAddress } = deriveSolanaAddress(activeMnemonic(), row.walletId);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${fromAddress}, 0))`,
    );

    const [sourceInFlight] = await tx
      .select({ id: cryptoPayouts.id })
      .from(cryptoPayouts)
      .where(
        and(
          eq(cryptoPayouts.walletId, row.walletId),
          eq(cryptoPayouts.chain, row.chain),
          ne(cryptoPayouts.id, row.id),
          inArray(cryptoPayouts.status, [...SOURCE_IN_FLIGHT_STATUSES]),
        ),
      )
      .limit(1);
    if (sourceInFlight) {
      return { ok: false as const, reason: "source_in_flight" };
    }

    let signed: SignedSolanaTx;
    try {
      signed = await buildAndSignSolanaUsdcTransfer({
        payoutId: row.id,
        walletId: row.walletId,
        destinationAddress: row.destinationAddress,
        amountBase: BigInt(row.amountBase as string),
      });
    } catch {
      const refund = await refundPayoutAndFail(
        tx,
        row,
        "requested",
        "build_or_sign_failed",
      );
      return {
        ok: false as const,
        reason: refund.refunded
          ? "sign_failed"
          : refund.reason === "ledger_unreconciled" && refund.terminal
            ? "refund_unreconciled"
            : "race_lost",
      };
    }

    const updated = await tx
      .update(cryptoPayouts)
      .set({
        status: "broadcasting",
        txHash: signed.signature, // base58 sig; same column as EVM Hex
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
  const { signed } = lockResult;
  try {
    const submittedSignature = await submitSolanaTx(signed.serialized);
    assertExpectedSubmitIdentity(
      "solana",
      signed.signature,
      submittedSignature,
    );
    if (!(await markExpectedPayoutBroadcast(payoutId, signed.signature))) {
      console.warn(
        `[payout-broadcast] ${payoutId}: submit accepted but payout identity/status changed before broadcast CAS; no state overwritten`,
      );
      return;
    }
    console.log(
      `[payout-broadcast] ${payoutId}: submitted ${signed.signature} (solana)`,
    );
  } catch {
    const resolution = await resolveSubmitError(() =>
      solanaTxExists(signed.signature),
    );
    if (resolution.nextStatus === "broadcast") {
      if (!(await markExpectedPayoutBroadcast(payoutId, signed.signature))) {
        console.warn(
          `[payout-broadcast] ${payoutId}: expected tx found but payout identity/status changed before broadcast CAS; no state overwritten`,
        );
        return;
      }
      console.warn(
        `[payout-broadcast] ${payoutId}: submit error but tx landed (${signed.signature}) — marked broadcast`,
      );
      return;
    }

    await db
      .update(cryptoPayouts)
      .set({ error: resolution.safeError })
      .where(
        and(
          eq(cryptoPayouts.id, payoutId),
          eq(cryptoPayouts.status, "broadcasting"),
        ),
      );
    console.error(
      `[payout-broadcast] ${payoutId}: submit outcome unknown (lookup=${resolution.lookup}); left broadcasting for operator reconciliation`,
    );
  }
}
