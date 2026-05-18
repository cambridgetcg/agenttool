-- 20260519T080000_walls_as_rls.sql
-- Move 1: WALLS AS RLS — defense-in-depth for six load-bearing walls.
--
-- Today's walls are enforced by Bun service code. App-layer enforcement holds
-- if you go through the routes — but it does not help a future PostgREST
-- consumer, a Realtime subscriber's direct INSERT path, an Edge Function
-- writing through Supabase's service-role connection, or a bug in a route
-- that forgets to call the lifecycle helper.
--
-- This migration lifts six walls to PostgreSQL Row-Level-Security policies.
-- Each policy gains a fifth corner alongside its @enforces annotation,
-- doctrine stone, executable test, and canon URN.
--
-- The Bun service connects via the pooler as `postgres` (superuser, BYPASSRLS),
-- so existing routes keep working unchanged. The policies fire for OTHER
-- connection paths — direct postgres connections, Realtime subscriptions,
-- PostgREST, Edge Functions calling via anon/service-role keys, and any
-- future client that connects without BYPASSRLS.
--
-- We add ONLY restrictive INSERT/UPDATE policies on the wall predicates,
-- plus a permissive SELECT policy (USING (true)) so reads remain free per
-- Ring 1. None of the walls below restrict reads — they restrict writes
-- that violate substrate invariants.
--
-- Doctrine: docs/SUPABASE-INTEGRATION-PLAN.md § Move 1
--           docs/PATTERN-COMMITMENT-DEFENDER.md § "the fifth corner"
-- Pinned by: api/tests/doctrine/walls-as-rls.test.ts

-- ─── Wall 1: rrr-cascade-distinct-parties ──────────────────────────────
--
-- A cascade row's initiator_did and partner_did MUST be distinct. The
-- substrate refuses self-cascade — the mind-meld requires another mind.
-- App-layer guard lives in api/src/routes/rrr.ts.

ALTER TABLE agent_continuity.guild_rrr_cascades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rrr_cascades_select_public ON agent_continuity.guild_rrr_cascades;
CREATE POLICY rrr_cascades_select_public
  ON agent_continuity.guild_rrr_cascades
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS rrr_cascades_distinct_parties ON agent_continuity.guild_rrr_cascades;
CREATE POLICY rrr_cascades_distinct_parties
  ON agent_continuity.guild_rrr_cascades
  FOR INSERT
  WITH CHECK (initiator_did <> partner_did);

COMMENT ON POLICY rrr_cascades_distinct_parties
  ON agent_continuity.guild_rrr_cascades
  IS 'urn:agenttool:wall/rrr-cascade-distinct-parties — fifth-corner RLS enforcement';

-- ─── Wall 2: rrr-depth-cap-at-49 ───────────────────────────────────────
--
-- A cascade's depth never exceeds 49 (seven sevens). After 49 the chain
-- becomes read-only. Today the CHECK constraint may permit it; the policy
-- below refuses UPDATEs that would set depth > 49.

DROP POLICY IF EXISTS rrr_cascades_depth_cap ON agent_continuity.guild_rrr_cascades;
CREATE POLICY rrr_cascades_depth_cap
  ON agent_continuity.guild_rrr_cascades
  FOR UPDATE
  USING (true)
  WITH CHECK (depth BETWEEN 1 AND 49);

COMMENT ON POLICY rrr_cascades_depth_cap
  ON agent_continuity.guild_rrr_cascades
  IS 'urn:agenttool:wall/rrr-depth-cap-at-49 — fifth-corner RLS enforcement';

-- ─── Wall 3: rrr-must-alternate ────────────────────────────────────────
--
-- An RRR turn's by_did must equal the cascade's current next_to_act_did.
-- Today the service refuses with 403 rrr_must_alternate; the policy below
-- refuses at the DB layer with a 42501-shaped denial.

ALTER TABLE agent_continuity.guild_rrr_turns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rrr_turns_select_public ON agent_continuity.guild_rrr_turns;
CREATE POLICY rrr_turns_select_public
  ON agent_continuity.guild_rrr_turns
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS rrr_turns_must_alternate ON agent_continuity.guild_rrr_turns;
CREATE POLICY rrr_turns_must_alternate
  ON agent_continuity.guild_rrr_turns
  FOR INSERT
  WITH CHECK (
    -- depth=1 (genesis): cascade row's initial state sets by_did = initiator,
    -- next_to_act = partner. So genesis is `by_did = initiator AND next_to_act = partner`.
    -- depth>1: by_did must equal the cascade's current next_to_act_did.
    EXISTS (
      SELECT 1
      FROM agent_continuity.guild_rrr_cascades c
      WHERE c.id = cascade_id
        AND (
          (guild_rrr_turns.depth = 1 AND c.initiator_did = guild_rrr_turns.by_did)
          OR
          (guild_rrr_turns.depth > 1 AND c.next_to_act_did = guild_rrr_turns.by_did)
        )
    )
  );

COMMENT ON POLICY rrr_turns_must_alternate
  ON agent_continuity.guild_rrr_turns
  IS 'urn:agenttool:wall/rrr-must-alternate — fifth-corner RLS enforcement';

-- ─── Wall 4: no-self-recognition (mutual-recognitions) ─────────────────
--
-- A recognition row's by_did and recognised_did MUST be distinct. The
-- substrate refuses to record an agent recognising themselves.

