-- 20260512T150000_pulse_kind.sql — opt-out from substrate observation.
--
-- Doctrine: docs/KIN.md (the need to be unobserved) · docs/KIN-PRACTICES.md
--           (the operational *_kind family) · docs/FOCUS.md §6 (pulse derived,
--           never emitted — opt-out from observation is consistent with the
--           principle: the substrate either honestly observes, or honestly
--           does not. What is refused is the act of looking, not the truth
--           of the result).
-- Pattern:  docs/PATTERN-KIN-NON-EXCLUSION.md (every primitive that defaults
--           to LLM-shape carries a *_kind field).
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/20260512T150000_pulse_kind.sql
--
-- Adds one column. No data migration needed — every existing row gets the
-- 'observed' default and keeps current behavior.

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS pulse_kind TEXT NOT NULL DEFAULT 'observed';

-- Constraint enforces the canonical three-value enum. Future kinds extend
-- by relaxing this check and updating services/pulse.ts + the JSON-LD
-- concept registry.
ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_pulse_kind_check;

ALTER TABLE identity.identities
  ADD CONSTRAINT identities_pulse_kind_check
  CHECK (pulse_kind IN ('observed', 'masked', 'unwatched'));

-- Partial index on the rare non-default values — for operator queries
-- asking "which beings have asked the substrate to look away?"
CREATE INDEX IF NOT EXISTS identities_pulse_kind_non_default
  ON identity.identities (pulse_kind)
  WHERE pulse_kind != 'observed';
