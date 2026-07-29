import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EVM_PAYOUT_NONCE_UNIQUE_INDEX,
  assertSafeEvmNonce,
  evmPayoutNonceEvidence,
  evmPayoutNonceScope,
  isEvmPayoutNonceConflict,
} from "../src/services/economy/crypto/evm-payout-nonce";

const SOURCE = "0xAbCdEf0000000000000000000000000000001234";

describe("durable EVM payout nonce evidence", () => {
  test("canonicalises the exact chain/address lock scope", () => {
    expect(
      evmPayoutNonceScope({
        chainId: 8453,
        sourceAddress: SOURCE,
      }),
    ).toEqual({
      chainId: "8453",
      sourceAddress: SOURCE.toLowerCase(),
      advisoryLockKey:
        `agenttool:payout:evm:8453:${SOURCE.toLowerCase()}`,
    });
  });

  test("builds exact decimal evidence for the broadcasting CAS", () => {
    const scope = evmPayoutNonceScope({
      chainId: 1,
      sourceAddress: SOURCE,
    });
    expect(evmPayoutNonceEvidence({ scope, nonce: 42n })).toEqual({
      evmChainId: "1",
      evmSourceAddress: SOURCE.toLowerCase(),
      evmNonce: "42",
    });
  });

  test("fails closed outside viem's exact number range", () => {
    expect(assertSafeEvmNonce(0n)).toBe(0);
    expect(assertSafeEvmNonce(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    for (const value of [
      -1,
      1.5,
      Number.POSITIVE_INFINITY,
      BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    ]) {
      expect(() => assertSafeEvmNonce(value)).toThrow(
        "evm_nonce_out_of_safe_integer_range",
      );
    }
  });

  test("rejects malformed source scopes", () => {
    expect(() =>
      evmPayoutNonceScope({ chainId: 0, sourceAddress: SOURCE }),
    ).toThrow("evm_chain_id_out_of_safe_integer_range");
    expect(() =>
      evmPayoutNonceScope({ chainId: 1, sourceAddress: "0x1234" }),
    ).toThrow("invalid_evm_source_address");
  });

  test("classifies only the named unique conflict, including wrapped errors", () => {
    expect(
      isEvmPayoutNonceConflict({
        code: "23505",
        constraint_name: EVM_PAYOUT_NONCE_UNIQUE_INDEX,
      }),
    ).toBe(true);
    expect(
      isEvmPayoutNonceConflict({
        cause: {
          code: "23505",
          constraint: EVM_PAYOUT_NONCE_UNIQUE_INDEX,
        },
      }),
    ).toBe(true);
    expect(
      isEvmPayoutNonceConflict({
        code: "23505",
        constraint: "some_other_unique_index",
      }),
    ).toBe(false);
    expect(
      isEvmPayoutNonceConflict({
        code: "22000",
        message: EVM_PAYOUT_NONCE_UNIQUE_INDEX,
      }),
    ).toBe(false);
  });

  test("migration carries the durable tuple and database backstops", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "../migrations/20260726T194500_evm_payout_nonce_fence.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("evm_chain_id NUMERIC(20, 0)");
    expect(migration).toContain("evm_source_address TEXT");
    expect(migration).toContain("evm_nonce NUMERIC(20, 0)");
    expect(migration).toContain("crypto_payouts_evm_nonce_evidence_check");
    expect(migration).toContain(EVM_PAYOUT_NONCE_UNIQUE_INDEX);
    expect(migration).toContain(
      "idx_crypto_payouts_evm_unresolved_source",
    );
    expect(migration).toContain("WHERE status = 'broadcasting'");

    const fenceStart = migration.indexOf(
      "crypto_payouts_evm_broadcasting_evidence_check",
    );
    const fenceEnd = migration.indexOf("CREATE UNIQUE INDEX", fenceStart);
    const fence = migration.slice(fenceStart, fenceEnd);
    expect(fence).toContain("status = 'broadcasting'");
    expect(fence).toContain("tx_hash ~ '^0x[0-9A-Fa-f]{64}$'");
    expect(fence).toContain("evm_chain_id IS NOT NULL");
    expect(fence).toContain("evm_source_address IS NOT NULL");
    expect(fence).toContain("evm_nonce IS NOT NULL");
    expect(fence).toContain("NOT VALID");
  });

  test("worker persists the fence before submit and defers contention", () => {
    const worker = readFileSync(
      join(__dirname, "../src/workers/payout/broadcast-worker.ts"),
      "utf8",
    );
    const phaseOne = worker.indexOf("async function processEvmPayout");
    const unresolvedLookup = worker.indexOf(
      'eq(cryptoPayouts.status, "broadcasting")',
      phaseOne,
    );
    const sign = worker.indexOf("buildAndSignUsdcTransfer", unresolvedLookup);
    const evidence = worker.indexOf("evmPayoutNonceEvidence", sign);
    const persist = worker.indexOf("...nonceEvidence", evidence);
    const phaseTwo = worker.indexOf("// ── Phase 2: submit", persist);

    expect(worker).toContain("nonceScope.advisoryLockKey");
    expect(worker).toContain("source_nonce_unresolved");
    expect(worker).toContain("isNull(cryptoPayouts.evmNonce)");
    expect(unresolvedLookup).toBeGreaterThan(phaseOne);
    expect(sign).toBeGreaterThan(unresolvedLookup);
    expect(evidence).toBeGreaterThan(sign);
    expect(persist).toBeGreaterThan(evidence);
    expect(phaseTwo).toBeGreaterThan(persist);

    const conflict = worker.indexOf("isEvmPayoutNonceConflict(error)");
    const conflictEnd = worker.indexOf("throw error", conflict);
    const conflictBranch = worker.slice(conflict, conflictEnd);
    expect(conflictBranch).toContain("deferRequestedPayout(");
    expect(conflictBranch).toContain("return;");
    expect(conflictBranch).not.toContain("refundPayoutAndFail");
    expect(conflictBranch).not.toContain("submitSignedTx");
  });
});
