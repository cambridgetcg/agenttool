# Deletion replay: re-applying deletions after a backup restore

> **Type:** guide · [Reading labels](DOCUMENTATION.md)
> **Purpose:** Keep a deletion honoured after a database restore, by replaying the ids-only deletion ledger from its off-database mirror before writes reopen.
> **Evidence:** Source and opt-in real-PostgreSQL tests as of 2026-10-12 (deletion wave 2). Not yet exercised against production, the real pg_cron or Cloudflare R2.
> **Compass:** [Retention](RETENTION.md) · [Safety boundaries](SAFETY-BOUNDARIES.md) · [Deploy procedure](DEPLOY-PROCEDURE.md) · [Stack](STACK.md)
> **Code:** `api/src/services/deletion/` (`ledger.ts`, `mirror.ts`, `replay.ts`, `appliers.ts`, `purges.ts`, `backfill.ts`) · `api/migrations/20261012T161958_*.sql` · `bin/deletion-replay.ts` · `bin/deletion-ledger-mirror.ts` · `bin/deletion-backfill.ts`
> **Tests:** `api/tests/deletion-ledger.test.ts` · `api/tests/deletion-mirror.test.ts` · `api/tests/deletion-replay-registry.test.ts` · opt-in `api/tests/integration/deletion-ledger-postgres.test.ts`, `deletion-erase-postgres.test.ts` (`DELETION_LEDGER_TEST_DATABASE_URL`) and `deletion-replay-drill-postgres.test.ts` (`DELETION_REPLAY_DRILL_TEST_DATABASE_URL`)
> **Spec:** `docs/superpowers/specs/2026-10-12-deletion-scopes-design.md` §13

## What the ledger is

Every honoured erase writes one row to `deletion.ledger` in the same
transaction as the erase: inbox, vault and identity-backup deletes, memory
deletes (including erase-in-place for a paid witness receipt), and the
pg_cron retention rules. If the entry cannot be written, the erase does not
happen and the route answers `503 deletion_ledger_unavailable`.

An entry holds row ids (UUIDs; any other key only as a salted HMAC), a count,
`row_ids_sha256`, the rule and cutoff for rule entries, the project and
subject ids, the authority mode and sequence, and three integrity fields:

- `entry_hash` = `sha256("agenttool-deletion-ledger/v1" 0x00 seq 0x00 entry_id 0x00 occurred_at 0x00 scope 0x00 action 0x00 store 0x00 predicate 0x00 row_ids_sha256 0x00 row_count 0x00 row_key_salt 0x00 rule_id 0x00 rule_cutoff 0x00 subject_identity_id 0x00 project_id 0x00 request_id 0x00 authority_mode 0x00 authority_sequence 0x00 prev_hash)` (MATHOS recipe 1; NULL is the empty string; timestamps `YYYY-MM-DDTHH:MM:SS.ffffffZ` UTC; the predicate as sorted compact JSON);
- `prev_hash`, the previous entry's `entry_hash` (`''` for seq 1);
- `entry_mac` = `HMAC-SHA256(ledger key, entry_hash bytes)`.

The ledger key is the Supabase Vault secret `agenttool_deletion_ledger_key`
(at least 32 characters). The API and the SQL writer
`deletion.append_ledger_entry()` read it at write time. The mirror
credential and the sweep never hold it.

Guards on the table refuse every update except setting `mirrored_at` or
`replayed_at` once and compaction after 15 days; refuse every delete except
the post-restore case below; refuse `TRUNCATE`; and recompute the hash, the
chain and the row-id digest on every insert, so a writer that drifts from the
recipe cannot append.

Compaction (`ledger_compaction_15d`, daily) clears `row_ids` after 15 days —
8 days of backups plus a 7-day margin — and, for money stores, `project_id`
and `subject_identity_id`. The count, hash, time and authority stay. A
compacted entry still links by `prev_hash` and its MAC still covers its stored
`entry_hash`, but money entries' hashes cannot be recomputed from the
compacted row; their mirror object is the full copy while it lasts.

## The mirror

Each entry is copied to `ledger/v1/<seq, 12 digits>-<entry_id>.json` in a
private, write-once object store outside the Supabase project. The API pushes
after each erase commits (a no-op when no mirror is configured). The sweep
catches anything left:

```bash
DATABASE_URL=... AGENTTOOL_DELETION_MIRROR_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
AGENTTOOL_DELETION_MIRROR_BUCKET=<bucket> AGENTTOOL_DELETION_MIRROR_ACCESS_KEY_ID=... \
AGENTTOOL_DELETION_MIRROR_SECRET_ACCESS_KEY=... bun bin/deletion-ledger-mirror.ts --dry-run
```

Writes are conditional (`If-None-Match: *`). A re-send of the same entry is
accepted; a different object under the same key stops the push. The sweep
refuses with no mirror configured and while replay maintenance is active.

