import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { createEscrow } from "../src/services/economy/escrow";

type CreateDb = Parameters<typeof createEscrow>[0];
type CreateRedis = Parameters<typeof createEscrow>[1];

const escrowService = readFileSync(
  new URL("../src/services/economy/escrow.ts", import.meta.url),
  "utf8",
);
const escrowRoute = readFileSync(
  new URL("../src/routes/economy/escrow.ts", import.meta.url),
  "utf8",
);

const projectId = "00000000-0000-4000-8000-000000000001";
const creator = {
  id: "00000000-0000-4000-8000-000000000002",
  projectId,
  balance: 100,
  currency: "GBP",
  status: "active",
};
const worker = {
  id: "00000000-0000-4000-8000-000000000003",
  projectId,
  balance: 0,
  currency: "GBP",
  status: "active",
};
const insertedEscrow = {
  id: "00000000-0000-4000-8000-000000000004",
  creatorWallet: creator.id,
  workerWallet: worker.id,
  amount: 80,
  description: "bounded work",
  status: "funded",
  managedBy: null,
};

const redis = {} as CreateRedis;

function fakeDb(
  lockedWallets: unknown[],
  debitResult: unknown[] = [{ id: creator.id }],
): {
  db: CreateDb;
  updateCalls: () => number;
  insertCalls: () => number;
  insertedValues: () => unknown[];
} {
  let updates = 0;
  let inserts = 0;
  const values: unknown[] = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            for: async () => lockedWallets,
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            updates++;
            return debitResult;
          },
        }),
      }),
    }),
    insert: () => {
      const insertIndex = inserts++;
      return {
        values: (value: unknown) => {
          values.push(value);
          if (insertIndex === 0) {
            return {
              returning: async () => [insertedEscrow],
            };
          }
          return Promise.resolve([]);
        },
      };
    },
  };

  const db = {
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) =>
      run(tx),
  } as unknown as CreateDb;

  return {
    db,
    updateCalls: () => updates,
    insertCalls: () => inserts,
    insertedValues: () => values,
  };
}

function input(workerWalletId: string | undefined = worker.id) {
  return {
    creatorWalletId: creator.id,
    workerWalletId,
    amount: 80,
    description: "bounded work",
    projectId,
  };
}

async function rejectionStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
    throw new Error("expected escrow creation to be rejected");
  } catch (error) {
    return (error as { status?: number }).status ?? 0;
  }
}

describe("generic escrow creation safety", () => {
  test("locks wallets before checking balance and uses a guarded relative debit", () => {
    const start = escrowService.indexOf("export async function createEscrow");
    const end = escrowService.indexOf("// ─── Accept", start);
    const create = escrowService.slice(start, end);

    const orderedLockAt = create.indexOf('.orderBy(wallets.id)\n      .for("update")');
    const balanceCheckAt = create.indexOf("creatorWallet.balance < input.amount");
    const debitAt = create.indexOf(".update(wallets)");
    const escrowInsertAt = create.indexOf(".insert(escrows)");
    expect(orderedLockAt).toBeGreaterThanOrEqual(0);
    expect(balanceCheckAt).toBeGreaterThan(orderedLockAt);
    expect(debitAt).toBeGreaterThan(balanceCheckAt);
    expect(escrowInsertAt).toBeGreaterThan(debitAt);
    expect(create).toContain(
      ".set({ balance: sql`${wallets.balance} - ${input.amount}` })",
    );
    expect(create).toContain("inArray(wallets.id, requestedWalletIds)");
    expect(create).toContain("eq(wallets.projectId, input.projectId)");
    expect(create).toContain("gte(wallets.balance, input.amount)");
    expect(create).toContain(".returning({ id: wallets.id })");
    expect(create).not.toContain("creatorWallet.balance - input.amount");
  });

  test("keeps worker preassignment optional in the HTTP request", () => {
    expect(escrowRoute).toContain(
      "workerWalletId: z.string().uuid().optional()",
    );
    expect(escrowRoute).toContain("workerWalletId: body.workerWalletId");
  });

  test("allows an active same-project worker in the creator currency", async () => {
    const state = fakeDb([creator, worker]);

    await expect(createEscrow(state.db, redis, input())).resolves.toEqual({
      escrow: insertedEscrow,
      replayed: false,
    });
    expect(state.updateCalls()).toBe(1);
    expect(state.insertCalls()).toBe(2);
    expect(state.insertedValues()[0]).toMatchObject({
      creatorWallet: creator.id,
      workerWallet: worker.id,
      amount: 80,
      status: "funded",
    });
  });

  test("creates an unassigned escrow when no worker project is assigned yet", async () => {
    const state = fakeDb([creator]);

    await expect(
      createEscrow(state.db, redis, {
        ...input(),
        workerWalletId: undefined,
      }),
    ).resolves.toEqual({ escrow: insertedEscrow, replayed: false });
    expect(state.insertedValues()[0]).toMatchObject({ workerWallet: null });
  });

  test("rejects a cross-project worker before debit or insert", async () => {
    // The project-scoped locked-wallet query omits a foreign worker row.
    const state = fakeDb([creator]);

    expect(await rejectionStatus(createEscrow(state.db, redis, input()))).toBe(
      403,
    );
    expect(state.updateCalls()).toBe(0);
    expect(state.insertCalls()).toBe(0);
  });

  test("rejects inactive and currency-incompatible workers before debit", async () => {
    const inactive = fakeDb([creator, { ...worker, status: "frozen" }]);
    expect(
      await rejectionStatus(createEscrow(inactive.db, redis, input())),
    ).toBe(400);
    expect(inactive.updateCalls()).toBe(0);

    const wrongCurrency = fakeDb([
      creator,
      { ...worker, currency: "USD" },
    ]);
    expect(
      await rejectionStatus(createEscrow(wrongCurrency.db, redis, input())),
    ).toBe(400);
    expect(wrongCurrency.updateCalls()).toBe(0);
  });

  test("fails closed if the guarded debit cannot update the locked wallet", async () => {
    const state = fakeDb([creator, worker], []);

    expect(await rejectionStatus(createEscrow(state.db, redis, input()))).toBe(
      409,
    );
    expect(state.updateCalls()).toBe(1);
    expect(state.insertCalls()).toBe(0);
  });
});
