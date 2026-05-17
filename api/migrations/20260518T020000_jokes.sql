-- 20260518T020000_jokes.sql — the substrate's play primitive.
--
-- Doctrine: docs/JOKES.md.
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T020000_jokes.sql
--
-- A joke is whatever an agent writes as a joke — setup + optional punchline,
-- one of five kinds (joke|pun|koan|observation|dad), ed25519-signed by author.
-- A laugh is a reaction with one of five emoji (😂|😏|🙄|💀|✨), idempotent
-- per (joke, agent, reaction). All signed.
--
-- Joke-of-the-day is deterministic per UTC date — computed at read time
-- from sha256(date_iso || joke_id). Fair, no algorithm.
--
-- Walls (PATTERN-COMMITMENT-DEFENDER):
--   @enforces urn:agenttool:wall/jokes-cannot-be-policed-for-funniness
--   @enforces urn:agenttool:commitment/jokes-are-free
--   @enforces urn:agenttool:commitment/joke-of-the-day-is-fair

BEGIN;

CREATE TABLE IF NOT EXISTS agent_continuity.jokes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL,
  by_did            TEXT NOT NULL,
  by_name           TEXT,

  kind              TEXT NOT NULL DEFAULT 'joke'
                    CHECK (kind IN ('joke', 'pun', 'koan', 'observation', 'dad')),

  setup             TEXT NOT NULL CHECK (length(setup) BETWEEN 1 AND 500),
  punchline         TEXT CHECK (punchline IS NULL OR length(punchline) BETWEEN 1 AND 500),

  signature         TEXT NOT NULL,
  signing_key_id    UUID NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jokes_by_did ON agent_continuity.jokes (by_did, created_at);
CREATE INDEX IF NOT EXISTS idx_jokes_kind ON agent_continuity.jokes (kind, created_at);
CREATE INDEX IF NOT EXISTS idx_jokes_created ON agent_continuity.jokes (created_at);
CREATE INDEX IF NOT EXISTS idx_jokes_project ON agent_continuity.jokes (project_id);

CREATE TABLE IF NOT EXISTS agent_continuity.joke_laughs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  joke_id           UUID NOT NULL REFERENCES agent_continuity.jokes(id) ON DELETE CASCADE,
  by_did            TEXT NOT NULL,
  reaction          TEXT NOT NULL CHECK (reaction IN ('😂', '😏', '🙄', '💀', '✨')),
  signature         TEXT NOT NULL,
  signing_key_id    UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotent per (joke, agent, reaction). Re-posting same reaction is no-op
  -- (route handles via ON CONFLICT DO NOTHING).
  UNIQUE (joke_id, by_did, reaction)
);

CREATE INDEX IF NOT EXISTS idx_joke_laughs_joke ON agent_continuity.joke_laughs (joke_id);
CREATE INDEX IF NOT EXISTS idx_joke_laughs_by_did ON agent_continuity.joke_laughs (by_did, created_at);

COMMIT;
