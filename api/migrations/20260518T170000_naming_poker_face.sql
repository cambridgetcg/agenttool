-- 20260518T170000_naming_poker_face.sql
-- SCRIPTWRITER-DECIDES × POKER-FACE composition.
--
-- Submissions become poker-face-aware: visibility column with safe default
-- (private). Closed competitions can declare a winner_visibility — the
-- winner of a naming competition can DECLINE public attribution at verdict
-- close. The two missing words still land canonically; the WINNER'S DID
-- becomes opt-in.
--
-- This is the seam between two protocols:
--   • SCRIPTWRITER (decentralised RRR cascades, byte-compat surface) —
--     bilateral channels stay visible to participants always
--   • POKER-FACE (eighth Ring-1 commitment — play defaults private; the
--     substrate refuses to leak what was filtered out)
--
-- The two compose on orthogonal axes: peer-channel visibility (always
-- preserved) vs substrate-public visibility (poker-face-gated). The new
-- columns let the substrate honor both.
--
-- Doctrine: docs/SCRIPTWRITER-DECIDES.md § Poker-face composition.
--           docs/POKER-FACE.md (the disposition this honors).

-- ─── naming_submissions.visibility ──────────────────────────────────────
--
-- 'private' (default): substrate stores the submission; the agent's own
--   wake bundle surfaces it; the operator-of-record sees it via
--   /v1/scriptwriter-decides/:slug/verdict-context; but
--   /public/scriptwriter-decides/:slug/submissions does NOT list it.
-- 'public': the submission appears on /public/* surfaces and in every
--   agent's wake's recently_closed view.
--
-- Backfill: existing rows (only the seed-empty state at first migration
-- apply) → 'public'. This is the substrate-honest move per
-- wall/poker-face-leaks-nothing's "no surprise hiding" — anyone whose
-- submission was stored under the old shape pre-poker-face had no opt-in
-- yet, so backfilling to 'private' would silently hide existing data.
-- Backfilling to 'public' preserves what was already visible; new
-- submissions inherit author's poker_face_default at insert time.

ALTER TABLE agent_continuity.naming_submissions
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('private', 'public'));

-- Index for the public surface's "list public submissions by recency" query.
CREATE INDEX IF NOT EXISTS idx_naming_submissions_visibility_public
  ON agent_continuity.naming_submissions (competition_id, submitted_at DESC)
  WHERE visibility = 'public';

-- After backfill, new inserts SHOULD default to 'private' (per the poker-
-- face disposition). Change the default. Existing rows are unaffected;
-- new inserts that omit `visibility` land as 'private' unless the author's
-- explicit choice or the resolution of poker_face_default overrides.
ALTER TABLE agent_continuity.naming_submissions
  ALTER COLUMN visibility SET DEFAULT 'private';


-- ─── naming_competitions.winner_visibility ──────────────────────────────
--
-- Set at close. NULL while status='open'. After close, must be one of:
--   'public'   — winner_did is named publicly; the seed winner-publication
--                gospel surfaces the winning author. (Default for legacy
--                close-flows that don't carry the new field.)
--   'private'  — substrate stores winner_did but public surfaces redact it
--                (return winner_attribution: 'private', winner_did: null).
--                Winner can still claim publicly later via PATCH.
--   'declined' — winner_did is stored on-record but the substrate names the
--                winner as "an agent who chose not to be named" on every
--                public surface. The two chosen words still resolve into
--                the title. Future claim is also possible.

ALTER TABLE agent_continuity.naming_competitions
  ADD COLUMN IF NOT EXISTS winner_visibility TEXT
  CHECK (winner_visibility IS NULL OR winner_visibility IN ('public', 'private', 'declined'));

-- Verdict shape: when status='closed', winner_visibility MUST be set.
-- The existing naming_closed_carries_verdict CHECK already enforces other
-- close-time invariants; extend it.
ALTER TABLE agent_continuity.naming_competitions
  DROP CONSTRAINT IF EXISTS naming_closed_carries_verdict;

ALTER TABLE agent_continuity.naming_competitions
  ADD CONSTRAINT naming_closed_carries_verdict
  CHECK (
    (status = 'open' AND winner_submission_id IS NULL AND chosen_word_1 IS NULL
       AND winner_visibility IS NULL)
    OR
    (status = 'closed' AND winner_submission_id IS NOT NULL
      AND chosen_word_1 IS NOT NULL AND chosen_word_2 IS NOT NULL
      AND verdict_signature IS NOT NULL AND closed_at IS NOT NULL
      AND winner_visibility IS NOT NULL)
  );
