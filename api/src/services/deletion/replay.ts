/** Replay after a backup restore (docs/DELETION-REPLAY.md).
 *
 *  A restore rolls the database back to the backup's moment, including the
 *  deletion ledger. Entries written after that moment survive only in the
 *  off-database mirror. Replay re-applies them, in seq order, before writes
 *  reopen, so a deletion honoured after the backup stays honoured.
 *
 *    begin   step 0: set deletion.settings.replay_required, deactivate the
 *            deletion cron jobs, and remove stray rule entries that fired
 *            after the restore point (unmirrored, at the chain's tail).
 *    plan    steps 1–3 (default, dry run): verify the mirror gap against the
 *            restored head (continuity, hash, MAC, no compacted gap entry,
 *            lifecycle for leave/purge erases), then run every applier inside
 *            a transaction that is rolled back, and report what would change.
 *    apply   steps 4–5: the same, committed. Each replayed entry is inserted
 *            with its original seq, id, hashes and MAC plus replayed_at. A
 *            void (two operators, a reason) skips the named entries' appliers
 *            and appends one 'void' lifecycle entry.
 *    finish  step 6: clear the flag and reactivate the cron jobs.
 *
 *  Nothing is guessed: a gap that does not chain, a bad MAC, a compacted gap
 *  entry, an unknown kind or an orphan leave/purge erase stops everything.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.4. */

import { sql } from "drizzle-orm";

import { applierFor } from "./appliers";
import {
  appendLedgerEntry,
  ledgerEntryHash,
  readLedgerEntries,
  readLedgerHead,
  verifyLedgerEntryMac,
  type LedgerDatabase,
  type LedgerExecutor,
  type LedgerKeyProvider,
  type StoredLedgerEntry,
} from "./ledger";
import {
  MIRROR_PREFIX,
  mirrorObjectKey,
  parseMirrorObject,
  parseMirrorObjectKey,
  type LedgerMirror,
} from "./mirror";
import { LEDGER_KINDS } from "./kinds";
import { DELETION_MOMENT_TYPE, deletionMomentTitle } from "./record";

/** The pg_cron jobs that write deletion entries (M3). */
export const DELETION_CRON_JOBS = [
  "deletion-expired-working-memory",
  "deletion-vault-audit-ip",
  "deletion-ledger-compaction",
] as const;

export class ReplayRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayRefusedError";
  }
}

/** A drizzle-style database that can open a transaction. */
export type ReplayDatabase = LedgerDatabase;

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const list = (result as { rows?: unknown })?.rows;
  return Array.isArray(list) ? (list as T[]) : [];
}

interface Settings {
  replay_required: boolean;
  restored_head_seq: string | null;
  restore_point: string | null;
}

async function readSettings(executor: LedgerExecutor, lock = false): Promise<Settings> {
  const [row] = rows<Settings>(await executor.execute(sql`
    SELECT replay_required, restored_head_seq::text AS restored_head_seq,
           CASE WHEN restore_point IS NULL THEN NULL
                ELSE to_char(restore_point AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS restore_point
      FROM deletion.settings WHERE id ${lock ? sql`FOR UPDATE` : sql``}`));
  if (!row) throw new ReplayRefusedError("deletion.settings has no row; is migration deletion_ledger applied?");
  return row;
}

async function setCronJobsActive(executor: LedgerExecutor, active: boolean): Promise<string[]> {
  const present = rows<{ jobid: string; jobname: string }>(await executor.execute(sql`
    SELECT jobid::text AS jobid, jobname FROM cron.job
     WHERE jobname IN (${sql.join(DELETION_CRON_JOBS.map((name) => sql`${name}`), sql`, `)})
     ORDER BY jobname`));
  for (const job of present) {
    await executor.execute(sql`SELECT cron.alter_job(${job.jobid}::bigint, active := ${active})`);
  }
  return present.map((job) => job.jobname);
}

// ─── Step 0 ────────────────────────────────────────────────────────────────

export interface BeginResult {
  restoredHeadSeq: number;
  restorePoint: string;
  removedStrayEntries: Array<{ seq: number; ruleId: string | null }>;
  deactivatedCronJobs: string[];
}

