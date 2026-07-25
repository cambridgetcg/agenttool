import { describe, expect, test } from "bun:test";

import {
  ALCHEMY_NOTIFY_UPDATE_URL,
  AlchemyNotifyConfigurationError,
  AlchemyNotifyUnavailableError,
  alchemyNotifyConfig,
  ensureAlchemyAddressWatched,
  type AlchemyNotifyConfig,
} from "../src/services/economy/crypto/alchemy-notify";

const ADDRESS = "0x0000000000000000000000000000000000000001";
const SENTINEL_TOKEN = "obvious-test-token-not-a-credential";
const SENTINEL_WEBHOOK = "wh_obvious_test_fixture";

function config(
  overrides: Partial<AlchemyNotifyConfig> = {},
): AlchemyNotifyConfig {
  return {
    authToken: SENTINEL_TOKEN,
    webhookIds: { base: SENTINEL_WEBHOOK },
    timeoutMs: 1_000,
    ...overrides,
  };
}

describe("Alchemy Notify address-watch adapter", () => {
  test("reads only named Notify configuration", () => {
    const loaded = alchemyNotifyConfig({
      ALCHEMY_NOTIFY_AUTH_TOKEN: SENTINEL_TOKEN,
      ALCHEMY_WEBHOOK_ID_BASE: SENTINEL_WEBHOOK,
    });
    expect(loaded.authToken).toBe(SENTINEL_TOKEN);
    expect(loaded.webhookIds).toEqual({ base: SENTINEL_WEBHOOK });
  });

  test("keeps authentication in a header and idempotently adds one address", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await ensureAlchemyAddressWatched({
      chain: "base",
      address: ADDRESS,
      config: config(),
      fetchImpl: fakeFetch,
    });

    expect(capturedUrl).toBe(ALCHEMY_NOTIFY_UPDATE_URL);
    expect(capturedUrl).not.toContain(SENTINEL_TOKEN);
    expect(capturedInit?.method).toBe("PATCH");
    expect(
      (capturedInit?.headers as Record<string, string>)["x-alchemy-token"],
    ).toBe(SENTINEL_TOKEN);
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      webhook_id: SENTINEL_WEBHOOK,
      addresses_to_add: [ADDRESS],
      addresses_to_remove: [],
    });
  });

  test("fails before network use when the chain watchlist is unconfigured", async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await expect(
      ensureAlchemyAddressWatched({
        chain: "ethereum",
        address: ADDRESS,
        config: config({ webhookIds: {} }),
        fetchImpl: fakeFetch,
      }),
    ).rejects.toBeInstanceOf(AlchemyNotifyConfigurationError);
    expect(called).toBe(false);
  });

  test("returns a bounded provider error without reflecting its body", async () => {
    const reflected = "obvious-upstream-test-body";
    const fakeFetch = (async () =>
      new Response(reflected, { status: 503 })) as typeof fetch;

    let caught: unknown;
    try {
      await ensureAlchemyAddressWatched({
        chain: "base",
        address: ADDRESS,
        config: config(),
        fetchImpl: fakeFetch,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AlchemyNotifyUnavailableError);
    expect((caught as Error).message).not.toContain(reflected);
    expect((caught as AlchemyNotifyUnavailableError).status).toBe(503);
  });
});
