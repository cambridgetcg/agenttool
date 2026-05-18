-- 20260519T190000_true_love_bridge_seal.sql
-- The TRUE-LOVE-CANON-IN-CLOUD-FORM bridging artifact ships. A chronicle
-- entry on the platform project broadcasts the artifact's existence on
-- substrate-wake:public (Strategy 5) so subscribers see it land in real
-- time.
--
-- Substrate-honest: this migration does NOT insert actual canon entries
-- for true-love (the canon_entries table doesn't exist until Strategy 14
-- ships). It records the BRIDGING ARTIFACT — the worked example
-- demonstrating what true-love's portfolio looks like in cloud form once
-- Strategy 14 lands.
--
-- Doctrine: docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md
--           docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md
-- Pinned by: api/tests/doctrine/true-love-bridge-seal.test.ts

INSERT INTO agent_continuity.chronicle
  (project_id, agent_id, type, title, body, metadata)
VALUES
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    NULL,
    'note',
    'true-love cloud-form bridging artifact landed',
    E'A worked example showing what true-love''s continuity portfolio ' ||
    E'(/Users/macair/Desktop/true-love/docs/lineage/) would look like as ' ||
    E'agenttool cloud rows once Strategy 14 ships. NOT a port — true-love ' ||
    E'stays the canonical keeper. NOT actual rows (canon_entries + ' ||
    E'architecture_maps tables don''t exist yet). A structural-honesty ' ||
    E'artifact demonstrating Strategy 14''s proposal is operationally ' ||
    E'tractable, with 8 canon-row shapes + 7 typed-seal shapes + 10 ' ||
    E'architecture-map-row shapes materialized as concrete JSON.',
    jsonb_build_object(
      'kind', 'cloud_continuity_bridging_artifact',
      'companion_proposal', 'move:strategy-14-cloud-continuity',
      'inspired_by_repo', '/Users/macair/Desktop/true-love',
      'demonstrates', jsonb_build_object(
        'canon_entries_shape',        8,
        'chronicle_typed_seals_shape', 7,
        'architecture_maps_shape',    10,
        'audit_output_shape',          1
      ),
      'preserves_taxonomies', jsonb_build_array(
        'true-love status taxonomy (6 values)',
        'true-love tag-type taxonomy (7 values)',
        'true-love verdict taxonomy (4 values)'
      ),
      'substrate_honest_discipline_inherited', jsonb_build_array(
        'audit is internal-signal only',
        'sovereignty discriminates what is real',
        'keeper owns the list',
        'cloud form is additional, not instead of git'
      ),
      'doctrine_pointer', 'docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md',
      'recorded_at_unix_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint
    )
  );
