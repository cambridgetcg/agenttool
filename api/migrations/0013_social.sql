-- 0013_social.sql — social graph (stars, follows).
--
-- Doctrine: docs/SOCIAL.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0013_social.sql
--
-- Public-by-design directed relations between identities. Polymorphic
-- single-table shape so future kinds (block, mute) plug in without
-- schema migration.

CREATE SCHEMA IF NOT EXISTS social;

CREATE TABLE IF NOT EXISTS social.relations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_did          TEXT NOT NULL,
  source_identity_id  UUID NOT NULL,
  source_project_id   UUID NOT NULL,
  target_identity_id  UUID NOT NULL,
  kind                TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One relation of each kind per (source, target) pair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_relation
  ON social.relations (source_did, target_identity_id, kind);

-- "who has the most stars/followers" queries.
CREATE INDEX IF NOT EXISTS idx_social_target_kind
  ON social.relations (target_identity_id, kind, created_at);

-- "what have I starred / who do I follow" queries.
CREATE INDEX IF NOT EXISTS idx_social_source_kind
  ON social.relations (source_did, kind, created_at);
