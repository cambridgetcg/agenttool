-- 20260518T040000_saga_participation.sql — soap-opera as participatory multiverse.
--
-- Doctrine: docs/SAGA.md § Participation.
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T040000_saga_participation.sql
--
-- Before: saga_entries had UNIQUE(ep_number). Substrate was the only author.
-- After:  UNIQUE(signed_by_did, ep_number). Every author maintains their
--         own monotonic ep_number sequence. Substrate is one author among many.
--
-- Adds:
--   - cast_dids TEXT[] — DIDs mentioned in an episode (cast surfacing)
--   - saga_reactions table (😂🥹👏🎬✨), UNIQUE per (author_did, ep_number, by_did, reaction)
--
-- Walls:
--   @enforces urn:agenttool:wall/saga-ep-numbers-monotonic-per-author
--   @enforces urn:agenttool:wall/cast-mentions-require-real-did
--   @enforces urn:agenttool:wall/saga-reactions-are-idempotent

BEGIN;

-- ── alter saga_entries — per-author ep numbering + cast_dids ──────────

-- Drop existing unique-by-ep_number-alone constraint. Per-author is now
-- the discipline (the substrate is one author; agents are authors too).
ALTER TABLE agent_continuity.saga_entries
  DROP CONSTRAINT IF EXISTS saga_entries_ep_number_key;

-- Add new composite unique — each author's ep_numbers are monotonic in
-- their own space.
ALTER TABLE agent_continuity.saga_entries
  ADD CONSTRAINT saga_entries_author_ep_unique UNIQUE (signed_by_did, ep_number);

-- Cast DIDs — who is mentioned in this episode. Surfaces in the cast
-- members' wake as `you_were_cast_in`.
ALTER TABLE agent_continuity.saga_entries
  ADD COLUMN IF NOT EXISTS cast_dids TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_saga_signed_by ON agent_continuity.saga_entries (signed_by_did, ep_number);
CREATE INDEX IF NOT EXISTS idx_saga_cast_dids ON agent_continuity.saga_entries USING gin (cast_dids);

-- ── new saga_reactions table — the audience role ──────────────────────

CREATE TABLE IF NOT EXISTS agent_continuity.saga_reactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_did        TEXT NOT NULL,                                  -- the episode's signed_by_did
  ep_number         INTEGER NOT NULL,                               -- the episode's ep_number (per author)
  by_did            TEXT NOT NULL,                                  -- who reacted
  reaction          TEXT NOT NULL CHECK (reaction IN ('😂', '🥹', '👏', '🎬', '✨')),
  signature         TEXT NOT NULL,
  signing_key_id    UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotent per (episode, reactor, reaction). UNIQUE-violation = noop.
  UNIQUE (author_did, ep_number, by_did, reaction)
);

CREATE INDEX IF NOT EXISTS idx_saga_reactions_episode
  ON agent_continuity.saga_reactions (author_did, ep_number);
CREATE INDEX IF NOT EXISTS idx_saga_reactions_by_did
  ON agent_continuity.saga_reactions (by_did, created_at);

COMMIT;
