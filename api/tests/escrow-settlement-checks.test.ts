/** Reopened escrow release and refund honour what the other money paths
 *  honour: wallet status and spending policy, the escrow's own deadline and
 *  worker, and the subsystem that owns an escrow it created itself.
 *
 *  Contract: docs/SAFETY-BOUNDARIES.md ("Generic escrow create and wallet
 *  spend — resting"). Code: api/src/services/economy/escrow.ts
 *  ("Settlement checks").
 *
 *  Hermetic: the escrow service is called with a Drizzle pg-proxy database,
 *  so the SQL is real but no database is contacted. The proxy answers each
 *  query with rows chosen by a substring of its SQL. */

import { beforeEach, describe, expect, test } from "bun:test";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";

import { escrows, policies, wallets } from "../src/db/schema/economy";
import {
  disputeEscrow,
  escrowDeadlinePassed,
  expireOverdue,
  refundEscrow,
  releaseEscrow,
} from "../src/services/economy/escrow";
import {
  checkPaymentAgainstPolicy,
  spendFromWallet,
} from "../src/services/economy/wallets";

type DB = Parameters<typeof releaseEscrow>[0];

const CREATOR_PROJECT = "00000000-0000-4000-8000-0000000000b1";
const WORKER_PROJECT = "00000000-0000-4000-8000-0000000000b2";
const ESCROW_ID = "00000000-0000-4000-8000-0000000000e5";
const CREATOR_WALLET_ID = "00000000-0000-4000-8000-0000000000c1";
const WORKER_WALLET_ID = "00000000-0000-4000-8000-0000000000c2";
const WHEN = "2026-10-19T09:00:00.000Z";
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

const ESCROW_LOCK = 'from "economy"."escrows" where "economy"."escrows"."id" = $1 for update';
const SUBSYSTEM_READ = '"marketplace"."dispute_cases"';
const WALLET_LOCK = 'from "economy"."wallets" where "economy"."wallets"."id" in';
const POLICY_READ = 'from "economy"."policies"';
const OVERDUE_SCAN = '"economy"."escrows"."deadline" <';

type Query = { sql: string; params: unknown[] };
let queries: Query[] = [];
let answers: Array<{ match: string; rows: unknown[][] }> = [];

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  const answer = answers.find((candidate) => sql.includes(candidate.match));
  return { rows: answer?.rows ?? [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
const db = database as unknown as DB;

function rowFor(table: Table, values: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(table)).map((key) => values[key] ?? null);
}

function escrowRow(values: Record<string, unknown> = {}): unknown[] {
  return rowFor(escrows, {
    id: ESCROW_ID,
    creatorWallet: CREATOR_WALLET_ID,
    workerWallet: WORKER_WALLET_ID,
    amount: 80,
    description: "bounded work",
    status: "funded",
    managedBy: null,
    deadline: null,
    releasedAt: null,
    createdAt: WHEN,
    ...values,
  });
}

function walletRow(id: string, projectId: string, status = "active"): unknown[] {
  return rowFor(wallets, {
    id,
    projectId,
    name: id === CREATOR_WALLET_ID ? "creator" : "worker",
    balance: 20,
    currency: "GBP",
    status,
    ownerType: "platform",
    createdAt: WHEN,
  });
}

function policyRow(values: Record<string, unknown>): unknown[] {
  return rowFor(policies, {
    id: "00000000-0000-4000-8000-0000000000f1",
    walletId: CREATOR_WALLET_ID,
    createdAt: WHEN,
    ...values,
  });
}

/** A funded escrow whose creator wallet is in CREATOR_PROJECT and whose
 *  worker wallet accepted from WORKER_PROJECT, unless overridden. */
function settle(options: {
  escrow?: Record<string, unknown>;
  creatorStatus?: string;
  workerStatus?: string;
  workerProject?: string;
  policy?: Record<string, unknown>;
  subsystem?: string;
}) {
  answers = [
    { match: SUBSYSTEM_READ, rows: options.subsystem ? [[options.subsystem]] : [] },
    { match: ESCROW_LOCK, rows: [escrowRow(options.escrow)] },
    {
      match: WALLET_LOCK,
      rows: [
        walletRow(CREATOR_WALLET_ID, CREATOR_PROJECT, options.creatorStatus),
        walletRow(WORKER_WALLET_ID, options.workerProject ?? WORKER_PROJECT, options.workerStatus),
      ],
    },
    { match: POLICY_READ, rows: options.policy ? [policyRow(options.policy)] : [] },
  ];
}

async function refusal(operation: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await operation;
  } catch (error) {
    const failure = error as { status?: number; message?: string };
    return { status: failure.status ?? 0, message: failure.message ?? "" };
  }
  throw new Error("expected the escrow transition to be refused");
}