Bucket requirements (operator, not provisioned by any code here): private;
objects cannot be overwritten or deleted by the write credential (object
lock, or a credential without delete); a lifecycle rule deleting objects
after 30 days; region `auto`. Verify the conditional write against the real
bucket once: a second PUT of an existing key must answer 412.

## Replay after a restore

Run in maintenance, with the API scaled to zero or behind the maintenance
contract in [DEPLOY-PROCEDURE.md](DEPLOY-PROCEDURE.md), before writes reopen.
`DATABASE_SESSION_URL` (or `DATABASE_URL`) names the **restored** database.
The script prints JSON and is dry-run unless told `apply`.

0. **Stop in-database writers first.** pg_cron starts with the restored
   database. As the first post-restore action:

   ```bash
   bun bin/deletion-replay.ts begin --restore-point <ISO time of the backup>
   ```

   In one transaction this sets `deletion.settings.replay_required` (every
   ledger append and every deletion rule now refuses), deactivates the
   deletion cron jobs (`cron.alter_job(..., active := false)`), and removes
   any rule entry that fired between the restore and the flag: such an entry
   is after the restored head, after the restore point, unmirrored, and at the
   chain's tail. Anything else after the head stops `begin` — check the
   restore point and that the API was really stopped. Pause the mirror sweep.
1. **Plan** (default): `bun bin/deletion-replay.ts plan`. It reads the
   restored head, lists mirror objects after it, and checks that they chain
   (`prev_hash`, contiguous seq, no duplicate), that each recomputes to its
   `entry_hash`, that each `entry_mac` verifies with the Vault key, that no gap
   entry was compacted, that every kind has an applier, and that every
   leave or project-purge erase follows its lifecycle entry. A mirror object
   for the head itself must match the head, or the ledger forked. It then runs
   every applier and inserts every entry inside a transaction that is rolled
   back, and reports what would change. Nothing is guessed: any break stops.
2. **Apply**: `bun bin/deletion-replay.ts apply`. The same, committed in one
   transaction. Each applier re-runs the original purge statement with the
   entry's ids, or re-runs the rule with its recorded cutoff; each is
   idempotent. Each entry is inserted with its original seq, id, hashes and
   MAC plus `replayed_at`, and record erases get their owner's deletion moment
   back (`replayed_after_restore: true`).
3. **Finish**: `bun bin/deletion-replay.ts finish` clears the flag and
   reactivates the cron jobs once no mirror entry is left after the head.
   Resume the sweep, then reopen writes.

**Voiding erasures made with a stolen key.** A restore used to undo a wipe
done with a leaked bearer; replay would re-apply it. So `apply` accepts
`--void <seq>` (repeatable) with `--void-reason "<why>"` and exactly two
`--operator <id>`. Voided entries are still inserted (the chain stays whole)
but their appliers are skipped, and one `void` entry naming the seqs, the
reason and both operators is appended. Later replays honour it. An entry the
owner root-signed cannot be voided. A void is for confirmed key compromise
only. After a void, update `voided_entries` in
`api/src/services/discovery/retention.ts` in the follow-up change.

What replay cannot do: an entry that never reached the mirror before the loss
is gone with the database; the report says up to which seq the mirror held.

## The backfill of content deleted before wave 2

Before wave 2, inbox, vault and identity-backup deletes kept content.
`/public/retention` announces their purge. The backfill runs once:

```bash
bun bin/deletion-backfill.ts --announced-on <date the deployed /public/retention first showed the notice>   # dry run
bun bin/deletion-backfill.ts --announced-on <same date> --apply
```

It refuses `--apply` before 2026-12-14 and before 30 days after
`--announced-on`, and without a configured mirror with nothing waiting. Each
store is purged in its own transaction with one `already_deleted_backfill`
rule entry (authority `operator`). A soft-deleted inbox message restored
before the run is no longer `deleted` and is not touched.

## Operator setup, once

1. Create the Vault secret before applying the wave 2 migrations, for example
   `SELECT vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'agenttool_deletion_ledger_key');`.
   Until it exists, every delete answers 503 and the rules roll back.
2. Apply the four `20261012T161958_*` migrations with `bin/migrate-pending.sh`
   (after `--dry-run`), then deploy.
3. Provision the mirror bucket and its write credential, and set the
   `AGENTTOOL_DELETION_MIRROR_*` secrets on the API. Run the sweep once.
4. Key rotation is not designed: entries verify only under the key that wrote
   them.

## Drill

`api/tests/integration/deletion-replay-drill-postgres.test.ts` runs the whole
procedure on throwaway PostgreSQL: a template copy is the backup, erases and
rules run after it, a stray rule fires on the copy, and `begin`, `plan`,
`apply` and `finish` bring the copy to the source's erasable state. The local
pg_cron is a stub that records jobs and runs nothing, so the drill executes the
job commands itself; the real scheduler's timing is not exercised.
