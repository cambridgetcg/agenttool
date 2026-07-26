import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";

import {
  cryptoWebhookEvents,
  depositAddresses,
} from "../src/db/schema/economy";
import {
  DepositWatchNotReadyError,
  depositAddressMatches,
  evmDepositWatchTargetForDisclosure,
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

  test("requires the exact chain ingress signing-key presence before disclosure", () => {
    const env = {
      AGENTTOOL_PUBLIC_URL: "https://agenttool.example",
      ALCHEMY_WEBHOOK_ID_BASE: "wh_public_base_target",
    };

    try {
      evmDepositWatchTargetForDisclosure(
        "base",
        "testnet",
        env,
        false,
      );
      throw new Error("expected disclosure readiness refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(DepositWatchNotReadyError);
      expect((error as DepositWatchNotReadyError).code).toBe(
        "deposit_ingress_signing_key_missing",
      );
      expect((error as DepositWatchNotReadyError).retryable).toBe(false);
    }

    expect(() =>
      evmDepositWatchTargetForDisclosure(
        "ethereum",
        "testnet",
        env,
        true,
      ),
    ).toThrow(DepositWatchNotReadyError);
  });

  test("target identity changes only with public target configuration", () => {
    const common = {
      AGENTTOOL_PUBLIC_URL: "https://agenttool.example",
      ALCHEMY_WEBHOOK_ID_BASE: "wh_public_base_target",
    };
    const first = evmDepositWatchTargetForDisclosure(
      "base",
      "testnet",
      {
        ...common,
        ALCHEMY_NOTIFY_AUTH_TOKEN: "first-control-secret",
        ALCHEMY_WEBHOOK_SIGNING_KEY_BASE: "first-ingress-secret",
      },
      true,
    );
    const secretRotation = evmDepositWatchTargetForDisclosure(
      "base",
      "testnet",
      {
        ...common,
        ALCHEMY_NOTIFY_AUTH_TOKEN: "second-control-secret",
        ALCHEMY_WEBHOOK_SIGNING_KEY_BASE: "second-ingress-secret",
      },
      true,
    );
    const targetRotation = evmDepositWatchTargetForDisclosure(
      "base",
      "testnet",
      {
        ...common,
        ALCHEMY_WEBHOOK_ID_BASE: "wh_replaced_public_base_target",
      },
      true,
    );
    const revisionRotation = evmDepositWatchTargetForDisclosure(
      "base",
      "testnet",
      {
        ...common,
        ALCHEMY_WATCH_TARGET_REVISION: "2",
      },
      true,
    );

    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.revision).toBe(1);
    expect(secretRotation).toEqual(first);
    expect(targetRotation.fingerprint).not.toBe(first.fingerprint);
    expect(revisionRotation).toEqual({
      fingerprint: first.fingerprint,
      revision: 2,
    });
  });

  test("an explicit disable takes precedence while the ingress ID can remain", () => {
    const common = {
      AGENTTOOL_PUBLIC_URL: "https://agenttool.example",
      ALCHEMY_WATCH_DISABLED_CHAINS: "base",
    };

    expect(() =>
      evmDepositWatchTargetForDisclosure(
        "base",
        "testnet",
        common,
        true,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "deposit_watch_target_disabled",
        retryable: false,
      }),
    );
    expect(() =>
      evmDepositWatchTargetForDisclosure(
        "base",
        "testnet",
        {
          ...common,
          ALCHEMY_WEBHOOK_ID_BASE: "wh_public_base_target",
        },
        true,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "deposit_watch_target_disabled",
        retryable: false,
      }),
    );
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
    expect(issuance.indexOf("depositWatchProjectionIsReady")).toBeGreaterThan(
      issuance.indexOf("persistDepositAddressAndDesiredWatch"),
    );
    expect(issuance).not.toContain(
      "targetFingerprint: evmWatch",
    );
  });
});
