/**
 * EVM deposit-confirmation reconciler.
 *
 * Signed Alchemy deliveries create durable pending observations. This worker
 * independently verifies the exact canonical ERC-20 log and configured chain
 * depth before applying wallet credit. RPC absence/unavailability leaves
 * evidence pending; it is never negative authority.
 */

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
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
  quarantineMalformedPendingDeposit,
  rejectPendingDeposit,
} from "../../services/economy/crypto/inbound-deposits";
import {
  activeChainId,
  EVM_CONFIRMATION_THRESHOLDS,
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
  expectedBlockNumber: bigint;
  expectedBlockHash: string;
  receiptStatus: "success" | "reverted";
  receiptBlockNumber: bigint;
  receiptBlockHash: string;
  canonicalBlockNumber: bigint;
  canonicalBlockHash: string;
  currentBlockNumber: bigint;
  threshold: number;
  expectedLogIndex: number;
  expectedContract: string;
  expectedToAddress: string;
  expectedAmountBase: string;
  logs: readonly EvmDepositReceiptLog[];
}

export type EvmDepositReceiptOutcome =
  | {
      status: "pending";
      confirmations: bigint;
      reason?: "rpc_evidence_inconsistent";
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

/** Pure canonical-log classifier. Sufficient depth alone is not enough: the
 * exact contract, topic, log index, recipient, and amount must all match. */
export function classifyEvmDepositReceipt(
  input: EvmDepositReceiptInput,
): EvmDepositReceiptOutcome {
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 1) {
    throw new Error("invalid_evm_confirmation_threshold");
  }
  if (
    !Number.isSafeInteger(input.expectedLogIndex) ||
    input.expectedLogIndex < 0 ||
    !/^0x[0-9a-f]{64}$/i.test(input.expectedTransactionHash) ||
    !/^0x[0-9a-f]{64}$/i.test(input.receiptTransactionHash) ||
    input.expectedBlockNumber < 0n ||
    !/^0x[0-9a-f]{64}$/i.test(input.expectedBlockHash) ||
    input.receiptBlockNumber < 0n ||
    !/^0x[0-9a-f]{40}$/i.test(input.expectedContract) ||
    !/^0x[0-9a-f]{40}$/i.test(input.expectedToAddress) ||
    !/^[1-9]\d{0,77}$/.test(input.expectedAmountBase) ||
    !/^0x[0-9a-f]{64}$/i.test(input.receiptBlockHash) ||
    input.canonicalBlockNumber < 0n ||
    !/^0x[0-9a-f]{64}$/i.test(input.canonicalBlockHash) ||
    input.currentBlockNumber < 0n
  ) {
    throw new Error("invalid_evm_deposit_evidence");
  }

  const confirmations =
    input.currentBlockNumber >= input.receiptBlockNumber
      ? input.currentBlockNumber - input.receiptBlockNumber
      : 0n;
  if (
    input.receiptTransactionHash.toLowerCase() !==
      input.expectedTransactionHash.toLowerCase() ||
    input.receiptBlockNumber !== input.expectedBlockNumber ||
    input.receiptBlockHash.toLowerCase() !==
      input.expectedBlockHash.toLowerCase() ||
    input.canonicalBlockNumber !== input.receiptBlockNumber ||
    input.canonicalBlockHash.toLowerCase() !==
      input.receiptBlockHash.toLowerCase()
  ) {
    return {
      status: "pending",
      confirmations,
      reason: "rpc_evidence_inconsistent",
    };
  }
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
  const fromAddress = log?.topics[1]
    ? topicAddress(log.topics[1])
    : null;
  const toAddress = log?.topics[2]
    ? topicAddress(log.topics[2])
    : null;
  const amount =
    log && /^0x[0-9a-f]{64}$/i.test(log.data)
      ? BigInt(log.data)
      : null;

  if (
    !log ||
    log.address.toLowerCase() !== input.expectedContract.toLowerCase() ||
    topic0 !== ERC20_TRANSFER_TOPIC ||
    log.topics.length !== 3 ||
    fromAddress === null ||
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

async function fetchCanonicalRpcEvidence(
  chain: EvmChain,
  txHash: Hex,
) {
  const client = createPublicClient({
    // Each JSON-RPC call has one finite attempt. Provider retry policy belongs
    // at the worker/state-machine layer where ambiguity stays visible.
    transport: evmRpcTransport(chain, {
      timeout: RPC_TIMEOUT_MS,
      retryCount: 0,
    }),
  });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== activeChainId(chain)) {
    return { kind: "wrong_chain" as const };
  }
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const [canonicalBlock, headBlock] = await Promise.all([
    client.getBlock({
      blockNumber: receipt.blockNumber,
      includeTransactions: false,
    }),
    client.getBlock({
      blockTag: "latest",
      includeTransactions: false,
    }),
  ]);
  if (
    canonicalBlock.number === null ||
    canonicalBlock.hash === null ||
    headBlock.number === null
  ) {
    throw new Error("incomplete_canonical_block_evidence");
  }
  return {
    kind: "ready" as const,
    receipt,
    canonicalBlockNumber: canonicalBlock.number,
    canonicalBlockHash: canonicalBlock.hash,
    currentBlockNumber: headBlock.number,
  };
}

async function reconcileRow(row: PendingRow): Promise<void> {
  const snapshot = {
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
  };
  if (
    !isEvmChain(row.chain) ||
    !/^0x[0-9a-f]{64}$/i.test(row.txHash) ||
    !row.amountBase ||
    !row.toAddress ||
    !row.contractAddress ||
    row.blockNumber === null ||
    !row.blockHash ||
    !/^0x[0-9a-f]{64}$/i.test(row.blockHash)
  ) {
    await quarantineMalformedPendingDeposit(row.id, snapshot);
    return;
  }

  const chain = row.chain as EvmChain;
  const expectedGeneration = {
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
  };
  let rpcEvidence: Awaited<ReturnType<typeof fetchCanonicalRpcEvidence>>;
  try {
    rpcEvidence = await fetchCanonicalRpcEvidence(
      chain,
      row.txHash as Hex,
    );
  } catch {
    await markPendingDepositChecked(
      row.id,
      expectedGeneration,
      "canonical_evidence_unavailable",
    ).catch(() => undefined);
    console.warn(
      "[deposit-confirm] canonical evidence unavailable; state unchanged",
    );
    return;
  }
  if (rpcEvidence.kind === "wrong_chain") {
    await markPendingDepositChecked(
      row.id,
      expectedGeneration,
      "rpc_chain_mismatch",
    );
    console.warn("[deposit-confirm] RPC chain mismatch; state unchanged");
    return;
  }

  const outcome = classifyEvmDepositReceipt({
    expectedTransactionHash: row.txHash,
    receiptTransactionHash: rpcEvidence.receipt.transactionHash,
    expectedBlockNumber: expectedGeneration.blockNumber,
    expectedBlockHash: expectedGeneration.blockHash,
    receiptStatus: rpcEvidence.receipt.status,
    receiptBlockNumber: rpcEvidence.receipt.blockNumber,
    receiptBlockHash: rpcEvidence.receipt.blockHash,
    canonicalBlockNumber: rpcEvidence.canonicalBlockNumber,
    canonicalBlockHash: rpcEvidence.canonicalBlockHash,
    currentBlockNumber: rpcEvidence.currentBlockNumber,
    threshold: EVM_CONFIRMATION_THRESHOLDS[chain],
    expectedLogIndex: row.logIndex,
    expectedContract: row.contractAddress,
    expectedToAddress: row.toAddress,
    expectedAmountBase: row.amountBase,
    logs: rpcEvidence.receipt.logs.map((log) => ({
      logIndex: log.logIndex,
      address: log.address,
      topics: log.topics,
      data: log.data,
    })),
  });

  if (outcome.status === "pending") {
    await markPendingDepositChecked(
      row.id,
      expectedGeneration,
      outcome.reason ?? null,
    );
    return;
  }
  if (outcome.status === "rejected") {
    await rejectPendingDeposit(
      row.id,
      expectedGeneration,
      outcome.reason,
    );
    return;
  }
  await creditConfirmedPendingDeposit(row.id, expectedGeneration);
}

/** Reserve half of each bounded poll for unseen rows and half for the oldest
 * rechecks. Continuous fresh traffic therefore cannot starve old ambiguity. */
async function selectPendingDepositBatch(): Promise<PendingRow[]> {
  const half = Math.floor(POLL_BATCH_SIZE / 2);
  const [fresh, revisits] = await Promise.all([
    db
      .select()
      .from(cryptoWebhookEvents)
      .where(
        and(
          eq(cryptoWebhookEvents.status, "pending"),
          isNull(cryptoWebhookEvents.lastCheckedAt),
        ),
      )
      .orderBy(asc(cryptoWebhookEvents.receivedAt))
      .limit(half),
    db
      .select()
      .from(cryptoWebhookEvents)
      .where(
        and(
          eq(cryptoWebhookEvents.status, "pending"),
          isNotNull(cryptoWebhookEvents.lastCheckedAt),
        ),
      )
      .orderBy(
        asc(cryptoWebhookEvents.lastCheckedAt),
        asc(cryptoWebhookEvents.receivedAt),
      )
      .limit(POLL_BATCH_SIZE - half),
  ]);
  return [...fresh, ...revisits];
}

async function reconcilePendingDepositBatchOnce(): Promise<void> {
  const pending = await selectPendingDepositBatch();
  let cursor = 0;
  const consumers = Array.from(
    { length: Math.min(POLL_CONCURRENCY, pending.length) },
    async () => {
      while (cursor < pending.length) {
        const row = pending[cursor++];
        if (!row) return;
        try {
          await reconcileRow(row);
        } catch {
          console.error(
            "[deposit-confirm] reconciliation unavailable; state unchanged",
          );
        }
      }
    },
  );
  await Promise.all(consumers);
}

/** One in-process batch at a time. Replicas may duplicate read-only RPC work;
 * the block-generation/status CAS remains the wallet-effect boundary. */
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
  void reconcilePendingDepositBatch().catch(() => {
    console.error("[deposit-confirm] initial tick unavailable");
  });
  interval = setInterval(() => {
    void reconcilePendingDepositBatch().catch(() => {
      console.error("[deposit-confirm] tick unavailable");
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
