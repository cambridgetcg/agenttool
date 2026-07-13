import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  createEscrow,
  escrowCreationRequestSha256,
  escrowIdempotencyKeySha256,
} from "../src/services/economy/escrow";
import {
  escrowCreateIdempotency,
  escrows,
  transactions,
  wallets,
} from "../src/db/schema/economy";
import openapiRouter from "../src/routes/openapi";

type CreateDb = Parameters<typeof createEscrow>[0];
type CreateRedis = Parameters<typeof createEscrow>[1];

const projectId = "00000000-0000-4000-8000-000000000001";
const creatorWalletId = "00000000-0000-4000-8000-000000000002";
const workerWalletId = "00000000-0000-4000-8000-000000000003";
const escrowId = "00000000-0000-4000-8000-000000000004";
const idempotencyKey = "escrow-create-attempt-001";
const deadline = new Date("2026-07-14T10:00:00.000Z");
const redis = {} as CreateRedis;

const input = {
  creatorWalletId,
  workerWalletId,
  amount: 80,
  description: "bounded work",
  deadline,
  projectId,
  idempotencyKey,
};

const creator = {
  id: creatorWalletId,
  projectId,
  balance: 100,
  currency: "GBP",
  status: "active",
};

const worker = {
  id: workerWalletId,
  projectId,
  balance: 0,
  currency: "GBP",
  status: "active",
};

const escrow = {
  id: escrowId,
  creatorWallet: creatorWalletId,
  workerWallet: workerWalletId,
  amount: 80,
  description: "bounded work",
  status: "funded",
  managedBy: null,
  deadline,
  releasedAt: null,
  createdAt: new Date("2026-07-13T10:00:00.000Z"),
};

async function rejectionStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
    throw new Error("expected operation to reject");
  } catch (error) {
    return (error as { status?: number }).status ?? 0;
  }
}

function replayDb(
  requestSha256: string,
  currentEscrow: unknown = escrow,
): {
  db: CreateDb;
  walletEffects: () => number;
} {
  let walletEffects = 0;
  const reservation = {
    id: "00000000-0000-4000-8000-000000000005",
    projectId,
    idempotencyKeySha256: escrowIdempotencyKeySha256(idempotencyKey),
    requestSha256,
    escrowId,
    createdAt: new Date(),
  };

  const tx = {
    insert: (table: unknown) => {
      if (table !== escrowCreateIdempotency) {
        walletEffects++;
        throw new Error("replay attempted a new economic insert");
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
        if (table === escrowCreateIdempotency) {
          return { where: async () => [reservation] };
        }
        if (table === escrows) return { where: async () => [currentEscrow] };
        walletEffects++;
        throw new Error("replay attempted a wallet read");
      },
    }),
    update: () => {
      walletEffects++;
      throw new Error("replay attempted a wallet update");
    },
  };

  return {
    db: {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) =>
        run(tx),
    } as unknown as CreateDb,
    walletEffects: () => walletEffects,
  };
}

