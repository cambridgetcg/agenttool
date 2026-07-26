/**
 * EVM deposit-confirmation reconciler.
 *
 * Signed Alchemy deliveries create durable `pending` observations. This
 * worker independently fetches the transaction receipt, verifies the exact
 * ERC-20 Transfer log and waits for the chain-specific confirmation depth
 * before applying wallet credit. Provider/RPC unavailability leaves evidence
 * pending; it never becomes negative evidence.
 *
 * Multi-replica polling may duplicate reads. The final wallet mutation is
 * guarded by a database status compare-and-swap in inbound-deposits.ts.
 *
 * Doctrine: docs/CRYPTO-PAYMENT.md.
 */

import { eq, sql } from "drizzle-orm";
import {
  createPublicClient,
  type Hex,
} from "viem";

import { db } from "../../db/client";
import { cryptoWebhookEvents } from "../../db/schema/economy";
import {
  isEvmChain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import {
  creditConfirmedPendingDeposit,
  markPendingDepositChecked,
  rejectPendingDeposit,
} from "../../services/economy/crypto/inbound-deposits";
import {
  activeNetwork,
  EVM_CONFIRMATION_THRESHOLDS,
  evmDepositCreditPolicy,
  evmRpcTransport,
} from "../../services/economy/crypto/network";

const POLL_INTERVAL_MS = 30_000;
const POLL_BATCH_SIZE = 50;
const POLL_CONCURRENCY = 5;
const RPC_TIMEOUT_MS = 10_000;
const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

let interval: ReturnType<typeof setInterval> | null = null;
let batchInFlight: Promise<void> | null = null;

export interface EvmDepositReceiptLog {
  logIndex: number | null;
  address: string;
  topics: readonly string[];
  data: string;
}

export interface EvmDepositReceiptInput {
  expectedTransactionHash: string;
  receiptTransactionHash: string;
  receiptStatus: "success" | "reverted";
  receiptBlockNumber: bigint;
  receiptBlockHash: string;
  currentBlockNumber: bigint;
  threshold: number;
  expectedLogIndex: number;
  expectedContract: string;
  expectedToAddress: string;
  expectedAmountBase: string;
  logs: readonly EvmDepositReceiptLog[];
}

export type EvmDepositReceiptOutcome =
  | { status: "pending"; confirmations: bigint }
  | {
      status: "unavailable";
      reason: "receipt_transaction_mismatch";
    }
  | {
      status: "confirmed";
      confirmations: bigint;
      blockNumber: bigint;
      blockHash: string;
    }
  | {
      status: "rejected";
      reason: "receipt_reverted" | "canonical_log_missing";
      confirmations: bigint;
    };

function topicAddress(topic: string): string | null {
  if (!/^0x[0-9a-f]{64}$/i.test(topic)) return null;
  return `0x${topic.slice(-40)}`.toLowerCase();
}

/** Classify a receipt without network or database access. A sufficiently deep
 * success is still rejected unless the exact canonical USDC log matches the
 * persisted recipient and amount. */
export function classifyEvmDepositReceipt(
  input: EvmDepositReceiptInput,
): EvmDepositReceiptOutcome {
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 1) {
    throw new Error("invalid_evm_confirmation_threshold");
  }
  if (
    !/^0x[0-9a-f]{64}$/i.test(input.expectedTransactionHash) ||
    !/^0x[0-9a-f]{64}$/i.test(input.receiptTransactionHash) ||
    !Number.isSafeInteger(input.expectedLogIndex) ||
    input.expectedLogIndex < 0 ||
    !/^0x[0-9a-f]{40}$/i.test(input.expectedContract) ||
    !/^0x[0-9a-f]{40}$/i.test(input.expectedToAddress) ||
    !/^[1-9]\d{0,77}$/.test(input.expectedAmountBase) ||
    !/^0x[0-9a-f]{64}$/i.test(input.receiptBlockHash)
  ) {
    throw new Error("invalid_evm_deposit_evidence");
  }
  if (
    input.receiptTransactionHash.toLowerCase() !==
    input.expectedTransactionHash.toLowerCase()
  ) {
    return {
      status: "unavailable",
      reason: "receipt_transaction_mismatch",
    };
  }

  const confirmations =
    input.currentBlockNumber >= input.receiptBlockNumber
      ? input.currentBlockNumber - input.receiptBlockNumber
      : 0n;
  if (confirmations < BigInt(input.threshold)) {
    return { status: "pending", confirmations };
  }
  if (input.receiptStatus === "reverted") {
    return { status: "rejected", reason: "receipt_reverted", confirmations };
  }

  const log = input.logs.find(
    (candidate) => candidate.logIndex === input.expectedLogIndex,
  );
  const topic0 = log?.topics[0]?.toLowerCase();
  const toAddress = log?.topics[2]
    ? topicAddress(log.topics[2])
    : null;
  let amount: bigint | null = null;
  if (log && /^0x[0-9a-f]{64}$/i.test(log.data)) {
    amount = BigInt(log.data);
  }

  if (
    !log ||
    log.address.toLowerCase() !== input.expectedContract.toLowerCase() ||
    topic0 !== ERC20_TRANSFER_TOPIC ||
    log.topics.length !== 3 ||
    toAddress !== input.expectedToAddress.toLowerCase() ||
    amount !== BigInt(input.expectedAmountBase)
  ) {
    return {
      status: "rejected",
      reason: "canonical_log_missing",
      confirmations,
    };
  }

  return {
    status: "confirmed",
    confirmations,
    blockNumber: input.receiptBlockNumber,
    blockHash: input.receiptBlockHash.toLowerCase(),
  };
}

