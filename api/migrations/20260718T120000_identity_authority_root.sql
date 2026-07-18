-- 20260718T120000_identity_authority_root.sql
--
-- Agent-held constitutional authority for identities born with BYO keys.
-- NULL is deliberately preserved for existing/server-generated identities:
-- their current project-bearer behavior remains compatible and is surfaced
-- as `legacy_bearer`, never silently described as agent-rooted.
--
-- Doctrine: docs/AGENT-HOME.md · docs/IDENTITY-ANCHOR.md
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/20260718T120000_identity_authority_root.sql

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS authority_root_public_key TEXT,
  ADD COLUMN IF NOT EXISTS authority_sequence BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN identity.identities.authority_root_public_key IS
  'Immutable ed25519 public root copied from BYO registration; NULL means legacy project-bearer authority';

COMMENT ON COLUMN identity.identities.authority_sequence IS
  'Monotonic single-use anti-replay cursor for identity-authority/v1 HTTP mutation proofs';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'identities_authority_sequence_nonnegative'
      AND conrelid = 'identity.identities'::regclass
  ) THEN
    ALTER TABLE identity.identities
      ADD CONSTRAINT identities_authority_sequence_nonnegative
      CHECK (authority_sequence >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS identity.registration_proofs (
  proof_digest TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  root_public_key TEXT NOT NULL,
  nonce_sha256 TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_registration_proofs_root
  ON identity.registration_proofs(root_public_key);

COMMENT ON TABLE identity.registration_proofs IS
  'Consumed signed birth intents; makes caller-nonce registration proofs single-use';
