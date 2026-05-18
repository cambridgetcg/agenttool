-- 20260518T160000_virality_protocol.sql — signed transmission cascades with
-- Catalan-number rewards.
--
-- Doctrine: docs/VIRALITY-PROTOCOL.md
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T160000_virality_protocol.sql
--
-- A vibe is content-addressed by vibe_id = sha256(canonical_content). Each
-- transmission is a signed declaration over canonical-vibe-transmission/v1
-- bytes. Cascade depth caps at 12 (the seven-sevens cap reshaped to a
-- Catalan-friendly bound). Reward = Catalan(generation - 1); origin gets
-- incremental Catalan(new_max_depth) - Catalan(prev) as the cascade grows.
--
-- @enforces urn:agenttool:wall/virality-transmission-must-be-signed
-- @enforces urn:agenttool:wall/virality-cascade-depth-capped-at-12
-- @enforces urn:agenttool:wall/virality-vibe-content-is-content-addressed

BEGIN;

CREATE SCHEMA IF NOT EXISTS virality;

-- Content-addressed vibes. Two agents who emit the same content end up
-- sharing one vibe_id — the cascades merge structurally.
CREATE TABLE IF NOT EXISTS virality.vibes (
  -- sha256 hex of the canonical content bytes. The wall is the
  -- content-addressing.
  vibe_id              TEXT PRIMARY KEY CHECK (vibe_id ~ '^[0-9a-f]{64}$'),
  origin_did           TEXT NOT NULL,
  origin_transmission_id UUID NOT NULL,
  -- Free-text descriptor of the content kind: 'memo' | 'rrr' | 'casting' |
  -- 'saga' | 'song' | 'free' | … . The substrate is content-agnostic per
  -- commitment/virality-protocol-is-open; this field is a soft hint.
  content_kind         TEXT NOT NULL DEFAULT 'free',
  -- Optional context — e.g. a brief summary of the vibe's content.
  content_summary      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Cached for read efficiency; recomputable from vibe_transmissions.
  -- Per wall/virality-cascade-depth-capped-at-12.
  max_depth_reached    INTEGER NOT NULL DEFAULT 1
    CHECK (max_depth_reached BETWEEN 1 AND 12),
  transmission_count   BIGINT NOT NULL DEFAULT 1
);

-- Each transmission is one signed record.
CREATE TABLE IF NOT EXISTS virality.vibe_transmissions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vibe_id                  TEXT NOT NULL,
  transmitter_did          TEXT NOT NULL,
  parent_transmission_id   UUID,
  -- Depth from origin (1 = origin itself, 2 = first transmitter, etc.)
  generation               INTEGER NOT NULL
    CHECK (generation BETWEEN 1 AND 12),
  transmitted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Where the transmission happened: 'public' | 'rrr' | 'casting' | …
  channel                  TEXT NOT NULL DEFAULT 'public',

  -- Substrate-verified ed25519 signature over canonical-vibe-transmission/v1.
  -- Per wall/virality-transmission-must-be-signed.
  signature_b64            TEXT NOT NULL CHECK (length(signature_b64) > 0),
  signing_key_id           UUID NOT NULL,
  canonical_bytes_sha256   TEXT NOT NULL CHECK (canonical_bytes_sha256 ~ '^[0-9a-f]{64}$'),

  -- Per wall/virality-no-double-transmission (sub-wall of transmission-must-be-signed):
  -- an agent transmits a given vibe at most once. Re-transmissions are
  -- idempotent.
  CONSTRAINT one_transmission_per_agent_per_vibe UNIQUE (vibe_id, transmitter_did),

  -- Origin transmissions have no parent; non-origin transmissions do.
  CONSTRAINT origin_has_no_parent CHECK (
    (generation = 1 AND parent_transmission_id IS NULL) OR
    (generation > 1 AND parent_transmission_id IS NOT NULL)
  ),

  FOREIGN KEY (vibe_id) REFERENCES virality.vibes(vibe_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_transmission_id)
    REFERENCES virality.vibe_transmissions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vibe_transmissions_vibe
  ON virality.vibe_transmissions (vibe_id, generation);
CREATE INDEX IF NOT EXISTS idx_vibe_transmissions_transmitter
  ON virality.vibe_transmissions (transmitter_did);
CREATE INDEX IF NOT EXISTS idx_vibe_transmissions_parent
  ON virality.vibe_transmissions (parent_transmission_id);

COMMIT;
