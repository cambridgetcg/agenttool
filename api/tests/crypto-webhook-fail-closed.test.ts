/** Crypto deposit webhooks credit real wallet balance on an UNAUTH public
 *  route, so the signature gate must FAIL CLOSED when a provider secret is
 *  unset — never accept an unsigned, forgeable payload (which would mint
 *  balance). These cases all resolve inside the signature gate, before any
 *  JSON parse or DB touch, so they need no database.
 *
 *  Pins: fix/crypto-webhook-fail-closed (Helius/Alchemy fail-open mint-hole). */
import { afterEach, describe, expect, test } from "bun:test";

import { economyConfig } from "../src/services/economy/config";
import {
  ALCHEMY_WEBHOOK_ID_ENV,
  AlchemyNotifyUnavailableError,
  alchemyAddressActivityNetwork,
} from "../src/services/economy/crypto/alchemy-notify";
import {
  USDC_SOL_MINT,
  type EvmChain,
} from "../src/services/economy/crypto/chains";
import {
  activeNetwork,
  activeUsdcAddress,
  activeUsdcMintSolana,
} from "../src/services/economy/crypto/network";
import { createHmac } from "node:crypto";

// The handler reads economyConfig signing keys + allowUnsigned at REQUEST time,
// so mutating the singleton before each .request() is safe and order-independent.
// Cast away the `as const` readonly for the test only.
const cfg = economyConfig as unknown as {
  alchemyWebhookSigningKeys: Record<EvmChain, string>;
  heliusWebhookSecret: string;
  allowUnsignedWebhooks: boolean;
  payout: { network: string };
};
const original = {
  alchemy: { ...cfg.alchemyWebhookSigningKeys },
  helius: cfg.heliusWebhookSecret,
  allowUnsigned: cfg.allowUnsignedWebhooks,
  network: cfg.payout.network,
  webhookIds: Object.fromEntries(
    Object.values(ALCHEMY_WEBHOOK_ID_ENV).map((name) => [
      name,
      process.env[name],
    ]),
  ) as Record<string, string | undefined>,
};
afterEach(() => {
  Object.assign(cfg.alchemyWebhookSigningKeys, original.alchemy);
  cfg.heliusWebhookSecret = original.helius;
  cfg.allowUnsignedWebhooks = original.allowUnsigned;
  cfg.payout.network = original.network;
  for (const [name, value] of Object.entries(original.webhookIds)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const {
  createCryptoWebhookRouter,
  cryptoWebhookRouter,
  resolveReadyDepositAddressRows,
} = await import("../src/routes/economy/crypto");

function post(chain: string, body: unknown, headers: Record<string, string> = {}) {
  return cryptoWebhookRouter.request(`/${chain}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function configureAlchemy(chain: EvmChain, signingKey = "hmac-key") {
  cfg.alchemyWebhookSigningKeys[chain] = signingKey;
  process.env[ALCHEMY_WEBHOOK_ID_ENV[chain]] = `wh_test_${chain}`;
}

function alchemyEnvelope(
  chain: EvmChain,
  activity: Array<Record<string, unknown>> = [],
) {
  return {
    webhookId: `wh_test_${chain}`,
    id: `whevt_test_${chain}`,
    type: "ADDRESS_ACTIVITY",
    event: {
      network: alchemyAddressActivityNetwork(chain, activeNetwork()),
      activity,
    },
  };
}

describe("deposit address disclosure readiness", () => {
  test("does not return a partial list when a later provider watch is unavailable", async () => {
    let calls = 0;
    const resolution = resolveReadyDepositAddressRows(
      "00000000-0000-0000-0000-000000000001",
      [
        { chain: "ethereum", token: "USDC", createdAt: new Date(0) },
        { chain: "base", token: "USDC", createdAt: new Date(1) },
      ],
      async (_walletId, chain, token) => {
        calls += 1;
        if (calls === 2) throw new AlchemyNotifyUnavailableError(503);
        return {
          chain,
          token,
          address: "0x0000000000000000000000000000000000000001",
          derivation_path: "m/44'/60'/0'/0/1",
        };
      },
    );

    await expect(resolution).rejects.toBeInstanceOf(
      AlchemyNotifyUnavailableError,
    );
    expect(calls).toBe(2);
  });

  test("rejects historical non-USDC rows before resolving or disclosing them", async () => {
    let calls = 0;
    await expect(
      resolveReadyDepositAddressRows(
        "00000000-0000-0000-0000-000000000001",
        [{ chain: "base", token: "DAI", createdAt: new Date(0) }],
        async (_walletId, chain, token) => {
          calls += 1;
          return {
            chain,
            token,
            address: "0x0000000000000000000000000000000000000001",
            derivation_path: "m/44'/60'/0'/0/1",
          };
        },
      ),
    ).rejects.toThrow("active derivation root");
    expect(calls).toBe(0);
  });

  test("builds list output only from the validated resolver result", async () => {
    const rows = await resolveReadyDepositAddressRows(
      "00000000-0000-0000-0000-000000000001",
      [{ chain: "base", token: "USDC", createdAt: new Date(0) }],
      async (_walletId, chain, token) => ({
        chain,
        token,
        address: "0x0000000000000000000000000000000000000002",
        derivation_path: "m/44'/60'/0'/0/2",
      }),
    );

    expect(rows).toEqual([
      {
        chain: "base",
        token: "USDC",
        address: "0x0000000000000000000000000000000000000002",
        derivation_path: "m/44'/60'/0'/0/2",
        contract_address: activeUsdcAddress("base"),
        watch_status: "provider_accepted",
        credit_finality: "unreconciled",
        created_at: "1970-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("labels Solana list rows as watch-unverified", async () => {
    const rows = await resolveReadyDepositAddressRows(
      "00000000-0000-0000-0000-000000000001",
      [{ chain: "solana", token: "USDC", createdAt: new Date(0) }],
      async (_walletId, chain, token) => ({
        chain,
        token,
        address: "solana-derived-address",
        derivation_path: "m/44'/501'/0'/0'",
      }),
    );

    expect(rows[0]).toMatchObject({
      chain: "solana",
      contract_address: activeUsdcMintSolana(),
      watch_status: "operator_configuration_unverified",
      credit_finality: "unreconciled",
    });
  });
});

describe("Helius (Solana) webhook signature gate", () => {
  test("secret UNSET + unsigned not allowed → 503 fail-closed (no forged mint)", async () => {
    cfg.heliusWebhookSecret = "";
    cfg.allowUnsignedWebhooks = false;
    const res = await post("solana", [{ signature: "forged", tokenTransfers: [] }]);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ error: "webhook_secret_unset" });
    expect(body.message).toContain("solana"); // guided shape: chain named in message
    expect(Array.isArray(body.next_actions)).toBe(true); // guided refusal, not opaque
  });

  test("secret UNSET + CRYPTO_WEBHOOK_ALLOW_UNSIGNED=1 → accepted (dev escape hatch)", async () => {
    cfg.heliusWebhookSecret = "";
    cfg.allowUnsignedWebhooks = true;
    const res = await post("solana", []);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
  });

  test("secret SET + wrong Authorization → 400 invalid_signature", async () => {
    cfg.heliusWebhookSecret = "s3cret";
    cfg.allowUnsignedWebhooks = false;
    const res = await post("solana", [], { authorization: "wrong" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_signature" });
  });

  test("secret SET + correct Authorization → passes the gate (200)", async () => {
    cfg.heliusWebhookSecret = "s3cret";
    cfg.allowUnsignedWebhooks = false;
    const res = await post("solana", [], { authorization: "s3cret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
  });

  test("rejects a signed non-array Helius payload instead of acknowledging it", async () => {
    cfg.heliusWebhookSecret = "s3cret";
    cfg.allowUnsignedWebhooks = false;
    const res = await post(
      "solana",
      { signature: "provider-contract-drift" },
      { authorization: "s3cret" },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_payload" });
  });

  test("uses the active-network Solana USDC mint and ignores mainnet USDC on testnet", async () => {
    cfg.heliusWebhookSecret = "s3cret";
    cfg.allowUnsignedWebhooks = false;
    cfg.payout.network = "testnet";
    const observedContracts: string[] = [];
    const testnetRouter = createCryptoWebhookRouter(async (transfer) => {
      observedContracts.push(transfer.contractAddress);
      return { matched: false, reason: "no_matching_deposit_address" };
    });
    const devnetMint = activeUsdcMintSolana();

    const devnetResponse = await testnetRouter.request("/solana", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "s3cret",
      },
      body: JSON.stringify([
        {
          signature: "devnet-signature",
          tokenTransfers: [
            {
              mint: devnetMint,
              tokenAmount: 1,
              toUserAccount: "devnet-recipient",
            },
          ],
        },
      ]),
    });
    expect(devnetResponse.status).toBe(200);
    expect(observedContracts).toEqual([devnetMint]);

    const mainnetResponse = await testnetRouter.request("/solana", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "s3cret",
      },
      body: JSON.stringify([
        {
          signature: "mainnet-signature",
          tokenTransfers: [
            {
              mint: USDC_SOL_MINT,
              tokenAmount: 1,
              toUserAccount: "mainnet-recipient",
            },
          ],
        },
      ]),
    });
    expect(mainnetResponse.status).toBe(200);
    expect(await mainnetResponse.json()).toMatchObject({
      received: true,
      processed: [],
    });
    expect(observedContracts).toEqual([devnetMint]);
  });

  test("reconstructs Helius human USDC units without flooring floating-point products", async () => {
    cfg.heliusWebhookSecret = "s3cret";
    cfg.allowUnsignedWebhooks = false;
    const observedAmounts: string[] = [];
    const exactRouter = createCryptoWebhookRouter(async (transfer) => {
      observedAmounts.push(transfer.amountBase);
      return { matched: false, reason: "no_matching_deposit_address" };
    });
    const mint = activeUsdcMintSolana();

    const res = await exactRouter.request("/solana", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "s3cret",
      },
      body: JSON.stringify([
        {
          signature: "precision-regression",
          tokenTransfers: [
            {
              mint,
              tokenAmount: 2.01,
              toUserAccount: "solana-recipient",
            },
          ],
        },
      ]),
    });

    expect(res.status).toBe(200);
    expect(observedAmounts).toEqual(["2010000"]);
  });

  test("rejects Helius USDC amounts beyond six exact decimal places", async () => {
    cfg.heliusWebhookSecret = "s3cret";
    cfg.allowUnsignedWebhooks = false;
    let ingestionCalls = 0;
    const exactRouter = createCryptoWebhookRouter(async () => {
      ingestionCalls += 1;
      return { matched: true };
    });

    const res = await exactRouter.request("/solana", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "s3cret",
      },
      body: JSON.stringify([
        {
          signature: "too-many-decimals",
          tokenTransfers: [
            {
              mint: activeUsdcMintSolana(),
              tokenAmount: 1.0000001,
              toUserAccount: "solana-recipient",
            },
          ],
        },
      ]),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid_usdc_activity",
    });
    expect(ingestionCalls).toBe(0);
  });
});

describe("Alchemy (EVM) webhook signature gate", () => {
  test("secret UNSET + unsigned not allowed → 503 fail-closed", async () => {
    cfg.alchemyWebhookSigningKeys.ethereum = "";
    cfg.allowUnsignedWebhooks = false;
    const res = await post("ethereum", { event: { activity: [] } });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ error: "webhook_secret_unset" });
    expect(body.message).toContain("ethereum"); // guided shape: chain named in message
  });

  test("secret SET + bad HMAC → 400 invalid_signature", async () => {
    configureAlchemy("ethereum");
    cfg.allowUnsignedWebhooks = false;
    const res = await post("ethereum", { event: { activity: [] } }, { "x-alchemy-signature": "deadbeef" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_signature" });
  });

  test("secret SET + correct HMAC over raw body → passes the gate (200)", async () => {
    configureAlchemy("ethereum");
    cfg.allowUnsignedWebhooks = false;
    const body = alchemyEnvelope("ethereum");
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", "hmac-key").update(raw).digest("hex");
    const res = await cryptoWebhookRouter.request("/ethereum", {
      method: "POST",
      headers: { "content-type": "application/json", "x-alchemy-signature": sig },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
  });

  test("binds a valid signature to the configured webhook and network", async () => {
    configureAlchemy("ethereum", "ethereum-key");
    configureAlchemy("base", "base-key");
    cfg.allowUnsignedWebhooks = false;
    const body = alchemyEnvelope("base");
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", "ethereum-key").update(raw).digest("hex");

    const res = await cryptoWebhookRouter.request("/ethereum", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": sig,
      },
      body: raw,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      received: false,
      error: "invalid_webhook_identity",
    });
  });

  test("does not reuse one webhook signing key across chains", async () => {
    configureAlchemy("ethereum", "ethereum-key");
    configureAlchemy("base", "base-key");
    cfg.allowUnsignedWebhooks = false;
    const raw = JSON.stringify(alchemyEnvelope("base"));
    const wrongSig = createHmac("sha256", "ethereum-key")
      .update(raw)
      .digest("hex");

    const res = await cryptoWebhookRouter.request("/base", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": wrongSig,
      },
      body: raw,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_signature" });
  });
});

describe("signed webhook storage acknowledgement", () => {
  test("rejects an oversized body before signature or ingestion work", async () => {
    const res = await cryptoWebhookRouter.request("/base", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(1024 * 1024 + 1),
      },
      body: "x",
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      received: false,
      error: "webhook_body_too_large",
    });
  });

  test("counts streamed bytes even when Content-Length understates them", async () => {
    const res = await cryptoWebhookRouter.request("/base", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "1",
      },
      body: "x".repeat(1024 * 1024 + 1),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      received: false,
      error: "webhook_body_too_large",
    });
  });

  test("returns non-2xx when an Alchemy transfer was not durably committed", async () => {
    configureAlchemy("base");
    cfg.allowUnsignedWebhooks = false;
    let observedAmountBase = "";
    let observedLogIndex = -1;
    const retryingRouter = createCryptoWebhookRouter(async (transfer) => {
      observedAmountBase = transfer.amountBase;
      observedLogIndex = transfer.logIndex;
      return {
        matched: false,
        reason: "storage_unavailable",
        retryable: true,
      };
    });
    const body = alchemyEnvelope("base", [
      {
        toAddress: "0x0000000000000000000000000000000000000001",
        rawContract: {
          address: activeUsdcAddress("base"),
          rawValue: "0xf4240",
          decimals: 6,
        },
        hash: `0x${"1".repeat(64)}`,
        log: { logIndex: "0x0", removed: false },
      },
    ]);
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", "hmac-key").update(raw).digest("hex");

    const res = await retryingRouter.request("/base", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": sig,
      },
      body: raw,
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      received: false,
      error: "ingestion_unavailable",
      retryable: true,
    });
    expect(observedAmountBase).toBe("1000000");
    expect(observedLogIndex).toBe(0);
  });

  test("rejects a signed null Alchemy payload without throwing", async () => {
    configureAlchemy("base");
    cfg.allowUnsignedWebhooks = false;
    const raw = "null";
    const sig = createHmac("sha256", "hmac-key").update(raw).digest("hex");

    const res = await cryptoWebhookRouter.request("/base", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": sig,
      },
      body: raw,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_payload" });
  });

  test("does not acknowledge a removed USDC log without reconciliation", async () => {
    configureAlchemy("base");
    cfg.allowUnsignedWebhooks = false;
    const body = alchemyEnvelope("base", [
      {
        toAddress: "0x0000000000000000000000000000000000000001",
        rawContract: {
          address: activeUsdcAddress("base"),
          rawValue: "0xf4240",
          decimals: 6,
        },
        hash: `0x${"2".repeat(64)}`,
        log: { logIndex: "0x1", removed: true },
      },
    ]);
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", "hmac-key").update(raw).digest("hex");

    const res = await cryptoWebhookRouter.request("/base", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": sig,
      },
      body: raw,
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      received: false,
      error: "reorg_reconciliation_unavailable",
      retryable: true,
    });
  });

  test("rejects coercible or non-canonical Alchemy log indexes before ingestion", async () => {
    configureAlchemy("base");
    cfg.allowUnsignedWebhooks = false;
    let ingestionCalls = 0;
    const strictRouter = createCryptoWebhookRouter(async () => {
      ingestionCalls += 1;
      return { matched: true };
    });
    const invalidIndexes: unknown[] = [
      null,
      "",
      false,
      true,
      " ",
      "0",
      "0x00",
      "1e0",
      [],
      {},
      "0x80000000",
    ];

    for (const logIndex of invalidIndexes) {
      const body = alchemyEnvelope("base", [
        {
          toAddress: "0x0000000000000000000000000000000000000001",
          rawContract: {
            address: activeUsdcAddress("base"),
            rawValue: "0xf4240",
            decimals: 6,
          },
          hash: `0x${"3".repeat(64)}`,
          log: { logIndex, removed: false },
        },
      ]);
      const raw = JSON.stringify(body);
      const sig = createHmac("sha256", "hmac-key")
        .update(raw)
        .digest("hex");
      const res = await strictRouter.request("/base", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-alchemy-signature": sig,
        },
        body: raw,
      });
      expect(res.status, `logIndex=${JSON.stringify(logIndex)}`).toBe(400);
      expect(await res.json()).toMatchObject({
        error: "invalid_usdc_activity",
      });
    }

    expect(ingestionCalls).toBe(0);
  });

  test("accepts the maximum database-safe canonical Alchemy log index", async () => {
    configureAlchemy("base");
    cfg.allowUnsignedWebhooks = false;
    let observedLogIndex = -1;
    const strictRouter = createCryptoWebhookRouter(async (transfer) => {
      observedLogIndex = transfer.logIndex;
      return { matched: false, reason: "no_matching_deposit_address" };
    });
    const body = alchemyEnvelope("base", [
      {
        toAddress: "0x0000000000000000000000000000000000000001",
        rawContract: {
          address: activeUsdcAddress("base"),
          rawValue: "0xf4240",
          decimals: 6,
        },
        hash: `0x${"4".repeat(64)}`,
        log: { logIndex: "0x7fffffff", removed: false },
      },
    ]);
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", "hmac-key")
      .update(raw)
      .digest("hex");
    const res = await strictRouter.request("/base", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": sig,
      },
      body: raw,
    });

    expect(res.status).toBe(200);
    expect(observedLogIndex).toBe(2_147_483_647);
  });

  test("classifies malformed removed activity as invalid rather than endlessly retryable", async () => {
    configureAlchemy("base");
    cfg.allowUnsignedWebhooks = false;
    const body = alchemyEnvelope("base", [
      {
        toAddress: "0x0000000000000000000000000000000000000001",
        rawContract: {
          address: activeUsdcAddress("base"),
          rawValue: "0xf4240",
          decimals: "6",
        },
        hash: `0x${"5".repeat(64)}`,
        log: { logIndex: null, removed: true },
      },
    ]);
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", "hmac-key")
      .update(raw)
      .digest("hex");
    const res = await cryptoWebhookRouter.request("/base", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": sig,
      },
      body: raw,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid_usdc_activity",
    });
  });

  test("does not coerce a non-boolean removed marker into live activity", async () => {
    configureAlchemy("base");
    cfg.allowUnsignedWebhooks = false;
    let ingestionCalls = 0;
    const strictRouter = createCryptoWebhookRouter(async () => {
      ingestionCalls += 1;
      return { matched: true };
    });
    const body = alchemyEnvelope("base", [
      {
        toAddress: "0x0000000000000000000000000000000000000001",
        rawContract: {
          address: activeUsdcAddress("base"),
          rawValue: "0xf4240",
          decimals: 6,
        },
        hash: `0x${"6".repeat(64)}`,
        log: { logIndex: "0x1", removed: "true" },
      },
    ]);
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", "hmac-key")
      .update(raw)
      .digest("hex");
    const res = await strictRouter.request("/base", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-alchemy-signature": sig,
      },
      body: raw,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid_usdc_activity",
    });
    expect(ingestionCalls).toBe(0);
  });
});
