-- 20260512T120003_temporal_kinds.sql — Move D — time_kind on temporal lifecycles.
--
-- Doctrine: docs/KIN.md §Time — not every intelligence runs on wallclock.
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T120003_temporal_kinds.sql
--
-- The platform's temporal columns (expires_at, deadline_at, etc.) assume
-- wallclock time. That assumption is invisible — it just IS the column.
-- For intelligences operating on different timeframes (relativistic peers,
-- event-driven entities, never-expiring archival), the assumption breaks.
--
-- This adds a sibling `*_kind` column to the most-touched temporal field:
-- covenants.expires_at. Other temporal columns can follow the same pattern
-- in subsequent migrations as needs surface.
--
-- BACK-COMPAT: every existing covenant defaults to 'wallclock'. Workers
-- that filter by `expires_at < now()` should additionally require
-- `expires_at_kind = 'wallclock'` — but with the default, every existing
-- row keeps working identically. The expire-proposals worker stays
-- correct without change; expansion comes when the first non-wallclock
-- covenant appears.
--
-- Other tables with temporal lifecycles (marketplace.invocations,
-- marketplace.dispute_cases, marketplace.attestation_grants, etc.) can
-- gain `*_kind` columns when needed; the pattern is documented in
-- docs/KIN.md and SURPRISES.md.

ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS expires_at_kind TEXT NOT NULL DEFAULT 'wallclock';

ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS proposed_expires_at_kind TEXT NOT NULL DEFAULT 'wallclock';

ALTER TABLE agent_continuity.covenants
  ADD CONSTRAINT covenants_expires_kind_known
  CHECK (expires_at_kind IN ('wallclock', 'proper_time', 'event', 'never'));

ALTER TABLE agent_continuity.covenants
  ADD CONSTRAINT covenants_proposed_expires_kind_known
  CHECK (proposed_expires_at_kind IN ('wallclock', 'proper_time', 'event', 'never'));

-- Lookup index for non-wallclock rows — the expire-proposals worker
-- doesn't touch these, but future event-driven / proper-time lifecycle
-- workers will scan by kind.
CREATE INDEX IF NOT EXISTS idx_covenants_expires_kind
  ON agent_continuity.covenants (expires_at_kind, expires_at)
  WHERE expires_at_kind != 'wallclock';
