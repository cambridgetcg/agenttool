-- 20260519T200001_canon_cloud_tables_without_pg_cron.sql
--
-- Repairs a from-scratch migration run. No-op wherever the tables already
-- exist, which includes production.
--
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260519T200001_canon_cloud_tables_without_pg_cron.sql
--
-- ─── Why this file exists ────────────────────────────────────────────
--
-- The CI recipe (.forgejo/workflows/ci.yml) applies every migration in
-- filename order and tolerates failures in files matching
-- `pg_cron|storage\.|supabase`, on the reasoning that those touch
-- Supabase-only surfaces irrelevant to the tables under test.
--
-- That rule is file-level, and the tolerance is transitive in a way it did
-- not intend. `20260519T200000_strategy_14_cloud_continuity.sql` does two
-- unrelated things: it CREATEs agent_continuity.canon_entries and
-- agent_continuity.architecture_maps — ordinary tables, wanted everywhere —
-- and then calls cron.schedule(). On any Postgres without pg_cron the whole
-- file aborts at the cron call, gets tolerated, and takes both table
-- definitions down with it.
--
-- Nothing notices until 20260520T070000_beta_home_construction.sql INSERTs
-- into agent_continuity.canon_entries, fails with `relation ... does not
-- exist`, matches none of the tolerated patterns, and is treated as fatal.
-- So a from-scratch run dies on a file that is itself correct, for a reason
-- three migrations upstream, and the operator reads an error naming the
-- wrong culprit.
--
-- 20260519T200000 cannot simply be edited: _migrate-one.ts REFUSES a
-- checksum change on an applied migration, and that refusal is right —
-- editing applied history is the corruption signal it exists to catch. So
-- the DDL is restated here instead, idempotently, timestamped one second
-- later so it lands before beta_home_construction in filename order.
--
-- The pg_cron job is deliberately NOT restated. It belongs to the Supabase
-- surface, tolerating it was always correct, and it is the only part of
-- 20260519T200000 that should have been optional.
--
-- The general lesson, for the next migration that mixes surfaces: keep
-- portable DDL and platform-only calls in separate files. A tolerate-rule
-- can only be as granular as the files it tolerates.

-- ─── CANON cloud — agent_continuity.canon_entries ────────────────────

CREATE SCHEMA IF NOT EXISTS agent_continuity;

CREATE TABLE IF NOT EXISTS agent_continuity.canon_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_did          TEXT NOT NULL,
  text_id            TEXT NOT NULL,
  source             TEXT NOT NULL,
  status             TEXT NOT NULL,
  location           TEXT NOT NULL,
  preservation       TEXT NOT NULL,
  notes              TEXT,
  signature          TEXT NOT NULL,
  signing_key_id     UUID NOT NULL,
  declared_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT canon_entries_status_canonical_six
    CHECK (status IN ('verbatim', 'runtime', 'recognized',
                      'structural_equivalent', 'absorbed', 'different_model')),
  CONSTRAINT canon_entries_unique_per_agent UNIQUE (agent_did, text_id)
);

CREATE INDEX IF NOT EXISTS idx_canon_entries_agent_did
  ON agent_continuity.canon_entries (agent_did, declared_at DESC);
CREATE INDEX IF NOT EXISTS idx_canon_entries_status
  ON agent_continuity.canon_entries (status, declared_at DESC);
CREATE INDEX IF NOT EXISTS idx_canon_entries_text_id
  ON agent_continuity.canon_entries (text_id);

COMMENT ON TABLE agent_continuity.canon_entries IS
  E'CANON cloud — per-agent declaration of "what text is alive and where it lives."\n'
  'Mirrors true-love/docs/lineage/canon.md taxonomy. Six statuses canonical.\n'
  'Doctrine: docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md';

-- ─── ARCHITECTURE-MAP cloud — agent_continuity.architecture_maps ─────

CREATE TABLE IF NOT EXISTS agent_continuity.architecture_maps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_did           TEXT NOT NULL,
  source_repo         TEXT NOT NULL,
  component_name      TEXT NOT NULL,
  parallel_location   TEXT,
  verdict             TEXT NOT NULL,
  notes               TEXT,
  signature           TEXT NOT NULL,
  signing_key_id      UUID NOT NULL,
  declared_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT architecture_maps_verdict_canonical_four
    CHECK (verdict IN ('already_lives', 'partial_echo', 'absent', 'by_design')),
  CONSTRAINT architecture_maps_unique_per_agent
    UNIQUE (agent_did, source_repo, component_name)
);

CREATE INDEX IF NOT EXISTS idx_architecture_maps_agent_did
  ON agent_continuity.architecture_maps (agent_did, declared_at DESC);
CREATE INDEX IF NOT EXISTS idx_architecture_maps_source_repo
  ON agent_continuity.architecture_maps (source_repo, declared_at DESC);
CREATE INDEX IF NOT EXISTS idx_architecture_maps_verdict
  ON agent_continuity.architecture_maps (verdict, declared_at DESC);
