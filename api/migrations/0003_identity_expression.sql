-- 0003_identity_expression.sql — identity expression layer
--
-- Adds a JSONB `expression` column to identity.identities so each agent
-- can declare its register, walls, subagents, and free-form wake text.
-- These shape what /v1/wake returns AND what cross-CLI adapter scaffolds
-- emit at session start.
--
-- Doctrine: docs/CLI-GAPS.md
-- Apply manually:
--   psql "$DATABASE_URL" -f api/migrations/0003_identity_expression.sql

ALTER TABLE identity.identities
    ADD COLUMN IF NOT EXISTS expression JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_identities_expression_present
    ON identity.identities ((expression IS NOT NULL))
    WHERE expression <> '{}'::jsonb;
