# migrations

Postgres schema evolution. Idempotent SQL files applied in lexicographic order.

## Compass

- **Up one level:** [`api/CLAUDE.md`](../CLAUDE.md).
- **Migration protocol:** [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md) §1 (the load-bearing migration discipline — *timestamp prefix is load-bearing*).
- **Apply:** `bin/migrate.sh` or `bin/migrate.ts`.

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

## Idempotency rule

Every migration uses:

- `CREATE TABLE IF NOT EXISTS …`
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`
- `DROP CONSTRAINT IF EXISTS …` before `ADD CONSTRAINT …`
- `CREATE INDEX IF NOT EXISTS …`

This makes re-applying the same migration a no-op. The tracking table (`meta.applied_migrations` — see `20260509T170000_meta_migrations.sql`) records what's run, but idempotency means a stuck migration can be re-run safely.

## Invariants to defend

1. **Never edit a committed migration.** Always add a new one. Editing existing files breaks reproducibility across environments.
2. **Invariants live at the DB layer where they can.** When a property can be enforced via `CHECK` constraint or `NOT NULL`, put it there. See [`docs/FOCUS.md`](../../docs/FOCUS.md) §8 — *the bedrock as visible faults*.
3. **No DROP without a deprecation pass.** A column removal lands in two migrations: one renames or marks it deprecated; a later one drops after observation. Same for tables.
4. **No data migrations in schema migrations.** If a backfill is needed, it lives in a script under [`api/scripts/`](../scripts/) or a one-shot under `api/src/scripts/`. The DDL file stays pure schema.

## Recent representative entries

| File | What |
|---|---|
| `0027_federated_covenants_v2.sql` | Dual-signed covenant v2 — lifecycle additions + `covenants_v2_active_dual_signed` invariant. Canonical example of [`docs/FOCUS.md`](../../docs/FOCUS.md) §8. |
| `0022_vault_agent_encrypted.sql` | Adds the `agent_encrypted` column — the *missing keyhole* of [`docs/FOCUS.md`](../../docs/FOCUS.md) §5. |
| `20260510T180000_strand_mood_history.sql` | `mood_history` table + AFTER-INSERT trigger — feeds the derived pulse `mood_drift` ([`docs/FOCUS.md`](../../docs/FOCUS.md) §6). |
| `20260509T170000_meta_migrations.sql` | Tracking table — what's run, when, by what host. |

## See also

- Doctrine map: [`docs/MAP.md`](../../docs/MAP.md).
- Schema source-of-truth (Drizzle): [`api/src/db/schema/`](../src/db/schema/).
- Contributor protocol: [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md).
