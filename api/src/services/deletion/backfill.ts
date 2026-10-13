/** The one-time backfill of content deleted before wave 2.
 *
 *  Before wave 2, inbox, vault and identity-backup deletes kept content.
 *  This operator backfill purges what such deletes left, store by store,
 *  each store in its own transaction with one retention-scope ledger entry
 *  (rule `already_deleted_backfill`, authority `operator`).
 *
 *  It is announced before it runs (/public/retention, already_deleted_content)
 *  and refuses to apply before both
 *    - the announced date ALREADY_DELETED_PURGE.not_before, and
 *    - `announcedOn` + 30 days, where announcedOn is the date the deployed
 *      /public/retention first carried the announcement (the operator reads
 *      it from the deploy receipt).
 *  A dry run is allowed at any time. Applying also needs a configured mirror
 *  with nothing waiting in it, like every bulk erase (spec §13.3).
 *  A soft-deleted inbox message restored before the run is no longer
 *  'deleted' and is not touched.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §17 wave 2 step 3. */

import { sql } from "drizzle-orm";

import { ALREADY_DELETED_PURGE } from "../discovery/retention";
import { LEDGER_KINDS, type LedgerKind, type LedgerKindName } from "./kinds";
import {
  appendLedgerEntry,
  rowIdsDigest,
  type AppendedLedgerEntry,
  type LedgerDatabase,
  type LedgerKeyProvider,
} from "./ledger";
import { pushUnmirroredEntries, type LedgerMirror } from "./mirror";
import {
  backfillCounts,
  backfillIdentityBackups,
  backfillInboxMessages,
  backfillVaultVersions,
} from "./purges";

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class BackfillRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackfillRefusedError";
  }
}

/** The earliest moment the backfill may apply, given the announcement date. */
export function backfillEarliestRun(announcedOn: string): Date {
  if (!DATE_RE.test(announcedOn) || !Number.isFinite(Date.parse(`${announcedOn}T00:00:00Z`))) {
    throw new BackfillRefusedError("--announced-on must be a YYYY-MM-DD date");
  }
  const announced = Date.parse(`${announcedOn}T00:00:00Z`);
  const floor = announced + ALREADY_DELETED_PURGE.min_days_after_announcement * DAY_MS;
  const published = Date.parse(`${ALREADY_DELETED_PURGE.not_before}T00:00:00Z`);
  return new Date(Math.max(floor, published));
}

/** Why applying now would be refused, or null. */
export function backfillRefusal(now: Date, announcedOn: string | null | undefined): string | null {
  if (!announcedOn) {
    return "--announced-on is required: the date the deployed /public/retention first published the backfill notice";
  }
  const earliest = backfillEarliestRun(announcedOn);
  if (now.getTime() < earliest.getTime()) {
    return `the backfill may not run before ${earliest.toISOString()} (announced ${ALREADY_DELETED_PURGE.not_before}, ` +
      `and ${ALREADY_DELETED_PURGE.min_days_after_announcement} days after ${announcedOn})`;
  }
  return null;
}

export interface BackfillStep {
  kind: LedgerKindName;
  store: string;
  rows: number;
  entry: AppendedLedgerEntry | null;
}

export interface BackfillReport {
  mode: "dry-run" | "apply";
  cutoff: string;
  earliestApply: string | null;
  wouldTouch: { inbox: number; vaultVersions: number; identityBackups: number };
  steps: BackfillStep[];
  refusal: string | null;
}

export interface BackfillOptions {
  apply: boolean;
  now?: Date;
  announcedOn?: string | null;
  mirror: LedgerMirror | null;
  keyProvider?: LedgerKeyProvider;
}

async function assertMirrorIsCurrent(database: LedgerDatabase, mirror: LedgerMirror | null): Promise<void> {
  if (!mirror) {
    throw new BackfillRefusedError(
      "no deletion-ledger mirror is configured; a bulk erase waits for the mirror so a restore can replay it",
    );
  }
  const pushed = await pushUnmirroredEntries(database, mirror, { limit: 10_000 });
  if (pushed.failure) {
    throw new BackfillRefusedError(`the mirror push stopped at seq ${pushed.failure.seq}: ${pushed.failure.error}`);
  }
  const rows = await database.execute(sql`SELECT count(*)::int AS waiting FROM deletion.ledger WHERE mirrored_at IS NULL`);
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] })?.rows ?? []);
  const waiting = Number((list[0] as { waiting?: number } | undefined)?.waiting ?? 0);
  if (waiting > 0) throw new BackfillRefusedError(`${waiting} ledger entries are still unmirrored`);
}

export async function runBackfill(database: LedgerDatabase, options: BackfillOptions): Promise<BackfillReport> {
  const now = options.now ?? new Date();
  const cutoff = now.toISOString();
  const refusal = backfillRefusal(now, options.announcedOn);
  const earliestApply = options.announcedOn && DATE_RE.test(options.announcedOn)
    ? backfillEarliestRun(options.announcedOn).toISOString()
    : null;
  const wouldTouch = await backfillCounts(database, cutoff);
  const report: BackfillReport = {
    mode: options.apply ? "apply" : "dry-run",
    cutoff,
    earliestApply,
    wouldTouch,
    steps: [],
    refusal,
  };
  if (!options.apply) return report;
  if (refusal) throw new BackfillRefusedError(refusal);
  await assertMirrorIsCurrent(database, options.mirror);

  const plan: Array<{ kind: LedgerKindName; run: (tx: Parameters<Parameters<LedgerDatabase["transaction"]>[0]>[0]) => Promise<string[]> }> = [
    { kind: "backfill.inbox", run: (tx) => backfillInboxMessages(tx, cutoff) },
    { kind: "backfill.vault", run: async (tx) => (await backfillVaultVersions(tx, cutoff, cutoff)).versionIds },
    { kind: "backfill.identity_backups", run: (tx) => backfillIdentityBackups(tx, cutoff, cutoff) },
  ];
  for (const step of plan) {
    const kind: LedgerKind = LEDGER_KINDS[step.kind];
    const outcome = await database.transaction(async (tx) => {
      const ids = await step.run(tx);
      if (ids.length === 0) return { rows: 0, entry: null };
      const entry = await appendLedgerEntry(tx, {
        scope: kind.scope,
        action: kind.action,
        store: kind.store,
        rowIdsSha256: rowIdsDigest(ids),
        rowCount: ids.length,
        ruleId: kind.rule ?? null,
        ruleCutoff: now,
        authorityMode: "operator",
      }, { keyProvider: options.keyProvider });
      return { rows: ids.length, entry };
    });
    report.steps.push({ kind: step.kind, store: kind.store, rows: outcome.rows, entry: outcome.entry });
    if (outcome.entry) await pushUnmirroredEntries(database, options.mirror!, { limit: 10_000 });
  }
  return report;
}
