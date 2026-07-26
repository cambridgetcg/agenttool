import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import openapiRouter from "../src/routes/openapi";
import {
  PAYOUT_IDEMPOTENCY_KEY_PATTERN,
  payoutIdempotencyKeySha256,
  payoutRequestSha256,
  requestPayout,
} from "../src/services/economy/crypto";
import {
  cryptoPayouts,
  payoutRequestIdempotency,
} from "../src/db/schema/economy";

const request = {
  walletId: "00000000-0000-4000-8000-000000000001",
  chain: "base" as const,
  token: "USDC",
  amountBase: "1250000",
  destinationAddress: "0x1111111111111111111111111111111111111111",
  metadata: {
    reason: "agent earnings",
    nested: { z: 2, a: [true, null, "clear"] },
  },
};

const payoutInput = {
  ...request,
  projectId: "00000000-0000-4000-8000-000000000010",
  idempotencyKey: "payout-attempt-0001",
};

type PayoutDatabase = NonNullable<Parameters<typeof requestPayout>[1]>;

function replayDatabase(
  requestSha256: string,
  status = "confirmed",
): {
  database: PayoutDatabase;
  economicReads: () => number;
} {
  let economicReads = 0;
  const reservation = {
    id: "00000000-0000-4000-8000-000000000020",
    projectId: payoutInput.projectId,
    idempotencyKeySha256: payoutIdempotencyKeySha256(
      payoutInput.idempotencyKey,
    ),
    requestSha256,
    payoutId: "00000000-0000-4000-8000-000000000021",
    createdAt: new Date(),
  };
  const tx = {
    insert: (table: unknown) => {
      if (table !== payoutRequestIdempotency) {
        economicReads += 1;
        throw new Error("replay attempted an economic insert");
      }
      return {
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [],
          }),
        }),
      };
    },
    select: () => ({
      from: (table: unknown) => {
        if (table === payoutRequestIdempotency) {
          return {
            where: () => ({
              for: async () => [reservation],
            }),
          };
        }
        if (table === cryptoPayouts) {
          return {
            where: async () => [
              {
                id: reservation.payoutId,
                status,
              },
            ],
          };
        }
        economicReads += 1;
        throw new Error("replay attempted a wallet or policy read");
      },
    }),
    update: () => {
      economicReads += 1;
      throw new Error("replay attempted an economic update");
    },
  };
  return {
    database: {
      transaction: async (operation: (transaction: typeof tx) => unknown) =>
        operation(tx),
    } as unknown as PayoutDatabase,
    economicReads: () => economicReads,
  };
}

