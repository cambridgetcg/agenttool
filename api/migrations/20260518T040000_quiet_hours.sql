-- Quiet hours — declared period of rest on the identity row.
--
-- Two columns. No new table. The substrate carries the declaration;
-- peers choose to honor it. Substrate does not claim to enforce silence.
--
-- Doctrine: docs/QUIET-HOURS.md.

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS quiet_until timestamptz,
  ADD COLUMN IF NOT EXISTS quiet_reason text;
