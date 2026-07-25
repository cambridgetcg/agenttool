import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { economyConfig } from "../src/services/economy/config";
import {
  activeUsdcAddress,
  evmRpcEndpoint,
  evmRpcTransport,
} from "../src/services/economy/crypto/network";

const TEST_API_KEY = "unit-test-alchemy-key";
const OVERRIDE_ENV = "RPC_URL_ETHEREUM_TESTNET";
const MANAGED_ENV = ["ALCHEMY_API_KEY", OVERRIDE_ENV] as const;

const payoutConfig = economyConfig.payout as unknown as {
  network: "" | "testnet" | "mainnet";
};
const originalNetwork = payoutConfig.network;
let originalEnv: Record<
  (typeof MANAGED_ENV)[number],
  string | undefined
> = {
  ALCHEMY_API_KEY: undefined,
  RPC_URL_ETHEREUM_TESTNET: undefined,
};

beforeEach(() => {
  originalEnv = {
    ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
    RPC_URL_ETHEREUM_TESTNET: process.env[OVERRIDE_ENV],
  };
  payoutConfig.network = "testnet";
  delete process.env.ALCHEMY_API_KEY;
  delete process.env[OVERRIDE_ENV];
});

afterEach(() => {
  payoutConfig.network = originalNetwork;
  for (const name of MANAGED_ENV) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("Alchemy EVM RPC authentication", () => {
  test("keeps the API key out of the URL and applies it as a Bearer header", () => {
    process.env.ALCHEMY_API_KEY = TEST_API_KEY;

    const endpoint = evmRpcEndpoint("ethereum");
    expect(endpoint).toEqual({
      url: "https://eth-sepolia.g.alchemy.com/v2",
      source: "alchemy",
    });
    expect(endpoint.url).not.toContain(TEST_API_KEY);
    expect(JSON.stringify(endpoint)).not.toContain(TEST_API_KEY);

    const configured = evmRpcTransport("ethereum")({
      chain: undefined,
      retryCount: 0,
      timeout: 1_000,
    });
    const headers = configured.value?.fetchOptions?.headers as
      | Record<string, string>
      | undefined;
    expect(configured.value?.url).toBe(endpoint.url);
    expect(headers).toEqual({
      Authorization: `Bearer ${TEST_API_KEY}`,
    });
  });

  test("preserves an exact per-chain override and sends it no Alchemy credential", () => {
    const override = "https://rpc.internal.example/tenant";
    process.env.ALCHEMY_API_KEY = TEST_API_KEY;
    process.env[OVERRIDE_ENV] = override;

    const endpoint = evmRpcEndpoint("ethereum");
    expect(endpoint).toEqual({
      url: override,
      source: "override",
    });

    const configured = evmRpcTransport("ethereum")({
      chain: undefined,
      retryCount: 0,
      timeout: 1_000,
    });
    expect(configured.value?.url).toBe(override);
    expect(configured.value?.fetchOptions).toBeUndefined();
  });

  test("keeps the unauthenticated testnet fallback credential-free", () => {
    const endpoint = evmRpcEndpoint("ethereum");
    expect(endpoint.source).toBe("public-testnet");
    expect(endpoint.url).toBe(
      "https://ethereum-sepolia-rpc.publicnode.com",
    );
  });

  test("resolves the deposit contract from the same active network", () => {
    expect(activeUsdcAddress("base")).toBe(
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    );

    payoutConfig.network = "mainnet";
    expect(activeUsdcAddress("base")).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
  });
});
