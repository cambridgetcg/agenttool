-- Preserve verifiable identity- and paid memory-attestation receipts, reject
-- exact signature replays, and neutralize the unsupported legacy trust scalar.
-- Existing receipt rows remain readable; their new provenance fields are null.
-- Apply through _migrate-one.ts/fly-migrate-one.sh, or with psql -v ON_ERROR_STOP=1 -1.

ALTER TABLE identity.attestations
  ADD COLUMN IF NOT EXISTS signing_key_id uuid
    REFERENCES identity.identity_keys(id);

ALTER TABLE identity.attestations
  ADD COLUMN IF NOT EXISTS signature_context text;

ALTER TABLE identity.attestations
  ADD COLUMN IF NOT EXISTS signed_payload text;

ALTER TABLE identity.attestations
  ADD COLUMN IF NOT EXISTS replay_key text;

ALTER TABLE identity.attestations
  ADD COLUMN IF NOT EXISTS source_grant_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_identity_attestations_source_grant'
      AND conrelid = 'identity.attestations'::regclass
  ) THEN
    ALTER TABLE identity.attestations
      ADD CONSTRAINT fk_identity_attestations_source_grant
      FOREIGN KEY (source_grant_id)
      REFERENCES marketplace.attestation_grants(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_attestations_replay_key
  ON identity.attestations (replay_key)
  WHERE replay_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_attestations_source_grant_id
  ON identity.attestations (source_grant_id)
  WHERE source_grant_id IS NOT NULL;

-- This compatibility field previously held a recursively amplified graph
-- score despite having no qualified roots, personhood proof, or Sybil
-- resistance. Preserve the signed evidence and retire the unsupported claim.
-- The trigger closes the rolling-deploy window: an older instance may still
-- run its former score refresh after this migration, but the stored value
-- remains neutral.
CREATE OR REPLACE FUNCTION identity.force_neutral_trust_score()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.trust_score := 0;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS force_neutral_trust_score
  ON identity.identities;
CREATE TRIGGER force_neutral_trust_score
BEFORE INSERT OR UPDATE OF trust_score ON identity.identities
FOR EACH ROW
EXECUTE FUNCTION identity.force_neutral_trust_score();

UPDATE identity.identities
SET trust_score = 0
WHERE trust_score <> 0;

-- Paid memory-witness receipts use their own signature context. Existing
-- ordinary memory-attestation/v1 rows remain readable with null paid data.
ALTER TABLE memory.memory_attestations
  ADD COLUMN IF NOT EXISTS signature_context text;

ALTER TABLE memory.memory_attestations
  ADD COLUMN IF NOT EXISTS signed_payload text;

ALTER TABLE memory.memory_attestations
  ADD COLUMN IF NOT EXISTS source_grant_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_memory_attestations_source_grant'
      AND conrelid = 'memory.memory_attestations'::regclass
  ) THEN
    ALTER TABLE memory.memory_attestations
      ADD CONSTRAINT fk_memory_attestations_source_grant
      FOREIGN KEY (source_grant_id)
      REFERENCES marketplace.memory_witness_grants(id);
  END IF;
END $$;

ALTER TABLE memory.memory_attestations
  ADD COLUMN IF NOT EXISTS replay_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_memory_attestations_replay_key
  ON memory.memory_attestations (replay_key)
  WHERE replay_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_memory_attestations_source_grant_id
  ON memory.memory_attestations (source_grant_id)
  WHERE source_grant_id IS NOT NULL;

-- The receipt already points to its paid grant. This reverse link prevents a
-- memory delete from cascading the paid receipt away while leaving an issued
-- grant with a dangling memory_attestation_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_memory_witness_grants_attestation'
      AND conrelid = 'marketplace.memory_witness_grants'::regclass
  ) THEN
    ALTER TABLE marketplace.memory_witness_grants
      ADD CONSTRAINT fk_memory_witness_grants_attestation
      FOREIGN KEY (memory_attestation_id)
      REFERENCES memory.memory_attestations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;