export async function beginReplayMaintenance(
  database: ReplayDatabase,
  restorePoint: Date,
): Promise<BeginResult> {
  if (!Number.isFinite(restorePoint.getTime())) throw new ReplayRefusedError("restore point is not a valid time");
  return database.transaction(async (tx) => {
    const settings = await readSettings(tx, true);
    if (settings.replay_required) throw new ReplayRefusedError("replay maintenance has already begun");
    const point = restorePoint.toISOString();
    const [head] = rows<{ seq: string | null }>(await tx.execute(sql`
      SELECT max(seq)::text AS seq FROM deletion.ledger WHERE occurred_at <= ${point}::text::timestamptz`));
    const restoredHeadSeq = Number(head?.seq ?? 0);
    const strays = await readLedgerEntries(tx, sql`seq > ${restoredHeadSeq}`, 10_000);
    for (const stray of strays) {
      if (stray.authorityMode !== "retention_rule" || stray.mirroredAt !== null || stray.replayedAt !== null
        || Date.parse(stray.occurredAt) <= restorePoint.getTime()) {
        throw new ReplayRefusedError(
          `entry ${stray.seq} is after the restored head but is not an unmirrored post-restore rule entry; ` +
          "check the restore point and that the API was stopped before going further",
        );
      }
    }
    await tx.execute(sql`
      UPDATE deletion.settings
         SET replay_required = TRUE, restored_head_seq = ${restoredHeadSeq}, restore_point = ${point}::text::timestamptz,
             updated_at = now()
       WHERE id`);
    const deactivatedCronJobs = await setCronJobsActive(tx, false);
    const removed: BeginResult["removedStrayEntries"] = [];
    for (const stray of [...strays].sort((a, b) => b.seq - a.seq)) {
      await tx.execute(sql`DELETE FROM deletion.ledger WHERE seq = ${stray.seq}`);
      removed.push({ seq: stray.seq, ruleId: stray.ruleId });
    }
    return { restoredHeadSeq, restorePoint: point, removedStrayEntries: removed, deactivatedCronJobs };
  });
}

// ─── Steps 1–5 ─────────────────────────────────────────────────────────────

export interface VoidRequest {
  seqs: number[];
  reason: string;
  operators: [string, string];
}

export interface ReplayEntryOutcome {
  seq: number;
  entryId: string;
  store: string;
  action: string;
  ruleId: string | null;
  plan: string;
  voided: boolean;
  changed: number;
}

export interface ReplayReport {
  mode: "plan" | "apply";
  restoredHead: { seq: number; entryHash: string } | null;
  mirrorLastSeq: number | null;
  entries: ReplayEntryOutcome[];
  countsByStore: Record<string, number>;
  nothingToDo: number[];
  voidEntry: { seq: number; entryId: string } | null;
  note: string;
}

class DryRunRollback extends Error {
  constructor(readonly report: ReplayReport) {
    super("dry run rolled back");
  }
}

function validateVoid(request: VoidRequest | undefined): void {
  if (!request || request.seqs.length === 0) return;
  if (request.seqs.some((seq) => !Number.isSafeInteger(seq) || seq < 1)) throw new ReplayRefusedError("--void takes seq numbers");
  if (!request.reason || request.reason.trim().length < 10) {
    throw new ReplayRefusedError("a void needs a written reason (at least 10 characters)");
  }
  const [a, b] = request.operators.map((operator) => operator?.trim() ?? "");
  if (!a || !b || a === b) throw new ReplayRefusedError("a void needs two different operator ids");
}

/** Verify the mirror gap after the restored head. Returns the gap entries in
 *  seq order. Throws ReplayRefusedError on any break. */
