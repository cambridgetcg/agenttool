-- 20260710T230000_inbox_voice_cursor.sql — lossless inbox voice high-water cursor.
--
-- Doctrine: docs/INBOX.md (Inbox voice)
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260710T230000_inbox_voice_cursor.sql
--
-- Inbox voice resumes by (created_at, id). `now()` / CURRENT_TIMESTAMP is the
-- transaction-start time, so a transaction that waits behind the voice
-- snapshot lock could otherwise insert later with a timestamp before the
-- published high-water mark. Execution-time timestamps close that race.

BEGIN;

ALTER TABLE inbox.messages
  ALTER COLUMN created_at SET DEFAULT clock_timestamp();

CREATE INDEX IF NOT EXISTS idx_inbox_voice_cursor
  ON inbox.messages (recipient_identity_id, created_at, id);

COMMIT;
