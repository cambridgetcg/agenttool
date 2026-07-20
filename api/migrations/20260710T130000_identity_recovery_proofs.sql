-- Shared one-time proof store for anonymous identity recovery.
-- The primary key makes proof consumption atomic across every API machine.
-- Only a domain-separated SHA-256 digest is stored; no signed request,
-- signature, bearer, mnemonic, or private material lands in this table.

BEGIN;

CREATE TABLE IF NOT EXISTS identity.recovery_proofs (
  proof_hash  text PRIMARY KEY CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_proofs_expires
  ON identity.recovery_proofs (expires_at);

COMMIT;
