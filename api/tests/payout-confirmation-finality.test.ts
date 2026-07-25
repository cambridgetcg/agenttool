import { describe, expect, test } from "bun:test";

import { classifyEvmReceiptFinality } from "../src/services/economy/crypto/sign-evm";
import { classifySolanaSignatureFinality } from "../src/services/economy/crypto/sign-solana";

describe("EVM payout finality", () => {
  test("an observed revert remains pending below the configured threshold", () => {
    expect(
      classifyEvmReceiptFinality({
        receiptStatus: "reverted",
        receiptBlockNumber: 100n,
        currentBlockNumber: 111n,
        threshold: 12,
      }),
    ).toEqual({
      status: "pending",
      blockNumber: 100n,
      confirmations: 11n,
    });
  });

  test("a revert becomes terminal only at the configured threshold", () => {
    expect(
      classifyEvmReceiptFinality({
        receiptStatus: "reverted",
        receiptBlockNumber: 100n,
        currentBlockNumber: 112n,
        threshold: 12,
      }),
    ).toEqual({
      status: "reverted",
      blockNumber: 100n,
      confirmations: 12n,
    });
  });

  test("success uses the same threshold", () => {
    expect(
      classifyEvmReceiptFinality({
        receiptStatus: "success",
        receiptBlockNumber: 100n,
        currentBlockNumber: 112n,
        threshold: 12,
      }),
    ).toEqual({
      status: "confirmed",
      blockNumber: 100n,
      confirmations: 12n,
    });
  });

  test("missing or unsafe threshold fails closed", () => {
    for (const threshold of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        classifyEvmReceiptFinality({
          receiptStatus: "reverted",
          receiptBlockNumber: 100n,
          currentBlockNumber: 200n,
          threshold,
        }),
      ).toThrow("invalid_evm_confirmation_threshold");
    }
  });

  test("a head behind the receipt is pending rather than negative-finalized", () => {
    expect(
      classifyEvmReceiptFinality({
        receiptStatus: "reverted",
        receiptBlockNumber: 101n,
        currentBlockNumber: 100n,
        threshold: 1,
      }),
    ).toEqual({
      status: "pending",
      blockNumber: 101n,
      confirmations: 0n,
    });
  });
});

describe("Solana payout finality", () => {
  test("processed or confirmed errors remain pending", () => {
    for (const confirmationStatus of ["processed", "confirmed", null]) {
      expect(
        classifySolanaSignatureFinality({
          err: { InstructionError: [0, "Custom"] },
          confirmationStatus,
          slot: 42,
        }),
      ).toEqual({ status: "pending", slot: 42 });
    }
  });

  test("an error becomes terminal only when finalized", () => {
    expect(
      classifySolanaSignatureFinality({
        err: { InstructionError: [0, "Custom"] },
        confirmationStatus: "finalized",
        slot: 42,
      }),
    ).toEqual({ status: "reverted", slot: 42 });
  });

  test("a successful finalized signature confirms", () => {
    expect(
      classifySolanaSignatureFinality({
        err: null,
        confirmationStatus: "finalized",
        slot: 42,
      }),
    ).toEqual({ status: "confirmed", slot: 42 });
  });
});
