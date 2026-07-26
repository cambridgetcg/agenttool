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

function freshDatabase(): {
  database: PayoutDatabase;
  economicTouches: () => number;
} {
  let economicTouches = 0;
  const tx = {
    insert: (table: unknown) => {
      if (table !== payoutRequestIdempotency) {
        economicTouches += 1;
        throw new Error("resting admission attempted an economic insert");
      }
      return {
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [
              { id: "00000000-0000-4000-8000-000000000030" },
            ],
          }),
        }),
      };
    },
    select: () => {
      economicTouches += 1;
      throw new Error("resting admission attempted an economic read");
    },
    update: () => {
      economicTouches += 1;
      throw new Error("resting admission attempted an economic update");
    },
    execute: () => {
      economicTouches += 1;
      throw new Error("resting admission attempted an economic query");
    },
  };
  return {
    database: {
      transaction: async (operation: (transaction: typeof tx) => unknown) =>
        operation(tx),
    } as unknown as PayoutDatabase,
    economicTouches: () => economicTouches,
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

  test("same input remains replayable while fresh admission rests", async () => {
    const fake = replayDatabase(payoutRequestSha256(payoutInput), "broadcast");
    await expect(requestPayout(payoutInput, fake.database)).resolves.toEqual({
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

  test("fresh input rests after a rollback-only reservation and before economic work", async () => {
    const fake = freshDatabase();
    await expect(requestPayout(payoutInput, fake.database)).rejects.toThrow(
      "payout_admission_resting",
    );
    expect(fake.economicTouches()).toBe(0);
  });

  test("source resolves replay before the unconditional resting wall", () => {
    const source = readFileSync(
      new URL("../src/services/economy/crypto/index.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("export async function requestPayout");
    const end = source.indexOf("export async function listPayouts");
    const payout = source.slice(start, end);
    const reservationInsert = payout.indexOf(".insert(payoutRequestIdempotency)");
    const replayReturn = payout.indexOf("replayed: true");
    const restingWall = payout.indexOf(
      "throw new Error(PAYOUT_ADMISSION_RESTING_ERROR)",
    );

    expect(reservationInsert).toBeGreaterThan(-1);
    expect(replayReturn).toBeGreaterThan(reservationInsert);
    expect(restingWall).toBeGreaterThan(replayReturn);
    expect(payout).not.toContain("activeNetwork()");
    expect(payout).not.toContain(".from(wallets)");
    expect(payout).not.toContain("evaluatePayoutPolicy");
    expect(payout).not.toContain(".insert(cryptoPayouts)");
    expect(payout).not.toContain("tx.insert(transactions)");
    expect(payout).not.toContain("payoutBroadcastConfigured");
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
    expect(parameter.description).toMatch(
      /permanently retain(?:s|ed).*SHA-256/is,
    );
    expect(parameter.description).toMatch(/never the raw header/i);
    expect(parameter.description).toMatch(/without .*debit/is);
    expect(parameter.description).toMatch(/Redis.*bypassed/is);
    expect(operation.parameters[0].$ref).toBe(
      "#/components/parameters/DurablePayoutIdempotencyKey",
    );
    expect(operation.responses["202"].headers["Idempotent-Replay"]).toBeDefined();
    expect(operation.responses["409"]).toBeDefined();
    expect(operation.responses["503"].description).toMatch(
      /payout_admission_resting.*durable replay\/conflict lookup.*reservation.*rolled back.*before network selection.*payout-economic wallet\/policy reads or mutation/is,
    );
    expect(operation.responses["402"]).toBeUndefined();
    expect(operation.responses["403"]).toBeUndefined();
  });
});
