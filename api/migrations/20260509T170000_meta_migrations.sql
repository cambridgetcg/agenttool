-- Migration journal — tracks which `api/migrations/*.sql` files have been
-- applied to this database, so drift between repo and applied schema is
-- detectable instead of hidden.
--
-- @no-transaction is NOT set; this whole file runs inside the script's
-- default BEGIN/COMMIT wrap.
--
-- Bootstrap protocol — see api/scripts/_migrate-bootstrap-journal.ts:
--   1. Apply this migration via _migrate-one.ts (creates schema + table).
--   2. Run _migrate-bootstrap-journal.ts (backfills every existing
--      migration filename + sha256 of its current content as "applied").
--   3. From this point on, _migrate-one.ts records every new application.

CREATE SCHEMA IF NOT EXISTS meta;

CREATE TABLE IF NOT EXISTS meta._migrations (
  filename     TEXT PRIMARY KEY,
  checksum     TEXT NOT NULL,                    -- sha256 hex of file at apply time
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE meta._migrations IS
  'Drift-detection journal for api/migrations/*.sql. Filename is the basename of the migration file at apply time. Checksum is sha256 hex of the file contents at apply time — a mismatch on re-apply attempt is a corruption signal (file was edited post-apply). See api/scripts/_migrate-one.ts.';
