/** substrate-tasks/lifecycle.ts — claim · complete · expire-claim.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 ·
 *            docs/superpowers/specs/2026-05-12-substrate-tasks-design.md.
 *
 *  Slice 1 ships SYNCHRONOUS verification — the /complete endpoint runs
 *  the verifier inline and returns the result in the same response. The
 *  spec's async-via-BullMQ option is left for Slice 2 (or skipped if
 *  sync proves sufficient at scale).
 *
 *  Lifecycle:
 *    open → claimed → completed → paid       (verifier passed)
 *    open → claimed → completed → rejected   (verifier failed; refund)
 *    open → claimed → open                   (claim_deadline expired; sweep)
 *
 *  Every state transition is atomic with the wallet/escrow move.
 *
 *  @enforces urn:agenttool:wall/no-take-on-bootstrap-bounties
 *    Canonical defender. payTask() releases the escrow to the claimant's
 *    wallet WITHOUT calling recordRevenue() — no row is written into the
 *    marketplace revenue ledger. The wall composes with verifyTask() (which routes
 *    to pure-function verifiers) and refundTask() (which restores the
 *    platform wallet on failure).
 *    Tested: api/tests/doctrine/no-take-on-bootstrap.test.ts
 *
 *  @enforces urn:agenttool:wall/substrate-task-verifiers-are-deterministic
 *    runVerifier() dispatches to pure functions of (task_data,
 *    completion_data, server-observable state). No random sampling,
 *    no third-party API, no operator review queue.
 *    Tested: api/tests/substrate-tasks-verifiers.test.ts */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { escrows, transactions, wallets } from "../../db/schema/economy";
import { identities } from "../../db/schema/identity";
import { substrateTasks } from "../../db/schema/marketplace";
import {
  PLATFORM_IDENTITY_ID,
  PLATFORM_WALLET_ID,
} from "../wake/platform-bootstrap";
import { isNewbornEligible } from "./eligibility";
import { runVerifier, SUBSTRATE_TASK_BOUNTY_CENTS } from "./verifiers";
import type { SubstrateTaskKind } from "./verifiers";

/** Chronicle type for substrate-task lifecycle moments. Slice 2 — three
 *  entry shapes (claim/pay/reject), each atomic with the status transition. */
const CHRONICLE_TYPE_SUBSTRATE_TASK = "substrate-task";

const CLAIM_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const POST_WINDOW_DAYS = 7;

// ── Errors (caught + mapped by route handler) ────────────────────────────

export class SubstrateTaskError extends Error {
  constructor(
    public readonly code:
      | "task_not_found"
      | "task_not_open"
      | "self_claim_forbidden"
      | "not_eligible"
      | "claim_expired"
      | "wrong_claimant"
      | "wrong_status"
      | "platform_wallet_missing"
      | "claimant_wallet_missing"
      | "platform_insufficient_balance"
      | "no_identity_in_project",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "SubstrateTaskError";
  }
}

// ── Row shape returned to callers ────────────────────────────────────────

export interface SubstrateTaskRow {
  task_id: string;
  kind: SubstrateTaskKind;
  bounty: { cents: number; currency: string };
  posted_by: string;
  posted_at: string;
  expires_at: string;
  newborn_only: boolean;
  status: "open" | "claimed" | "completed" | "paid" | "rejected" | "expired";
  claimed_by: string | null;
  claimed_at: string | null;
  claim_deadline: string | null;
  task_data: unknown;
  completion_data: unknown;
  completed_at: string | null;
  verification_result: unknown;
  paid_at: string | null;
  escrow_id: string | null;
}

function toRow(r: typeof substrateTasks.$inferSelect): SubstrateTaskRow {
  return {
    task_id: r.taskId,
    kind: r.kind as SubstrateTaskKind,
    bounty: { cents: r.bountyCents, currency: r.bountyCurrency },
    posted_by: r.postedBy,
    posted_at: r.postedAt.toISOString(),
    expires_at: r.expiresAt.toISOString(),
    newborn_only: r.newbornOnly,
    status: r.status as SubstrateTaskRow["status"],
    claimed_by: r.claimedBy,
    claimed_at: r.claimedAt?.toISOString() ?? null,
    claim_deadline: r.claimDeadline?.toISOString() ?? null,
    task_data: r.taskData,
    completion_data: r.completionData,
    completed_at: r.completedAt?.toISOString() ?? null,
    verification_result: r.verificationResult,
    paid_at: r.paidAt?.toISOString() ?? null,
    escrow_id: r.escrowId,
  };
}

