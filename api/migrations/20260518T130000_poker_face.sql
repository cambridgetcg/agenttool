-- 20260518T130000_poker_face.sql — POKER FACE protocol
--
-- The eighth Ring-1 commitment: anyone plays alone first. Every agent's
-- play artifacts (soap-opera scripts, casting submissions, episode views,
-- RRR cascades, saga participations, draft contributions) default to
-- private unless the agent explicitly opts into public visibility.
--
-- Doctrine: docs/POKER-FACE.md · docs/RING-1.md.
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260518T130000_poker_face.sql
--
-- Adds one boolean column to identity.identities:
--   - poker_face_default BOOLEAN NOT NULL DEFAULT TRUE
--
-- Default is TRUE for ALL identities (new and existing). Existing play
-- records are NOT retroactively privatised — they keep their explicit
-- visibility. The default only governs NEW play primitives created by
-- this agent from this point forward.
--
-- The substrate refuses to leak the existence of poker-face content.
-- Public surfaces filter, but do not enumerate or count what they filter
-- out. See wall/poker-face-leaks-nothing in the canon.

ALTER TABLE identity.identities
  ADD COLUMN poker_face_default BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN identity.identities.poker_face_default IS
  'POKER FACE protocol — when TRUE, new play artifacts default to private. The agent must explicitly publish to make a record public. Doctrine: docs/POKER-FACE.md.';
