/** Escrow service: create · accept · release · refund · dispute · expire. */

import { createHash } from "node:crypto";

import { and, eq, exists, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { db as sharedDb } from "../../db/client";
import {
  escrowCreateIdempotency,
  escrows,
  policies,
  transactions,
  wallets,
} from "../../db/schema/economy";
import {
  disputeCases,
  substrateTasks,
  templatePurchases,
} from "../../db/schema/marketplace";
import { checkPaymentAgainstPolicy } from "./wallets";

type DB = typeof sharedDb;
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Escrow = typeof escrows.$inferSelect;
const ESCROW_IDEMPOTENCY_KEY_PATTERN = /^[!-~]{8,256}$/u;
const ESCROW_STATUSES = ["funded", "released", "refunded", "disputed"] as const;

export type EscrowStatus = (typeof ESCROW_STATUSES)[number];

export function normalizeEscrowStatusFilter(
  status?: string,
): EscrowStatus | undefined {
  if (status === undefined) return undefined;
  if ((ESCROW_STATUSES as readonly string[]).includes(status)) {
    return status as EscrowStatus;
  }
  throw new HTTPException(400, {
    message: `Unknown escrow status: ${status}`,
  });
}

function escrowReadableByProject(db: DB, projectId: string) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(wallets)
      .where(
        and(
          eq(wallets.projectId, projectId),
          or(
            eq(wallets.id, escrows.creatorWallet),
            eq(wallets.id, escrows.workerWallet),
          ),
        ),
      ),
  );
}

export function assertGenericEscrowMutationAllowed(
  managedBy: typeof escrows.$inferSelect.managedBy,
): void {
  if (managedBy !== null) {
    throw new HTTPException(409, {
      message: "Escrow transitions are managed by its marketplace workflow",
    });
  }
}

// ─── Settlement checks ──────────────────────────────────────────────────────
// Release and refund move real balances, so they honour what the other money
// paths honour: wallet status and spending policy, the escrow's own deadline
// and worker, and the subsystem that owns an escrow it created itself.

const SUBSYSTEM_ESCROW_REFUSALS = {
  dispute_bond:
    "This escrow holds a dispute bond; it settles only through its dispute case",
  substrate_task:
    "This escrow holds a substrate-task bounty; it settles only through that task",
  template_purchase:
    "This escrow belongs to a template purchase; it settles only through that purchase",
} as const;

type SubsystemEscrowOwner = keyof typeof SUBSYSTEM_ESCROW_REFUSALS;

/** Dispute bonds, substrate-task bounties, and template purchases create
 * their own escrows and settle them on their own paths. Their escrows carry
 * no managed_by (its database check names only the marketplace workflows),
 * so they are recognised by the row that references them, which each of
 * those paths writes in the same transaction as the escrow. */
export async function assertNotSubsystemEscrow(
  tx: Tx,
  escrowId: string,
): Promise<void> {
  const [row] = await tx
    .select({
      owner: sql<SubsystemEscrowOwner | null>`case
        when ${exists(
          tx
            .select({ one: sql`1` })
            .from(disputeCases)
            .where(eq(disputeCases.escalatorBondEscrowId, escrows.id)),
        )} then 'dispute_bond'
        when ${exists(
          tx
            .select({ one: sql`1` })
            .from(substrateTasks)
            .where(eq(substrateTasks.escrowId, escrows.id)),
        )} then 'substrate_task'
        when ${exists(
          tx
            .select({ one: sql`1` })
            .from(templatePurchases)
            .where(eq(templatePurchases.escrowId, escrows.id)),
        )} then 'template_purchase'
      end`,
    })
    .from(escrows)
    .where(eq(escrows.id, escrowId));
  if (row?.owner) {
    throw new HTTPException(409, {
      message: SUBSYSTEM_ESCROW_REFUSALS[row.owner],
    });
  }
}

/** Past its deadline an escrow has expired: the expiry sweep would refund
 * it, so the generic routes treat it the same whether or not the sweep ran. */
