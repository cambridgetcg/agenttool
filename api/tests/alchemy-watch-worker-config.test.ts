import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  alchemyNotifyConfig,
  alchemyDepositWatchTargetFingerprint,
  alchemyDepositWatchTargetFromEnv,
  parseAlchemyWatchDisabledChains,
  parseAlchemyWatchTargetRevision,
} from "../src/services/economy/crypto/alchemy-notify";
import {
  DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT,
} from "../src/services/economy/crypto/deposit-watch";
import {
  alchemyDepositWatchConfigFromEnv,
  alchemyDepositWatchWorkerConfigFromEnv,
} from "../src/workers/deposit-watch/alchemy";

const TOKEN = "obvious-test-notify-token-not-a-credential";

describe("Alchemy deposit-watch worker composition", () => {
  test("requires an active target plus its Notify token and explicit HTTPS origin", () => {
    expect(
      alchemyDepositWatchConfigFromEnv(
        {
          AGENTTOOL_PUBLIC_URL: "https://api.example",
          ALCHEMY_WEBHOOK_ID_BASE: "wh_base_fixture",
        },
        "testnet",
      ),
    ).toBeNull();
    expect(
      alchemyDepositWatchConfigFromEnv(
        {
          ALCHEMY_NOTIFY_AUTH_TOKEN: TOKEN,
          ALCHEMY_WEBHOOK_ID_BASE: "wh_base_fixture",
        },
        "testnet",
      ),
    ).toBeNull();
    expect(
      alchemyDepositWatchConfigFromEnv(
        {
          ALCHEMY_NOTIFY_AUTH_TOKEN: TOKEN,
          AGENTTOOL_PUBLIC_URL: "http://localhost:3000",
          ALCHEMY_WEBHOOK_ID_BASE: "wh_base_fixture",
        },
        "testnet",
      ),
    ).toBeNull();
  });

  test("scopes existing chain webhook IDs to only the active network", () => {
    const config = alchemyDepositWatchConfigFromEnv(
      {
        ALCHEMY_NOTIFY_AUTH_TOKEN: TOKEN,
        AGENTTOOL_PUBLIC_URL: "https://api.example",
        ALCHEMY_WEBHOOK_ID_BASE: "wh_base_fixture",
        ALCHEMY_WEBHOOK_ID_ETHEREUM: "wh_eth_fixture",
        // Unrelated provider/API credentials must not become config output.
        ALCHEMY_API_KEY: "unrelated-key",
        ALCHEMY_WEBHOOK_SIGNING_KEY_BASE: "unrelated-signing-key",
      },
      "testnet",
    );

    expect(config).toEqual({
      authToken: TOKEN,
      callbackBaseUrl: "https://api.example",
      webhookIds: {
        ethereum: { testnet: "wh_eth_fixture" },
        base: { testnet: "wh_base_fixture" },
      },
      targetRevision: 1,
    });
    expect(JSON.stringify(config)).not.toContain("unrelated");
    expect(config?.webhookIds.base?.mainnet).toBeUndefined();
  });

  test("builds exact active bindings and explicit disabled tombstones", () => {
    const env: NodeJS.ProcessEnv = {
      ALCHEMY_NOTIFY_AUTH_TOKEN: TOKEN,
      AGENTTOOL_PUBLIC_URL: "https://api.example",
      ALCHEMY_WEBHOOK_ID_BASE: "wh_base_fixture",
      // A disabled chain may retain its ID so ingress can authenticate
      // deliveries for addresses that were registered before the tombstone.
      ALCHEMY_WEBHOOK_ID_POLYGON: "wh_polygon_previous",
      ALCHEMY_WATCH_TARGET_REVISION: "7",
      ALCHEMY_WATCH_DISABLED_CHAINS: "polygon,optimism",
    };
    const config = alchemyDepositWatchWorkerConfigFromEnv(env, "testnet");
    const target = alchemyDepositWatchTargetFromEnv(
      "base",
      "testnet",
      env,
    );

    expect(target).not.toBeNull();
    expect(config).toEqual({
      reconcilerConfig: {
        authToken: TOKEN,
        callbackBaseUrl: "https://api.example",
        webhookIds: {
          base: { testnet: "wh_base_fixture" },
        },
        targetRevision: 7,
      },
      targetBindings: [
        {
          provider: "alchemy",
          chain: "base",
          network: "testnet",
          state: "active",
          targetFingerprint: target?.fingerprint,
          targetRevision: 7,
        },
        {
          provider: "alchemy",
          chain: "polygon",
          network: "testnet",
          state: "disabled",
          targetFingerprint: DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT,
          targetRevision: 7,
        },
        {
          provider: "alchemy",
          chain: "optimism",
          network: "testnet",
          state: "disabled",
          targetFingerprint: DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT,
          targetRevision: 7,
        },
      ],
      claimTargets: [
        {
          provider: "alchemy",
          chain: "base",
          network: "testnet",
          state: "active",
          targetFingerprint: target?.fingerprint,
          targetRevision: 7,
        },
      ],
      targetRevision: 7,
    });
  });

  test("allows credential-free disabled-only preparation but no claims", () => {
    expect(
      alchemyDepositWatchWorkerConfigFromEnv(
        {
          ALCHEMY_WATCH_TARGET_REVISION: "4",
          ALCHEMY_WATCH_DISABLED_CHAINS: "base",
        },
        "mainnet",
      ),
    ).toEqual({
      reconcilerConfig: null,
      targetBindings: [
        {
          provider: "alchemy",
          chain: "base",
          network: "mainnet",
          state: "disabled",
          targetFingerprint: DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT,
          targetRevision: 4,
        },
      ],
      claimTargets: [],
      targetRevision: 4,
    });
  });

  test("rejects ambiguous or malformed target rollout configuration", () => {
    const baseEnv: NodeJS.ProcessEnv = {
      ALCHEMY_NOTIFY_AUTH_TOKEN: TOKEN,
      AGENTTOOL_PUBLIC_URL: "https://api.example",
      ALCHEMY_WEBHOOK_ID_BASE: "wh_base_fixture",
    };
    for (const overrides of [
      {
        ALCHEMY_WATCH_TARGET_REVISION: "0",
      },
      {
        ALCHEMY_WATCH_TARGET_REVISION: "01",
      },
      {
        ALCHEMY_WATCH_TARGET_REVISION: "2147483648",
      },
      {
        ALCHEMY_WATCH_DISABLED_CHAINS: "base,base",
      },
      {
        ALCHEMY_WATCH_DISABLED_CHAINS: "base, polygon",
      },
      {
        ALCHEMY_WATCH_DISABLED_CHAINS: "solana",
      },
    ]) {
      expect(
        alchemyDepositWatchWorkerConfigFromEnv(
          { ...baseEnv, ...overrides },
          "testnet",
        ),
      ).toBeNull();
    }

    expect(parseAlchemyWatchTargetRevision(undefined)).toBe(1);
    expect(parseAlchemyWatchTargetRevision("7")).toBe(7);
    expect(parseAlchemyWatchDisabledChains("")).toEqual([]);
    expect(parseAlchemyWatchDisabledChains("optimism,base")).toEqual([
      "base",
      "optimism",
    ]);
  });

  test("lets a disabled chain retain its webhook identity for signed ingress", () => {
    const env: NodeJS.ProcessEnv = {
      ALCHEMY_WEBHOOK_ID_BASE: "wh_base_previous",
      ALCHEMY_WATCH_DISABLED_CHAINS: "base",
      ALCHEMY_WATCH_TARGET_REVISION: "5",
    };

    expect(
      alchemyDepositWatchWorkerConfigFromEnv(env, "testnet"),
    ).toEqual({
      reconcilerConfig: null,
      targetBindings: [
        {
          provider: "alchemy",
          chain: "base",
          network: "testnet",
          state: "disabled",
          targetFingerprint: DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT,
          targetRevision: 5,
        },
      ],
      claimTargets: [],
      targetRevision: 5,
    });
    expect(alchemyDepositWatchTargetFromEnv("base", "testnet", env))
      .toBeNull();
    expect(alchemyNotifyConfig(env).webhookIds.base).toBe(
      "wh_base_previous",
    );
  });

  test("fingerprint v2 binds public type and active-state constants, not credentials", () => {
    const env: NodeJS.ProcessEnv = {
      ALCHEMY_NOTIFY_AUTH_TOKEN: TOKEN,
      AGENTTOOL_PUBLIC_URL: "https://api.example",
      ALCHEMY_WEBHOOK_ID_BASE: "wh_base_fixture",
      ALCHEMY_WATCH_TARGET_REVISION: "9",
    };
    const target = alchemyDepositWatchTargetFromEnv(
      "base",
      "testnet",
      env,
    );
    const tokenRotated = alchemyDepositWatchTargetFromEnv(
      "base",
      "testnet",
      {
        ...env,
        ALCHEMY_NOTIFY_AUTH_TOKEN: "another-obvious-test-token",
      },
    );
    const independentlyCanonical = JSON.stringify({
      schema: "agenttool-deposit-watch-target/v2",
      provider: "alchemy",
      chain: "base",
      network: "testnet",
      provider_network: "BASE_SEPOLIA",
      provider_target_id: "wh_base_fixture",
      provider_target_type: "ADDRESS_ACTIVITY",
      provider_target_active: true,
      callback_url:
        "https://api.example/v1/billing/crypto-webhook/base",
    });
    const expected = createHash("sha256")
      .update(independentlyCanonical, "utf8")
      .digest("hex");

    expect(target).toEqual({ fingerprint: expected, revision: 9 });
    expect(tokenRotated).toEqual(target);
    expect(JSON.stringify(target)).not.toContain(TOKEN);
    expect(
      alchemyDepositWatchTargetFingerprint({
        chain: "base",
        network: "testnet",
        webhookId: "wh_base_fixture_next",
        callbackBaseUrl: "https://api.example",
      }),
    ).not.toBe(target?.fingerprint);
  });

  test("is mounted only inside the global no-workers gate", () => {
    const source = readFileSync(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    const mount = source.indexOf(
      'import("./workers/deposit-watch/alchemy")',
    );
    const precedingGate = source.lastIndexOf(
      'if (!envFlag("AGENTTOOL_DISABLE_WORKERS"))',
      mount,
    );

    expect(mount).toBeGreaterThan(-1);
    expect(precedingGate).toBeGreaterThan(-1);
    expect(mount - precedingGate).toBeLessThan(1_500);
  });
});
