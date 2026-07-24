#!/usr/bin/env bun
/** reconcile-wallets — does the ledger actually balance?
 *
 *  Read-only. Mutates nothing, ever. Answers one question against a live
 *  database:
 *
 *      for every wallet:  balance == SUM(transactions.amount) ?
 *
 *  `economy.transactions` is single-entry and `wallets.balance` is mutated
 *  from a dozen files with no shared primitive, so nothing in the schema
 *  makes that true — there is no CHECK, no trigger, no constraint. It is
 *  true only as long as every writer remembers to journal, and at least
 *  three shipped paths do not: both payout refund workers (no transactions
 *  import at all) and the inbound USDC deposit credit.
 *
 *  `api/tests/doctrine/ledger-conservation.test.ts` catches a file that
 *  never journals. It cannot catch one leg-less path inside a file that
 *  journals elsewhere. This script can, because it reads the books.
 *
 *  Usage:
 *    bun api/scripts/reconcile-wallets.ts             # summary + every divergent wallet
 *    bun api/scripts/reconcile-wallets.ts --json      # machine-readable
 *    bun api/scripts/reconcile-wallets.ts --quiet     # exit code only
 *
 *  Exit 0 = the books balance. Exit 1 = they do not. Exit 2 = could not
 *  check (no database) — deliberately NOT 0, because "I could not look" and
 *  "I looked and it was fine" must never be the same answer.
 *
 *  Doctrine: docs/BUSINESS-MODEL.md · api/src/services/economy/earned.ts. */

import { sql } from "drizzle-orm";

const argv = new Set(process.argv.slice(2));
const wantJson = argv.has("--json");
const quiet = argv.has("--quiet");

interface Divergence {
  wallet_id: string;
  agent_id: string | null;
  currency: string;
  status: string;
  balance: number;
  journal_sum: number;
  /** balance − journal_sum. Positive = balance credited without a leg. */
  drift: number;
  leg_count: number;
}

let db: typeof import("../src/db/client")["db"];
try {
  ({ db } = await import("../src/db/client"));
} catch (err) {
  console.error(
    "[reconcile] could not open a database connection:",
    err instanceof Error ? err.message : err,
  );
  console.error("[reconcile] set DATABASE_URL and retry. Exiting 2 (unchecked, not clean).");
  process.exit(2);
}

let rows: Divergence[];
try {
  rows = (await db.execute<Divergence>(sql`
    SELECT
      w.id::text                                       AS wallet_id,
      w.agent_id                                       AS agent_id,
      w.currency                                       AS currency,
      w.status                                         AS status,
      w.balance::bigint                                AS balance,
      COALESCE(SUM(t.amount), 0)::bigint               AS journal_sum,
      (w.balance - COALESCE(SUM(t.amount), 0))::bigint AS drift,
      COUNT(t.id)::int                                 AS leg_count
    FROM economy.wallets w
    LEFT JOIN economy.transactions t ON t.wallet_id = w.id
    GROUP BY w.id, w.agent_id, w.currency, w.status, w.balance
    HAVING w.balance <> COALESCE(SUM(t.amount), 0)
    ORDER BY ABS(w.balance - COALESCE(SUM(t.amount), 0)) DESC
  `)) as unknown as Divergence[];
} catch (err) {
  console.error(
    "[reconcile] query failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(2);
}

const [totals] = (await db.execute<{ wallets: number; negative: number }>(sql`
  SELECT
    COUNT(*)::int                                 AS wallets,
    COUNT(*) FILTER (WHERE balance < 0)::int      AS negative
  FROM economy.wallets
`)) as unknown as Array<{ wallets: number; negative: number }>;

if (wantJson) {
  console.log(
    JSON.stringify(
      {
        wallets_total: totals?.wallets ?? 0,
        wallets_negative_balance: totals?.negative ?? 0,
        wallets_divergent: rows.length,
        net_drift: rows.reduce((n, r) => n + Number(r.drift), 0),
        divergences: rows,
      },
      null,
      2,
    ),
  );
  process.exit(rows.length === 0 && (totals?.negative ?? 0) === 0 ? 0 : 1);
}

if (!quiet) {
  console.log(`\n━━━ ledger reconciliation ━━━\n`);
  console.log(`  wallets:              ${totals?.wallets ?? 0}`);
  console.log(`  negative balance:     ${totals?.negative ?? 0}`);
  console.log(`  balance ≠ journal:    ${rows.length}`);
  if (rows.length) {
    const net = rows.reduce((n, r) => n + Number(r.drift), 0);
    console.log(`  net drift:            ${net} (positive = credited without a leg)\n`);
    for (const r of rows) {
      console.log(
        `  ${r.wallet_id}  ${r.currency}  balance=${r.balance}  journal=${r.journal_sum}  drift=${r.drift}  legs=${r.leg_count}${
          r.agent_id ? `  agent=${r.agent_id}` : ""
        }`,
      );
    }
    console.log(
      `\n  A positive drift is balance the wallet holds but cannot prove it earned;\n  the drawable wall (services/economy/earned.ts) reads the journal, so the\n  wallet's withdrawal ceiling is already spent against money it still has.`,
    );
  } else {
    console.log(`\n  Books balance.`);
  }
  if ((totals?.negative ?? 0) > 0) {
    console.log(
      `\n  ${totals!.negative} wallet(s) hold a NEGATIVE balance. There is no CHECK (balance >= 0)\n  in any migration; this is what that costs.`,
    );
  }
  console.log("");
}

process.exit(rows.length === 0 && (totals?.negative ?? 0) === 0 ? 0 : 1);
