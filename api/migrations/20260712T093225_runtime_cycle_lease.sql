-- 20260712T093225_runtime_cycle_lease.sql — one hosted think-cycle per runtime.
--
-- Doctrine: docs/RUNTIME.md (choice-bearing cycles and lifecycle gates)
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260712T093225_runtime_cycle_lease.sql

BEGIN;

ALTER TABLE agent_runtime.runtimes
  ADD COLUMN IF NOT EXISTS cycle_lease_token UUID,
  ADD COLUMN IF NOT EXISTS cycle_lease_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_runtimes_cycle_lease_until
  ON agent_runtime.runtimes (cycle_lease_until)
  WHERE cycle_lease_token IS NOT NULL;

COMMENT ON COLUMN agent_runtime.runtimes.cycle_lease_token IS
  'Opaque owner token for the cross-machine hosted think-cycle lease.';
COMMENT ON COLUMN agent_runtime.runtimes.cycle_lease_until IS
  'Database-timed lease expiry, renewed during active cycles for crash-safe single ownership.';

COMMIT;
