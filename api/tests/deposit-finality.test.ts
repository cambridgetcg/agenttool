import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  creditsForUsdcAtomic,
  pendingDepositSnapshotMatches,
} from "../src/services/economy/crypto/inbound-deposits";
import {
  evmDepositCreditPolicy,
} from "../src/services/economy/crypto/network";
import {
  classifyEvmDepositReceipt,
  type EvmDepositReceiptInput,
} from "../src/workers/deposit/confirm-worker";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const CONTRACT = "0x0000000000000000000000000000000000000011";
const RECIPIENT = "0x0000000000000000000000000000000000000022";
const SENDER_TOPIC = `0x${"0".repeat(24)}${"33".repeat(20)}`;
const RECIPIENT_TOPIC = `0x${"0".repeat(24)}${RECIPIENT.slice(2)}`;
const AMOUNT_DATA = `0x${(1_000_000n).toString(16).padStart(64, "0")}`;
const TX_HASH = `0x${"b".repeat(64)}`;

function input(
  overrides: Partial<EvmDepositReceiptInput> = {},
): EvmDepositReceiptInput {
  return {
    expectedTransactionHash: TX_HASH,
    receiptTransactionHash: TX_HASH,
    receiptStatus: "success",
    receiptBlockNumber: 100n,
    receiptBlockHash: `0x${"a".repeat(64)}`,
    currentBlockNumber: 112n,
    threshold: 12,
    expectedLogIndex: 7,
    expectedContract: CONTRACT,
    expectedToAddress: RECIPIENT,
    expectedAmountBase: "1000000",
    logs: [
      {
        logIndex: 7,
        address: CONTRACT,
        topics: [TRANSFER_TOPIC, SENDER_TOPIC, RECIPIENT_TOPIC],
        data: AMOUNT_DATA,
      },
    ],
    ...overrides,
  };
}

describe("EVM deposit receipt finality", () => {
  test("keeps a valid observation pending below confirmation depth", () => {
    expect(
      classifyEvmDepositReceipt(input({ currentBlockNumber: 111n })),
    ).toEqual({ status: "pending", confirmations: 11n });
  });

  test("confirms only the exact canonical ERC-20 transfer log", () => {
    expect(classifyEvmDepositReceipt(input())).toEqual({
      status: "confirmed",
      confirmations: 12n,
      blockNumber: 100n,
      blockHash: `0x${"a".repeat(64)}`,
    });
  });

  test("rejects a finalized revert", () => {
    expect(
      classifyEvmDepositReceipt(input({ receiptStatus: "reverted" })),
    ).toEqual({
      status: "rejected",
      reason: "receipt_reverted",
      confirmations: 12n,
    });
  });

  test("treats a valid-shaped receipt for another transaction as unavailable", () => {
    expect(
      classifyEvmDepositReceipt(
        input({ receiptTransactionHash: `0x${"c".repeat(64)}` }),
      ),
    ).toEqual({
      status: "unavailable",
      reason: "receipt_transaction_mismatch",
    });
  });

  test("rejects wrong contract, recipient, amount, topic, or log identity", () => {
    const mutations: EvmDepositReceiptInput["logs"][] = [
      [{ ...input().logs[0]!, address: RECIPIENT }],
      [{
        ...input().logs[0]!,
        topics: [TRANSFER_TOPIC, SENDER_TOPIC, SENDER_TOPIC],
      }],
      [{
        ...input().logs[0]!,
        data: `0x${(2_000_000n).toString(16).padStart(64, "0")}`,
      }],
      [{
        ...input().logs[0]!,
        topics: [`0x${"f".repeat(64)}`, SENDER_TOPIC, RECIPIENT_TOPIC],
      }],
      [{ ...input().logs[0]!, logIndex: 8 }],
    ];
    for (const logs of mutations) {
      expect(classifyEvmDepositReceipt(input({ logs }))).toEqual({
        status: "rejected",
        reason: "canonical_log_missing",
        confirmations: 12n,
      });
    }
  });

  test("fails closed on malformed persisted evidence or threshold", () => {
    expect(() =>
      classifyEvmDepositReceipt(input({ threshold: 0 })),
    ).toThrow("invalid_evm_confirmation_threshold");
    expect(() =>
      classifyEvmDepositReceipt(input({ expectedAmountBase: "1.0" })),
    ).toThrow("invalid_evm_deposit_evidence");
  });
});

