import { describe, expect, test } from "bun:test";

import {
  classifyRemovedGeneration,
  creditsForUsdcAtomic,
  isPromotableLiveGeneration,
  sameEvmBlockGeneration,
} from "../src/services/economy/crypto/inbound-deposits";
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

function input(
  overrides: Partial<EvmDepositReceiptInput> = {},
): EvmDepositReceiptInput {
  return {
    expectedTransactionHash: `0x${"9".repeat(64)}`,
    receiptTransactionHash: `0x${"9".repeat(64)}`,
    expectedBlockNumber: 100n,
    expectedBlockHash: `0x${"a".repeat(64)}`,
    receiptStatus: "success",
    receiptBlockNumber: 100n,
    receiptBlockHash: `0x${"a".repeat(64)}`,
    canonicalBlockNumber: 100n,
    canonicalBlockHash: `0x${"a".repeat(64)}`,
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
  test("keeps valid evidence pending below configured depth", () => {
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

  test("keeps mismatched RPC identities pending instead of granting negative authority", () => {
    const inconsistent = [
      { receiptTransactionHash: `0x${"8".repeat(64)}` },
      { receiptBlockNumber: 101n },
      { receiptBlockHash: `0x${"b".repeat(64)}` },
      { canonicalBlockNumber: 101n },
      { canonicalBlockHash: `0x${"b".repeat(64)}` },
    ] satisfies Array<Partial<EvmDepositReceiptInput>>;

    for (const mismatch of inconsistent) {
      expect(
        classifyEvmDepositReceipt(input(mismatch)),
      ).toMatchObject({
        status: "pending",
        reason: "rpc_evidence_inconsistent",
      });
    }
  });

  test("rejects a deep revert or mismatched canonical log", () => {
    expect(
      classifyEvmDepositReceipt(input({ receiptStatus: "reverted" })),
    ).toEqual({
      status: "rejected",
      reason: "receipt_reverted",
      confirmations: 12n,
    });

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
      [{
        ...input().logs[0]!,
        topics: [TRANSFER_TOPIC, "0x1", RECIPIENT_TOPIC],
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
    expect(() =>
      classifyEvmDepositReceipt(input({ receiptBlockNumber: -1n })),
    ).toThrow("invalid_evm_deposit_evidence");
  });
});

describe("deposit reorg generation fencing", () => {
  const blockA = {
    blockNumber: 100n,
    blockHash: `0x${"a".repeat(64)}`,
  };
  const blockB = {
    blockNumber: 101n,
    blockHash: `0x${"b".repeat(64)}`,
  };

  test("matches the same generation exactly and case-insensitively by hash", () => {
    expect(sameEvmBlockGeneration(blockA, blockA)).toBe(true);
    expect(
      sameEvmBlockGeneration(blockA, {
        ...blockA,
        blockHash: blockA.blockHash.toUpperCase().replace("0X", "0x"),
      }),
    ).toBe(true);
    expect(sameEvmBlockGeneration(blockA, blockB)).toBe(false);
    expect(
      sameEvmBlockGeneration(blockA, {
        ...blockA,
        blockNumber: 102n,
      }),
    ).toBe(false);
  });

  test("classifies delayed removed(A) against current B as stale", () => {
    expect(classifyRemovedGeneration(blockB, blockA)).toBe("stale");
    expect(classifyRemovedGeneration(blockA, blockA)).toBe("matching");
    expect(
      classifyRemovedGeneration(
        { blockNumber: null, blockHash: null },
        blockA,
      ),
    ).toBe("unreconciled");
  });

  test("promotes only a different-hash generation with identical transfer facts", () => {
    const event = {
      walletId: "00000000-0000-0000-0000-000000000001",
      amountBase: "1000000",
      toAddress: RECIPIENT,
      contractAddress: CONTRACT,
    };
    const candidate = {
      ...event,
      blockHash: blockB.blockHash,
    };

    expect(isPromotableLiveGeneration(event, candidate, blockA)).toBe(true);
    expect(
      isPromotableLiveGeneration(
        event,
        { ...candidate, blockHash: blockA.blockHash },
        blockA,
      ),
    ).toBe(false);
    expect(
      isPromotableLiveGeneration(
        event,
        { ...candidate, amountBase: "2000000" },
        blockA,
      ),
    ).toBe(false);
    expect(
      isPromotableLiveGeneration(
        event,
        {
          ...candidate,
          walletId: "00000000-0000-0000-0000-000000000002",
        },
        blockA,
      ),
    ).toBe(false);
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
});