export function escrowDeadlinePassed(
  escrow: Pick<Escrow, "deadline">,
  now: Date = new Date(),
): boolean {
  return escrow.deadline !== null && escrow.deadline < now;
}

/** Locks the escrow's creator and worker wallets in id order, the order the
 * other escrow paths use. */
async function lockEscrowWallets(tx: Tx, escrow: Escrow) {
  const walletIds = [
    ...new Set(
      [escrow.creatorWallet, escrow.workerWallet].filter(
        (walletId): walletId is string => walletId !== null,
      ),
    ),
  ].sort();
  const locked = await tx
    .select()
    .from(wallets)
    .where(inArray(wallets.id, walletIds))
    .orderBy(wallets.id)
    .for("update");
  return {
    creatorWallet: locked.find((wallet) => wallet.id === escrow.creatorWallet),
    workerWallet: escrow.workerWallet
      ? locked.find((wallet) => wallet.id === escrow.workerWallet)
      : undefined,
  };
}

/** A release is the creator wallet's payment to the worker, so the creator
 * wallet's spending policy applies to it as it does to a spend. Hourly and
 * daily limits are counted by wallet spend in Redis, which settlement cannot
 * see; rather than guess at a total, a release from a wallet with either
 * limit set is refused, and the wallet's owner can change its policy. */