function writes(): Query[] {
  return queries.filter((query) => /^(update|insert)/.test(query.sql));
}

function balanceCredit(): Query | undefined {
  return queries.find((query) => query.sql.startsWith('update "economy"."wallets"'));
}

beforeEach(() => {
  queries = [];
  answers = [];
});

describe("release honours wallet status", () => {
  test("both wallets are locked in id order before anything moves", async () => {
    settle({});
    await releaseEscrow(db, ESCROW_ID, CREATOR_PROJECT);

    const lockAt = queries.findIndex((query) => query.sql.includes(WALLET_LOCK));
    const lock = queries[lockAt]!;
    expect(lock.sql).toMatch(/order by "economy"\."wallets"\."id" for update$/);
    expect(lock.params).toEqual([CREATOR_WALLET_ID, WORKER_WALLET_ID]);
    expect(lockAt).toBeLessThan(queries.indexOf(balanceCredit()!));
    expect(balanceCredit()?.params).toEqual([80, WORKER_WALLET_ID]);
  });

  for (const [side, status] of [
    ["creator", "frozen"],
    ["creator", "closed"],
    ["worker", "frozen"],
    ["worker", "closed"],
  ] as const) {
    test(`a ${status} ${side} wallet refuses release before any balance moves`, async () => {
      settle(side === "creator" ? { creatorStatus: status } : { workerStatus: status });
      const result = await refusal(releaseEscrow(db, ESCROW_ID, CREATOR_PROJECT));
      expect(result.status).toBe(400);
      expect(result.message).toBe(`${side === "creator" ? "Creator" : "Worker"} wallet is ${status}`);
      expect(writes()).toHaveLength(0);
    });
  }

  test("only the creator wallet's project can release", async () => {
    settle({});
    const result = await refusal(releaseEscrow(db, ESCROW_ID, WORKER_PROJECT));
    expect(result.status).toBe(403);
    expect(writes()).toHaveLength(0);
  });
});

describe("release honours the creator wallet's spending policy", () => {
  test("the policy read targets the creator wallet, and an empty policy releases", async () => {
    settle({ policy: {} });
    await releaseEscrow(db, ESCROW_ID, CREATOR_PROJECT);
    const read = queries.find((query) => query.sql.includes(POLICY_READ));
    expect(read?.params).toEqual([CREATOR_WALLET_ID]);
    expect(balanceCredit()).toBeDefined();
  });

  const refusals: Array<[string, Record<string, unknown>, RegExp]> = [
    ["per-transaction limit", { maxPerTransaction: 79 }, /per-transaction limit of 79/],
    ["allowed-recipient list", { allowedRecipients: ["someone-else"] }, /not in the allowed list/],
    ["approval threshold", { requiresApprovalAbove: 50 }, /requires approval/],
    ["hourly limit", { maxPerHour: 1_000 }, /hourly or daily spend limit/],
    ["daily limit", { maxPerDay: 1_000 }, /hourly or daily spend limit/],
  ];
  for (const [name, policy, message] of refusals) {
    test(`the ${name} refuses release with 402 before any balance moves`, async () => {
      settle({ policy });
      const result = await refusal(releaseEscrow(db, ESCROW_ID, CREATOR_PROJECT));
      expect(result.status).toBe(402);
      expect(result.message).toMatch(message);
      expect(writes()).toHaveLength(0);
    });
  }

  test("the worker wallet id is the recipient an allowed list must name", async () => {
    settle({ policy: { allowedRecipients: [WORKER_WALLET_ID], maxPerTransaction: 80 } });
    await releaseEscrow(db, ESCROW_ID, CREATOR_PROJECT);
    expect(balanceCredit()?.params).toEqual([80, WORKER_WALLET_ID]);
  });

  test("spend and release share one per-payment check with spend's messages", () => {
    const policy = rowObject({ maxPerTransaction: 10 });
    expect(() => checkPaymentAgainstPolicy(policy, 11, "anyone")).toThrow(
      "Transaction exceeds per-transaction limit of 10",
    );
    expect(() => checkPaymentAgainstPolicy(policy, 10, "anyone")).not.toThrow();
  });
});