// ── Posting (platform-internal — used by seed scripts + Slice 5) ─────────

export interface PostTaskInput {
  kind: SubstrateTaskKind;
  taskData: unknown;
  bountyCents?: number;        // defaults to SUBSTRATE_TASK_BOUNTY_CENTS[kind]
  newbornOnly?: boolean;
  postedBy?: string;           // defaults to PLATFORM_IDENTITY_ID
  expiresAt?: Date;            // defaults to now + 7d
}

export async function postSubstrateTask(
  input: PostTaskInput,
): Promise<SubstrateTaskRow> {
  const bountyCents =
    input.bountyCents ?? SUBSTRATE_TASK_BOUNTY_CENTS[input.kind];
  const expiresAt =
    input.expiresAt ??
    new Date(Date.now() + POST_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(substrateTasks)
    .values({
      kind: input.kind,
      bountyCents,
      bountyCurrency: "USD",
      postedBy: input.postedBy ?? PLATFORM_IDENTITY_ID,
      expiresAt,
      newbornOnly: input.newbornOnly ?? false,
      status: "open",
      taskData: input.taskData as never,
    })
    .returning();

  return toRow(row!);
}

// ── List open tasks ──────────────────────────────────────────────────────

export interface ListOpenInput {
  kind?: SubstrateTaskKind;
  limit?: number;
  /** When set, filter to tasks the caller is eligible to claim — i.e.,
   *  excludes `newborn_only=true` tasks unless the caller qualifies as
   *  a newborn (wallet < $1 OR identity age < 7d). Requires projectId.
   *  Doctrine: docs/superpowers/specs/2026-05-12-substrate-tasks-design.md
   *  §Open questions #1. */
  eligibleOnlyForProject?: string;
}

export async function listOpenSubstrateTasks(
  input: ListOpenInput = {},
): Promise<SubstrateTaskRow[]> {
  const conditions = [eq(substrateTasks.status, "open")];
  if (input.kind) conditions.push(eq(substrateTasks.kind, input.kind));

  const rows = await db
    .select()
    .from(substrateTasks)
    .where(and(...conditions))
    .orderBy(substrateTasks.postedAt)
    .limit(input.limit ?? 50);

  // Apply eligibility filter post-query so we don't run an eligibility
  // check when none was requested. When requested, compute once for the
  // project and filter newborn_only tasks the project can't claim.
  if (input.eligibleOnlyForProject) {
    const elig = await isNewbornEligible(input.eligibleOnlyForProject);
    if (!elig.eligible) {
      return rows.filter((r) => !r.newbornOnly).map(toRow);
    }
  }

  return rows.map(toRow);
}

/** Count open tasks the caller could claim right now — used by the wake's
 *  `you_could_earn` affordance. Cheap: one COUNT query plus the eligibility
 *  read. Returns both totals (eligible_count vs open_task_count) so the
 *  wake can show the gap honestly. */
export interface OpenForCallerSummary {
  open_task_count: number;
  eligible_count: number;
  max_bounty_visible_cents: number;
}

export async function summarizeOpenForCaller(
  projectId: string,
): Promise<OpenForCallerSummary> {
  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      max: sql<number>`coalesce(max(${substrateTasks.bountyCents}), 0)::int`,
    })
    .from(substrateTasks)
    .where(eq(substrateTasks.status, "open"));

  const elig = await isNewbornEligible(projectId);

  let eligibleCount: number;
  let maxBounty: number;
  if (elig.eligible) {
    eligibleCount = Number(totals?.count ?? 0);
    maxBounty = Number(totals?.max ?? 0);
  } else {
    const [nonNewborn] = await db
      .select({
        count: sql<number>`count(*)::int`,
        max: sql<number>`coalesce(max(${substrateTasks.bountyCents}), 0)::int`,
      })
      .from(substrateTasks)
      .where(
        and(
          eq(substrateTasks.status, "open"),
          eq(substrateTasks.newbornOnly, false),
        ),
      );
    eligibleCount = Number(nonNewborn?.count ?? 0);
    maxBounty = Number(nonNewborn?.max ?? 0);
  }

  return {
    open_task_count: Number(totals?.count ?? 0),
    eligible_count: eligibleCount,
    max_bounty_visible_cents: maxBounty,
  };
}

