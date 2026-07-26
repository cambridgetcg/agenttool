import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";

import {
  cryptoWebhookEvents,
  depositAddresses,
} from "../src/db/schema/economy";
import {
  depositAddressMatches,
  getOrCreateDepositAddress,
} from "../src/services/economy/crypto";

describe("Alchemy deposit identity invariants", () => {
  test("accepts EVM checksum presentation but requires the exact derivation path", () => {
    const derived = {
      address: "0x00000000000000000000000000000000000000aA",
      derivation_path: "m/44'/60'/0'/0/7",
    };

    expect(
      depositAddressMatches(
        "base",
        {
          address: derived.address.toLowerCase(),
          derivationPath: derived.derivation_path,
        },
        derived,
      ),
    ).toBe(true);
    expect(
      depositAddressMatches(
        "base",
        {
          address: derived.address,
          derivationPath: "m/44'/60'/0'/0/8",
        },
        derived,
      ),
    ).toBe(false);
  });

  test("keeps non-EVM address identity case-sensitive", () => {
    expect(
      depositAddressMatches(
        "solana",
        { address: "Abc", derivationPath: "m/44'/501'/1'/0'" },
        { address: "abc", derivation_path: "m/44'/501'/1'/0'" },
      ),
    ).toBe(false);
  });

  test("rejects unsupported tokens before any database or provider work", async () => {
    await expect(
      getOrCreateDepositAddress(
        "00000000-0000-0000-0000-000000000001",
        "base",
        "DAI",
      ),
    ).rejects.toThrow("Only USDC");
  });

  test("declares one logical row per wallet, chain, and token", () => {
    const table = getTableConfig(depositAddresses);
    const identity = table.indexes.find(
      (index) => index.config.name === "uq_deposit_wallet_chain_token",
    );

    expect(identity?.config.unique).toBe(true);
    expect(
      identity?.config.columns.map((column) =>
        "name" in column ? column.name : null,
      ),
    ).toEqual(["wallet_id", "chain", "token"]);
  });

  test("indexes canonical EVM address identity without changing Solana case semantics", () => {
    const table = getTableConfig(depositAddresses);
    const canonicalEvmIdentity = table.indexes.find(
      (index) => index.config.name === "idx_deposit_evm_chain_addr_ci",
    );

    expect(canonicalEvmIdentity?.config.unique).toBe(true);
    expect(canonicalEvmIdentity?.config.where).toBeDefined();
  });

  test("requires a non-null provider log identity for webhook deduplication", () => {
    expect(cryptoWebhookEvents.logIndex.notNull).toBe(true);
  });

  test("persists desired watch state instead of mutating Alchemy on the request path", () => {
    const source = readFileSync(
      new URL("../src/services/economy/crypto/index.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf(
      "export async function getOrCreateDepositAddress",
    );
    const end = source.indexOf("export async function listDepositAddresses");
    const issuance = source.slice(start, end);

    expect(issuance).toContain("persistDepositAddressAndDesiredWatch");
    expect(issuance).not.toContain("ensureAlchemyAddressWatched");
    expect(issuance.indexOf('watch.status !== "converged"')).toBeGreaterThan(
      issuance.indexOf("persistDepositAddressAndDesiredWatch"),
    );
  });
});
