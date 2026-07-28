import {
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import {
  reconcileSubmissionUnknown,
  type OperationState,
} from "@agenttool/wallet";

import {
  ZERONE_LIMITS,
  ZeroneAdapterError,
  createZeroneAdapterClient,
  zeroneBroadcastResultToWallet,
  zeroneLookupToWallet,
  type VerifiedZeroneTransaction,
  type ZeroneBroadcastTransport,
  type ZeroneQueryTransport,
  type ZeroneSimulationTransport,
  type ZeroneTransactionLookup,
} from "../src/index.js";
import {
  SOURCE_ACCOUNT,
  accountObservation,
  signedTransaction,
} from "./fixtures.js";

let transaction: Readonly<VerifiedZeroneTransaction>;

beforeAll(async () => {
  ({ transaction } = await signedTransaction("attestation"));
});

const unusedSimulation: ZeroneSimulationTransport = {
  async simulate() {
    throw new Error("simulation transport must not be called");
  },
};

function queryTransport(
  lookup?: ZeroneQueryTransport["lookup_transaction"],
): ZeroneQueryTransport {
  return {
    async query_account() {
      return accountObservation();
    },
    async query_agenttool_adapter() {
      throw new Error("adapter query transport must not be called");
    },
    lookup_transaction:
      lookup
      ?? (async ({ tx_hash }) => ({
        status: "absent",
        tx_hash,
        observed_at_height: "700002",
      })),
  };
}

function clientWithBroadcast(
  broadcastOnce: ZeroneBroadcastTransport["broadcast_once"],
) {
  return createZeroneAdapterClient({
    network: "testnet",
    query: queryTransport(),
    simulation: unusedSimulation,
    broadcast: { broadcast_once: broadcastOnce },
  });
}

describe("single-submit broadcast ambiguity", () => {
  test("returns accepted and explicit pre-submit rejection without weakening them", async () => {
    const accepted = await clientWithBroadcast(async ({ tx_hash }) => ({
      status: "accepted",
      tx_hash,
    })).broadcastOnce(transaction);
    expect(accepted).toEqual({
      status: "accepted",
      tx_hash: transaction.tx_hash,
    });

    const rejected = await clientWithBroadcast(async ({ tx_hash }) => ({
      status: "rejected_pre_submit",
      tx_hash,
      code: "local_policy_rejection",
    })).broadcastOnce(transaction);
    expect(rejected).toEqual({
      status: "rejected_pre_submit",
      tx_hash: transaction.tx_hash,
      code: "local_policy_rejection",
    });
  });

  test("maps delayed resolution after deadline to ambiguous known tx hash", async () => {
    let invoked = false;
    const client = clientWithBroadcast(async ({ tx_hash }) => {
      invoked = true;
      return await new Promise((resolve) => {
        setTimeout(() => resolve({ status: "accepted", tx_hash }), 100);
      });
    });
    const result = await client.broadcastOnce(transaction, {
      deadline_at_ms: Date.now() + 25,
    });
    expect(invoked).toBe(true);
    expect(result).toEqual({
      status: "ambiguous",
      tx_hash: transaction.tx_hash,
      code: "deadline_exceeded",
    });
  });

  test("external abort returns bounded ambiguity even if transport ignores signal", async () => {
    let invoked = false;
    const client = clientWithBroadcast(async () => {
      invoked = true;
      return await new Promise(() => {
        // Deliberately never resolves and ignores context.signal.
      });
    });
    const controller = new AbortController();
    const pending = client.broadcastOnce(transaction, {
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    const result = await pending;
    expect(invoked).toBe(true);
    expect(result).toEqual({
      status: "ambiguous",
      tx_hash: transaction.tx_hash,
      code: "transport_error",
    });
  });

  test("already-aborted signal never invokes the send boundary", async () => {
    let invoked = false;
    const client = clientWithBroadcast(async ({ tx_hash }) => {
      invoked = true;
      return { status: "accepted", tx_hash };
    });
    const controller = new AbortController();
    controller.abort();
    await expect(client.broadcastOnce(transaction, {
      signal: controller.signal,
    })).rejects.toThrow(/already aborted before invocation/i);
    expect(invoked).toBe(false);
  });

  test("invalid deadline is rejected before invoking the send boundary", async () => {
    let invoked = false;
    const client = clientWithBroadcast(async ({ tx_hash }) => {
      invoked = true;
      return { status: "accepted", tx_hash };
    });
    await expect(client.broadcastOnce(transaction, {
      deadline_at_ms: Date.now() - 1,
    })).rejects.toThrow(/bounded future window/i);
    expect(invoked).toBe(false);
  });

  test("maps every thrown post-invocation error to ambiguous", async () => {
    const errors = [
      new Error("socket broke after write"),
      new ZeroneAdapterError(
        "transport_mismatch",
        "provider claimed a mismatched response",
      ),
      new ZeroneAdapterError(
        "response_too_large",
        "provider response exceeded its bound",
      ),
    ];
    const expectedCodes = [
      "transport_error",
      "transport_mismatch",
      "response_too_large",
    ];
    for (const [index, thrown] of errors.entries()) {
      const result = await clientWithBroadcast(async () => {
        throw thrown;
      }).broadcastOnce(transaction);
      expect(result).toEqual({
        status: "ambiguous",
        tx_hash: transaction.tx_hash,
        code: expectedCodes[index],
      });
    }
  });

  test("maps malformed, wrong-hash, and oversized returned data to ambiguous", async () => {
    const wrongHash = "A".repeat(64);
    const malformed: readonly unknown[] = [
      { status: "accepted", tx_hash: wrongHash },
      { status: "accepted" },
      { status: "accepted", tx_hash: transaction.tx_hash, extra: true },
      {
        status: "impossible",
        tx_hash: transaction.tx_hash,
        code: "bad_status",
      },
      {
        status: "ambiguous",
        tx_hash: transaction.tx_hash,
        code: 7,
      },
    ];
    for (const value of malformed) {
      const result = await clientWithBroadcast(
        async () => value as never,
      ).broadcastOnce(transaction);
      expect(result).toEqual({
        status: "ambiguous",
        tx_hash: transaction.tx_hash,
        code: "transport_mismatch",
      });
    }

    const oversized = {
      status: "ambiguous",
      tx_hash: transaction.tx_hash,
      code: "x".repeat(ZERONE_LIMITS.max_transport_response_bytes + 1),
    };
    const result = await clientWithBroadcast(
      async () => oversized,
    ).broadcastOnce(transaction);
    expect(result).toEqual({
      status: "ambiguous",
      tx_hash: transaction.tx_hash,
      code: "response_too_large",
    });
  });
});

describe("lookup evidence and sticky submission uncertainty", () => {
  const txHash = "B".repeat(64);
  const absent: ZeroneTransactionLookup = {
    status: "absent",
    tx_hash: txHash,
    observed_at_height: "700002",
  };
  const unavailable: ZeroneTransactionLookup = {
    status: "unavailable",
    tx_hash: txHash,
    code: "provider_unavailable",
  };

  test("absence and unavailability remain non-authorizing", () => {
    expect(zeroneLookupToWallet(absent, "testnet")).toEqual({
      status: "absent",
    });
    expect(zeroneLookupToWallet(unavailable, "testnet")).toEqual({
      status: "unavailable",
      code: "provider_unavailable",
    });
    const unknown: OperationState = {
      status: "submission_unknown",
      updated_at: "2026-07-05T20:33:00.000Z",
      operation_id: txHash,
    };
    expect(reconcileSubmissionUnknown(
      unknown,
      zeroneLookupToWallet(absent, "testnet"),
      "2026-07-05T20:34:00.000Z",
    )).toBe(unknown);
    expect(reconcileSubmissionUnknown(
      unknown,
      zeroneLookupToWallet(unavailable, "testnet"),
      "2026-07-05T20:34:00.000Z",
    )).toBe(unknown);
  });

  test("requires code zero and one committed block after inclusion", () => {
    const base = {
      status: "found" as const,
      tx_hash: txHash,
      height: "700001",
      codespace: "",
      block_hash: "C".repeat(64),
    };
    expect(zeroneLookupToWallet({
      ...base,
      code: 0,
      observed_at_height: "700001",
    }, "testnet")).toEqual({
      status: "found",
      operation_id: txHash,
      confirmed: false,
    });
    expect(zeroneLookupToWallet({
      ...base,
      code: 0,
      observed_at_height: "700002",
    }, "testnet")).toEqual({
      status: "found",
      operation_id: txHash,
      confirmed: true,
    });
    expect(zeroneLookupToWallet({
      ...base,
      code: 12,
      observed_at_height: "700002",
    }, "testnet")).toEqual({
      status: "found",
      operation_id: txHash,
      confirmed: false,
    });
  });

  test("validates lookup block hashes as exact uppercase evidence", async () => {
    const client = createZeroneAdapterClient({
      network: "testnet",
      query: queryTransport(async ({ tx_hash }) => ({
        status: "found",
        tx_hash,
        height: "700001",
        observed_at_height: "700002",
        code: 0,
        codespace: "",
        block_hash: "c".repeat(64),
      })),
      simulation: unusedSimulation,
      broadcast: {
        async broadcast_once({ tx_hash }) {
          return { status: "accepted", tx_hash };
        },
      },
    });
    await expect(client.lookupTransaction(txHash)).rejects.toThrow(
      /64 uppercase hexadecimal/i,
    );
  });

  test("preserves the precomputed hash in Wallet broadcast mapping", () => {
    expect(zeroneBroadcastResultToWallet({
      status: "ambiguous",
      tx_hash: txHash,
      code: "deadline_exceeded",
    })).toEqual({
      status: "ambiguous",
      operation_id: txHash,
    });
  });
});