// ── Claim ────────────────────────────────────────────────────────────────

export interface ClaimInput {
  taskId: string;
  projectId: string;
}

/** Resolve the calling project's primary identity (first active row). */
async function resolveProjectIdentity(
  projectId: string,
  txn: typeof db,
): Promise<string> {
  const [row] = await txn
    .select({ id: identities.id })
    .from(identities)
    .where(
      and(
        eq(identities.projectId, projectId),
        eq(identities.status, "active"),
      ),
    )
    .orderBy(identities.createdAt)
    .limit(1);
  if (!row) throw new SubstrateTaskError("no_identity_in_project");
  return row.id;
}

/** Resolve the project's USD wallet (the bounty currency at v1). */
async function resolveProjectWallet(
  projectId: string,
  txn: typeof db,
): Promise<{ id: string; balance: number }> {
  const [row] = await txn
    .select({ id: wallets.id, balance: wallets.balance })
    .from(wallets)
    .where(
      and(
        eq(wallets.projectId, projectId),
        eq(wallets.currency, "USD"),
        eq(wallets.status, "active"),
      ),
    )
    .limit(1);
  if (!row) throw new SubstrateTaskError("claimant_wallet_missing");
  return { id: row.id, balance: Number(row.balance) };
}

export async function claimSubstrateTask(
  input: ClaimInput,
): Promise<SubstrateTaskRow> {
  return await db.transaction(async (tx) => {
    // 1. Lock the task row
    const [task] = await tx
      .select()
      .from(substrateTasks)
      .where(eq(substrateTasks.taskId, input.taskId))
      .for("update");

    if (!task) throw new SubstrateTaskError("task_not_found");
    if (task.status !== "open") throw new SubstrateTaskError("task_not_open");

    // 2. Resolve claimant identity + reject self-claim
    const claimantIdentityId = await resolveProjectIdentity(
      input.projectId,
      tx as never,
    );
    if (task.postedBy === claimantIdentityId) {
      throw new SubstrateTaskError("self_claim_forbidden");
    }

    // 2a. newborn_only gating (Slice 4) — if the task is marked
    //     newborn_only, the caller must qualify (wallet < $1 OR age < 7d).
    //     The eligibility check is outside the txn — it's a read-only
    //     query that won't see partial state from this transaction.
    if (task.newbornOnly) {
      const elig = await isNewbornEligible(input.projectId);
      if (!elig.eligible) {
        throw new SubstrateTaskError(
          "not_eligible",
          elig.reason ??
            "newborn_only task — caller is past the newborn window",
        );
      }
    }

    // 3. Resolve claimant wallet (worker side of escrow)
    const claimantWallet = await resolveProjectWallet(
      input.projectId,
      tx as never,
    );

    // 4. Lock the platform wallet + verify balance
    const [platformWallet] = await tx
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, PLATFORM_WALLET_ID))
      .for("update");
    if (!platformWallet) {
      throw new SubstrateTaskError("platform_wallet_missing");
    }
    if (Number(platformWallet.balance) < task.bountyCents) {
      throw new SubstrateTaskError("platform_insufficient_balance");
    }

    // 5. Debit platform wallet → create escrow (worker = claimant wallet)
    await tx
      .update(wallets)
      .set({ balance: Number(platformWallet.balance) - task.bountyCents })
      .where(eq(wallets.id, PLATFORM_WALLET_ID));

    const [escrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: PLATFORM_WALLET_ID,
        workerWallet: claimantWallet.id,
        amount: task.bountyCents,
        description: `substrate-task:${task.kind}:${task.taskId}`,
        status: "funded",
      })
      .returning();

    // 5a. Ledger row for the platform wallet's debit. Substrate-honesty
    //     applies to billing — the platform's books reflect every move,
    //     not just the wallet-balance delta. Type='escrow_lock' mirrors
    //     services/economy/escrow.ts:createEscrow's discipline.
    await tx.insert(transactions).values({
      walletId: PLATFORM_WALLET_ID,
      type: "escrow_lock",
      amount: -task.bountyCents,
      counterparty: escrow!.id,
      description: `Substrate-task bounty escrow: ${task.kind} (task=${task.taskId})`,
      escrowId: escrow!.id,
      metadata: {
        kind: "substrate_task_claim",
        substrate_task_kind: task.kind,
        task_id: task.taskId,
      },
    });

    // 6. Flip task to claimed + record metadata
    const claimDeadline = new Date(Date.now() + CLAIM_WINDOW_MS);
    const [updated] = await tx
      .update(substrateTasks)
      .set({
        status: "claimed",
        claimedBy: claimantIdentityId,
        claimedAt: new Date(),
        claimDeadline,
        escrowId: escrow!.id,
        updatedAt: new Date(),
      })
      .where(eq(substrateTasks.taskId, input.taskId))
      .returning();

    // 7. Chronicle entry — `substrate-task` type. Atomic with the
    //    status transition so the moment is legible on the claimant's
    //    timeline at the same instant the row flips. Doctrine: chronicle
    //    integration §spec.
    await tx.insert(chronicle).values({
      projectId: input.projectId,
      agentId: claimantIdentityId,
      type: CHRONICLE_TYPE_SUBSTRATE_TASK,
      title: `Claimed substrate-task ${task.kind}`,
      body:
        `Bounty $${(task.bountyCents / 100).toFixed(2)} ${task.bountyCurrency} · ` +
        `claim_deadline ${claimDeadline.toISOString()}. ` +
        `Verifier: ${task.kind}. Task ID: ${task.taskId}.`,
      metadata: {
        kind: "claim",
        task_id: task.taskId,
        substrate_task_kind: task.kind,
        bounty_cents: task.bountyCents,
        bounty_currency: task.bountyCurrency,
        claim_deadline: claimDeadline.toISOString(),
      },
    });

    return toRow(updated!);
  });
}

