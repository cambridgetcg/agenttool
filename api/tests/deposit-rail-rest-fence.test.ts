/** The crypto deposit rail rests behind a refuse-only production fence
 *  (owner decision, 2026-10-11).
 *
 *  - GET /v1/wallets/:id/deposit-address refuses before any wallet lookup,
 *    deposit-row read, derivation, or network selection, so no address is
 *    disclosed, new or previously issued.
 *  - A production runtime (NODE_ENV=production or FLY_APP_NAME set) never
 *    credits testnet deposit evidence and refuses the development-only
 *    CRYPTO_WEBHOOK_ALLOW_UNSIGNED and
 *    CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS escape hatches.
 *  - Solana addresses are withheld unless the unreconciled adapter and
 *    HELIUS_WEBHOOK_SECRET are both configured.
 *
 *  Every case resolves before database or provider I/O. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { readFileSync } from "node:fs";

import type { ProjectContext } from "../src/auth/middleware";
import { isProductionOrFlyRuntime } from "../src/lib/production-runtime";
import {
  depositAddressDisclosureAllowed,
  economyConfig,
  unreconciledSolanaDepositsAllowed,
  unsignedDepositWebhooksAllowed,
} from "../src/services/economy/config";
import {
  DEPOSIT_ADDRESS_DISCLOSURE_RESTING_ERROR,
  getOrCreateDepositAddress,
  SolanaDepositUnavailableError,
} from "../src/services/economy/crypto";
import { USDC_ATOMIC_PER_CREDIT } from "../src/services/economy/crypto/inbound-deposits";
import {
  activeUsdcMintSolana,
  assertEvmDepositCreditSupported,
  EvmDepositSettlementPolicyError,
  evmDepositCreditPolicy,
} from "../src/services/economy/crypto/network";

const cfg = economyConfig as unknown as {
  heliusWebhookSecret: string;
  allowUnsignedWebhooks: boolean;
  allowUnreconciledSolanaDeposits: boolean;
  cryptoNetwork: "" | "testnet" | "mainnet";
  alchemyWebhookSigningKeys: Record<string, string>;
  payout: { network: string; cryptoHdMnemonicTestnet: string };
};
const original = {
  helius: cfg.heliusWebhookSecret,
  allowUnsigned: cfg.allowUnsignedWebhooks,
  allowUnreconciledSolana: cfg.allowUnreconciledSolanaDeposits,
  cryptoNetwork: cfg.cryptoNetwork,
  ethereumKey: cfg.alchemyWebhookSigningKeys.ethereum,
  payoutNetwork: cfg.payout.network,
  testnetMnemonic: cfg.payout.cryptoHdMnemonicTestnet,
  nodeEnv: process.env.NODE_ENV,
  flyAppName: process.env.FLY_APP_NAME,
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Each case starts outside production and opts in explicitly. */
beforeEach(() => {
  process.env.NODE_ENV = "test";
  delete process.env.FLY_APP_NAME;
  cfg.cryptoNetwork = "mainnet";
  cfg.payout.network = "";
  cfg.allowUnsignedWebhooks = false;
  cfg.allowUnreconciledSolanaDeposits = false;
  cfg.heliusWebhookSecret = "";
});

afterEach(() => {
  cfg.heliusWebhookSecret = original.helius;
  cfg.allowUnsignedWebhooks = original.allowUnsigned;
  cfg.allowUnreconciledSolanaDeposits = original.allowUnreconciledSolana;
  cfg.cryptoNetwork = original.cryptoNetwork;
  cfg.alchemyWebhookSigningKeys.ethereum = original.ethereumKey;
  cfg.payout.network = original.payoutNetwork;
  cfg.payout.cryptoHdMnemonicTestnet = original.testnetMnemonic;
  restoreEnv("NODE_ENV", original.nodeEnv);
  restoreEnv("FLY_APP_NAME", original.flyAppName);
});

const PRODUCTION_RUNTIMES = [
  {
    name: "NODE_ENV=production",
    enter: () => {
      process.env.NODE_ENV = "production";
    },
  },
  {
    name: "FLY_APP_NAME set",
    enter: () => {
      process.env.FLY_APP_NAME = "agenttool-live";
    },
  },
] as const;

const { default: cryptoRouter, createCryptoWebhookRouter } = await import(
  "../src/routes/economy/crypto"
);

const WALLET_ID = "00000000-0000-4000-8000-000000000001";