describe("deposit credit arithmetic", () => {
  test("uses exact integer USDC base units", () => {
    expect(creditsForUsdcAtomic("1000000")).toBe(100);
    expect(creditsForUsdcAtomic("1500000")).toBe(150);
    expect(creditsForUsdcAtomic("9999")).toBeNull();
    expect(creditsForUsdcAtomic("1.5")).toBeNull();
    expect(creditsForUsdcAtomic("01")).toBeNull();
  });

  test("persists matched dust as rejected custody evidence before acknowledging it", () => {
    const source = readFileSync(
      new URL(
        "../src/services/economy/crypto/inbound-deposits.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const start = source.indexOf("export async function ingestInboundTransfer");
    const end = source.indexOf(
      "export async function reconcileRemovedInboundTransfer",
    );
    const ingestion = source.slice(start, end);

    expect(ingestion.indexOf("matchingActiveDepositAddress")).toBeLessThan(
      ingestion.indexOf("amountAndCredits"),
    );
    expect(ingestion).toContain('"inactive_deposit_address"');
    expect(ingestion).toContain(
      'recordRejectedObservation(\n        transfer,\n        row.walletId,\n        "inactive_deposit_address"',
    );
    expect(source).toContain("deriveDepositAddress(");
    expect(source).toContain("depositAddressMatches(");
    expect(source).toContain("activeMnemonic()");
    expect(ingestion).toContain("recordRejectedObservation");
    expect(source).toContain('status: "rejected"');
    expect(source).toContain("error: reason");
  });

  test("revalidates the active derivation inside the final credit transaction", () => {
    const source = readFileSync(
      new URL(
        "../src/services/economy/crypto/inbound-deposits.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const start = source.indexOf(
      "export async function creditConfirmedPendingDeposit",
    );
    const credit = source.slice(start);
    const eventLock = credit.indexOf(".from(cryptoWebhookEvents)");
    const addressLock = credit.indexOf(".from(depositAddresses)");
    const settlementPolicy = credit.indexOf("evmDepositCreditPolicy(");
    const activeRoot = credit.indexOf("activeMnemonic()");
    const authorityMatch = credit.indexOf("depositAddressMatches(");
    const creditStatus = credit.indexOf('status: "credited"');
    const walletCredit = credit.indexOf("balance +");

    expect(eventLock).toBeGreaterThan(-1);
    expect(addressLock).toBeGreaterThan(eventLock);
    expect(settlementPolicy).toBeGreaterThan(eventLock);
    expect(addressLock).toBeGreaterThan(settlementPolicy);
    expect(activeRoot).toBeGreaterThan(addressLock);
    expect(authorityMatch).toBeGreaterThan(activeRoot);
    expect(creditStatus).toBeGreaterThan(authorityMatch);
    expect(walletCredit).toBeGreaterThan(creditStatus);
    expect(credit).toContain('error: "inactive_deposit_address"');
    expect(credit).toContain(
      "creditedGeneration: event.observationGeneration",
    );
  });

  test("binds a receipt decision to one exact pending observation", () => {
    const snapshot = {
      id: "event-1",
      chain: "ethereum",
      txHash: TX_HASH,
      logIndex: 7,
      walletId: "wallet-1",
      amountBase: "1000000",
      toAddress: RECIPIENT,
      contractAddress: CONTRACT,
      blockNumber: 100n,
      blockHash: `0x${"a".repeat(64)}`,
      providerWebhookId: "webhook-1",
      providerEventId: "delivery-1",
      observationGeneration: 1,
      receivedAt: new Date(1000),
    };
    expect(pendingDepositSnapshotMatches(snapshot, { ...snapshot })).toBe(true);
    expect(
      pendingDepositSnapshotMatches(snapshot, {
        ...snapshot,
        amountBase: "2000000",
      }),
    ).toBe(false);
    expect(
      pendingDepositSnapshotMatches(snapshot, {
        ...snapshot,
        receivedAt: new Date(1001),
      }),
    ).toBe(false);
    expect(
      pendingDepositSnapshotMatches(snapshot, {
        ...snapshot,
        observationGeneration: 2,
      }),
    ).toBe(false);
  });

  test("marks checks through a locked incarnation instead of timestamp SQL equality", () => {
    const source = readFileSync(
      new URL(
        "../src/services/economy/crypto/inbound-deposits.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const start = source.indexOf(
      "export async function markPendingDepositChecked",
    );
    const end = source.indexOf(
      "export async function rejectPendingDeposit",
    );
    const markChecked = source.slice(start, end);

    expect(markChecked).toContain("db.transaction");
    expect(markChecked).toContain('.for("update")');
    expect(markChecked).toContain("pendingDepositSnapshotMatches");
    expect(markChecked).toContain("observationGeneration");
    expect(markChecked).toContain("error: error ?? null");
    expect(markChecked).toContain(".returning(");
    expect(markChecked).not.toContain(
      "eq(cryptoWebhookEvents.receivedAt, expected.receivedAt)",
    );
  });

  test("database-fences each observation incarnation and credited effect", () => {
    const migration = readFileSync(
      new URL(
        "../migrations/20260726T200000_deposit_observation_generation.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain(
      "observation_generation INTEGER NOT NULL DEFAULT 1",
    );
    expect(migration).toContain("credited_generation INTEGER");
    expect(migration).toContain("CHECK (observation_generation > 0)");
    expect(migration).toContain(
      "SET credited_generation = observation_generation",
    );
    expect(migration).toContain(
      "crypto_webhook_events_credited_generation_check",
    );
    expect(migration).toContain(
      "crypto_webhook_events_pending_generation_check",
    );
    expect(migration).toContain(
      "status <> 'pending' OR credited_generation IS NULL",
    );
    expect(migration).toContain("credited_generation IS NOT NULL");
    expect(migration).toContain(
      "credited_generation = observation_generation",
    );
    expect(migration).toContain(
      "enforce_crypto_webhook_observation_generation",
    );
    expect(migration).toContain(
      "OLD.status = 'removed' AND NEW.status = 'pending'",
    );
    expect(migration).toContain(
      "NEW.observation_generation := OLD.observation_generation + 1",
    );
    expect(migration).toContain("NEW.credited_generation := NULL");
    expect(migration).toContain(
      "NEW.observation_generation IS DISTINCT FROM OLD.observation_generation",
    );
  });

  test("current writers bind credits and clear stale credited generations", () => {
    const source = readFileSync(
      new URL(
        "../src/services/economy/crypto/inbound-deposits.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const immediateStart = source.indexOf("async function recordImmediateCredit");
    const immediateEnd = source.indexOf(
      "async function recordRejectedObservation",
      immediateStart,
    );
    const immediate = source.slice(immediateStart, immediateEnd);
    const pendingStart = source.indexOf(
      "async function recordPendingEvmObservation",
    );
    const pendingEnd = source.indexOf(
      "export async function ingestInboundTransfer",
      pendingStart,
    );
    const pending = source.slice(pendingStart, pendingEnd);

    expect(immediate).toContain("observationGeneration: 1");
    expect(immediate).toContain("creditedGeneration: 1");
    expect(
      pending.match(/creditedGeneration: null/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("EVM deposit credit policy", () => {
  test("allows testnets and Ethereum mainnet but blocks non-L1 mainnet credit", () => {
    for (const chain of [
      "ethereum",
      "base",
      "polygon",
      "arbitrum",
      "optimism",
    ] as const) {
      expect(evmDepositCreditPolicy(chain, "testnet")).toEqual({
        allowed: true,
      });
    }
    expect(evmDepositCreditPolicy("ethereum", "mainnet")).toEqual({
      allowed: true,
    });
    for (const chain of [
      "base",
      "polygon",
      "arbitrum",
      "optimism",
    ] as const) {
      expect(evmDepositCreditPolicy(chain, "mainnet")).toEqual({
        allowed: false,
        reason: "mainnet_settlement_policy_unavailable",
      });
    }
  });
});
