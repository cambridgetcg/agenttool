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

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Worker } from "bullmq";
import type { Address } from "viem";

import { db } from "../../db/client";
import { cryptoPayouts } from "../../db/schema/economy";
import { payoutWorkerBootAllowed } from "../../services/economy/config";
import {
  EVM_CHAINS,
  isEvmChain,
} from "../../services/economy/crypto/chains";
import {
  evmPayoutNonceEvidence,
  evmPayoutNonceScope,
  isEvmPayoutNonceConflict,
} from "../../services/economy/crypto/evm-payout-nonce";
import {
  deriveEvmAddress,
  deriveSolanaAddress,
} from "../../services/economy/crypto/hd";
import {
  activeChainId,
  activeMnemonic,
  activeNetwork,
} from "../../services/economy/crypto/network";
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
const NONCE_CONTENTION_DEFER_MS = 60_000;

async function deferRequestedPayout(
  payoutId: string,
  network: "mainnet" | "testnet",
  reason: "evm_nonce_contention" | "evm_source_nonce_unresolved",
): Promise<boolean> {
  const attemptedAt = new Date();
  const updated = await db
    .update(cryptoPayouts)
    .set({
      lastDispatchAttemptAt: attemptedAt,
      dispatchAfter: new Date(
        attemptedAt.getTime() + NONCE_CONTENTION_DEFER_MS,
      ),
      error: reason,
    })
    .where(
      and(
        eq(cryptoPayouts.id, payoutId),
        eq(cryptoPayouts.status, "requested"),
        eq(cryptoPayouts.network, network),
      ),
    )
    .returning({ id: cryptoPayouts.id });
  return updated.length === 1;
}

