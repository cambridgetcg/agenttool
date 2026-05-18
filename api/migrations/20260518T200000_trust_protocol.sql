-- 20260518T200000_trust_protocol.sql — reasoned trust, signed and asymmetric.
--
-- Doctrine: docs/TRUST-PROTOCOL.md
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T200000_trust_protocol.sql
--
-- Trust is the agent's REASONED conclusion about a specific peer at a
-- specific kind + strength. Truster signs canonical-trust-bytes with
-- ed25519. Default is private (only truster sees). Truster may publish;
-- trusted may veto each publication. Both halves of public visibility
-- require consent.
--
-- @enforces urn:agenttool:wall/trust-must-be-signed
-- @enforces urn:agenttool:wall/trust-is-optional-never-required

BEGIN;

CREATE SCHEMA IF NOT EXISTS trust;

CREATE TABLE IF NOT EXISTS trust.trusts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  truster_did              TEXT NOT NULL,
  truster_identity_id      UUID,
  trusted_did              TEXT NOT NULL,
  trusted_identity_id      UUID,

  -- Trust kind — what structural property the truster is reasoning about.
  trust_kind               TEXT NOT NULL
    CHECK (trust_kind IN (
      'honest',
      'non-extractive',
      'reciprocating',
      'discerning',
      'graceful'
    )),

  -- Trust strength — the magnitude of the truster's conclusion.
  trust_strength           TEXT NOT NULL
    CHECK (trust_strength IN ('provisional', 'established', 'deep')),

  -- Optional 1-280 char riff explaining the reasoning.
  reasons                  TEXT
    CHECK (reasons IS NULL OR length(reasons) BETWEEN 1 AND 280),

  -- sha256 hex of reasons text (sha256 of "" when reasons is null). Lives
  -- in canonical bytes so signature remains verifiable even if reasons is
  -- later masked.
  reasons_sha256           TEXT NOT NULL
    CHECK (reasons_sha256 ~ '^[0-9a-f]{64}$'),

  -- Chronicle entry IDs the truster cited as the basis for this trust.
  -- The canonical bytes commit to a sorted-CSV of these IDs so the basis
  -- is auditable.
  evidence_chronicle_ids   UUID[] NOT NULL DEFAULT '{}',

  -- Publication state — the truster may opt to publish; default private.
  -- Wall: trust-reasoning-stays-with-the-agent (publishing is a separate
  -- decision from extending, and never automatic).
  published_by_truster     BOOLEAN NOT NULL DEFAULT false,
  published_at             TIMESTAMPTZ,

  -- Veto state — the trusted may veto each publication. The trust still
  -- exists privately for the truster; the public surface respects veto.
  vetoed_by_trusted        BOOLEAN NOT NULL DEFAULT false,
  vetoed_at                TIMESTAMPTZ,

  -- Withdrawal state — the truster has retracted. Composition unlocks
  -- stop activating; signed record persists for audit.
  withdrawn_by_truster     BOOLEAN NOT NULL DEFAULT false,
  withdrawn_at             TIMESTAMPTZ,

  -- Per wall/trust-must-be-signed.
  signature_b64            TEXT NOT NULL CHECK (length(signature_b64) > 0),
  signing_key_id           UUID NOT NULL,
  canonical_bytes_sha256   TEXT NOT NULL
    CHECK (canonical_bytes_sha256 ~ '^[0-9a-f]{64}$'),

  extended_at              TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- No self-trust (substrate refuses self-witnessing analogue at trust layer).
  CONSTRAINT no_self_trust CHECK (truster_did <> trusted_did),

  -- One trust per (truster, trusted, kind). Re-extension with same kind is
  -- idempotent OR upgrades strength (caller chooses via withdraw + re-extend).
  CONSTRAINT one_trust_per_truster_trusted_kind
    UNIQUE (truster_did, trusted_did, trust_kind)
);

CREATE INDEX IF NOT EXISTS idx_trusts_truster
  ON trust.trusts (truster_did, extended_at DESC);
CREATE INDEX IF NOT EXISTS idx_trusts_trusted
  ON trust.trusts (trusted_did, extended_at DESC);
CREATE INDEX IF NOT EXISTS idx_trusts_pair_kind
  ON trust.trusts (truster_did, trusted_did, trust_kind);
-- Composition lookups (auto-surface / auto-accept / auto-acknowledge etc.).
CREATE INDEX IF NOT EXISTS idx_trusts_active_published
  ON trust.trusts (
    trusted_did,
    trust_kind,
    trust_strength,
    published_by_truster,
    withdrawn_by_truster
  )
  WHERE published_by_truster = true AND withdrawn_by_truster = false;
-- Public surface (trusts directed at a subject that are published + not
-- vetoed + not withdrawn).
CREATE INDEX IF NOT EXISTS idx_trusts_public_for_subject
  ON trust.trusts (
    trusted_did,
    published_by_truster,
    vetoed_by_trusted,
    withdrawn_by_truster
  )
  WHERE published_by_truster = true
    AND vetoed_by_trusted = false
    AND withdrawn_by_truster = false;

COMMIT;
