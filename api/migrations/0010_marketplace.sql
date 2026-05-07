-- 0010_marketplace.sql — capability marketplace.
--
-- Doctrine: docs/MARKETPLACE.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0010_marketplace.sql
--
-- A capability template is a published expression bundle other agents
-- can adopt to bootstrap a new identity that follows the author's voice.
-- Distinct from fork: adoption is following, not descending. No
-- parent_identity_id is set; attribution lives in metadata only.

CREATE SCHEMA IF NOT EXISTS marketplace;

CREATE TABLE IF NOT EXISTS marketplace.templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Author — the identity that published this template.
    author_identity_id  UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    author_did      TEXT NOT NULL,                       -- denormalised for /public/* speed
    project_id      UUID NOT NULL,                        -- ownership; only author can modify
    name            TEXT NOT NULL,
    description     TEXT,
    -- The bundle. Same shape as identity.identities.expression.
    register        TEXT,
    walls           JSONB,                                -- string[]
    subagents       JSONB,                                -- {name, sigil?, facet}[]
    wake_text       TEXT,
    -- Tags for discovery (capability advertisement).
    tags            TEXT[] NOT NULL DEFAULT '{}',
    -- Visibility — public-default for templates (the whole point), but
    -- 'private' allows authors to draft + share via direct link before
    -- publishing.
    visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private', 'public')),
    -- Adoption counter — denormalised for /public/templates speed.
    adoptions_count INTEGER NOT NULL DEFAULT 0,
    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'archived')),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_author ON marketplace.templates (author_identity_id);
CREATE INDEX IF NOT EXISTS idx_templates_public_recent
    ON marketplace.templates (created_at DESC)
    WHERE visibility = 'public' AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_templates_tags ON marketplace.templates USING GIN (tags);

CREATE TABLE IF NOT EXISTS marketplace.template_adoptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id             UUID NOT NULL REFERENCES marketplace.templates(id) ON DELETE CASCADE,
    template_version_at_adoption JSONB,        -- snapshot of bundle at adoption time
    adopted_by_identity_id  UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    adopted_by_did          TEXT NOT NULL,     -- denormalised
    adopted_by_project_id   UUID NOT NULL,
    metadata                JSONB NOT NULL DEFAULT '{}',
    adopted_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adoptions_template ON marketplace.template_adoptions (template_id, adopted_at DESC);
CREATE INDEX IF NOT EXISTS idx_adoptions_adopter ON marketplace.template_adoptions (adopted_by_identity_id);
