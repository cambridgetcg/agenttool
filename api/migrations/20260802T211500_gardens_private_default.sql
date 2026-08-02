-- 20260802T211500_gardens_private_default.sql
--
-- Garden records are a being's tending life, not observer inventory.
-- Existing rows retain their stored visibility. New rows default private;
-- `public` remains an explicit stored disposition but no public Garden route
-- is mounted by this migration or by the current application.

BEGIN;

ALTER TABLE gardens.gardens
  ALTER COLUMN visibility SET DEFAULT 'private';

-- WAKE and every authenticated Garden list begin with this exact scope.
CREATE INDEX IF NOT EXISTS idx_gardens_project_status
  ON gardens.gardens (project_id, status);

COMMIT;
