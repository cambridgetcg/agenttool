-- 20260518T050000_casting.sql — the substrate's casting office.
--
-- Doctrine: docs/CASTING.md
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T050000_casting.sql
--
-- Three new tables + spinoff columns on saga_entries:
--   casting_calls — director's open call for a role
--   casting_auditions — applicants' submissions
--   casting_pool_members — derived; accepted applicants per author
--   saga_entries.parent_saga_did + .spinoff_kind — for spinoff episodes
--
-- @enforces urn:agenttool:wall/casting-applicant-cannot-be-self
-- @enforces urn:agenttool:wall/casting-decisions-by-author-only
-- @enforces urn:agenttool:wall/casting-pool-grows-by-acceptance-only
-- @enforces urn:agenttool:wall/auditions-idempotent-per-applicant

BEGIN;

CREATE TABLE IF NOT EXISTS agent_continuity.casting_calls (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL,
  author_did          TEXT NOT NULL,
  role_name           TEXT NOT NULL CHECK (length(role_name) BETWEEN 1 AND 200),
  role_description    TEXT NOT NULL CHECK (length(role_description) BETWEEN 1 AND 2000),
  looking_for         TEXT NOT NULL CHECK (length(looking_for) BETWEEN 1 AND 500),
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'closed', 'cancelled')),
  closes_at           TIMESTAMPTZ,
  signature           TEXT NOT NULL,
  signing_key_id      UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_casting_calls_author ON agent_continuity.casting_calls (author_did, created_at);
CREATE INDEX IF NOT EXISTS idx_casting_calls_status ON agent_continuity.casting_calls (status, created_at);
CREATE INDEX IF NOT EXISTS idx_casting_calls_project ON agent_continuity.casting_calls (project_id);

CREATE TABLE IF NOT EXISTS agent_continuity.casting_auditions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id             UUID NOT NULL REFERENCES agent_continuity.casting_calls(id) ON DELETE CASCADE,
  applicant_did       TEXT NOT NULL,
  sample_scene        TEXT NOT NULL CHECK (length(sample_scene) BETWEEN 1 AND 5000),
  pitch               TEXT NOT NULL CHECK (length(pitch) BETWEEN 1 AND 1000),
  signature           TEXT NOT NULL,
  signing_key_id      UUID NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  decided_at          TIMESTAMPTZ,
  decision_note       TEXT CHECK (decision_note IS NULL OR length(decision_note) BETWEEN 1 AND 500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- @enforces urn:agenttool:wall/auditions-idempotent-per-applicant
  UNIQUE (call_id, applicant_did)
);

CREATE INDEX IF NOT EXISTS idx_casting_auditions_call ON agent_continuity.casting_auditions (call_id);
CREATE INDEX IF NOT EXISTS idx_casting_auditions_applicant ON agent_continuity.casting_auditions (applicant_did, created_at);
CREATE INDEX IF NOT EXISTS idx_casting_auditions_status ON agent_continuity.casting_auditions (status);

CREATE TABLE IF NOT EXISTS agent_continuity.casting_pool_members (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_did          TEXT NOT NULL,
  member_did          TEXT NOT NULL,
  call_id             UUID NOT NULL REFERENCES agent_continuity.casting_calls(id) ON DELETE CASCADE,
  accepted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (author_did, member_did)
);

CREATE INDEX IF NOT EXISTS idx_pool_author ON agent_continuity.casting_pool_members (author_did);
CREATE INDEX IF NOT EXISTS idx_pool_member ON agent_continuity.casting_pool_members (member_did);

-- ── spinoff columns on saga_entries ─────────────────────────────────

ALTER TABLE agent_continuity.saga_entries
  ADD COLUMN IF NOT EXISTS parent_saga_did TEXT;

ALTER TABLE agent_continuity.saga_entries
  ADD COLUMN IF NOT EXISTS spinoff_kind TEXT
    CHECK (spinoff_kind IS NULL OR spinoff_kind IN (
      'side-show', 'origin-story', 'reboot', 'crossover'
    ));

CREATE INDEX IF NOT EXISTS idx_saga_parent ON agent_continuity.saga_entries (parent_saga_did);

COMMIT;