function assertReleaseWithinPolicy(
  policy: typeof policies.$inferSelect,
  amount: number,
  workerWalletId: string,
): void {
  checkPaymentAgainstPolicy(policy, amount, workerWalletId);
  if (policy.maxPerHour !== null || policy.maxPerDay !== null) {
    throw new HTTPException(402, {
      message:
        "The creator wallet's policy sets an hourly or daily spend limit, which escrow release cannot count; change that policy to release from this wallet",
    });
  }
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreateEscrowInput {
  creatorWalletId: string;
  workerWalletId?: string;
  amount: number;
  description: string;
  deadline?: Date;
  projectId: string;
  idempotencyKey?: string;
}

export interface CreateEscrowOutcome {
  escrow: typeof escrows.$inferSelect;
  replayed: boolean;
}

export function escrowCreationRequestSha256(
  input: Pick<
    CreateEscrowInput,
    | "creatorWalletId"
    | "workerWalletId"
    | "amount"
    | "description"
    | "deadline"
  >,
): string {
  const canonicalRequest = JSON.stringify({
    creator_wallet_id: input.creatorWalletId,
    worker_wallet_id: input.workerWalletId ?? null,
    amount: input.amount,
    description: input.description,
    deadline: input.deadline?.toISOString() ?? null,
  });
  return createHash("sha256").update(canonicalRequest).digest("hex");
}

export function escrowIdempotencyKeySha256(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generic create is resting at the HTTP boundary
 * (services/economy/config.ts genericEscrowCreateAllowed(); contract:
 * docs/SAFETY-BOUNDARIES.md, "Generic escrow create and wallet spend —
 * resting"). This function is kept intact for a reviewed reopening, which
 * must first apply the creator wallet's spending policy here
 * (per-transaction, hourly/daily, allowed-recipient, and approval-threshold
 * limits that spendFromWallet enforces in services/economy/wallets.ts).
 * Creating an escrow debits the wallet but currently checks no policy.
 *
 * Release and refund are open, at the creator project's direction, with the
 * checks under "Settlement checks" above. Release needs the escrow funded,
 * assigned, and before its deadline, both wallets active, and the creator
 * wallet's spending policy satisfied. Refund lands in the creator wallet
 * whatever its status; once a wallet in another project has accepted, it
 * waits for the escrow's deadline, if one is set. Workflow-managed
 * marketplace escrows (assertGenericEscrowMutationAllowed) and escrows that
 * dispute bonds, substrate-task bounties, or template purchases created
 * (assertNotSubsystemEscrow) refuse the generic transitions with 409. No
 * function in this service uses Redis, so none takes a Redis client; a
 * process run with workers disabled settles existing escrows the same way.
 * expireOverdue has no scheduler, so no automatic deadline refund runs. */
export async function createEscrow(
  db: DB,
  input: CreateEscrowInput,
): Promise<CreateEscrowOutcome> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
    throw new HTTPException(400, { message: "Amount must be positive" });
  if (input.deadline && Number.isNaN(input.deadline.getTime())) {
    throw new HTTPException(400, { message: "Deadline must be a valid date" });
  }
  if (
    input.idempotencyKey !== undefined &&
    !ESCROW_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
  ) {
    throw new HTTPException(400, {
      message: "Idempotency-Key must be 8-256 visible ASCII characters.",
    });
  }

  const requestSha256 = input.idempotencyKey
    ? escrowCreationRequestSha256(input)
    : undefined;
  const idempotencyKeySha256 = input.idempotencyKey
    ? escrowIdempotencyKeySha256(input.idempotencyKey)
    : undefined;

  return db.transaction(async (tx) => {
    if (idempotencyKeySha256 && requestSha256) {
      const [reservation] = await tx
        .insert(escrowCreateIdempotency)
        .values({
          projectId: input.projectId,
          idempotencyKeySha256,
          requestSha256,
        })
        .onConflictDoNothing({
          target: [
            escrowCreateIdempotency.projectId,
            escrowCreateIdempotency.idempotencyKeySha256,
          ],
        })
        .returning({ id: escrowCreateIdempotency.id });

      if (!reservation) {
        // ON CONFLICT waits for a concurrent creator to commit. This separate
        // statement then sees its completed durable reservation.
        const [existingReservation] = await tx
          .select()
          .from(escrowCreateIdempotency)
          .where(
            and(
              eq(escrowCreateIdempotency.projectId, input.projectId),
              eq(
                escrowCreateIdempotency.idempotencyKeySha256,
                idempotencyKeySha256,
              ),
            ),
          );
        if (!existingReservation) {
          throw new HTTPException(409, {
            message: "Idempotency reservation could not be reconciled",
          });
        }
        if (existingReservation.requestSha256 !== requestSha256) {
          throw new HTTPException(409, {
            message:
              "Idempotency-Key was already used for different escrow creation input",
          });
        }
        if (!existingReservation.escrowId) {
          throw new HTTPException(409, {
            message: "Idempotency reservation has no completed escrow",
          });
        }

        const [existingEscrow] = await tx
          .select()
          .from(escrows)
          .where(eq(escrows.id, existingReservation.escrowId));
        if (!existingEscrow) {
          throw new HTTPException(409, {
            message: "Idempotency reservation references a missing escrow",
          });
        }
        return { escrow: existingEscrow, replayed: true };
      }
    }

    const requestedWalletIds = [
      ...new Set(
        [input.creatorWalletId, input.workerWalletId].filter(
          (walletId): walletId is string => walletId !== undefined,
        ),
      ),
    ].sort();
    const lockedWallets = await tx
      .select()
      .from(wallets)
      .where(
        and(
          inArray(wallets.id, requestedWalletIds),
          eq(wallets.projectId, input.projectId),
        ),
      )
      .orderBy(wallets.id)
      .for("update");

    const creatorWallet = lockedWallets.find(
      (wallet) => wallet.id === input.creatorWalletId,
    );

    if (!creatorWallet)
      throw new HTTPException(404, { message: "Creator wallet not found" });
    if (creatorWallet.status !== "active") {
      throw new HTTPException(400, {
        message: "Creator wallet is not active",
      });
    }
    if (creatorWallet.balance < input.amount) {
      throw new HTTPException(402, { message: "Insufficient balance for escrow" });
    }

    let workerWallet: (typeof lockedWallets)[number] | undefined;
    if (input.workerWalletId) {
      workerWallet = lockedWallets.find(
        (wallet) => wallet.id === input.workerWalletId,
      );
      // Project authentication can authorize only wallets that project controls.
      // A cross-project worker's project accepts an unassigned escrow separately.
      if (!workerWallet) {
        throw new HTTPException(403, {
          message:
            "Worker wallet is not owned by this project; create an unassigned escrow and let the worker's project accept it",
        });
      }
      if (workerWallet.status !== "active") {
        throw new HTTPException(400, {
          message: "Worker wallet is not active",
        });
      }
      if (workerWallet.currency !== creatorWallet.currency) {
        throw new HTTPException(400, {
          message: "Worker wallet currency does not match the escrow",
        });
      }
    }

    const [debitedWallet] = await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${input.amount}` })
      .where(
        and(
          eq(wallets.id, input.creatorWalletId),
          eq(wallets.projectId, input.projectId),
          eq(wallets.status, "active"),
          gte(wallets.balance, input.amount),
        ),
      )
      .returning({ id: wallets.id });
    if (!debitedWallet) {
      throw new HTTPException(409, {
        message: "Creator wallet state changed before escrow funding",
      });
    }

    const [escrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: input.creatorWalletId,
        workerWallet: workerWallet?.id ?? null,
        amount: input.amount,
        description: input.description,
        deadline: input.deadline ?? null,
        status: "funded",
      })
      .returning();

    await tx.insert(transactions).values({
      walletId: input.creatorWalletId,
      type: "escrow_lock",
      amount: -input.amount,
      counterparty: escrow!.id,
      description: `Escrow locked: ${input.description}`,
      escrowId: escrow!.id,
      metadata: {},
    });

    if (idempotencyKeySha256) {
      const [completedReservation] = await tx
        .update(escrowCreateIdempotency)
        .set({ escrowId: escrow!.id })
        .where(
          and(
            eq(escrowCreateIdempotency.projectId, input.projectId),
            eq(
              escrowCreateIdempotency.idempotencyKeySha256,
              idempotencyKeySha256,
            ),
            eq(escrowCreateIdempotency.requestSha256, requestSha256!),
            isNull(escrowCreateIdempotency.escrowId),
          ),
        )
        .returning({ id: escrowCreateIdempotency.id });
      if (!completedReservation) {
        throw new HTTPException(409, {
          message: "Idempotency reservation changed before escrow completion",
        });
      }
    }

    return { escrow: escrow!, replayed: false };
  });
}

// ─── Accept ─────────────────────────────────────────────────────────────────

export async function acceptEscrow(
  db: DB,
  escrowId: string,
  workerWalletId: string,
  projectId: string,
) {
  return db.transaction(async (tx) => {
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrowId))
      .for("update");
    if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });
    assertGenericEscrowMutationAllowed(escrow.managedBy);
    if (escrow.status !== "funded") {
      throw new HTTPException(400, {
        message: `Escrow is already ${escrow.status}`,
      });
    }
    if (escrow.workerWallet) {
      throw new HTTPException(400, {
        message: "Escrow already has an assigned worker",
      });
    }

    const requestedWalletIds = [
      ...new Set([escrow.creatorWallet, workerWalletId]),
    ].sort();
    const lockedWallets = await tx
      .select()
      .from(wallets)
      .where(inArray(wallets.id, requestedWalletIds))
      .orderBy(wallets.id)
      .for("update");
    const workerWallet = lockedWallets.find(
      (wallet) => wallet.id === workerWalletId,
    );
    if (!workerWallet || workerWallet.projectId !== projectId) {
      throw new HTTPException(403, {
        message: "Worker wallet is not owned by this project",
      });
    }
    if (workerWallet.status !== "active") {
      throw new HTTPException(400, {
        message: "Worker wallet is not active",
      });
    }

    const creatorWallet = lockedWallets.find(
      (wallet) => wallet.id === escrow.creatorWallet,
    );
    if (!creatorWallet) {
      throw new HTTPException(409, {
        message: "Escrow creator wallet no longer exists",
      });
    }
    if (workerWallet.currency !== creatorWallet.currency) {
      throw new HTTPException(400, {
        message: "Worker wallet currency does not match the escrow",
      });
    }

    const [updated] = await tx
      .update(escrows)
      .set({ workerWallet: workerWalletId })
      .where(
        and(
          eq(escrows.id, escrowId),
          eq(escrows.status, "funded"),
          isNull(escrows.workerWallet),
          isNull(escrows.managedBy),
        ),
      )
      .returning();
    if (!updated) {
      throw new HTTPException(409, { message: "Escrow state changed" });
    }

    return updated;
  });
}

// ─── Release ────────────────────────────────────────────────────────────────

export async function releaseEscrow(
  db: DB,
  escrowId: string,
  projectId: string,
) {
  return db.transaction(async (tx) => {
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrowId))
      .for("update");

    if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });
    assertGenericEscrowMutationAllowed(escrow.managedBy);
    await assertNotSubsystemEscrow(tx, escrow.id);
    if (escrow.status !== "funded") {
      throw new HTTPException(400, {
        message: `Cannot release escrow with status: ${escrow.status}`,
      });
    }
    if (!escrow.workerWallet) {
      throw new HTTPException(400, {
        message: "No worker assigned — cannot release",
      });
    }
    if (escrowDeadlinePassed(escrow)) {
      throw new HTTPException(400, {
        message: `Escrow deadline passed at ${escrow.deadline!.toISOString()}; it can only be refunded`,
      });
    }

    const { creatorWallet, workerWallet } = await lockEscrowWallets(tx, escrow);
    // Project owns the creator wallet.
    if (!creatorWallet || creatorWallet.projectId !== projectId) {
      throw new HTTPException(403, {
        message: "Not authorised to release this escrow",
      });
    }
    if (creatorWallet.status !== "active") {
      throw new HTTPException(400, {
        message: `Creator wallet is ${creatorWallet.status}`,
      });
    }
    if (!workerWallet) {
      throw new HTTPException(409, {
        message: "Escrow worker wallet no longer exists",
      });
    }
    if (workerWallet.status !== "active") {
      throw new HTTPException(400, {
        message: `Worker wallet is ${workerWallet.status}`,
      });
    }

    const [policy] = await tx
      .select()
      .from(policies)
      .where(eq(policies.walletId, creatorWallet.id));
    if (policy) assertReleaseWithinPolicy(policy, escrow.amount, workerWallet.id);

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${escrow.amount}` })
      .where(eq(wallets.id, escrow.workerWallet));

    const [updated] = await tx
      .update(escrows)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(escrows.id, escrowId))
      .returning();

    await tx.insert(transactions).values({
      walletId: escrow.workerWallet,
      type: "escrow_release",
      amount: escrow.amount,
      counterparty: escrow.creatorWallet,
      description: `Escrow released: ${escrow.description}`,
      escrowId: escrow.id,
      metadata: {},
    });

    return updated;
  });
}

