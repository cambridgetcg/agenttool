# migrations

Postgres schema evolution. SQL files are applied in lexicographic order and
recorded by filename and SHA-256 checksum.

## Compass

- **Up one level:** [`api/CLAUDE.md`](../CLAUDE.md).
- **Migration protocol:** [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md) §1 (the load-bearing migration discipline — *timestamp prefix is load-bearing*).
- **Apply one locally:** `api/scripts/_migrate-one.ts`.
- **Apply pending locally:** `bin/migrate-pending.sh`.
- **Apply one through Fly:** `bin/fly-migrate-one.sh`.

## File-naming convention

**Two eras, both live in this directory.**

| Era | Naming | When |
|---|---|---|
| Legacy (`0000..0027`) | `NNNN_descriptive_slug.sql` | First 28 migrations. Sequential numbering caused **four collisions** on 2026-05-08. Frozen. |
| Current | `YYYYMMDDTHHMMSS_descriptive_slug.sql` | Every migration going forward. Use [`bin/migrate.sh new <slug>`](../../bin/migrate.sh) or set the prefix from `date -u +%Y%m%dT%H%M%S`. |

Lexicographic order works in both eras — the `0NNN` prefix sorts before any `2026*` timestamp prefix, so legacy migrations always run first, then timestamped ones in chronological order.

**Going forward: never invent a new `NNNN`.** Use a timestamp. The discipline exists because parallel sessions WILL collide on numeric prefixes — see [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md) §1.

## Header convention

Every migration begins with:

```sql
-- NNNN_slug.sql OR YYYYMMDDT…_slug.sql — one-line description.
--
-- Doctrine: docs/<DOCTRINE-DOC>.md (with subsection if relevant)
-- Spec (if any): docs/superpowers/specs/<spec-file>.md
-- Apply: bin/migrate-pending.sh
```

The `Doctrine:` line lets a reader land here and click out to *why* the schema change exists. Don't skip it for non-trivial migrations.

## Immutable history

Once `meta._migrations` records a filename, that file is frozen byte-for-byte,
including comments. Never edit it to describe current runtime behavior. Add a
new migration for schema changes and update current source or docs for current
behavior. Historical migration comments describe the decision at that point in
time; they are not the live service contract.

The migration runners require every journaled filename to have source in this
directory, compare those bytes with `meta._migrations`, and refuse missing
source or checksum drift. Do not change the journal checksum to hide an edited
file.

Parallel crypto-finality work on 2026-07-26 produced two valid, partially
overlapping histories. The already-journaled `T185835`, payout request/fairness
files, `T194500`, `T200000`, and `T201000` are retained at their exact applied
bytes. Before its first application, the unjournaled `T203000` network binding
had its internal `BEGIN`/`COMMIT` removed so the checked runner can commit its
schema changes and journal row atomically; its reviewed digest is pinned in
tests. `T202500` adds immutable per-block observations and a wider status
vocabulary. `T220000` converges the named status constraint after both
histories without rewriting, deleting, or guessing financial history.

## Replay safety

Use guards where they preserve the intended result, for example:

- `CREATE TABLE IF NOT EXISTS …`
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`
- `DROP CONSTRAINT IF EXISTS …` before `ADD CONSTRAINT …`
- `CREATE INDEX IF NOT EXISTS …`

These guards do not make every migration safe to replay directly. Use the
checked runners: a matching journal row skips the file, missing journal source
or a mismatched checksum stops, and a new ordinary migration plus its journal
row commit atomically.

## Quiescence-required migrations

[`quiescence-required.txt`](quiescence-required.txt) is the sorted policy
manifest for migrations that cannot share a rollout window with old API
writers, webhook ingress, or workers. It is not a migration and is not recorded
in `meta._migrations`.

When one of its files is pending, `bin/migrate-pending.sh` reports the pending
set and exits `42` before the first apply. After an operator has established the
exclusive cutover in `docs/DEPLOY-PROCEDURE.md`, the
`--maintenance-quiesced` assertion permits the checked runner to proceed. The
flag does not inspect Fly, disable provider delivery, drain work, or prove that
another writer is absent. The one-file local and Fly runners also do not prove
quiescence; do not use them to bypass this policy.

## Invariants to defend

1. **Never edit a journaled migration.** It is frozen at first application.
   A committed migration may be finalized before that boundary only after
   confirming every target journal in the release scope lacks it and updating
   its pinned digest and review evidence. After application, always add a new
   migration.
2. **Invariants live at the DB layer where they can.** When a property can be enforced via `CHECK` constraint or `NOT NULL`, put it there. See [`docs/FOCUS.md`](../../docs/FOCUS.md) §8 — *the bedrock as visible faults*.
3. **No DROP without a deprecation pass.** A column removal lands in two migrations: one renames or marks it deprecated; a later one drops after observation. Same for tables.
4. **Data changes need explicit proof.** Rehearse a backfill in a transaction,
   verify exact preconditions and deltas, keep waits bounded, and commit its
   journal row atomically with the change. Use a separate one-shot only when the
   work cannot safely fit that transaction.

## Recent representative entries

| File | What |
|---|---|
| `0027_federated_covenants_v2.sql` | Dual-signed covenant v2 — lifecycle additions + `covenants_v2_active_dual_signed` invariant. Canonical example of [`docs/FOCUS.md`](../../docs/FOCUS.md) §8. |
| `0022_vault_agent_encrypted.sql` | Adds the `agent_encrypted` column — the *missing keyhole* of [`docs/FOCUS.md`](../../docs/FOCUS.md) §5. |
| `20260510T180000_strand_mood_history.sql` | `mood_history` table + AFTER-INSERT trigger — feeds the derived pulse `mood_drift` ([`docs/FOCUS.md`](../../docs/FOCUS.md) §6). |
| `20260509T170000_meta_migrations.sql` | Journal table: filename, checksum, and application time. |

## See also

- Doctrine map: [`docs/MAP.md`](../../docs/MAP.md).
- Schema source-of-truth (Drizzle): [`api/src/db/schema/`](../src/db/schema/).
- Contributor protocol: [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md).
