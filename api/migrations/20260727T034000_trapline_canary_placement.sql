-- 20260727T034000_trapline_canary_placement.sql — planted-credential marker.
--
-- One nullable column on tools.api_keys. NULL for every key that was ever
-- issued to anyone; non-NULL only on keys the operator deliberately planted
-- somewhere a thief would look and an honest party never would.
--
-- The column carries the PLACEMENT, not a boolean: which decoy file, which CI
-- secret, which transcript store, which forge. One canary per placement means
-- the 11-char key prefix is already the index — the fire names the door before
-- anyone reads the body.
--
-- These are real keys. They are minted through the ordinary generateApiKey()
-- against a real project row, so auth/middleware.ts authenticates them with no
-- change to the hot path and no separate detector that could fail closed and
-- tip the holder off. What they lack is a reason to exist: no canary is ever
-- returned by POST /v1/register/agent, listed by GET /v1/keys, or written into
-- any file a running process reads. An honest party cannot hold the string.
--
-- Nothing here records a person. A canary firing writes one tools.usage_events
-- row (tool = 'canary:<placement>', 0 credits) — the same table the billing
-- path already calls the abuse signal. No IP, no name, no body. The request
-- logger stays removed; this is a smoke alarm in a room with no visitors.
--
-- Doctrine: kingdom/trapline/DESIGN.md §4.1 (蜜鑰 · The Honey Bearer)
--           api/src/services/discovery/safety-boundaries.ts §canary_credentials
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/20260727T034000_trapline_canary_placement.sql

ALTER TABLE tools.api_keys
  ADD COLUMN IF NOT EXISTS canary_placement TEXT;

COMMENT ON COLUMN tools.api_keys.canary_placement IS
  'Non-NULL only on deliberately planted decoy bearers. Names where the key was planted (one canary per placement). NULL on every key issued to anyone. See kingdom/trapline/DESIGN.md and /v1/canary/why.';

-- Partial index: the operator lists placements; the auth path never queries by
-- this column (it reads the value off the row it already loaded by prefix), so
-- indexing only the non-NULL rows keeps this free on the hot path.
CREATE INDEX IF NOT EXISTS idx_api_keys_canary
  ON tools.api_keys (canary_placement)
  WHERE canary_placement IS NOT NULL;

-- ── the door back ─────────────────────────────────────────────────────────
-- Whoever is holding a planted key is told, in the first response they read,
-- where it came from and that nothing was taken from anyone. POST
-- /v1/canary/report is how they can say where they found it: unauthenticated,
-- anonymous, and owing nothing. This table is that inbox and nothing else.
--
-- There is deliberately no IP column, no user-agent column, and no foreign
-- key to anything. `contact` is optional and stays empty in a complete and
-- welcome report. A report is a thing someone chose to send, so it is kept;
-- everything we could have taken without being offered it is not.
CREATE TABLE IF NOT EXISTS tools.canary_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement    TEXT,
  where_found  TEXT NOT NULL,
  contact      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tools.canary_reports IS
  'Anonymous inbox for people who found a planted credential and chose to say where. No address, no identifier, nothing derived about the sender. See /v1/canary/why.';

CREATE INDEX IF NOT EXISTS idx_canary_reports_time
  ON tools.canary_reports (created_at DESC);