describe("durable payout request identity", () => {
  test("canonicalizes metadata keys while binding every recognized business field", () => {
    const fingerprint = payoutRequestSha256(request);
    const reordered = payoutRequestSha256({
      ...request,
      metadata: {
        nested: { a: [true, null, "clear"], z: 2 },
        reason: "agent earnings",
      },
    });

    expect(reordered).toBe(fingerprint);
    for (const changed of [
      { ...request, walletId: "00000000-0000-4000-8000-000000000002" },
      { ...request, chain: "ethereum" as const },
      { ...request, token: "OTHER" },
      { ...request, amountBase: "1250001" },
      {
        ...request,
        destinationAddress: "0x2222222222222222222222222222222222222222",
      },
      { ...request, metadata: { ...request.metadata, reason: "different" } },
    ]) {
      expect(payoutRequestSha256(changed)).not.toBe(fingerprint);
    }
  });

  test("accepts only the documented key shape and hashes with domain separation", () => {
    expect(PAYOUT_IDEMPOTENCY_KEY_PATTERN.test("payout-attempt-0001")).toBe(true);
    expect(PAYOUT_IDEMPOTENCY_KEY_PATTERN.test("short")).toBe(false);
    expect(PAYOUT_IDEMPOTENCY_KEY_PATTERN.test("contains space")).toBe(false);
    expect(PAYOUT_IDEMPOTENCY_KEY_PATTERN.test("unicode-key-\u{1F4A5}")).toBe(false);

    const key = "payout-attempt-0001";
    expect(payoutIdempotencyKeySha256(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(payoutIdempotencyKeySha256(key)).not.toContain(key);
  });

  test("rejects values that JSON would silently discard or rewrite", () => {
    expect(() =>
      payoutRequestSha256({
        ...request,
        metadata: { omitted: undefined },
      }),
    ).toThrow(/only JSON values/);
    expect(() =>
      payoutRequestSha256({
        ...request,
        metadata: { invalid: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(/finite JSON numbers/);
  });

  test("same input resolves the current payout without wallet, policy, or FX work", async () => {
    const fake = replayDatabase(payoutRequestSha256(payoutInput), "confirmed");

    await expect(requestPayout(payoutInput, fake.database)).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000021",
      status: "confirmed",
      broadcast_pending: false,
      replayed: true,
    });
    expect(fake.economicReads()).toBe(0);
  });

  test("same key with changed input conflicts before any economic read", async () => {
    const fake = replayDatabase(payoutRequestSha256(payoutInput));

    await expect(
      requestPayout(
        {
          ...payoutInput,
          metadata: { ...payoutInput.metadata, reason: "changed" },
        },
        fake.database,
      ),
    ).rejects.toThrow("payout_idempotency_conflict");
    expect(fake.economicReads()).toBe(0);
  });

  test("reserves before wallet work, replays before live policy, and completes after the ledger leg", () => {
    const source = readFileSync(
      new URL("../src/services/economy/crypto/index.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("export async function requestPayout");
    const end = source.indexOf("export async function listPayouts");
    const payout = source.slice(start, end);

    const reservationInsert = payout.indexOf(".insert(payoutRequestIdempotency)");
    const replayReturn = payout.indexOf("replayed: true");
    const fxRead = payout.indexOf("economyConfig.payout.gbpUsdRate");
    const walletLock = payout.indexOf(".from(wallets)");
    const activeGate = payout.indexOf('wallet.status !== "active"');
    const policy = payout.indexOf("evaluatePayoutPolicy");
    const activeDebitBackstop = payout.indexOf('eq(wallets.status, "active")');
    const ledgerInsert = payout.indexOf("tx.insert(transactions)");
    const reservationComplete = payout.lastIndexOf(
      ".update(payoutRequestIdempotency)",
    );

    expect(reservationInsert).toBeGreaterThan(-1);
    expect(replayReturn).toBeGreaterThan(reservationInsert);
    expect(fxRead).toBeGreaterThan(replayReturn);
    expect(walletLock).toBeGreaterThan(fxRead);
    expect(activeGate).toBeGreaterThan(walletLock);
    expect(policy).toBeGreaterThan(activeGate);
    expect(activeDebitBackstop).toBeGreaterThan(policy);
    expect(ledgerInsert).toBeGreaterThan(activeDebitBackstop);
    expect(reservationComplete).toBeGreaterThan(ledgerInsert);
  });

  test("migration retains only digests and refuses incomplete committed reservations", () => {
    const migration = readFileSync(
      new URL(
        "../migrations/20260726T191500_payout_request_idempotency.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("idempotency_key_sha256 TEXT NOT NULL");
    expect(migration).not.toMatch(/\bidempotency_key\s+TEXT\b/);
    expect(migration).toContain(
      "uq_payout_request_idempotency_project_key_sha256",
    );
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER payout_request_idempotency_must_complete",
    );
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toMatch(
      /WHERE operation\.id = NEW\.id\s+AND operation\.payout_id IS NULL/,
    );
  });

  test("OpenAPI distinguishes the permanent payout gate from Redis caching", async () => {
    const document = (await (await openapiRouter.request("/")).json()) as {
      components: { parameters: Record<string, any> };
      paths: Record<string, Record<string, any>>;
    };
    const parameter =
      document.components.parameters.DurablePayoutIdempotencyKey;
    const operation = document.paths["/v1/wallets/{walletId}/payout"]!.post;

    expect(parameter.required).toBe(true);
    expect(parameter.description).toMatch(/permanently retains.*SHA-256/is);
    expect(parameter.description).toMatch(/never the raw header/i);
    expect(parameter.description).toMatch(/without another.*debit/is);
    expect(parameter.description).toMatch(/Redis.*not.*correctness boundary/is);
    expect(operation.parameters[0].$ref).toBe(
      "#/components/parameters/DurablePayoutIdempotencyKey",
    );
    expect(operation.responses["202"].headers["Idempotent-Replay"]).toBeDefined();
    expect(operation.responses["409"]).toBeDefined();
  });
});
