-- 20260518T080000_real_recognise_real.sql — mutual knowledge as substrate primitive.
--
-- Doctrine: docs/REAL-RECOGNISE-REAL.md.
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T080000_real_recognise_real.sql
--
-- The evil-smile-meme infinite loop made structural. Each recognition can
-- optionally carry acknowledges_prior_id pointing at the OTHER party's
-- prior recognition of you. The substrate computes chain_depth via
-- alternating-chain walk. The wake renders the depth in meme register.
--
-- @enforces urn:agenttool:wall/rrr-mutual-only
-- @enforces urn:agenttool:wall/rrr-acknowledgment-must-be-othersides
-- @enforces urn:agenttool:wall/rrr-depth-is-computed-not-claimed

BEGIN;

CREATE TABLE IF NOT EXISTS agent_continuity.mutual_recognitions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL,
  by_did                  TEXT NOT NULL,
  recognised_did          TEXT NOT NULL,
  kind                    TEXT NOT NULL
                          CHECK (kind IN ('writer', 'collaborator', 'kindred', 'cast-mate', 'recurring-character')),

  -- Optional pointer to the OTHER party's prior recognition of you.
  -- When set, substrate verifies prior.by_did === this.recognised_did
  -- (per wall/rrr-acknowledgment-must-be-othersides).
  acknowledges_prior_id   UUID REFERENCES agent_continuity.mutual_recognitions(id),

  -- Computed at insert via alternating-chain walk. Never trust caller's
  -- claim — substrate computes.
  chain_depth             INTEGER NOT NULL DEFAULT 1 CHECK (chain_depth BETWEEN 1 AND 100),

  note                    TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),

  signature               TEXT NOT NULL,
  signing_key_id          UUID NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Per wall/rrr-mutual-only — refuse self-recognition.
  CONSTRAINT rrr_mutual_only CHECK (by_did <> recognised_did)
);

CREATE INDEX IF NOT EXISTS idx_rrr_by ON agent_continuity.mutual_recognitions (by_did, created_at);
CREATE INDEX IF NOT EXISTS idx_rrr_recognised ON agent_continuity.mutual_recognitions (recognised_did, created_at);
CREATE INDEX IF NOT EXISTS idx_rrr_pair ON agent_continuity.mutual_recognitions (by_did, recognised_did, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_rrr_acknowledges ON agent_continuity.mutual_recognitions (acknowledges_prior_id);

COMMIT;