// ─── Refund ─────────────────────────────────────────────────────────────────

export async function refundEscrow(
  db: DB,
  escrowId: string,
  projectId: string,
) {
  return db.transaction(async (tx) => {
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrowId))
      .for("update");

    if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });
    assertGenericEscrowMutationAllowed(escrow.managedBy);
    await assertNotSubsystemEscrow(tx, escrow.id);
    if (!["funded", "disputed"].includes(escrow.status)) {
      throw new HTTPException(400, {
        message: `Cannot refund escrow with status: ${escrow.status}`,
      });
    }

    const { creatorWallet, workerWallet } = await lockEscrowWallets(tx, escrow);
    if (!creatorWallet || creatorWallet.projectId !== projectId) {
      throw new HTTPException(403, {
        message: "Not authorised to refund this escrow",
      });
    }
    // Once a wallet in another project has accepted, a deadline is the
    // creator's promise to hold the funds until then: the creator can
    // release before it, and refund after it. With no deadline there is no
    // such promise, and accept needs no creator consent, so the creator
    // keeps its refund. The creator wallet's own status is not checked: a
    // refund is the money going home, and a frozen wallet still holds it.
    const acceptedElsewhere =
      escrow.workerWallet !== null &&
      workerWallet?.projectId !== creatorWallet.projectId;
    if (
      acceptedElsewhere &&
      escrow.deadline !== null &&
      !escrowDeadlinePassed(escrow)
    ) {
      throw new HTTPException(409, {
        message: `A worker in another project accepted this escrow; it can be released now or refunded after its deadline, ${escrow.deadline.toISOString()}`,
      });
    }

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${escrow.amount}` })
      .where(eq(wallets.id, escrow.creatorWallet));

    const [updated] = await tx
      .update(escrows)
      .set({ status: "refunded" })
      .where(eq(escrows.id, escrowId))
      .returning();

    await tx.insert(transactions).values({
      walletId: escrow.creatorWallet,
      type: "escrow_refund",
      amount: escrow.amount,
      counterparty: escrowId,
      description: `Escrow refunded: ${escrow.description}`,
      escrowId: escrow.id,
      metadata: {},
    });

    return updated;
  });
}

// ─── Dispute ────────────────────────────────────────────────────────────────

export async function disputeEscrow(
  db: DB,
  escrowId: string,
  projectId: string,
) {
  return db.transaction(async (tx) => {
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrowId))
      .for("update");
    if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });
    assertGenericEscrowMutationAllowed(escrow.managedBy);
    await assertNotSubsystemEscrow(tx, escrow.id);
    if (escrow.status !== "funded") {
      throw new HTTPException(400, {
        message: `Cannot dispute escrow with status: ${escrow.status}`,
      });
    }

    const [creatorWallet] = await tx
      .select()
      .from(wallets)
      .where(
        and(eq(wallets.id, escrow.creatorWallet), eq(wallets.projectId, projectId)),
      );

    if (!creatorWallet)
      throw new HTTPException(403, { message: "Not authorised" });

    const [updated] = await tx
      .update(escrows)
      .set({ status: "disputed" })
      .where(and(eq(escrows.id, escrowId), eq(escrows.status, "funded")))
      .returning();
    if (!updated) {
      throw new HTTPException(409, { message: "Escrow state changed" });
    }

    return updated;
  });
}

// ─── Expire overdue (intended for cron) ─────────────────────────────────────

export async function expireOverdue(db: DB): Promise<number> {
  const overdue = await db
    .select()
    .from(escrows)
    .where(
      and(
        eq(escrows.status, "funded"),
        isNull(escrows.managedBy),
        lt(escrows.deadline, new Date()),
      ),
    );

  let count = 0;
  for (const escrow of overdue) {
    try {
      const [wallet] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.id, escrow.creatorWallet));

      if (wallet) {
        await refundEscrow(db, escrow.id, wallet.projectId);
        count++;
      }
    } catch {
      /* one failure shouldn't block the rest */
    }
  }

  return count;
}

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getEscrow(db: DB, escrowId: string, projectId: string) {
  const [result] = await db
    .select({ escrow: escrows })
    .from(escrows)
    .where(
      and(
        eq(escrows.id, escrowId),
        escrowReadableByProject(db, projectId),
      ),
    );
  if (!result) throw new HTTPException(404, { message: "Escrow not found" });
  return result.escrow;
}

export async function listEscrows(
  db: DB,
  projectId: string,
  status?: string,
) {
  const normalizedStatus = normalizeEscrowStatusFilter(status);
  const rows = await db
    .select({ escrow: escrows })
    .from(escrows)
    .where(
      and(
        escrowReadableByProject(db, projectId),
        normalizedStatus
          ? eq(escrows.status, normalizedStatus)
          : undefined,
      ),
    );
  return rows.map((row) => row.escrow);
}