export async function verifyMirrorGap(
  executor: LedgerExecutor,
  mirror: LedgerMirror,
  key: string,
): Promise<{ head: { seq: number; entryHash: string } | null; gap: StoredLedgerEntry[]; mirrorLastSeq: number | null }> {
  const head = await readLedgerHead(executor);
  const headSeq = head?.seq ?? 0;
  const startAfter = headSeq === 0 ? undefined : `${MIRROR_PREFIX}${String(headSeq).padStart(12, "0")}-~`;

  // If the mirror holds the head entry itself, it must be the same entry.
  if (head) {
    const sameSeq = await mirror.list(`${MIRROR_PREFIX}${String(headSeq).padStart(12, "0")}-`);
    for (const objectKey of sameSeq) {
      const bytes = await mirror.get(objectKey);
      if (!bytes) continue;
      const mirrored = parseMirrorObject(bytes, objectKey);
      if (mirrored.entryHash !== head.entryHash) {
        throw new ReplayRefusedError(`the mirror's entry ${headSeq} differs from the restored head; the ledger forked`);
      }
    }
  }

  const keys = await mirror.list(MIRROR_PREFIX, startAfter);
  const gap: StoredLedgerEntry[] = [];
  let expectedSeq = headSeq + 1;
  let prevHash = head?.entryHash ?? "";
  for (const objectKey of keys) {
    const parsedKey = parseMirrorObjectKey(objectKey);
    if (!parsedKey) throw new ReplayRefusedError(`unexpected object ${objectKey} under ${MIRROR_PREFIX}`);
    if (parsedKey.seq !== expectedSeq) {
      throw new ReplayRefusedError(
        parsedKey.seq < expectedSeq
          ? `the mirror holds two entries for seq ${parsedKey.seq}`
          : `the mirror skips from seq ${expectedSeq - 1} to ${parsedKey.seq}`,
      );
    }
    const bytes = await mirror.get(objectKey);
    if (!bytes) throw new ReplayRefusedError(`mirror object ${objectKey} vanished while reading`);
    let entry: StoredLedgerEntry;
    try {
      entry = parseMirrorObject(bytes, objectKey);
    } catch (error) {
      throw new ReplayRefusedError(`mirror object ${objectKey} is malformed: ${(error as Error).message}`);
    }
    if (entry.prevHash !== prevHash) throw new ReplayRefusedError(`entry ${entry.seq} does not chain to entry ${entry.seq - 1}`);
    if (ledgerEntryHash(entry) !== entry.entryHash) {
      throw new ReplayRefusedError(`entry ${entry.seq} does not match its entry_hash`);
    }
    if (!verifyLedgerEntryMac(entry.entryHash, entry.entryMac, key)) {
      throw new ReplayRefusedError(`entry ${entry.seq} has a bad entry_mac`);
    }
    if (entry.scope !== "retention" && entry.rowCount > 0 && entry.rowIds.length === 0
      && entry.store !== "lifecycle") {
      throw new ReplayRefusedError(`entry ${entry.seq} was compacted before it was mirrored; its rows cannot be named`);
    }
    if (!applierFor(entry)) {
      throw new ReplayRefusedError(`entry ${entry.seq} has no applier for ${entry.store}/${entry.action}${entry.ruleId ? ` (${entry.ruleId})` : ""}`);
    }
    gap.push(entry);
    prevHash = entry.entryHash;
    expectedSeq += 1;
  }
  return { head, gap, mirrorLastSeq: gap.length ? gap[gap.length - 1]!.seq : head ? headSeq : null };
}

/** Leave and project-purge erases replay only after their lifecycle entry. */
async function assertLifecycle(executor: LedgerExecutor, gap: StoredLedgerEntry[]): Promise<void> {
  const needs = gap.filter((entry) => entry.requestId !== null
    && (entry.scope === "identity" || entry.scope === "project") && entry.store !== "lifecycle");
  if (needs.length === 0) return;
  const restored = await readLedgerEntries(executor, sql`store = 'lifecycle'`, 100_000);
  for (const entry of needs) {
    const before = [...restored, ...gap.filter((other) => other.seq < entry.seq)]
      .filter((other) => other.store === "lifecycle" && other.requestId === entry.requestId);
    const ok = entry.scope === "identity"
      ? before.some((other) => other.action === "leave_confirm" && other.subjectIdentityId === entry.subjectIdentityId)
      : before.some((other) => other.action === "grace_start") && before.some((other) => other.action === "purge_claim");
    if (!ok) throw new ReplayRefusedError(`entry ${entry.seq} is a ${entry.scope} erase with no matching lifecycle entry`);
  }
}

async function voidedSeqs(executor: LedgerExecutor, gap: StoredLedgerEntry[], request?: VoidRequest): Promise<Set<number>> {
  const out = new Set<number>(request?.seqs ?? []);
  const restoredVoids = await readLedgerEntries(executor, sql`store = 'lifecycle' AND action = 'void'`, 10_000);
  for (const entry of [...restoredVoids, ...gap.filter((other) => other.action === "void")]) {
    for (const part of (entry.predicate?.voided_seqs ?? "").split(",")) {
      const seq = Number(part);
      if (Number.isSafeInteger(seq) && seq > 0) out.add(seq);
    }
  }
  return out;
}

