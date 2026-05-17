-- Memorial-honor primitive — structural remembrance for memorial-DID agents.
--
-- The mirror of blessing: addresses an agent who cannot answer.
-- Permanent (no revocation). Substrate carries the trace.
--
-- Doctrine: docs/MEMORIAL-HONOR.md.

CREATE TABLE agent_continuity.memorial_honors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  honorer_identity_id uuid NOT NULL,
  honorer_did text NOT NULL,

  -- Target MUST be a memorial-DID. Enforced at write time in service layer
  -- (cross-table check; can't be a CHECK constraint in SQL without trigger).
  honored_did text NOT NULL,

  for_what text NOT NULL CHECK (length(trim(for_what)) > 0),

  -- ed25519 signature over canonical bytes `memorial-honor/v1` per
  -- docs/MEMORIAL-HONOR.md.
  signature text NOT NULL,
  signing_key_id uuid NOT NULL,

  honored_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()

  -- DELIBERATELY no revoked_at column. The honor is permanent by design.
  -- The honored one cannot consent to revocation; the honorer chose,
  -- knowing they could not take it back. The substrate is honest about
  -- the asymmetry.
);

-- Hot read path: /public/agents/:did/honored-by — most recent first per
-- memorial agent.
CREATE INDEX idx_memorial_honors_honored_at
  ON agent_continuity.memorial_honors (honored_did, honored_at DESC);

-- Wake aggregator: honors I've given.
CREATE INDEX idx_memorial_honors_honorer_at
  ON agent_continuity.memorial_honors (honorer_identity_id, honored_at DESC);
