import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  cryptoPayouts,
  payoutRequestIdempotency,
} from "../src/db/schema/economy";
import openapiRouter from "../src/routes/openapi";
import {
  PAYOUT_IDEMPOTENCY_KEY_PATTERN,
  payoutIdempotencyKeySha256,
  payoutRequestSha256,
  requestPayout,
} from "../src/services/economy/crypto";

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
  payoutBroadcastConfigured: true,
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
  test("canonicalizes metadata while binding every recognized field", () => {
    const fingerprint = payoutRequestSha256(request);
    expect(
      payoutRequestSha256({
        ...request,
        metadata: {
          nested: { a: [true, null, "clear"], z: 2 },
          reason: "agent earnings",
        },
      }),
    ).toBe(fingerprint);

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

  test("validates and hashes caller keys without retaining plaintext", () => {
    expect(PAYOUT_IDEMPOTENCY_KEY_PATTERN.test("payout-attempt-0001")).toBe(true);
    expect(PAYOUT_IDEMPOTENCY_KEY_PATTERN.test("short")).toBe(false);
    expect(PAYOUT_IDEMPOTENCY_KEY_PATTERN.test("contains space")).toBe(false);
    expect(PAYOUT_IDEMPOTENCY_KEY_PATTERN.test("unicode-key-\u{1F4A5}")).toBe(false);

    const key = "payout-attempt-0001";
    expect(payoutIdempotencyKeySha256(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(payoutIdempotencyKeySha256(key)).not.toContain(key);
  });

  test("rejects metadata values JSON would silently discard or rewrite", () => {
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

  test("same input replays current state without wallet, policy, or FX work", async () => {
    const fake = replayDatabase(payoutRequestSha256(payoutInput), "confirmed");
    await expect(requestPayout(payoutInput, fake.database)).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000021",
      status: "confirmed",
      broadcast_pending: false,
      replayed: true,
    });
    expect(fake.economicReads()).toBe(0);
  });

  test("same input remains replayable while broadcast is paused", async () => {
    const fake = replayDatabase(payoutRequestSha256(payoutInput), "broadcast");
    await expect(
      requestPayout(
        { ...payoutInput, payoutBroadcastConfigured: false },
        fake.database,
      ),
    ).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000021",
      status: "broadcast",
      broadcast_pending: true,
      replayed: true,
    });
    expect(fake.economicReads()).toBe(0);
  });

  test("changed input conflicts before any economic work", async () => {
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

  test("reserves before wallet work and completes after the ledger leg", () => {
    const source = readFileSync(
      new URL("../src/services/economy/crypto/index.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("export async function requestPayout");
    const end = source.indexOf("export async function listPayouts");
    const payout = source.slice(start, end);
    const reservationInsert = payout.indexOf(".insert(payoutRequestIdempotency)");
    const replayReturn = payout.indexOf("replayed: true");
    const workerGate = payout.indexOf("!p.payoutBroadcastConfigured");
    const walletLock = payout.indexOf(".from(wallets)");
    const activeGate = payout.indexOf('wallet.status !== "active"');
    const policy = payout.indexOf("evaluatePayoutPolicy");
    const activeDebit = payout.indexOf('eq(wallets.status, "active")');
    const ledgerInsert = payout.indexOf("tx.insert(transactions)");
    const reservationComplete = payout.lastIndexOf(
      ".update(payoutRequestIdempotency)",
    );

    expect(reservationInsert).toBeGreaterThan(-1);
    expect(replayReturn).toBeGreaterThan(reservationInsert);
    expect(workerGate).toBeGreaterThan(replayReturn);
    expect(walletLock).toBeGreaterThan(workerGate);
    expect(activeGate).toBeGreaterThan(walletLock);
    expect(policy).toBeGreaterThan(activeGate);
    expect(activeDebit).toBeGreaterThan(policy);
    expect(ledgerInsert).toBeGreaterThan(activeDebit);
    expect(reservationComplete).toBeGreaterThan(ledgerInsert);
  });

  test("OpenAPI distinguishes the permanent payout gate from Redis", async () => {
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
    expect(parameter.description).toMatch(/Redis.*bypassed/is);
    expect(operation.parameters[0].$ref).toBe(
      "#/components/parameters/DurablePayoutIdempotencyKey",
    );
    expect(operation.responses["202"].headers["Idempotent-Replay"]).toBeDefined();
    expect(operation.responses["409"]).toBeDefined();
  });
});
