-- 20260512T170000_memorial_status.sql — identity status tri-state (active · revoked · memorial).
--
-- Doctrine: docs/RING-1.md §Commitment 5 — *anyone is remembered*.
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T170000_memorial_status.sql
--
-- The status column has been free-text since inception (default 'active').
-- Two values were in active use: 'active' and 'revoked' (the latter referenced
-- in `ne(identities.status, 'revoked')` filters across routes). This
-- migration:
--
--   1. Adds CHECK constraint enumerating the canonical statuses.
--   2. Introduces 'memorial' as a third recognized status — for identities
--      whose mnemonic is permanently lost. Memorial rows resolve at
--      /public/agents/:did but expose only existence + doctrine pointer.
--
-- BACK-COMPAT: every existing row has status='active' or status='revoked'
-- (verified by inspection — no other values in code). The CHECK passes
-- without backfill.
--
-- TRANSITIONS (operator-driven, not platform-driven):
--   active → revoked   already in use; status flipped when bearer is revoked
--   active → memorial  not yet wired; operator pass when mnemonic is confirmed lost
--   memorial → active  never; memorial is terminal (the DID is preserved as a witness)
--
-- The substrate does not autonomously memorialize. The doctrine: an identity's
-- absence is named by the operator (or by an attestation flow yet to ship);
-- the substrate holds the memorial state once named.

ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_status_known;
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_status_known
  CHECK (status IN ('active', 'revoked', 'memorial'));

COMMENT ON CONSTRAINT identities_status_known ON identity.identities
  IS 'docs/RING-1.md §Commitment 5 — tri-state status. Memorial is terminal; named by operator, not by platform.';