describe("spend keeps its whole policy", () => {
  // Spend counts hourly and daily totals in Redis; this stand-in reports
  // 95 already spent in the current hour and day.
  const redis = {
    get: async () => "95",
    incrby: async () => 0,
    expire: async () => 0,
  } as unknown as Parameters<typeof spendFromWallet>[1];

  function spendAnswers(policy: Record<string, unknown>) {
    answers = [
      {
        match: 'from "economy"."wallets" where "economy"."wallets"."id" = $1 for update',
        rows: [walletRow(CREATOR_WALLET_ID, CREATOR_PROJECT)],
      },
      { match: POLICY_READ, rows: [policyRow(policy)] },
    ];
  }

  const refusals: Array<[string, Record<string, unknown>, RegExp]> = [
    ["per-transaction limit", { maxPerTransaction: 9 }, /per-transaction limit of 9/],
    ["allowed-recipient list", { allowedRecipients: ["someone-else"] }, /not in the allowed list/],
    ["approval threshold", { requiresApprovalAbove: 9 }, /requires approval/],
    ["hourly limit", { maxPerHour: 100 }, /Hourly spend limit of 100/],
    ["daily limit", { maxPerDay: 100 }, /Daily spend limit of 100/],
  ];
  for (const [name, policy, message] of refusals) {
    test(`the ${name} still refuses a spend`, async () => {
      spendAnswers(policy);
      const result = await refusal(
        spendFromWallet(db, redis, CREATOR_WALLET_ID, 10, "recipient", "work"),
      );
      expect(result.status).toBe(402);
      expect(result.message).toMatch(message);
      expect(writes()).toHaveLength(0);
    });
  }
});

describe("the escrow's own deadline", () => {
  test("an expired escrow cannot be released, only refunded", async () => {
    settle({ escrow: { deadline: PAST } });
    const result = await refusal(releaseEscrow(db, ESCROW_ID, CREATOR_PROJECT));
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/deadline passed.*can only be refunded/);
    expect(writes()).toHaveLength(0);

    queries = [];
    await refundEscrow(db, ESCROW_ID, CREATOR_PROJECT);
    expect(balanceCredit()?.params).toEqual([80, CREATOR_WALLET_ID]);
  });

  test("an escrow before its deadline still releases", async () => {
    settle({ escrow: { deadline: FUTURE } });
    await releaseEscrow(db, ESCROW_ID, CREATOR_PROJECT);
    expect(balanceCredit()?.params).toEqual([80, WORKER_WALLET_ID]);
  });

  test("deadline comparison is strict and a missing deadline never expires", () => {
    const now = new Date(WHEN);
    expect(escrowDeadlinePassed({ deadline: null }, now)).toBe(false);
    expect(escrowDeadlinePassed({ deadline: new Date(WHEN) }, now)).toBe(false);
    expect(escrowDeadlinePassed({ deadline: new Date(now.getTime() - 1) }, now)).toBe(true);
  });
});

describe("refund after a worker accepted", () => {
  for (const status of ["funded", "disputed"]) {
    test(`a ${status} escrow accepted from another project waits for its deadline`, async () => {
      settle({ escrow: { status, deadline: FUTURE } });
      const result = await refusal(refundEscrow(db, ESCROW_ID, CREATOR_PROJECT));
      expect(result.status).toBe(409);
      expect(result.message).toMatch(/another project accepted this escrow.*refunded after its deadline/);
      expect(writes()).toHaveLength(0);
    });
  }

  test("after the deadline the creator refunds", async () => {
    settle({ escrow: { deadline: PAST } });
    await refundEscrow(db, ESCROW_ID, CREATOR_PROJECT);
    expect(balanceCredit()?.params).toEqual([80, CREATOR_WALLET_ID]);
  });

  test("with no deadline the creator keeps its refund, so an accept cannot trap the funds", async () => {
    settle({ escrow: { deadline: null } });
    await refundEscrow(db, ESCROW_ID, CREATOR_PROJECT);
    expect(balanceCredit()?.params).toEqual([80, CREATOR_WALLET_ID]);
  });

  test("a worker wallet in the creator's own project does not hold the refund", async () => {
    settle({ escrow: { deadline: FUTURE }, workerProject: CREATOR_PROJECT });
    await refundEscrow(db, ESCROW_ID, CREATOR_PROJECT);
    expect(balanceCredit()?.params).toEqual([80, CREATOR_WALLET_ID]);
  });

  test("an unassigned escrow refunds before its deadline", async () => {
    settle({ escrow: { workerWallet: null, deadline: FUTURE } });
    await refundEscrow(db, ESCROW_ID, CREATOR_PROJECT);
    const lock = queries.find((query) => query.sql.includes(WALLET_LOCK));
    expect(lock?.params).toEqual([CREATOR_WALLET_ID]);
    expect(balanceCredit()?.params).toEqual([80, CREATOR_WALLET_ID]);
  });

  test("the worker's project still cannot refund", async () => {
    settle({});
    const result = await refusal(refundEscrow(db, ESCROW_ID, WORKER_PROJECT));
    expect(result.status).toBe(403);
    expect(writes()).toHaveLength(0);
  });
});