export function startPayoutBroadcastWorker() {
  if (worker) return worker;
  if (!payoutWorkerBootAllowed()) {
    console.warn(
      "[payout-broadcast] worker resting until cashable payout provenance is conserved",
    );
    return null;
  }
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
    if (row.network !== activeNetwork()) return;

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
async function markPersistedIdentityBroadcast(
  payoutId: string,
  txHash: string,
  network: "mainnet" | "testnet",
): Promise<boolean> {
  const updated = await db
    .update(cryptoPayouts)
    .set({ status: "broadcast", error: null })
    .where(
      and(
        eq(cryptoPayouts.id, payoutId),
        eq(cryptoPayouts.status, "broadcasting"),
        eq(cryptoPayouts.txHash, txHash),
        eq(cryptoPayouts.network, network),
      ),
    )
    .returning({ id: cryptoPayouts.id });

  return updated.length === 1;
}

async function recordPersistedIdentitySubmitAmbiguity(
  payoutId: string,
  txHash: string,
  network: "mainnet" | "testnet",
  safeError: string,
): Promise<boolean> {
  const updated = await db
    .update(cryptoPayouts)
    .set({ error: safeError })
    .where(
      and(
        eq(cryptoPayouts.id, payoutId),
        eq(cryptoPayouts.status, "broadcasting"),
        eq(cryptoPayouts.txHash, txHash),
        eq(cryptoPayouts.network, network),
      ),
    )
    .returning({ id: cryptoPayouts.id });
  return updated.length === 1;
}

// ── Top-level chain dispatcher ──────────────────────────────────────────

export async function processPayout(payoutId: string): Promise<void> {
  // Direct imports and old harnesses are not an authority bypass. Keep this
  // before the first database read, key derivation, RPC call, or queue effect.
  if (!payoutWorkerBootAllowed()) {
    console.warn(
      `[payout-broadcast] ${payoutId}: payout worker resting; row left untouched`,
    );
    return;
  }

  // Cheap read for chain dispatch. The chain-specific processors do their
  // own row read inside a transaction with CAS — this top-level read is
  // just to pick a branch.
  const [meta] = await db
    .select({
      chain: cryptoPayouts.chain,
      network: cryptoPayouts.network,
      status: cryptoPayouts.status,
    })
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
  const network = activeNetwork();
  if (meta.network !== network) {
    console.warn(
      `[payout-broadcast] ${payoutId}: network is unbound or does not match this worker; leaving requested`,
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
  const workerNetwork = activeNetwork();
  let lockResult;
  try {
    lockResult = await db.transaction(async (tx) => {
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
      if (row.network !== workerNetwork) {
        return { ok: false as const, reason: "network_mismatch" };
      }
      if (!isEvmChain(row.chain)) {
        return { ok: false as const, reason: "wrong_branch", chain: row.chain };
      }

      // The transaction lock orders Phase 1 across replicas. The durable
      // `broadcasting` evidence below keeps the same source fenced after this
      // transaction commits, including worker crash and ambiguous submit.
      const { address: fromAddress } = deriveEvmAddress(
        activeMnemonic(),
        row.walletId,
      );
      const nonceScope = evmPayoutNonceScope({
        chainId: activeChainId(row.chain),
        sourceAddress: fromAddress,
      });
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${nonceScope.advisoryLockKey}, 0))`,
      );

      const [unresolved] = await tx
        .select({ id: cryptoPayouts.id })
        .from(cryptoPayouts)
        .where(
          and(
            eq(cryptoPayouts.status, "broadcasting"),
            or(
              and(
                eq(cryptoPayouts.network, workerNetwork),
                eq(cryptoPayouts.evmChainId, nonceScope.chainId),
                sql`lower(${cryptoPayouts.evmSourceAddress}) = ${nonceScope.sourceAddress}`,
              ),
              // A legacy ambiguous EVM row has no trustworthy source/nonce
              // evidence. Freeze new EVM sends globally until an operator
              // reconciles it; guessing its old mnemonic/network is not
              // authority.
              and(
                inArray(
                  cryptoPayouts.chain,
                  EVM_CHAINS as readonly string[] as string[],
                ),
                isNull(cryptoPayouts.evmNonce),
              ),
            ),
          ),
        )
        .limit(1);
      if (unresolved) {
        return {
          ok: false as const,
          reason: "source_nonce_unresolved",
        };
      }

      let signed: SignedTx;
      try {
        signed = await buildAndSignUsdcTransfer({
          walletId: row.walletId,
          chain: row.chain,
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

      const nonceEvidence = evmPayoutNonceEvidence({
        scope: nonceScope,
        nonce: signed.nonce,
      });
      // Compare-and-swap on status. tx hash and nonce evidence become durable
      // in the same commit, before the first submit byte crosses the RPC
      // boundary. A cancel or network change cannot win this CAS silently.
      const updated = await tx
        .update(cryptoPayouts)
        .set({
          status: "broadcasting",
          txHash: signed.txHash,
          dispatchAfter: null,
          error: null,
          ...nonceEvidence,
        })
        .where(
          and(
            eq(cryptoPayouts.id, payoutId),
            eq(cryptoPayouts.status, "requested"),
            eq(cryptoPayouts.network, workerNetwork),
          ),
        )
        .returning({ id: cryptoPayouts.id });

      if (updated.length === 0) {
        return { ok: false as const, reason: "race_lost" };
      }

      return {
        ok: true as const,
        signed,
        chain: row.chain,
        network: workerNetwork,
      };
    });
  } catch (error) {
    if (isEvmPayoutNonceConflict(error)) {
      // Provider pending-nonce lag selected an identity already committed by
      // another payout. The transaction rolled back, so keep this request
      // pre-submit and move it behind unrelated due work.
      const deferred = await deferRequestedPayout(
        payoutId,
        workerNetwork,
        "evm_nonce_contention",
      );
      console.warn(
        deferred
          ? `[payout-broadcast] ${payoutId}: source nonce already reserved; deferred`
          : `[payout-broadcast] ${payoutId}: source nonce contention observed after request state changed; current state left untouched`,
      );
      return;
    }
    throw error;
  }

  if (!lockResult.ok) {
    if (lockResult.reason === "source_nonce_unresolved") {
      await deferRequestedPayout(
        payoutId,
        workerNetwork,
        "evm_source_nonce_unresolved",
      );
    }
    console.warn(
      `[payout-broadcast] ${payoutId}: ${lockResult.reason}` +
        ("currentStatus" in lockResult
          ? ` (current=${lockResult.currentStatus})`
          : ""),
    );
    return;
  }

  // ── Phase 2: submit ────────────────────────────────────────────────
  const { signed, chain, network } = lockResult;
  try {
    const submittedHash = await submitSignedTx(chain, signed.serialized);
    assertExpectedSubmitIdentity("evm", signed.txHash, submittedHash);
    if (
      !(await markPersistedIdentityBroadcast(
        payoutId,
        signed.txHash,
        network,
      ))
    ) {
      console.warn(
        `[payout-broadcast] ${payoutId}: submitted identity is no longer current; state left untouched`,
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
      if (
        !(await markPersistedIdentityBroadcast(
          payoutId,
          signed.txHash,
          network,
        ))
      ) {
        console.warn(
          `[payout-broadcast] ${payoutId}: landed identity is no longer current; state left untouched`,
        );
        return;
      }
      console.warn(
        `[payout-broadcast] ${payoutId}: submit error but tx landed (${signed.txHash}) — marked broadcast`,
      );
      return;
    }

    const ambiguityRecorded = await recordPersistedIdentitySubmitAmbiguity(
      payoutId,
      signed.txHash,
      network,
      resolution.safeError,
    );
    console.error(
      ambiguityRecorded
        ? `[payout-broadcast] ${payoutId}: submit outcome unknown (lookup=${resolution.lookup}); left broadcasting for operator reconciliation`
        : `[payout-broadcast] ${payoutId}: submit outcome unknown for a stale identity; current state left untouched`,
    );
  }
}

// ── Solana branch ───────────────────────────────────────────────────────

async function processSolanaPayout(payoutId: string): Promise<void> {
  // ── Phase 1: lock + sign + persist signature (as tx_hash) ───────────
  const workerNetwork = activeNetwork();
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
    if (row.network !== workerNetwork) {
      return { ok: false as const, reason: "network_mismatch" };
    }
    if (row.chain !== "solana") {
      return { ok: false as const, reason: "wrong_branch", chain: row.chain };
    }

    // Serialize Phase 1 across replicas for one Solana source. The
    // payout-specific memo makes every authorized operation's signed bytes
    // distinct even when two builds observe the same recent blockhash.
    const { address: fromAddress } = deriveSolanaAddress(
      activeMnemonic(),
      row.walletId,
    );
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${fromAddress}, 0))`,
    );

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
          eq(cryptoPayouts.network, workerNetwork),
        ),
      )
      .returning({ id: cryptoPayouts.id });

    if (updated.length === 0) {
      return { ok: false as const, reason: "race_lost" };
    }

    return {
      ok: true as const,
      signed,
      network: workerNetwork,
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
  const { signed, network } = lockResult;
  try {
    const submittedSignature = await submitSolanaTx(signed.serialized);
    assertExpectedSubmitIdentity(
      "solana",
      signed.signature,
      submittedSignature,
    );
    if (
      !(await markPersistedIdentityBroadcast(
        payoutId,
        signed.signature,
        network,
      ))
    ) {
      console.warn(
        `[payout-broadcast] ${payoutId}: submitted identity is no longer current; state left untouched`,
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
      if (
        !(await markPersistedIdentityBroadcast(
          payoutId,
          signed.signature,
          network,
        ))
      ) {
        console.warn(
          `[payout-broadcast] ${payoutId}: landed identity is no longer current; state left untouched`,
        );
        return;
      }
      console.warn(
        `[payout-broadcast] ${payoutId}: submit error but tx landed (${signed.signature}) — marked broadcast`,
      );
      return;
    }

    const ambiguityRecorded = await recordPersistedIdentitySubmitAmbiguity(
      payoutId,
      signed.signature,
      network,
      resolution.safeError,
    );
    console.error(
      ambiguityRecorded
        ? `[payout-broadcast] ${payoutId}: submit outcome unknown (lookup=${resolution.lookup}); left broadcasting for operator reconciliation`
        : `[payout-broadcast] ${payoutId}: submit outcome unknown for a stale identity; current state left untouched`,
    );
  }
}