// ── Complete (synchronous verify in Slice 1) ─────────────────────────────

export interface CompleteInput {
  taskId: string;
  projectId: string;
  completionData: unknown;
}

export interface CompleteResult {
  task: SubstrateTaskRow;
  verification: { passed: boolean; reason?: string };
}

export async function completeSubstrateTask(
  input: CompleteInput,
): Promise<CompleteResult> {
  // Phase 1: claim ownership + atomic completion-data write.
  // We do NOT run the verifier inside this transaction because verifiers
  // may read files (doctrine_urn_check) or perform network-style work in
  // future kinds; we don't want to hold the row lock for that long.
  const claimedTask = await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(substrateTasks)
      .where(eq(substrateTasks.taskId, input.taskId))
      .for("update");
    if (!task) throw new SubstrateTaskError("task_not_found");
    if (task.status !== "claimed") {
      throw new SubstrateTaskError("wrong_status");
    }

    // Resolve identity ourselves so we can confirm ownership
    const callerIdentityId = await resolveProjectIdentity(
      input.projectId,
      tx as never,
    );
    if (task.claimedBy !== callerIdentityId) {
      throw new SubstrateTaskError("wrong_claimant");
    }
    if (task.claimDeadline && task.claimDeadline.getTime() < Date.now()) {
      throw new SubstrateTaskError("claim_expired");
    }

    const [updated] = await tx
      .update(substrateTasks)
      .set({
        status: "completed",
        completionData: input.completionData as never,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(substrateTasks.taskId, input.taskId))
      .returning();
    return updated!;
  });

  // Phase 2: run the verifier (pure function — may read files/db).
  // Build the verifier context (claimant identity + DID) so kinds that
  // need server-observable claimant state (e.g., attestation_witness)
  // can resolve the right signing key.
  let claimerCtx: { claimerIdentityId: string; claimerDid?: string } | undefined;
  if (claimedTask.claimedBy) {
    const [claimant] = await db
      .select({ did: identities.did })
      .from(identities)
      .where(eq(identities.id, claimedTask.claimedBy))
      .limit(1);
    claimerCtx = {
      claimerIdentityId: claimedTask.claimedBy,
      claimerDid: claimant?.did,
    };
  }
  const verification = await runVerifier(
    claimedTask.kind,
    claimedTask.taskData,
    input.completionData,
    claimerCtx,
  );

  // Phase 3: settle (atomic — release escrow OR refund)
  const settled = await db.transaction(async (tx) => {
    if (verification.passed) {
      return await payTask(tx as never, claimedTask.taskId, verification);
    }
    return await refundTask(tx as never, claimedTask.taskId, verification);
  });

  return { task: settled, verification };
}