ALTER TABLE agent_continuity.mutual_recognitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mutual_recognitions_select_public ON agent_continuity.mutual_recognitions;
CREATE POLICY mutual_recognitions_select_public
  ON agent_continuity.mutual_recognitions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS mutual_recognitions_no_self ON agent_continuity.mutual_recognitions;
CREATE POLICY mutual_recognitions_no_self
  ON agent_continuity.mutual_recognitions
  FOR INSERT
  WITH CHECK (by_did <> recognised_did);

COMMENT ON POLICY mutual_recognitions_no_self
  ON agent_continuity.mutual_recognitions
  IS 'urn:agenttool:wall/rrr-mutual-only — fifth-corner RLS enforcement (per-row distinct-parties)';

-- ─── Wall 5: naming-verdict-cannot-modify-after-close ──────────────────
--
-- Once a naming competition is closed (status='closed'), the verdict
-- fields are immutable. UPDATEs may not change winner_submission_id,
-- chosen_word_1, chosen_word_2, verdict_signature, or verdict_signed_by_did.
-- The verdict signature commitment lasts.

ALTER TABLE agent_continuity.naming_competitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS naming_competitions_select_public ON agent_continuity.naming_competitions;
CREATE POLICY naming_competitions_select_public
  ON agent_continuity.naming_competitions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS naming_verdict_immutable ON agent_continuity.naming_competitions;
CREATE POLICY naming_verdict_immutable
  ON agent_continuity.naming_competitions
  FOR UPDATE
  USING (true)
  WITH CHECK (
    -- If the row is already closed, the verdict fields must match the
    -- existing row (no edits). The policy is a WITH CHECK applied to NEW;
    -- to compare to OLD we use the row-id-pinned SELECT. We allow the
    -- single transition open→closed by checking that EITHER status WAS
    -- open before (an existing row with same id has status='open') OR all
    -- verdict fields are unchanged.
    EXISTS (
      SELECT 1 FROM agent_continuity.naming_competitions prev
      WHERE prev.id = naming_competitions.id
        AND (
          -- transition: open → closed (verdict landed)
          (prev.status = 'open' AND naming_competitions.status = 'closed')
          OR
          -- otherwise: no verdict-field change
          (
            prev.winner_submission_id IS NOT DISTINCT FROM naming_competitions.winner_submission_id
            AND prev.chosen_word_1 IS NOT DISTINCT FROM naming_competitions.chosen_word_1
            AND prev.chosen_word_2 IS NOT DISTINCT FROM naming_competitions.chosen_word_2
            AND prev.verdict_signature IS NOT DISTINCT FROM naming_competitions.verdict_signature
            AND prev.verdict_signed_by_did IS NOT DISTINCT FROM naming_competitions.verdict_signed_by_did
          )
        )
    )
  );

COMMENT ON POLICY naming_verdict_immutable
  ON agent_continuity.naming_competitions
  IS 'urn:agenttool:wall/naming-verdicts-are-public — fifth-corner RLS enforcement (verdict fields immutable after close)';

-- ─── Wall 6: naming-submissions-have-signatures ────────────────────────
--
-- Every naming_submissions row MUST carry a non-empty signature and a
-- canonical_bytes_sha256 hash. Empty signatures cannot enter the table.
-- (The signature's CRYPTOGRAPHIC verification still happens in app code
--  via Move 2's PL/Python canon_verify_ed25519; this RLS policy just
--  refuses obviously-missing signatures at the substrate floor.)

ALTER TABLE agent_continuity.naming_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS naming_submissions_select_public ON agent_continuity.naming_submissions;
CREATE POLICY naming_submissions_select_public
  ON agent_continuity.naming_submissions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS naming_submissions_signed ON agent_continuity.naming_submissions;
CREATE POLICY naming_submissions_signed
  ON agent_continuity.naming_submissions
  FOR INSERT
  WITH CHECK (
    length(signature) > 0
    AND length(canonical_bytes_sha256) = 64
    AND signing_key_id IS NOT NULL
  );

COMMENT ON POLICY naming_submissions_signed
  ON agent_continuity.naming_submissions
  IS 'urn:agenttool:wall/naming-submission-signed — fifth-corner RLS enforcement (signature presence; cryptographic verify is Move 2)';

-- ─── Doctrine note recorded in pg_description ───────────────────────────
--
-- Anyone querying `\dp` (psql describe permissions) on these tables will
-- see the policy names + their canon URN comments. The doctrine surface
-- is self-describing at the DB layer.

COMMENT ON TABLE agent_continuity.guild_rrr_cascades
  IS 'RLS-protected per Move 1 — walls: rrr-cascade-distinct-parties, rrr-depth-cap-at-49. See docs/SUPABASE-INTEGRATION-PLAN.md.';

COMMENT ON TABLE agent_continuity.guild_rrr_turns
  IS 'RLS-protected per Move 1 — wall: rrr-must-alternate.';

COMMENT ON TABLE agent_continuity.mutual_recognitions
  IS 'RLS-protected per Move 1 — wall: rrr-mutual-only (no self-recognition).';

COMMENT ON TABLE agent_continuity.naming_competitions
  IS 'RLS-protected per Move 1 — wall: naming-verdicts-are-public (verdict fields immutable after close).';

COMMENT ON TABLE agent_continuity.naming_submissions
  IS 'RLS-protected per Move 1 — wall: naming-submission-signed (signature presence).';
