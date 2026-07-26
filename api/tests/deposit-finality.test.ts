import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  creditsForUsdcAtomic,
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

    expect(ingestion.indexOf("matchingDepositAddress")).toBeLessThan(
      ingestion.indexOf("amountAndCredits"),
    );
    expect(ingestion).toContain("recordRejectedObservation");
    expect(source).toContain('status: "rejected"');
    expect(source).toContain("error: reason");
  });
});