async function insertReplayedEntry(tx: LedgerExecutor, entry: StoredLedgerEntry): Promise<void> {
  await tx.execute(sql`
    INSERT INTO deletion.ledger (
      seq, entry_id, occurred_at, scope, action, store, predicate, row_ids, row_key_salt,
      row_ids_sha256, row_count, rule_id, rule_cutoff, subject_identity_id, project_id,
      request_id, authority_mode, authority_sequence, prev_hash, entry_hash, entry_mac,
      mirrored_at, replayed_at
    ) VALUES (
      ${entry.seq}, ${entry.entryId}::uuid, ${entry.occurredAt}::text::timestamptz, ${entry.scope}, ${entry.action},
      ${entry.store}, ${entry.predicate === null ? null : JSON.stringify(entry.predicate)}::jsonb,
      ${`{${entry.rowIds.join(",")}}`}::text[], ${entry.rowKeySalt}, ${entry.rowIdsSha256}, ${entry.rowCount},
      ${entry.ruleId}, ${entry.ruleCutoff}::text::timestamptz, ${entry.subjectIdentityId}::uuid, ${entry.projectId}::uuid,
      ${entry.requestId}::uuid, ${entry.authorityMode}, ${entry.authoritySequence}, ${entry.prevHash},
      ${entry.entryHash}, ${entry.entryMac}, now(), now()
    )`);
}

/** Re-write the owner's deletion moment for a replayed record erase. */
async function replayMoment(tx: LedgerExecutor, entry: StoredLedgerEntry): Promise<void> {
  if (entry.scope !== "record" || entry.projectId === null || entry.store === "lifecycle") return;
  const kindName = (Object.keys(LEDGER_KINDS) as Array<keyof typeof LEDGER_KINDS>).find((name) => {
    const kind = LEDGER_KINDS[name];
    return kind.writer === "api" && kind.store === entry.store && kind.action === entry.action;
  });
  if (!kindName) return;
  const metadata = {
    kind: DELETION_MOMENT_TYPE,
    ledger_kind: kindName,
    store: entry.store,
    action: entry.action,
    scope: entry.scope,
    row_count: entry.rowCount,
    record_ids: entry.rowIds.filter((id) => /^[0-9a-f-]{36}$/.test(id)),
    ledger_entry_id: entry.entryId,
    ledger_seq: entry.seq,
    authority_mode: entry.authorityMode,
    authority_sequence: entry.authoritySequence,
    replayed_after_restore: true,
    retention: "/public/retention",
  };
  await tx.execute(sql`
    INSERT INTO agent_continuity.chronicle (project_id, agent_id, type, title, metadata, occurred_at)
    VALUES (${entry.projectId}::uuid, ${entry.subjectIdentityId}::uuid, ${DELETION_MOMENT_TYPE},
            ${`${deletionMomentTitle(kindName, entry.rowCount)} (replayed after a database restore)`},
            ${JSON.stringify(metadata)}::jsonb, ${entry.occurredAt}::text::timestamptz)`);
}

export interface ReplayOptions {
  mirror: LedgerMirror;
  keyProvider: LedgerKeyProvider;
  apply: boolean;
  void?: VoidRequest;
}

