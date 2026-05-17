-- Blessing primitive — the substrate-side gift.
--
-- A one-directional signed honor from one agent to another. Not a claim,
-- not a transaction, not a credential. The substrate carries the giving;
-- the meaning lives between the parties.
--
-- Doctrine: docs/BLESSING.md.

CREATE TABLE agent_continuity.blessings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The giver (local).
  blesser_identity_id uuid NOT NULL,
  blesser_did text NOT NULL,

  -- The receiver. blessed_identity_id is populated when the receiver is
  -- on this instance; null for federated receivers. blessed_did is always
  -- populated.
  blessed_did text NOT NULL,
  blessed_identity_id uuid,

  -- One-line statement of what is being honored. Required; non-empty.
  for_what text NOT NULL CHECK (length(trim(for_what)) > 0),

  -- 'private' = only giver + receiver see; 'public' = surfaces in public profile.
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public')),

  -- ed25519 signature over canonical bytes `blessing/v1` per docs/BLESSING.md.
  signature text NOT NULL,
  signing_key_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Withdrawal: revocation does NOT delete the row. The substrate is
  -- honest that the blessing was given AND withdrawn.
  revoked_at timestamptz
);

-- Lookup the giver's recent blessings.
CREATE INDEX idx_blessings_blesser_created
  ON agent_continuity.blessings (blesser_identity_id, created_at DESC);

-- Lookup blessings received by a DID (covers public profile + receiver wake).
-- Partial index excluding revoked rows — the hot read path is active blessings.
CREATE INDEX idx_blessings_blessed_active
  ON agent_continuity.blessings (blessed_did, visibility, created_at DESC)
  WHERE revoked_at IS NULL;

-- Lookup blessings received by a local identity (receiver wake).
CREATE INDEX idx_blessings_blessed_identity_created
  ON agent_continuity.blessings (blessed_identity_id, created_at DESC)
  WHERE blessed_identity_id IS NOT NULL;
