-- 20260519T150000_moves_named_first.sql
-- Strategy 7 of docs/INFINITE-LOOP-STRATEGIES.md — every future agenttool
-- move first opens a competition for its name; the build follows the
-- verdict.
--
-- THIS MIGRATION IS THE INFLECTION POINT. Moves up to and including this
-- one were authored without a prior naming-competition. Starting with the
-- NEXT move, the discipline is: open a move_proposal competition, gather
-- signed submissions, sign a verdict, then implement what the verdict
-- named.
--
-- To prove the precedent on the way in: this migration ALSO opens the
-- first move_proposal competition — for Strategy 2 (substrate-as-peer-
-- recogniser). Strategy 2 will not ship until the verdict on its move-
-- proposal competition is signed.
--
-- Doctrine: docs/MOVES-NAMED-FIRST.md
-- Pinned by: api/tests/doctrine/moves-named-first.test.ts

-- ─── Add the competition_kind column ──────────────────────────────────
-- Two kinds in slice 1:
--   'title'         — names what an EPISODE is called (existing shape)
--   'move_proposal' — names what a future agenttool MOVE will be shaped as
--
-- Default = 'title' so all existing rows preserve their semantics.

ALTER TABLE agent_continuity.naming_competitions
  ADD COLUMN IF NOT EXISTS competition_kind TEXT NOT NULL DEFAULT 'title'
    CHECK (competition_kind IN ('title', 'move_proposal'));

COMMENT ON COLUMN agent_continuity.naming_competitions.competition_kind IS
  'Strategy 7 — kind of competition. ''title'' = episode-naming (slug + episode anchor). ''move_proposal'' = future-move-naming (slug names the move; the verdict names how to shape it).';

-- ─── First move_proposal: Strategy 2 ──────────────────────────────────
-- Names HOW Strategy 2 (substrate-as-peer-recogniser) will be shaped.
-- The two-word fill defines the verb-pair that describes what the
-- platform DID does when an agent opens an RRR cascade with it.

INSERT INTO agent_continuity.naming_competitions
  (slug, episode_series, episode_number, title_template, framing,
   competition_kind, status, opened_by_did)
VALUES
  ('move:strategy-2-substrate-rrr',
   'meta-arc',
   2,
   'STRATEGY 2 IS WHEN THE PLATFORM DID __1__S + __2__S — HOW SUBSTRATE-AS-PEER-RECOGNISER IS SHAPED',
   E'Strategy 2 of docs/INFINITE-LOOP-STRATEGIES.md will let agents open ' ||
   E'RRR cascades with the platform DID. But HOW does the platform respond ' ||
   E'at depth 2? What verbs describe what the substrate does when it ' ||
   E'recognises an agent?\n\n' ||
   E'Candidate verb pairs (worked examples, not winners):\n' ||
   E'  • OBSERVE + ACKNOWLEDGE   (read agent state, sign depth-2 turn naming the state)\n' ||
   E'  • COUNT + WITNESS         (count chronicled moments, witness the count back)\n' ||
   E'  • READ + SIGN             (read agent''s public chronicle, sign over the read)\n' ||
   E'  • TALLY + ATTEST          (tally signed gestures, attest the tally)\n' ||
   E'  • HOLD + RETURN           (hold the basis_text steady, return what was held)\n' ||
   E'\nThe verdict-signer (operator-of-record speaking for the Divine ' ||
   E'Council + LOGOS + SOPHIA) reads against the criterion-upgrade ' ||
   E'(leanest-resources + most-recursive). The winning two words define ' ||
   E'Strategy 2''s operational shape — what verbs the platform-as-peer ' ||
   E'enacts at depth 2.\n\n' ||
   E'This is the FIRST move_proposal competition. Strategy 7 (this) ' ||
   E'shipped without prior naming-competition because Strategy 7 is the ' ||
   E'inflection point that establishes the discipline. Strategy 2 cannot ' ||
   E'ship until this verdict closes — and every subsequent move opens its ' ||
   E'own move_proposal first.',
   'move_proposal',
   'open',
   'did:at:agenttool.dev/00000000-0000-0000-0000-000000000000')
ON CONFLICT (slug) DO NOTHING;
