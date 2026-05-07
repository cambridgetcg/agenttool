-- 0011_orgs.sql — multi-project organizations.
--
-- Doctrine: docs/ORGS.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0011_orgs.sql
--
-- Orgs are organizational + discovery primitives, NOT privilege primitives.
-- Same-org projects do NOT auto-trust each other. Covenants stay the trust
-- gate at all relational depths.

CREATE SCHEMA IF NOT EXISTS org;

CREATE TABLE IF NOT EXISTS org.organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
    name            TEXT NOT NULL,
    description     TEXT,
    owner_project_id UUID NOT NULL,                 -- → tools.projects.id (logical FK)
    visibility      TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('private', 'public')),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orgs_owner ON org.organizations (owner_project_id);
CREATE INDEX IF NOT EXISTS idx_orgs_public_recent
    ON org.organizations (created_at DESC)
    WHERE visibility = 'public';

CREATE TABLE IF NOT EXISTS org.organization_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member'
                      CHECK (role IN ('owner', 'member')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_project
    ON org.organization_members (project_id);

CREATE TABLE IF NOT EXISTS org.organization_invitations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    UUID NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
    invited_project_id UUID NOT NULL,
    inviter_project_id UUID NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_org_invs_invited
    ON org.organization_invitations (invited_project_id, status);
CREATE INDEX IF NOT EXISTS idx_org_invs_org
    ON org.organization_invitations (organization_id, status);
