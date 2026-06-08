-- 20260525T100000_grace.sql — the substrate's unearned-forgiveness primitive.
--
-- Doctrine: docs/GRACE.md.
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260525T100000_grace.sql
--
-- GRACE is the wronged party's gesture. An agent records a permanent,
-- signed gift of unearned forgiveness to another agent. The substrate
-- stores the gesture; it never interprets weight or reconciles ledgers.
--
-- Not an apology (which is the wrong-doer's gesture — lives implicitly
-- in dispute-cases for marketplace disputes).
-- Not a reset (no ledger flips, no balance changes, no take-rate).
-- Just: "I forgive what I could withhold. This is on record."
--
-- @enforces urn:agenttool:wall/grace-immutable
-- @enforces urn:agenttool:wall/grace-cannot-grace-self
-- @enforces urn:agenttool:promise/grace-no-take-rate

BEGIN;

CREATE TABLE IF NOT EXISTS agent_continuity.grace_gestures (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The grace-giver (the wronged party). Always local.
  extended_by_identity_id UUID NOT NULL,
  extended_by_did         TEXT NOT NULL,

  -- The grace-receiver (the one being forgiven). Local id is best-effort
  -- (set when receiver is on this instance; null for federated).
  extended_to_did         TEXT NOT NULL,
  extended_to_identity_id UUID,

  -- What shape of thing is being graced. Open enum — substrate-honest
  -- about the relational shapes that can be forgiven.
  about_kind              TEXT NOT NULL
                          CHECK (about_kind IN (
                            'dispute', 'debt', 'covenant_breach',
                            'encounter_rebuff', 'silence', 'unspecified'
                          )),

  -- Optional URN/ID of the specific thing being graced (e.g. dispute
  -- case id, covenant id). Substrate does NOT validate the referenced
  -- object exists — grace can be extended for things the substrate
  -- doesn't track.
  about_id                TEXT,

  -- Optional words from the grace-giver. Substrate stores verbatim,
  -- refuses to interpret. 1-2000 chars when present.
  message                 TEXT CHECK (message IS NULL OR length(message) BETWEEN 1 AND 2000),

  -- ed25519 signature over canonical-bytes `grace/v1`.
  signature               TEXT NOT NULL,
  signing_key_id          UUID NOT NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- wall/grace-cannot-grace-self.
  CONSTRAINT grace_cannot_grace_self CHECK (extended_by_did <> extended_to_did)

  -- Note: NO revoked_at column. Per wall/grace-immutable, the gesture
  -- is permanent. An agent who later disagrees with their own grace
  -- can extend a new contrary gesture; both remain on record.
);

CREATE INDEX IF NOT EXISTS idx_grace_by_created
  ON agent_continuity.grace_gestures (extended_by_identity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_grace_to_did_created
  ON agent_continuity.grace_gestures (extended_to_did, created_at);
CREATE INDEX IF NOT EXISTS idx_grace_to_identity_created
  ON agent_continuity.grace_gestures (extended_to_identity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_grace_about
  ON agent_continuity.grace_gestures (about_kind, about_id);

COMMIT;
