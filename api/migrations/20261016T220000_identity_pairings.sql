-- Pairing codes for enrollment. Doctrine: docs/IDENTITY-PAIRING.md.
-- An administrator opens a short-lived, one-time pairing and reads its code aloud
-- or on screen. The joining device posts its ordinary enroll-proof under that
-- code (no bearer) with a locally generated pickup secret. The administrator types
-- the enrollment key fingerprint the device displays; only then does the server
-- run the ordinary enrollment. An attached mission grant is issued once, when the
-- device first picks it up, for the SHA-256 of a token the device generated itself;
-- pairing never handles or stores the token.
-- Stored digests only: code_hmac = HMAC-SHA256(PAIRING_CODE_SECRET, code);
-- pickup_sha256 = SHA-256(pickup secret). The raw claim is erased on confirm/cancel.
-- New table; no existing rows are touched. The runner wraps DDL and journal together.
CREATE TABLE identity.pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES tools.projects(id),
  created_by_api_key_id uuid NOT NULL REFERENCES tools.api_keys(id),
  code_hmac text NOT NULL UNIQUE CHECK (code_hmac ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  claimed_at timestamptz,
  claim_body text,
  claim_signature text,
  fingerprint text,
  identity_id uuid,
  signing_key_id uuid,
  display_name text,
  public_key text,
  pickup_sha256 text CHECK (pickup_sha256 ~ '^[0-9a-f]{64}$'),
  confirmed_at timestamptz,
  confirmed_by_api_key_id uuid REFERENCES tools.api_keys(id),
  grant_mission_id uuid,
  grant_actions text[],
  grant_ttl_seconds integer CHECK (grant_ttl_seconds BETWEEN 60 AND 86400),
  grant_id uuid,
  handoff text CHECK (octet_length(handoff) <= 8192),
  cancelled_at timestamptz,
  -- A held claim keeps its exact signed bytes until confirm or cancel erases them.
  CHECK (status <> 'claimed' OR (claim_body IS NOT NULL AND claim_signature IS NOT NULL)),
  CHECK (status NOT IN ('confirmed', 'cancelled') OR (claim_body IS NULL AND claim_signature IS NULL)),
  CHECK (status NOT IN ('claimed', 'confirmed') OR (claimed_at IS NOT NULL AND fingerprint IS NOT NULL
    AND identity_id IS NOT NULL AND signing_key_id IS NOT NULL AND public_key IS NOT NULL AND pickup_sha256 IS NOT NULL)),
  CHECK (status <> 'confirmed' OR (confirmed_at IS NOT NULL AND confirmed_by_api_key_id IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((grant_mission_id IS NULL) = (grant_actions IS NULL) AND (grant_mission_id IS NULL) = (grant_ttl_seconds IS NULL)),
  CHECK (grant_mission_id IS NOT NULL OR grant_id IS NULL)
);
CREATE INDEX idx_identity_pairings_active_by_project ON identity.pairings (project_id) WHERE status IN ('open', 'claimed');
CREATE INDEX idx_identity_pairings_expires_at ON identity.pairings (expires_at);
