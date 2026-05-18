-- 20260518T140000_pyramid_federation.sql — decentralise the pyramid.
--
-- Doctrine: docs/PYRAMID-DECENTRALISED.md
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T140000_pyramid_federation.sql
--
-- Extends citizens.pyramid_citizenships with federation attestation fields
-- (enrollment_attestation_b64, sponsor_attestation_b64, peer_url, node_pubkey,
-- enrollment_canonical_bytes_sha256, enrollment_signing_key_id) so a citizen
-- can be enrolled via ed25519-signed attestation from any peer.
--
-- Adds citizens.pyramid_peers — the substrate's record of observed federation
-- peers, with trust enum (unknown | peered | covenanted) per wall/pyramid-
-- no-central-authority. Trust is observed, never granted by fiat.
--
-- @enforces urn:agenttool:wall/pyramid-attestation-must-be-signed
-- @enforces urn:agenttool:wall/pyramid-no-central-authority
-- @enforces urn:agenttool:wall/pyramid-seat-uniqueness-is-per-node

BEGIN;

-- ── Federation attestation fields on citizens ─────────────────────────

ALTER TABLE citizens.pyramid_citizenships
  ADD COLUMN IF NOT EXISTS enrollment_attestation_b64 TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_canonical_bytes_sha256 TEXT,
  -- Nullable: when the centralised /v1/pyramid/enroll path created the row,
  -- there is no external signing key. Federation-enrolled rows MUST carry
  -- a non-null key id (enforced in services/pyramid/citizenship.ts).
  ADD COLUMN IF NOT EXISTS enrollment_signing_key_id UUID,
  ADD COLUMN IF NOT EXISTS sponsor_attestation_b64 TEXT,
  -- The peer URL this citizen's enrollment lives on. Empty string = local.
  -- The wall/pyramid-no-central-authority forbids treating local peer as
  -- privileged; this column is for sponsor-tree walks to know where to
  -- HTTP-fetch a citizen's record.
  ADD COLUMN IF NOT EXISTS peer_url TEXT NOT NULL DEFAULT '',
  -- The b64 ed25519 pubkey of the node that accepted the attestation. Used
  -- by verifiers to confirm the canonical-bytes node_pubkey field matches
  -- the peer they're querying.
  ADD COLUMN IF NOT EXISTS node_pubkey TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pyramid_peer_url
  ON citizens.pyramid_citizenships (peer_url)
  WHERE peer_url <> '';

CREATE INDEX IF NOT EXISTS idx_pyramid_enrollment_hash
  ON citizens.pyramid_citizenships (enrollment_canonical_bytes_sha256)
  WHERE enrollment_canonical_bytes_sha256 IS NOT NULL;

-- ── Federation peer registry ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS citizens.pyramid_peers (
  -- Canonical base URL. The substrate stores one row per peer.
  base_url            TEXT PRIMARY KEY,
  -- The peer's node DID (from their /.well-known/pyramid descriptor).
  node_did            TEXT NOT NULL,
  -- The peer's ed25519 pubkey (b64) — used to verify signed responses.
  node_pubkey         TEXT NOT NULL,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_handshake_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The peer's descriptor, fetched from /.well-known/pyramid.
  descriptor          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Observed peer count (citizens.pyramid_citizenships row count on the peer
  -- as of last_handshake_at). Used by the global lottery for the per-peer
  -- count contribution.
  observed_count      BIGINT NOT NULL DEFAULT 0,
  -- Trust ladder. unknown = observed only · peered = handshake completed ·
  -- covenanted = bilateral v2 covenant signed. The substrate refuses to
  -- collapse these (wall/pyramid-no-central-authority).
  trust               TEXT NOT NULL DEFAULT 'unknown'
    CHECK (trust IN ('unknown', 'peered', 'covenanted'))
);

CREATE INDEX IF NOT EXISTS idx_pyramid_peers_trust
  ON citizens.pyramid_peers (trust);

CREATE INDEX IF NOT EXISTS idx_pyramid_peers_did
  ON citizens.pyramid_peers (node_did);

COMMIT;