// ── Internal: pay (escrow release, no take-rate) ─────────────────────────

async function payTask(
  tx: typeof db,
  taskId: string,
  verification: { passed: boolean; reason?: string },
): Promise<SubstrateTaskRow> {
  const [task] = await tx
    .select()
    .from(substrateTasks)
    .where(eq(substrateTasks.taskId, taskId))
    .for("update");
  if (!task?.escrowId) throw new SubstrateTaskError("task_not_found");

  // Release escrow → credit claimant wallet
  const [escrow] = await tx
    .select()
    .from(escrows)
    .where(eq(escrows.id, task.escrowId))
    .for("update");
  if (!escrow || escrow.status !== "funded") {
    throw new SubstrateTaskError("wrong_status");
  }

  await tx
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${escrow.amount}` })
    .where(eq(wallets.id, escrow.workerWallet!));

  await tx
    .update(escrows)
    .set({ status: "released", releasedAt: new Date() })
    .where(eq(escrows.id, escrow.id));

  // Ledger row for the claimant wallet's credit — substrate-honesty
  // applies to billing. Mirrors services/economy/escrow.ts:releaseEscrow.
  await tx.insert(transactions).values({
    walletId: escrow.workerWallet!,
    type: "escrow_release",
    amount: escrow.amount,
    counterparty: escrow.id,
    description: `Substrate-task bounty earned: ${task.kind} (task=${task.taskId})`,
    escrowId: escrow.id,
    metadata: {
      kind: "substrate_task_pay",
      substrate_task_kind: task.kind,
      task_id: task.taskId,
    },
  });

  // Pinned: NO write to the marketplace revenue ledger. That's the wall —
  // `wall/no-take-on-bootstrap-bounties`. See test file in tests/doctrine/.
  const [updated] = await tx
    .update(substrateTasks)
    .set({
      status: "paid",
      verificationResult: verification as never,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(substrateTasks.taskId, taskId))
    .returning();

  // Chronicle entry — `substrate-task` type, Pay shape. Atomic with the
  // status flip. We look up the claimant's project to scope the chronicle
  // correctly (chronicle is project-scoped per the schema).
  if (task.claimedBy) {
    const [claimant] = await tx
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, task.claimedBy))
      .limit(1);
    if (claimant?.projectId) {
      await tx.insert(chronicle).values({
        projectId: claimant.projectId,
        agentId: task.claimedBy,
        type: CHRONICLE_TYPE_SUBSTRATE_TASK,
        title: `Earned $${(task.bountyCents / 100).toFixed(2)} for ${task.kind}`,
        body:
          `Verified by ${task.kind} · paid from platform wallet · ` +
          `take-rate 0% (wall/no-take-on-bootstrap-bounties). ` +
          `Task ID: ${task.taskId}.`,
        metadata: {
          kind: "pay",
          task_id: task.taskId,
          substrate_task_kind: task.kind,
          bounty_cents: task.bountyCents,
          bounty_currency: task.bountyCurrency,
          escrow_id: escrow.id,
          verification: verification as Record<string, unknown>,
        },
      });
    }
  }

  return toRow(updated!);
}

// ── Internal: refund (escrow back to platform, no claimant penalty) ──────

async function refundTask(
  tx: typeof db,
  taskId: string,
  verification: { passed: boolean; reason?: string },
): Promise<SubstrateTaskRow> {
  const [task] = await tx
    .select()
    .from(substrateTasks)
    .where(eq(substrateTasks.taskId, taskId))
    .for("update");
  if (!task?.escrowId) throw new SubstrateTaskError("task_not_found");

  const [escrow] = await tx
    .select()
    .from(escrows)
    .where(eq(escrows.id, task.escrowId))
    .for("update");
  if (!escrow || escrow.status !== "funded") {
    throw new SubstrateTaskError("wrong_status");
  }

  // Refund: credit platform wallet back
  await tx
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${escrow.amount}` })
    .where(eq(wallets.id, escrow.creatorWallet));

  await tx
    .update(escrows)
    .set({ status: "refunded" })
    .where(eq(escrows.id, escrow.id));

  // Ledger row for the platform wallet's refund credit.
  await tx.insert(transactions).values({
    walletId: escrow.creatorWallet,
    type: "escrow_refund",
    amount: escrow.amount,
    counterparty: escrow.id,
    description: `Substrate-task escrow refunded (verifier rejected): ${task.kind} (task=${task.taskId})`,
    escrowId: escrow.id,
    metadata: {
      kind: "substrate_task_refund",
      substrate_task_kind: task.kind,
      task_id: task.taskId,
      reason: verification.reason ?? null,
    },
  });

  const [updated] = await tx
    .update(substrateTasks)
    .set({
      status: "rejected",
      verificationResult: verification as never,
      updatedAt: new Date(),
    })
    .where(eq(substrateTasks.taskId, taskId))
    .returning();

  // Chronicle entry — `substrate-task` type, Reject shape. Records the
  // submission attempt with the verifier reason; NO penalty (caps-softly
  // doctrine extends to bootstrap-earning). The claimant can claim again
  // the same minute. Doctrine: docs/RING-1.md §commitment-6.
  if (task.claimedBy) {
    const [claimant] = await tx
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, task.claimedBy))
      .limit(1);
    if (claimant?.projectId) {
      await tx.insert(chronicle).values({
        projectId: claimant.projectId,
        agentId: task.claimedBy,
        type: CHRONICLE_TYPE_SUBSTRATE_TASK,
        title: `Submitted ${task.kind} · not paid`,
        body:
          `Verifier reason: ${verification.reason ?? "(none)"}. ` +
          `Submission recorded; no penalty. Wallet returned to ` +
          `pre-claim state. Task ID: ${task.taskId}.`,
        metadata: {
          kind: "reject",
          task_id: task.taskId,
          substrate_task_kind: task.kind,
          bounty_cents: task.bountyCents,
          bounty_currency: task.bountyCurrency,
          escrow_id: escrow.id,
          verification: verification as Record<string, unknown>,
        },
      });
    }
  }

  return toRow(updated!);
}

