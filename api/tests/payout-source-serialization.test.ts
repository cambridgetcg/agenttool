import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/workers/payout/broadcast-worker.ts", import.meta.url),
  "utf8",
);

describe("payout source serialization", () => {
  test("EVM locks a namespaced chain/source and persists nonce evidence", () => {
    const evmStart = source.indexOf("async function processEvmPayout");
    const solanaStart = source.indexOf("async function processSolanaPayout");
    const branch = source.slice(evmStart, solanaStart);

    const scope = branch.indexOf("evmPayoutNonceScope");
    const lock = branch.indexOf("pg_advisory_xact_lock", scope);
    const unresolved = branch.indexOf(
      'eq(cryptoPayouts.status, "broadcasting")',
      lock,
    );
    const signing = branch.indexOf("buildAndSignUsdcTransfer", unresolved);
    const evidence = branch.indexOf("evmPayoutNonceEvidence", signing);
    const persist = branch.indexOf("...nonceEvidence", evidence);

    expect(scope).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(scope);
    expect(unresolved).toBeGreaterThan(lock);
    expect(signing).toBeGreaterThan(unresolved);
    expect(evidence).toBeGreaterThan(signing);
    expect(persist).toBeGreaterThan(evidence);
    expect(branch).toContain("nonceScope.advisoryLockKey");
    expect(branch).toContain('reason: "source_nonce_unresolved"');
  });

  test("Solana serializes signing and binds the payout operation identity", () => {
    const branch = source.slice(
      source.indexOf("async function processSolanaPayout"),
    );
    const lock = branch.indexOf("pg_advisory_xact_lock");
    const signing = branch.indexOf("buildAndSignSolanaUsdcTransfer");
    const persist = branch.indexOf('status: "broadcasting"');

    expect(lock).toBeGreaterThan(-1);
    expect(signing).toBeGreaterThan(lock);
    expect(persist).toBeGreaterThan(signing);
    expect(branch).toContain("payoutId: row.id");
  });

  test("both Phase 1 CASes bind the active durable network", () => {
    const evmStart = source.indexOf("async function processEvmPayout");
    const solanaStart = source.indexOf("async function processSolanaPayout");
    const branches = [
      source.slice(evmStart, solanaStart),
      source.slice(solanaStart),
    ];

    for (const branch of branches) {
      expect(branch).toContain("row.network !== workerNetwork");
      expect(branch).toContain(
        "eq(cryptoPayouts.network, workerNetwork)",
      );
    }
  });
});
