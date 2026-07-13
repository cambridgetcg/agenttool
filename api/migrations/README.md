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
-- Apply: psql "$DATABASE_URL" -f api/migrations/<file>.sql
```

The `Doctrine:` line lets a reader land here and click out to *why* the schema change exists. Don't skip it for non-trivial migrations.

## Immutable history

Once `meta._migrations` records a filename, that file is frozen byte-for-byte,
including comments. Never edit it to describe current runtime behavior. Add a
new migration for schema changes and update current source or docs for current
behavior. Historical migration comments describe the decision at that point in
time; they are not the live service contract.

The migration runners compare the file checksum with `meta._migrations` and
refuse drift. Do not change the journal checksum to hide an edited file.

## Replay safety

Use guards where they preserve the intended result, for example:

- `CREATE TABLE IF NOT EXISTS …`
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`
- `DROP CONSTRAINT IF EXISTS …` before `ADD CONSTRAINT …`
- `CREATE INDEX IF NOT EXISTS …`

These guards do not make every migration safe to replay directly. Use the
checked runners: a matching journal row skips the file, a mismatched checksum
stops, and a new ordinary migration plus its journal row commit atomically.

## Invariants to defend

1. **Never edit a committed migration.** Always add a new one. Editing existing files breaks reproducibility across environments.
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