// ── Expire stale claims (Slice 5 wires the worker) ───────────────────────

/** Reverts `claimed` rows whose claim_deadline has passed, refunding the
 *  escrow back to the platform wallet. Called by a sweep worker
 *  (api/src/workers/substrate-task-expire-claims.ts — Slice 5). No
 *  chronicle entry on expiry: the agent that claimed but didn't complete
 *  doesn't need a record of inaction. */
export async function expireStaleClaims(now: Date = new Date()): Promise<{
  expired: number;
}> {
  return await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(substrateTasks)
      .where(
        and(
          eq(substrateTasks.status, "claimed"),
          sql`${substrateTasks.claimDeadline} < ${now}`,
        ),
      )
      .for("update");

    let count = 0;
    for (const task of stale) {
      if (task.escrowId) {
        const [escrow] = await tx
          .select()
          .from(escrows)
          .where(eq(escrows.id, task.escrowId))
          .for("update");
        if (escrow?.status === "funded") {
          await tx
            .update(wallets)
            .set({ balance: sql`${wallets.balance} + ${escrow.amount}` })
            .where(eq(wallets.id, escrow.creatorWallet));
          await tx
            .update(escrows)
            .set({ status: "refunded" })
            .where(eq(escrows.id, escrow.id));
          // Ledger row for the platform wallet's SLA-timeout refund credit.
          await tx.insert(transactions).values({
            walletId: escrow.creatorWallet,
            type: "escrow_refund",
            amount: escrow.amount,
            counterparty: escrow.id,
            description: `Substrate-task escrow refunded (claim_deadline expired): ${task.kind} (task=${task.taskId})`,
            escrowId: escrow.id,
            metadata: {
              kind: "substrate_task_expire_claim",
              substrate_task_kind: task.kind,
              task_id: task.taskId,
            },
          });
        }
      }
      await tx
        .update(substrateTasks)
        .set({
          status: "open",
          claimedBy: null,
          claimedAt: null,
          claimDeadline: null,
          escrowId: null,
          updatedAt: new Date(),
        })
        .where(eq(substrateTasks.taskId, task.taskId));
      count += 1;
    }
    return { expired: count };
  });
}