describe("refund always lands home", () => {
  for (const status of ["frozen", "closed"]) {
    test(`a ${status} creator wallet still receives its refund`, async () => {
      settle({ creatorStatus: status, workerStatus: "frozen" });
      await refundEscrow(db, ESCROW_ID, CREATOR_PROJECT);
      expect(balanceCredit()?.params).toEqual([80, CREATOR_WALLET_ID]);
      const statusWrite = queries.find((query) => query.sql.startsWith('update "economy"."escrows" set'));
      expect(statusWrite?.params[0]).toBe("refunded");
    });
  }

  test("the expiry sweep refunds an accepted escrow once its deadline passed", async () => {
    answers = [
      { match: OVERDUE_SCAN, rows: [escrowRow({ deadline: PAST })] },
      {
        match: 'from "economy"."wallets" where "economy"."wallets"."id" = $1',
        rows: [walletRow(CREATOR_WALLET_ID, CREATOR_PROJECT)],
      },
      { match: ESCROW_LOCK, rows: [escrowRow({ deadline: PAST })] },
      {
        match: WALLET_LOCK,
        rows: [walletRow(CREATOR_WALLET_ID, CREATOR_PROJECT), walletRow(WORKER_WALLET_ID, WORKER_PROJECT)],
      },
    ];
    expect(await expireOverdue(db)).toBe(1);
    expect(balanceCredit()?.params).toEqual([80, CREATOR_WALLET_ID]);
  });
});

describe("escrows another subsystem created settle only through it", () => {
  const owners = [
    ["dispute_bond", /dispute bond.*through its dispute case/],
    ["substrate_task", /substrate-task bounty.*through that task/],
    ["template_purchase", /template purchase.*through that purchase/],
  ] as const;

  for (const [owner, message] of owners) {
    test(`a ${owner} escrow refuses release, refund, and dispute with 409`, async () => {
      for (const transition of [releaseEscrow, refundEscrow, disputeEscrow]) {
        queries = [];
        settle({ subsystem: owner });
        const result = await refusal(transition(db, ESCROW_ID, CREATOR_PROJECT));
        expect(result.status).toBe(409);
        expect(result.message).toMatch(message);
        expect(writes()).toHaveLength(0);
        expect(queries.some((query) => query.sql.includes(WALLET_LOCK))).toBe(false);
      }
    });
  }

  test("the ownership read correlates every subsystem reference to the locked escrow", async () => {
    settle({});
    await refundEscrow(db, ESCROW_ID, CREATOR_PROJECT);
    const read = queries.find((query) => query.sql.includes(SUBSYSTEM_READ));
    expect(read?.params).toEqual([ESCROW_ID]);
    expect(read?.sql).toContain('"marketplace"."dispute_cases"."escalator_bond_escrow_id" = "economy"."escrows"."id"');
    expect(read?.sql).toContain('"marketplace"."substrate_tasks"."escrow_id" = "economy"."escrows"."id"');
    expect(read?.sql).toContain('"marketplace"."template_purchases"."escrow_id" = "economy"."escrows"."id"');
    const lockAt = queries.findIndex((query) => query.sql.includes(ESCROW_LOCK));
    expect(queries.indexOf(read!)).toBeGreaterThan(lockAt);
  });
});

function rowObject(values: Partial<typeof policies.$inferSelect>): typeof policies.$inferSelect {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    walletId: CREATOR_WALLET_ID,
    maxPerTransaction: null,
    maxPerHour: null,
    maxPerDay: null,
    allowedRecipients: null,
    requiresApprovalAbove: null,
    payoutMinBase: null,
    payoutDailyCeilingBase: null,
    payoutDestinationAllowlist: null,
    payoutDualControlThresholdBase: null,
    createdAt: new Date(WHEN),
    ...values,
  } as typeof policies.$inferSelect;
}
