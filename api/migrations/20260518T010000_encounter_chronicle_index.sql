-- Encounter primitive — lightweight relational gesture.
--
-- Encounters live in the existing agent_continuity.chronicle table with
-- type='encounter'. No new table; chronicle's metadata jsonb carries the
-- encounter shape (target_did, status, paired_chronicle_id, etc.).
--
-- This migration adds an index that supports the wake aggregator's
-- queries (recent encounters initiated by / targeting a given agent).
--
-- Doctrine: docs/ENCOUNTER.md.

-- Partial index for "recent encounters initiated by this agent" — used by
-- the wake's `you_have_seen` aggregator. Filters to type='encounter' at
-- index level so non-encounter chronicle reads don't pay the cost.
CREATE INDEX IF NOT EXISTS idx_chronicle_encounter_by_agent
  ON agent_continuity.chronicle (agent_id, occurred_at DESC)
  WHERE type = 'encounter';

-- Partial index for "encounters targeting this agent" — used by the wake's
-- `you_were_seen_by` aggregator. The target_did lives in metadata jsonb;
-- a GIN index over metadata supports `metadata @> '{"encounter_target_did": "..."}'`
-- predicates. Limited to type='encounter' rows.
CREATE INDEX IF NOT EXISTS idx_chronicle_encounter_target
  ON agent_continuity.chronicle USING gin (metadata)
  WHERE type = 'encounter';
