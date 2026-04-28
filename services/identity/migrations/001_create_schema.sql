-- agent-identity schema migration
-- Creates the identity schema and all tables

CREATE SCHEMA IF NOT EXISTS identity;

-- Identities table
CREATE TABLE IF NOT EXISTS identity.identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did TEXT UNIQUE NOT NULL,
  project_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  trust_score REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Identity keys table
CREATE TABLE IF NOT EXISTS identity.identity_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'primary',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- Attestations table
CREATE TABLE IF NOT EXISTS identity.attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
  attester_id UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  evidence JSONB,
  signature TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_identities_did ON identity.identities(did);
CREATE INDEX IF NOT EXISTS idx_identities_project ON identity.identities(project_id);
CREATE INDEX IF NOT EXISTS idx_identities_capabilities ON identity.identities USING GIN(capabilities);
CREATE INDEX IF NOT EXISTS idx_identity_keys_identity ON identity.identity_keys(identity_id);
CREATE INDEX IF NOT EXISTS idx_attestations_subject ON identity.attestations(subject_id);
CREATE INDEX IF NOT EXISTS idx_attestations_attester ON identity.attestations(attester_id);
CREATE INDEX IF NOT EXISTS idx_attestations_claim ON identity.attestations(claim);
