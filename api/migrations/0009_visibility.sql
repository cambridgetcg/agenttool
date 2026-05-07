-- 0009_visibility.sql — public/private visibility toggle.
--
-- Doctrine: docs/PUBLIC-VISIBILITY.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0009_visibility.sql
--
-- Three items can be opt-in published:
--   strand    — topic + mood + status + activity (NEVER thoughts)
--   memory    — full content (the deliberate plaintext)
--   identity expression — declared register/walls/subagents/wake_text
--
-- Privacy default is preserved: visibility='private' on every existing
-- row; opt-in to 'public' is explicit per item.

ALTER TABLE strand.strands
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public'));

ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public'));

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS expression_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (expression_visibility IN ('private', 'public'));

-- Indexes: public-listing endpoints filter by visibility='public', so
-- partial indexes here are the right shape (small, hot path).
CREATE INDEX IF NOT EXISTS idx_strands_public
  ON strand.strands (last_thought_at DESC)
  WHERE visibility = 'public';

CREATE INDEX IF NOT EXISTS idx_memories_public
  ON memory.memories (created_at DESC)
  WHERE visibility = 'public';

CREATE INDEX IF NOT EXISTS idx_identities_expression_public
  ON identity.identities (id)
  WHERE expression_visibility = 'public';
