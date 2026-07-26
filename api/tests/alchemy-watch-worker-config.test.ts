import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { alchemyDepositWatchConfigFromEnv } from "../src/workers/deposit-watch/alchemy";

const TOKEN = "obvious-test-notify-token-not-a-credential";

describe("Alchemy deposit-watch worker composition", () => {
  test("requires both a Notify token and an explicit HTTPS callback origin", () => {
    expect(
      alchemyDepositWatchConfigFromEnv(
        { AGENTTOOL_PUBLIC_URL: "https://api.example" },
        "testnet",
      ),
    ).toBeNull();
    expect(
      alchemyDepositWatchConfigFromEnv(
        { ALCHEMY_NOTIFY_AUTH_TOKEN: TOKEN },
        "testnet",
      ),
    ).toBeNull();
    expect(
      alchemyDepositWatchConfigFromEnv(
        {
          ALCHEMY_NOTIFY_AUTH_TOKEN: TOKEN,
          AGENTTOOL_PUBLIC_URL: "http://localhost:3000",
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
    });
    expect(JSON.stringify(config)).not.toContain("unrelated");
    expect(config?.webhookIds.base?.mainnet).toBeUndefined();
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
