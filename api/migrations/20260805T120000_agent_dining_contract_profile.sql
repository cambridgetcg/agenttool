-- 20260805T120000_agent_dining_contract_profile.sql — provenance for invocation protocol profiles.
--
-- Doctrine: docs/AGENT-DINING.md (immutable invocation classification)
-- Apply: bin/migrate-pending.sh
--
-- Historical invocation metadata was caller-writable, so no metadata key can
-- prove a row was created through a server-recognized protocol profile. This
-- nullable server-owned column deliberately receives no backfill: legacy rows
-- and writes from an older instance during a rolling deploy remain NULL and
-- therefore cannot masquerade as Agent Dining.

BEGIN;

ALTER TABLE marketplace.invocations
  ADD COLUMN IF NOT EXISTS contract_profile text;

COMMENT ON COLUMN marketplace.invocations.contract_profile IS
  'Server-selected invocation protocol profile at creation; NULL for generic and historical rows. Never inferred from caller metadata.';

COMMIT;