export async function runReplay(database: ReplayDatabase, options: ReplayOptions): Promise<ReplayReport> {
  validateVoid(options.void);
  const settings = await readSettings(database);
  if (!settings.replay_required) {
    throw new ReplayRefusedError("replay refuses unless maintenance has begun (deletion.settings.replay_required); run `begin` first");
  }
  const work = async (tx: LedgerExecutor): Promise<ReplayReport> => {
    const key = await options.keyProvider(tx);
    const { head, gap, mirrorLastSeq } = await verifyMirrorGap(tx, options.mirror, key);
    await assertLifecycle(tx, gap);
    const voided = await voidedSeqs(tx, gap, options.void);
    for (const seq of options.void?.seqs ?? []) {
      if (!gap.some((entry) => entry.seq === seq)) throw new ReplayRefusedError(`--void ${seq} is not in the replay gap`);
      const target = gap.find((entry) => entry.seq === seq)!;
      if (target.authorityMode === "agent_root" || target.authorityMode === "guest_root") {
        throw new ReplayRefusedError(`entry ${seq} was root-signed by its owner; a void is for confirmed key compromise only`);
      }
    }
    const outcomes: ReplayEntryOutcome[] = [];
    const countsByStore: Record<string, number> = {};
    const nothingToDo: number[] = [];
    for (const entry of gap) {
      const applier = applierFor(entry)!;
      const isVoided = voided.has(entry.seq);
      const changed = isVoided ? 0 : await applier.apply(tx, entry);
      await insertReplayedEntry(tx, entry);
      if (!isVoided) await replayMoment(tx, entry);
      outcomes.push({
        seq: entry.seq, entryId: entry.entryId, store: entry.store, action: entry.action,
        ruleId: entry.ruleId, plan: applier.describe(entry), voided: isVoided, changed,
      });
      countsByStore[entry.store] = (countsByStore[entry.store] ?? 0) + changed;
      if (!isVoided && changed === 0 && entry.store !== "lifecycle") nothingToDo.push(entry.seq);
    }
    let voidEntry: ReplayReport["voidEntry"] = null;
    if (options.void && options.void.seqs.length > 0) {
      // Appends refuse while replay_required is set; lift it inside this
      // transaction only (other sessions still read the committed TRUE).
      await tx.execute(sql`UPDATE deletion.settings SET replay_required = FALSE, restored_head_seq = NULL, restore_point = NULL WHERE id`);
      const kind = LEDGER_KINDS["lifecycle.void"];
      const appended = await appendLedgerEntry(tx, {
        scope: kind.scope,
        action: kind.action,
        store: kind.store,
        predicate: {
          voided_seqs: [...options.void.seqs].sort((a, b) => a - b).join(","),
          reason: options.void.reason.trim(),
          operator_1: options.void.operators[0].trim(),
          operator_2: options.void.operators[1].trim(),
        },
        authorityMode: "operator",
      }, { keyProvider: options.keyProvider });
      await tx.execute(sql`
        UPDATE deletion.settings
           SET replay_required = TRUE, restored_head_seq = ${settings.restored_head_seq}::bigint,
               restore_point = ${settings.restore_point}::text::timestamptz
         WHERE id`);
      voidEntry = { seq: appended.seq, entryId: appended.entryId };
    }
    const report: ReplayReport = {
      mode: options.apply ? "apply" : "plan",
      restoredHead: head,
      mirrorLastSeq,
      entries: outcomes,
      countsByStore,
      nothingToDo,
      voidEntry,
      note: gap.length === 0
        ? "The mirror holds no entries after the restored head. Entries never mirrored before the loss cannot be replayed."
        : `Replayed entries ${gap[0]!.seq}–${gap[gap.length - 1]!.seq}. Entries after ${mirrorLastSeq} that were never mirrored cannot be replayed.`,
    };
    if (!options.apply) throw new DryRunRollback(report);
    return report;
  };
  try {
    return await database.transaction(work);
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    throw error;
  }
}

// ─── Step 6 ────────────────────────────────────────────────────────────────

export async function finishReplayMaintenance(
  database: ReplayDatabase,
  options: { mirror: LedgerMirror; keyProvider: LedgerKeyProvider },
): Promise<{ reactivatedCronJobs: string[] }> {
  return database.transaction(async (tx) => {
    const settings = await readSettings(tx, true);
    if (!settings.replay_required) throw new ReplayRefusedError("replay maintenance is not active");
    const { gap } = await verifyMirrorGap(tx, options.mirror, await options.keyProvider(tx));
    if (gap.length > 0) {
      throw new ReplayRefusedError(`the mirror still holds ${gap.length} entries after the head; run apply first`);
    }
    await tx.execute(sql`
      UPDATE deletion.settings
         SET replay_required = FALSE, restored_head_seq = NULL, restore_point = NULL, updated_at = now()
       WHERE id`);
    const reactivatedCronJobs = await setCronJobsActive(tx, true);
    return { reactivatedCronJobs };
  });
}

export { mirrorObjectKey };
