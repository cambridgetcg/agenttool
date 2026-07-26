import { describe, expect, test } from "bun:test";

import {
  alchemyAddressActivityNetwork,
  alchemyNotifyConfig,
} from "../src/services/economy/crypto/alchemy-notify";

const SENTINEL_TOKEN = "obvious-test-token-not-a-credential";
const SENTINEL_WEBHOOK = "wh_obvious_test_fixture";

describe("Alchemy Notify configuration", () => {
  test("reads only named Notify configuration", () => {
    const loaded = alchemyNotifyConfig({
      ALCHEMY_NOTIFY_AUTH_TOKEN: SENTINEL_TOKEN,
      ALCHEMY_WEBHOOK_ID_BASE: SENTINEL_WEBHOOK,
    });
    expect(loaded.authToken).toBe(SENTINEL_TOKEN);
    expect(loaded.webhookIds).toEqual({ base: SENTINEL_WEBHOOK });
  });

  test("maps every supported EVM chain to its active Alchemy network", () => {
    expect(alchemyAddressActivityNetwork("ethereum", "mainnet")).toBe(
      "ETH_MAINNET",
    );
    expect(alchemyAddressActivityNetwork("base", "testnet")).toBe(
      "BASE_SEPOLIA",
    );
    expect(alchemyAddressActivityNetwork("polygon", "testnet")).toBe(
      "MATIC_AMOY",
    );
    expect(alchemyAddressActivityNetwork("arbitrum", "mainnet")).toBe(
      "ARB_MAINNET",
    );
    expect(alchemyAddressActivityNetwork("optimism", "testnet")).toBe(
      "OPT_SEPOLIA",
    );
  });
});