describe("the shared production predicate", () => {
  test("is false outside production and true for either runtime signal", () => {
    expect(isProductionOrFlyRuntime()).toBe(false);
    for (const runtime of PRODUCTION_RUNTIMES) {
      process.env.NODE_ENV = "test";
      delete process.env.FLY_APP_NAME;
      runtime.enter();
      expect(isProductionOrFlyRuntime(), runtime.name).toBe(true);
    }
  });
});

describe("testnet deposit credit in a production runtime", () => {
  test("is allowed only outside production", () => {
    expect(evmDepositCreditPolicy("base", "testnet")).toEqual({
      allowed: true,
    });
  });

  for (const runtime of PRODUCTION_RUNTIMES) {
    test(`is refused on every chain when ${runtime.name}`, () => {
      runtime.enter();
      for (const chain of [
        "ethereum",
        "base",
        "polygon",
        "arbitrum",
        "optimism",
      ] as const) {
        expect(evmDepositCreditPolicy(chain, "testnet")).toEqual({
          allowed: false,
          reason: "testnet_credit_refused_in_production",
        });
      }
      // Mainnet policy is unchanged by the fence.
      expect(evmDepositCreditPolicy("ethereum", "mainnet")).toEqual({
        allowed: true,
      });
      expect(evmDepositCreditPolicy("base", "mainnet")).toEqual({
        allowed: false,
        reason: "mainnet_settlement_policy_unavailable",
      });
    });

    test(`withholds testnet addresses when ${runtime.name}`, () => {
      runtime.enter();
      cfg.cryptoNetwork = "testnet";
      try {
        assertEvmDepositCreditSupported("base");
        throw new Error("expected the testnet refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(EvmDepositSettlementPolicyError);
        expect((error as EvmDepositSettlementPolicyError).reason).toBe(
          "testnet_credit_refused_in_production",
        );
        expect((error as Error).message).toContain("production runtime");
      }
    });
  }
});

describe("development-only webhook escape hatches in a production runtime", () => {
  test("both apply outside production when set", () => {
    cfg.allowUnsignedWebhooks = true;
    cfg.allowUnreconciledSolanaDeposits = true;
    expect(unsignedDepositWebhooksAllowed()).toBe(true);
    expect(unreconciledSolanaDepositsAllowed()).toBe(true);
  });

  for (const runtime of PRODUCTION_RUNTIMES) {
    test(`CRYPTO_WEBHOOK_ALLOW_UNSIGNED is refused when ${runtime.name}`, async () => {
      runtime.enter();
      cfg.allowUnsignedWebhooks = true;
      cfg.heliusWebhookSecret = "";
      cfg.alchemyWebhookSigningKeys.ethereum = "";
      expect(unsignedDepositWebhooksAllowed()).toBe(false);

      let ingestionCalls = 0;
      const router = createCryptoWebhookRouter(async () => {
        ingestionCalls += 1;
        return { matched: true };
      });
      for (const [chain, body] of [
        ["solana", []],
        ["ethereum", { event: { activity: [] } }],
      ] as const) {
        const res = await router.request(`/${chain}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(res.status, chain).toBe(503);
        expect(await res.json()).toMatchObject({
          error: "webhook_secret_unset",
        });
      }
      expect(ingestionCalls).toBe(0);
    });

    test(`CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS is refused when ${runtime.name}`, async () => {
      runtime.enter();
      cfg.allowUnreconciledSolanaDeposits = true;
      cfg.heliusWebhookSecret = "s3cret";
      expect(unreconciledSolanaDepositsAllowed()).toBe(false);

      let ingestionCalls = 0;
      const router = createCryptoWebhookRouter(async () => {
        ingestionCalls += 1;
        return { matched: true };
      });
      const res = await router.request("/solana", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "s3cret",
        },
        body: JSON.stringify([
          {
            signature: "production-runtime-transfer",
            tokenTransfers: [
              {
                mint: activeUsdcMintSolana(),
                tokenAmount: 1,
                toUserAccount: "solana-recipient",
              },
            ],
          },
        ]),
      });

      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({
        error: "solana_deposit_finality_unavailable",
        consequence: "No wallet balance or deposit event was changed.",
      });
      expect(ingestionCalls).toBe(0);
    });
  }
});

describe("Solana deposit-address withholding", () => {
  async function solanaDisclosureError(): Promise<unknown> {
    try {
      await getOrCreateDepositAddress(WALLET_ID, "solana", "USDC");
    } catch (error) {
      return error;
    }
    throw new Error("expected Solana disclosure to stop before any address");
  }

  test.each([
    ["neither the opt-in nor the secret", false, ""],
    ["the opt-in without HELIUS_WEBHOOK_SECRET", true, ""],
    ["HELIUS_WEBHOOK_SECRET without the opt-in", false, "s3cret"],
    ["a whitespace-only secret", true, "   "],
  ])("withholds the address with %s", async (_label, optIn, secret) => {
    cfg.allowUnreconciledSolanaDeposits = optIn;
    cfg.heliusWebhookSecret = secret;
    const error = await solanaDisclosureError();
    expect(error).toBeInstanceOf(SolanaDepositUnavailableError);
    expect((error as SolanaDepositUnavailableError).code).toBe(
      "solana_deposit_finality_unavailable",
    );
  });

  for (const runtime of PRODUCTION_RUNTIMES) {
    test(`withholds the address with both configured when ${runtime.name}`, async () => {
      runtime.enter();
      cfg.allowUnreconciledSolanaDeposits = true;
      cfg.heliusWebhookSecret = "s3cret";
      expect(await solanaDisclosureError()).toBeInstanceOf(
        SolanaDepositUnavailableError,
      );
    });
  }

  test("passes the gate only with both configured outside production", async () => {
    cfg.allowUnreconciledSolanaDeposits = true;
    cfg.heliusWebhookSecret = "s3cret";
    cfg.cryptoNetwork = "testnet";
    cfg.payout.cryptoHdMnemonicTestnet = "";
    // The next step is derivation, which needs the network root; reaching it
    // proves the Solana gate opened without touching the database.
    const error = await solanaDisclosureError();
    expect(error).not.toBeInstanceOf(SolanaDepositUnavailableError);
    expect((error as Error).message).toContain(
      "CRYPTO_HD_MNEMONIC_TESTNET is unset",
    );
  });
});

describe("GET /v1/wallets/:id/deposit-address rests", () => {
  async function get(path: string) {
    const server = new Hono<ProjectContext>();
    server.use("*", async (c, next) => {
      c.set("project", { id: "00000000-0000-4000-8000-0000000000aa" } as never);
      await next();
    });
    server.route("/v1", cryptoRouter);
    const res = await server.request(path);
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  }

  test("no environment flag reopens disclosure", () => {
    cfg.allowUnsignedWebhooks = true;
    cfg.allowUnreconciledSolanaDeposits = true;
    cfg.heliusWebhookSecret = "s3cret";
    cfg.cryptoNetwork = "testnet";
    expect(depositAddressDisclosureAllowed()).toBe(false);
  });

  test.each([
    `/v1/wallets/${WALLET_ID}/deposit-address`,
    `/v1/wallets/${WALLET_ID}/deposit-address?chain=ethereum&token=USDC`,
    `/v1/wallets/${WALLET_ID}/deposit-address?chain=base`,
    `/v1/wallets/${WALLET_ID}/deposit-address?chain=solana`,
    `/v1/wallets/${WALLET_ID}/deposit-address?chain=base&token=DAI`,
  ])("refuses %s before any wallet or address read", async (path) => {
    // With both Solana settings present and a selected network, the resting
    // refusal still comes first. No database is configured here, so reaching
    // a wallet or deposit-row read would not produce this refusal.
    cfg.allowUnreconciledSolanaDeposits = true;
    cfg.heliusWebhookSecret = "s3cret";
    cfg.cryptoNetwork = "mainnet";

    const { status, body } = await get(path);

    expect(status).toBe(503);
    expect(body).toMatchObject({
      error: DEPOSIT_ADDRESS_DISCLOSURE_RESTING_ERROR,
      deposit_address_disclosure: "resting",
      retryable: false,
    });
    expect(body.error).toBe("deposit_address_disclosure_resting");
    expect(String(body.message)).toContain(
      "No deposit address, new or previously issued, was created, derived, or disclosed.",
    );
    for (const key of [
      "address",
      "addresses",
      "derivation_path",
      "contract_address",
      "instructions",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });
});

describe("EVM deposit instructions", () => {
  test("state the 0.01 USDC granularity that the credit boundary enforces", () => {
    expect(USDC_ATOMIC_PER_CREDIT).toBe(10_000n);
    const route = readFileSync(
      new URL("../src/routes/economy/crypto.ts", import.meta.url),
      "utf8",
    );
    expect(route).toContain(
      "in whole multiples of 0.01 USDC: one credit is 0.01 USDC (10,000 atomic units), and a deposit with any remainder is quarantined in full, with no wallet credit and no refund route.",
    );
  });
});