function creationDb(): {
  db: CreateDb;
  reservationValues: () => Record<string, unknown> | undefined;
  completionValues: () => Record<string, unknown> | undefined;
  walletDebits: () => number;
  transactionInserts: () => number;
} {
  let reserved: Record<string, unknown> | undefined;
  let completed: Record<string, unknown> | undefined;
  let walletDebits = 0;
  let transactionInserts = 0;

  const tx = {
    insert: (table: unknown) => {
      if (table === escrowCreateIdempotency) {
        return {
          values: (values: Record<string, unknown>) => {
            reserved = values;
            return {
              onConflictDoNothing: () => ({
                returning: async () => [{ id: "reservation" }],
              }),
            };
          },
        };
      }
      if (table === escrows) {
        return {
          values: () => ({ returning: async () => [escrow] }),
        };
      }
      if (table === transactions) {
        return {
          values: async () => {
            transactionInserts++;
            return [];
          },
        };
      }
      throw new Error("unexpected insert table");
    },
    select: () => ({
      from: (table: unknown) => {
        if (table !== wallets) throw new Error("unexpected select table");
        return {
          where: () => ({
            orderBy: () => ({ for: async () => [creator, worker] }),
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === wallets) {
          return {
            where: () => ({
              returning: async () => {
                walletDebits++;
                return [{ id: creatorWalletId }];
              },
            }),
          };
        }
        if (table === escrowCreateIdempotency) {
          completed = values;
          return {
            where: () => ({ returning: async () => [{ id: "reservation" }] }),
          };
        }
        throw new Error("unexpected update table");
      },
    }),
  };

  return {
    db: {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) =>
        run(tx),
    } as unknown as CreateDb,
    reservationValues: () => reserved,
    completionValues: () => completed,
    walletDebits: () => walletDebits,
    transactionInserts: () => transactionInserts,
  };
}

describe("generic escrow durable idempotency", () => {
  test("stores deterministic hashes instead of the caller key", async () => {
    const state = creationDb();

    await expect(createEscrow(state.db, redis, input)).resolves.toEqual({
      escrow,
      replayed: false,
    });

    expect(state.reservationValues()).toEqual({
      projectId,
      idempotencyKeySha256: escrowIdempotencyKeySha256(idempotencyKey),
      requestSha256: escrowCreationRequestSha256(input),
    });
    expect(state.reservationValues()).not.toHaveProperty("idempotencyKey");
    expect(state.completionValues()).toEqual({ escrowId });
    expect(state.walletDebits()).toBe(1);
    expect(state.transactionInserts()).toBe(1);
  });

  test("resolves the same escrow's current row before touching wallets", async () => {
    const releasedEscrow = {
      ...escrow,
      status: "released",
      releasedAt: new Date("2026-07-13T11:00:00.000Z"),
    };
    const state = replayDb(escrowCreationRequestSha256(input), releasedEscrow);

    await expect(createEscrow(state.db, redis, input)).resolves.toEqual({
      escrow: releasedEscrow,
      replayed: true,
    });
    expect(state.walletEffects()).toBe(0);
  });

  test("same project and key with changed input conflicts before wallet effects", async () => {
    const state = replayDb(
      escrowCreationRequestSha256({ ...input, description: "different work" }),
    );

    expect(await rejectionStatus(createEscrow(state.db, redis, input))).toBe(409);
    expect(state.walletEffects()).toBe(0);
  });

  test("fingerprint binds nullable worker and deadline fields", () => {
    const hash = escrowCreationRequestSha256(input);
    expect(hash).toHaveLength(64);
    expect(
      escrowCreationRequestSha256({ ...input, workerWalletId: undefined }),
    ).not.toBe(hash);
    expect(
      escrowCreationRequestSha256({ ...input, deadline: undefined }),
    ).not.toBe(hash);
  });

  test("rejects invalid keys before opening a transaction", async () => {
    let transactionsOpened = 0;
    const db = {
      transaction: async () => {
        transactionsOpened++;
      },
    } as unknown as CreateDb;

    for (const invalidKey of [
      "short",
      "contains space",
      "unicode-key-\u{1F4A5}",
    ]) {
      expect(
        await rejectionStatus(
          createEscrow(db, redis, { ...input, idempotencyKey: invalidKey }),
        ),
      ).toBe(400);
    }
    expect(transactionsOpened).toBe(0);
  });

  test("route and migration expose the durable replay boundary", () => {
    const route = readFileSync(
      new URL("../src/routes/economy/escrow.ts", import.meta.url),
      "utf8",
    );
    const migration = readFileSync(
      new URL(
        "../migrations/20260713T160000_generic_escrow_idempotency.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(route).toContain('c.req.header("Idempotency-Key")');
    expect(route).toContain('c.header("Idempotent-Replay", "true")');
    expect(route).toContain(
      'c.header("X-Idempotency-Supported", "Idempotency-Key")',
    );
    expect(migration).toContain("idempotency_key_sha256");
    expect(migration).not.toMatch(/\bidempotency_key\s+TEXT\b/);
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER escrow_create_idempotency_must_complete",
    );
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toMatch(
      /WHERE operation\.id = NEW\.id\s+AND operation\.escrow_id IS NULL/,
    );
    expect(migration).toContain("psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -1");
  });

  test("OpenAPI distinguishes durable escrow replay from Redis middleware", async () => {
    const document = (await (await openapiRouter.request("/")).json()) as {
      components: { parameters: Record<string, { description: string }> };
      paths: Record<string, Record<string, any>>;
    };
    const operation = document.paths["/v1/escrows"]!.post;
    const parameter =
      document.components.parameters.DurableEscrowIdempotencyKey!;

    expect(operation.parameters[0].$ref).toBe(
      "#/components/parameters/DurableEscrowIdempotencyKey",
    );
    expect(parameter.description).toMatch(/database permanently retains SHA-256/i);
    expect(parameter.description).toMatch(/visible ASCII.*no spaces/i);
    expect(parameter.description).toMatch(/fingerprint binds.*creatorWalletId.*deadline/is);
    expect(parameter.description).toMatch(/unknown JSON fields.*not part/is);
    expect(parameter.description).toMatch(/does not depend.*Redis/is);
    expect(parameter.description).toMatch(/without a key.*another escrow/is);
    expect(parameter.description).toMatch(/current row.*does not preserve/is);
    expect(operation.responses["201"].headers["Idempotent-Replay"]).toBeDefined();
    expect(operation.responses["409"]).toBeDefined();
  });

  test("OpenAPI covers the mounted generic escrow lifecycle and authority", async () => {
    const document = (await (await openapiRouter.request("/")).json()) as {
      paths: Record<string, Record<string, any>>;
    };

    expect(document.paths["/v1/escrows"]!.get).toBeDefined();
    expect(document.paths["/v1/escrows/{id}"]!.get).toBeDefined();
    const list = document.paths["/v1/escrows"]!.get;
    expect(list.description).toMatch(/creator wallet or assigned worker wallet/i);
    expect(list.description).toMatch(/applied in SQL/i);
    expect(list.responses["400"]).toBeDefined();
    const detail = document.paths["/v1/escrows/{id}"]!.get;
    expect(detail.description).toMatch(/creator wallet or assigned worker wallet/i);
    expect(detail.description).toMatch(/missing and unauthorized IDs both return 404/i);
    expect(detail.responses["403"]).toBeUndefined();
    for (const action of ["accept", "release", "refund", "dispute"]) {
      const operation = document.paths[`/v1/escrows/{id}/${action}`]!.post;
      expect(operation).toBeDefined();
      expect(operation.description).toMatch(/workflow-managed.*409/is);
      expect(operation.responses["409"]).toBeDefined();
    }

    const release = document.paths["/v1/escrows/{id}/release"]!.post;
    expect(release.description).toMatch(/creator project's bearer/i);
    expect(release.description).toMatch(/no worker signature/i);

    const dispute = document.paths["/v1/escrows/{id}/dispute"]!.post;
    expect(dispute.description).toMatch(/does not create.*dispute case/is);
    expect(dispute.description).toMatch(/subsequently refund/i);
  });
});