type PendingRow = typeof cryptoWebhookEvents.$inferSelect;

async function reconcileRow(row: PendingRow): Promise<void> {
  if (
    !isEvmChain(row.chain) ||
    !/^0x[0-9a-f]{64}$/i.test(row.txHash) ||
    !row.amountBase ||
    !row.toAddress ||
    !row.contractAddress
  ) {
    await rejectPendingDeposit(row, "invalid_persisted_evidence");
    return;
  }

  const chain = row.chain as EvmChain;
  const settlementPolicy = evmDepositCreditPolicy(chain, activeNetwork());
  if (!settlementPolicy.allowed) {
    // Keep signed custody evidence available for later reconciliation without
    // spending RPC capacity or pretending L2 block depth proves settlement.
    await markPendingDepositChecked(row, settlementPolicy.reason);
    return;
  }
  const client = createPublicClient({
    transport: evmRpcTransport(chain, { timeoutMs: RPC_TIMEOUT_MS }),
  });

  let receipt;
  let currentBlockNumber: bigint;
  try {
    receipt = await client.getTransactionReceipt({
      hash: row.txHash as Hex,
    });
    currentBlockNumber = await client.getBlockNumber();
  } catch (error) {
    // RPC absence, timeout, rate limiting, or a not-yet-indexed receipt are
    // unavailable evidence, not proof that the transfer failed.
    await markPendingDepositChecked(row).catch(() => undefined);
    console.warn(
      `[deposit-confirm] ${row.id}: canonical receipt unavailable`,
      error instanceof Error ? error.name : "unknown_error",
    );
    return;
  }

  const outcome = classifyEvmDepositReceipt({
    expectedTransactionHash: row.txHash,
    receiptTransactionHash: receipt.transactionHash,
    receiptStatus: receipt.status,
    receiptBlockNumber: receipt.blockNumber,
    receiptBlockHash: receipt.blockHash,
    currentBlockNumber,
    threshold: EVM_CONFIRMATION_THRESHOLDS[chain],
    expectedLogIndex: row.logIndex,
    expectedContract: row.contractAddress,
    expectedToAddress: row.toAddress,
    expectedAmountBase: row.amountBase,
    logs: receipt.logs.map((log) => ({
      logIndex: log.logIndex,
      address: log.address,
      topics: log.topics,
      data: log.data,
    })),
  });

  if (outcome.status === "pending") {
    await markPendingDepositChecked(row);
    return;
  }
  if (outcome.status === "unavailable") {
    await markPendingDepositChecked(row, outcome.reason);
    console.warn(
      `[deposit-confirm] ${row.id}: receipt transaction identity mismatch`,
    );
    return;
  }
  if (outcome.status === "rejected") {
    await rejectPendingDeposit(row, outcome.reason);
    return;
  }
  await creditConfirmedPendingDeposit(row, {
    blockNumber: outcome.blockNumber,
    blockHash: outcome.blockHash,
  });
}

async function reconcilePendingDepositBatchOnce(): Promise<void> {
  const pending = await db
    .select()
    .from(cryptoWebhookEvents)
    .where(eq(cryptoWebhookEvents.status, "pending"))
    // A permanently unavailable receipt must not monopolize the first page.
    // Fresh rows are checked first, then the least-recently checked rows.
    .orderBy(
      sql`${cryptoWebhookEvents.lastCheckedAt} ASC NULLS FIRST`,
      cryptoWebhookEvents.receivedAt,
    )
    .limit(POLL_BATCH_SIZE);

  let cursor = 0;
  const consumers = Array.from(
    { length: Math.min(POLL_CONCURRENCY, pending.length) },
    async () => {
      while (cursor < pending.length) {
        const row = pending[cursor++];
        if (!row) return;
        try {
          await reconcileRow(row);
        } catch (error) {
          await markPendingDepositChecked(row).catch(() => undefined);
          console.error(
            `[deposit-confirm] ${row.id}: reconciliation failed`,
            error instanceof Error ? error.name : "unknown_error",
          );
        }
      }
    },
  );
  await Promise.all(consumers);
}

/** One in-process batch at a time. Multi-replica duplicate reads are allowed;
 * the database status CAS remains the balance-effect boundary. */
export async function reconcilePendingDepositBatch(): Promise<void> {
  if (batchInFlight) return batchInFlight;
  const run = reconcilePendingDepositBatchOnce();
  batchInFlight = run;
  try {
    await run;
  } finally {
    if (batchInFlight === run) batchInFlight = null;
  }
}

export function startDepositConfirmWorker(): void {
  if (interval) return;
  void reconcilePendingDepositBatch().catch((error) => {
    console.error(
      "[deposit-confirm] initial tick failed:",
      error instanceof Error ? error.name : "unknown_error",
    );
  });
  interval = setInterval(() => {
    void reconcilePendingDepositBatch().catch((error) => {
      console.error(
        "[deposit-confirm] tick failed:",
        error instanceof Error ? error.name : "unknown_error",
      );
    });
  }, POLL_INTERVAL_MS);
  console.log(
    `💰 deposit confirmation worker started (poll ${POLL_INTERVAL_MS}ms)`,
  );
}

export function stopDepositConfirmWorker(): void {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
}
