import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { acceptEscrow } from "../src/services/economy/escrow";

type AcceptDb = Parameters<typeof acceptEscrow>[0];

const escrowService = readFileSync(
  new URL("../src/services/economy/escrow.ts", import.meta.url),
  "utf8",
);
const escrowRoute = readFileSync(
  new URL("../src/routes/economy/escrow.ts", import.meta.url),
  "utf8",
);

const fundedEscrow = {
  id: "00000000-0000-4000-8000-000000000001",
  creatorWallet: "00000000-0000-4000-8000-000000000002",
  workerWallet: null,
  managedBy: null,
  status: "funded",
};

const activeWorker = {
  id: "00000000-0000-4000-8000-000000000003",
  projectId: "00000000-0000-4000-8000-000000000004",
  status: "active",
  currency: "GBP",
};
const creatorWallet = {
  id: fundedEscrow.creatorWallet,
  projectId: "00000000-0000-4000-8000-000000000005",
  status: "active",
  currency: "GBP",
};

function fakeDb(
  selectResults: unknown[][],
  updated: unknown[] = [{ ...fundedEscrow, workerWallet: activeWorker.id }],
): { db: AcceptDb; updateCalls: () => number; selectCalls: () => number } {
  let selects = 0;
  let updates = 0;

  const tx = {
    select: () => {
      const result = selectResults[selects++] ?? [];
      const terminal = {
        for: async () => result,
        limit: async () => result,
        orderBy: () => terminal,
      };
      return {
        from: () => ({
          where: () => terminal,
        }),
      };
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            updates++;
            return updated;
          },
        }),
      }),
    }),
  };

  const db = {
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) =>
      run(tx),
  } as unknown as AcceptDb;

  return {
    db,
    updateCalls: () => updates,
    selectCalls: () => selects,
  };
}

async function rejectionStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
    throw new Error("expected escrow acceptance to be rejected");
  } catch (error) {
    return (error as { status?: number }).status ?? 0;
  }
}

describe("generic escrow acceptance authorization", () => {
  test("route passes the authenticated project without changing the request body", () => {
    expect(escrowRoute).toContain("const project = c.var.project");
    expect(escrowRoute).toContain("body.workerWalletId,\n      project.id,");
    expect(escrowRoute).toContain(
      'z.object({ workerWalletId: z.string().uuid() })',
    );
  });

  test("locks and authorizes before a conditional generic-only mutation", () => {
    const start = escrowService.indexOf("export async function acceptEscrow");
    const end = escrowService.indexOf("// ─── Release", start);
    const accept = escrowService.slice(start, end);

    const escrowLockAt = accept.indexOf('.for("update")');
    const walletLockAt = accept.indexOf('.for("update")', escrowLockAt + 1);
    const ownershipAt = accept.indexOf("workerWallet.projectId !== projectId");
    const mutationAt = accept.indexOf(".update(escrows)");
    expect(escrowLockAt).toBeGreaterThanOrEqual(0);
    expect(walletLockAt).toBeGreaterThan(escrowLockAt);
    expect(ownershipAt).toBeGreaterThan(walletLockAt);
    expect(mutationAt).toBeGreaterThan(ownershipAt);
    expect(accept).toContain("inArray(wallets.id, requestedWalletIds)");
    expect(accept).toContain(".orderBy(wallets.id)");
    expect(accept).toContain(
      "assertGenericEscrowMutationAllowed(escrow.managedBy)",
    );
    expect(accept).toContain("isNull(escrows.workerWallet)");
    expect(accept).toContain("isNull(escrows.managedBy)");
  });

  test("rejects a worker wallet outside the authenticated project before mutation", async () => {
    const state = fakeDb([
      [fundedEscrow],
      [creatorWallet, { ...activeWorker, projectId: creatorWallet.projectId }],
    ]);

    expect(
      await rejectionStatus(
        acceptEscrow(
          state.db,
          fundedEscrow.id,
          activeWorker.id,
          activeWorker.projectId,
        ),
      ),
    ).toBe(403);
    expect(state.updateCalls()).toBe(0);
  });

  test("managed escrows remain unavailable to generic acceptance", async () => {
    const state = fakeDb([[{ ...fundedEscrow, managedBy: "capability_invocation" }]]);

    expect(
      await rejectionStatus(
        acceptEscrow(
          state.db,
          fundedEscrow.id,
          activeWorker.id,
          activeWorker.projectId,
        ),
      ),
    ).toBe(409);
    expect(state.selectCalls()).toBe(1);
    expect(state.updateCalls()).toBe(0);
  });

  test("rejects inactive and currency-incompatible worker wallets", async () => {
    const inactive = fakeDb([
      [fundedEscrow],
      [creatorWallet, { ...activeWorker, status: "frozen" }],
    ]);
    expect(
      await rejectionStatus(
        acceptEscrow(
          inactive.db,
          fundedEscrow.id,
          activeWorker.id,
          activeWorker.projectId,
        ),
      ),
    ).toBe(400);
    expect(inactive.updateCalls()).toBe(0);

    const wrongCurrency = fakeDb([
      [fundedEscrow],
      [creatorWallet, { ...activeWorker, currency: "USD" }],
    ]);
    expect(
      await rejectionStatus(
        acceptEscrow(
          wrongCurrency.db,
          fundedEscrow.id,
          activeWorker.id,
          activeWorker.projectId,
        ),
      ),
    ).toBe(400);
    expect(wrongCurrency.updateCalls()).toBe(0);
  });

  test("accepts an owned active worker wallet in the escrow currency", async () => {
    const accepted = { ...fundedEscrow, workerWallet: activeWorker.id };
    const state = fakeDb(
      [[fundedEscrow], [creatorWallet, activeWorker]],
      [accepted],
    );

    await expect(
      acceptEscrow(
        state.db,
        fundedEscrow.id,
        activeWorker.id,
        activeWorker.projectId,
      ),
    ).resolves.toEqual(accepted);
    expect(state.updateCalls()).toBe(1);
  });

  test("fails closed when the conditional update loses a state race", async () => {
    const state = fakeDb(
      [[fundedEscrow], [creatorWallet, activeWorker]],
      [],
    );

    expect(
      await rejectionStatus(
        acceptEscrow(
          state.db,
          fundedEscrow.id,
          activeWorker.id,
          activeWorker.projectId,
        ),
      ),
    ).toBe(409);
    expect(state.updateCalls()).toBe(1);
  });
});
