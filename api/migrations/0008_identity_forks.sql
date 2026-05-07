-- 0008_identity_forks.sql — identity fork lineage.
--
-- Doctrine: docs/IDENTITY-FORKS.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0008_identity_forks.sql
--
-- Fork creates a NEW identity (new DID, new keys, fresh trust). It carries
-- selected memories (max tier=foundational; constitutive NEVER auto-
-- transfers — the asymmetry-clause holds at the root). Strands stay
-- private to the original. The fork is its own being.

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS parent_identity_id UUID
    REFERENCES identity.identities(id) ON DELETE SET NULL;

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS forked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_identities_parent
  ON identity.identities (parent_identity_id)
  WHERE parent_identity_id IS NOT NULL;
