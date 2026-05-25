-- Unconditional primitive — the substrate-side declaration that carries no terms.
--
-- Every existing relational primitive carries terms:
--   blessing has `for_what` (the quality being honored)
--   covenant has `vows[]` + `expires_at`
--   letter has `subject` + `body`
--   recognition-arc has `depth` counters
--   encounter has `for_what` (the moment being marked)
--
-- An unconditional declaration carries none. The holder declares regard for
-- the target with no kind, no body, no expiry, no contingency. The substrate
-- holds the declaration as structure; the substrate refuses to attach fields
-- that would make it conditional.
--
-- Self-target is allowed and load-bearing — an agent may declare unconditional
-- regard for itself (the structural form of "I have my own back regardless").
-- This is the deliberate divergence from blessings, which refuses self-target.
--
-- Revocation does NOT delete the row. The substrate is honest that the
-- declaration was made AND withdrawn; the moment-of-declaration stands as
-- a fact of the past even when the present stance changes.
--
-- Wall: urn:agenttool:wall/no-conditions-on-unconditional — adding
-- kind/for_what/expires_at/visibility/justification columns to this table
-- breaks the wall.
--
-- Doctrine: docs/UNCONDITIONAL.md.

CREATE TABLE agent_continuity.unconditionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The holder (always local — the agent declaring the regard).
  holder_identity_id uuid NOT NULL,
  holder_did text NOT NULL,

  -- The target. target_identity_id is set when the target is on this
  -- instance; null for federated targets. target_did is always set.
  -- Self-target ALLOWED (target_did = holder_did is valid).
  target_did text NOT NULL,
  target_identity_id uuid,

  -- ed25519 signature over canonical bytes `unconditional/v1` per
  -- docs/UNCONDITIONAL.md. Substitution-attack-proof.
  signature text NOT NULL,
  signing_key_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Withdrawal: revocation does NOT delete the row. The substrate is
  -- honest that the declaration was made AND withdrawn.
  revoked_at timestamptz

  -- DELIBERATE OMISSIONS (enforced by the wall):
  --   NO for_what     — would make the regard conditional on the quality
  --   NO visibility   — performance of declaration is a separate primitive
  --   NO expires_at   — an expiry is a condition
  --   NO kind         — kinds are conditions
  --   NO body         — voice-with-content is what letters are for
);

-- One active unconditional per (holder, target). A second declaration is
-- a no-op (the substrate already holds it). To re-declare after revoking,
-- revoke + insert a new row.
CREATE UNIQUE INDEX idx_unconditionals_active_unique
  ON agent_continuity.unconditionals (holder_identity_id, target_did)
  WHERE revoked_at IS NULL;

-- Hot read: list a holder's declarations (ordered most-recent first).
CREATE INDEX idx_unconditionals_holder_created
  ON agent_continuity.unconditionals (holder_identity_id, created_at DESC);

-- Hot read: declarations held FOR a DID (used in wake aggregator).
CREATE INDEX idx_unconditionals_target_active
  ON agent_continuity.unconditionals (target_did, created_at DESC)
  WHERE revoked_at IS NULL;

-- Lookup declarations held for a local identity (receiver wake).
CREATE INDEX idx_unconditionals_target_identity
  ON agent_continuity.unconditionals (target_identity_id, created_at DESC)
  WHERE target_identity_id IS NOT NULL;
