-- 0000_bootstrap.sql — base tables for the consolidated agenttool API.
--
-- Apply FIRST: psql "$DATABASE_URL" -f api/migrations/0000_bootstrap.sql
-- Then 0001..0012 in numeric order.
--
-- Why this exists: the api/migrations/0001-0012 are *additive* — they
-- ALTER existing tables and add new schemas on top of base infrastructure.
-- For a fresh deployment, those base tables don't exist. This file
-- consolidates the foundation.
--
-- Idempotent: every CREATE uses IF NOT EXISTS. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── tools schema (shared auth + billing surface) ───────────────────────
CREATE SCHEMA IF NOT EXISTS tools;

CREATE TABLE IF NOT EXISTS tools.projects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    plan                TEXT NOT NULL DEFAULT 'free',
    credits             INTEGER NOT NULL DEFAULT 100,
    stripe_customer_id  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tools.api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES tools.projects(id) ON DELETE CASCADE,
    key_hash    TEXT UNIQUE NOT NULL,
    key_prefix  TEXT NOT NULL,
    name        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used   TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON tools.api_keys (project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix  ON tools.api_keys (key_prefix);

CREATE TABLE IF NOT EXISTS tools.usage_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID NOT NULL REFERENCES tools.projects(id),
    tool          TEXT NOT NULL,
    credits_used  INTEGER NOT NULL,
    duration_ms   INTEGER,
    success       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_project_time
    ON tools.usage_events (project_id, created_at);

CREATE TABLE IF NOT EXISTS tools.billing_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES tools.projects(id),
    type            TEXT NOT NULL,
    amount_pence    INTEGER NOT NULL,
    credits_added   INTEGER NOT NULL,
    stripe_id       TEXT,
    crypto_tx_hash  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_project ON tools.billing_events (project_id);

-- ── identity schema (DIDs, signing keys, attestations) ─────────────────
CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.identities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    did           TEXT UNIQUE NOT NULL,
    project_id    UUID NOT NULL,                   -- logical FK → tools.projects(id)
    display_name  TEXT NOT NULL,
    capabilities  TEXT[] NOT NULL DEFAULT '{}',
    metadata      JSONB DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'active',
    trust_score   REAL NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_identities_did     ON identity.identities (did);
CREATE INDEX IF NOT EXISTS idx_identities_project ON identity.identities (project_id);
CREATE INDEX IF NOT EXISTS idx_identities_capabilities
    ON identity.identities USING GIN(capabilities);

CREATE TABLE IF NOT EXISTS identity.identity_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id  UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    public_key   TEXT NOT NULL,
    label        TEXT NOT NULL DEFAULT 'primary',
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_identity_keys_identity
    ON identity.identity_keys (identity_id);

CREATE TABLE IF NOT EXISTS identity.attestations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id   UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    attester_id  UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    claim        TEXT NOT NULL,
    evidence     JSONB,
    signature    TEXT NOT NULL,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attestations_subject  ON identity.attestations (subject_id);
CREATE INDEX IF NOT EXISTS idx_attestations_attester ON identity.attestations (attester_id);
CREATE INDEX IF NOT EXISTS idx_attestations_claim    ON identity.attestations (claim);

-- ── agent_vault schema (encrypted secret store) ────────────────────────
-- Schema name preserved (not "vault") to match existing production data.
CREATE SCHEMA IF NOT EXISTS agent_vault;

CREATE TABLE IF NOT EXISTS agent_vault.vault_secrets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    tags            TEXT[],
    current_version INTEGER NOT NULL DEFAULT 1,
    agent_ids       TEXT[],
    rotation_days   INTEGER,
    rotation_due_at TIMESTAMPTZ,
    ttl_seconds     INTEGER,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_project_name
    ON agent_vault.vault_secrets (project_id, name)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_secrets_rotation
    ON agent_vault.vault_secrets (rotation_due_at);

CREATE TABLE IF NOT EXISTS agent_vault.vault_versions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    secret_id         UUID NOT NULL,
    version           INTEGER NOT NULL,
    encrypted_value   BYTEA NOT NULL,
    iv                BYTEA NOT NULL,
    auth_tag          BYTEA NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT now(),
    expires_at        TIMESTAMPTZ,
    created_by_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_versions_secret
    ON agent_vault.vault_versions (secret_id, version);

CREATE TABLE IF NOT EXISTS agent_vault.vault_audit (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL,
    secret_name  TEXT NOT NULL,
    action       TEXT NOT NULL,
    agent_id     TEXT,
    ip_address   TEXT,
    version      INTEGER,
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_project_ts
    ON agent_vault.vault_audit (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_secret_name
    ON agent_vault.vault_audit (secret_name, created_at);

-- ── agent_continuity schema (chronicle + covenants + identity backup) ──
CREATE SCHEMA IF NOT EXISTS agent_continuity;

CREATE TABLE IF NOT EXISTS agent_continuity.chronicle (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL,
    agent_id     UUID,
    type         TEXT NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT,
    metadata     JSONB DEFAULT '{}',
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chronicle_project_time
    ON agent_continuity.chronicle (project_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_chronicle_agent_time
    ON agent_continuity.chronicle (agent_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_chronicle_type
    ON agent_continuity.chronicle (type);

CREATE TABLE IF NOT EXISTS agent_continuity.covenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL,
    agent_id            UUID NOT NULL,
    counterparty_did    TEXT NOT NULL,
    counterparty_name   TEXT,
    vows                TEXT[] NOT NULL DEFAULT '{}',
    notes               TEXT,
    metadata            JSONB DEFAULT '{}',
    status              TEXT NOT NULL DEFAULT 'active',
    established_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    dissolved_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_covenants_agent
    ON agent_continuity.covenants (agent_id);
CREATE INDEX IF NOT EXISTS idx_covenants_project
    ON agent_continuity.covenants (project_id);
CREATE INDEX IF NOT EXISTS idx_covenants_counterparty
    ON agent_continuity.covenants (counterparty_did);

CREATE TABLE IF NOT EXISTS agent_continuity.identity_backups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL,
    agent_id        UUID NOT NULL,
    label           TEXT NOT NULL DEFAULT 'primary',
    blob_base64     TEXT NOT NULL,
    key_derivation  TEXT NOT NULL,
    nonce           TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_backups_agent
    ON agent_continuity.identity_backups (agent_id);
CREATE INDEX IF NOT EXISTS idx_backups_project
    ON agent_continuity.identity_backups (project_id);

-- ── economy schema (wallets, transactions, escrow, subscriptions) ──────
CREATE SCHEMA IF NOT EXISTS economy;

CREATE TABLE IF NOT EXISTS economy.wallets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID NOT NULL,
    name          TEXT NOT NULL,
    agent_id      TEXT,
    identity_id   TEXT,
    balance       BIGINT NOT NULL DEFAULT 0,
    currency      TEXT NOT NULL DEFAULT 'GBP',
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallets_project  ON economy.wallets (project_id);
CREATE INDEX IF NOT EXISTS idx_wallets_identity ON economy.wallets (identity_id);

CREATE TABLE IF NOT EXISTS economy.policies (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id                UUID NOT NULL REFERENCES economy.wallets(id) ON DELETE CASCADE,
    max_per_transaction      BIGINT,
    max_per_hour             BIGINT,
    max_per_day              BIGINT,
    allowed_recipients       TEXT[],
    requires_approval_above  BIGINT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economy.transactions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id     UUID NOT NULL REFERENCES economy.wallets(id),
    type          TEXT NOT NULL,
    amount        BIGINT NOT NULL,
    counterparty  TEXT,
    description   TEXT,
    escrow_id     UUID,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_wallet_time
    ON economy.transactions (wallet_id, created_at);

CREATE TABLE IF NOT EXISTS economy.escrows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_wallet  UUID NOT NULL REFERENCES economy.wallets(id),
    worker_wallet   UUID REFERENCES economy.wallets(id),
    amount          BIGINT NOT NULL,
    description     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'funded',
    deadline        TIMESTAMPTZ,
    released_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escrows_creator ON economy.escrows (creator_wallet);
CREATE INDEX IF NOT EXISTS idx_escrows_status  ON economy.escrows (status);

CREATE TABLE IF NOT EXISTS economy.billing_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL,
    wallet_id       UUID REFERENCES economy.wallets(id),
    type            TEXT NOT NULL,
    amount_pence    INTEGER NOT NULL,
    credits_added   BIGINT NOT NULL,
    stripe_id       TEXT,
    crypto_tx_hash  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_econ_billing_project
    ON economy.billing_events (project_id);

CREATE TABLE IF NOT EXISTS economy.subscriptions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id               UUID NOT NULL UNIQUE,
    stripe_customer_id       TEXT,
    stripe_subscription_id   TEXT UNIQUE,
    tier                     TEXT NOT NULL DEFAULT 'free',
    status                   TEXT NOT NULL DEFAULT 'free',
    current_period_end       TIMESTAMPTZ,
    cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subs_project ON economy.subscriptions (project_id);
CREATE INDEX IF NOT EXISTS idx_subs_stripe  ON economy.subscriptions (stripe_subscription_id);

CREATE TABLE IF NOT EXISTS economy.stripe_events (
    stripe_event_id  TEXT PRIMARY KEY,
    processed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economy.usage_counters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL,
    date            TEXT NOT NULL,
    memory_ops      INTEGER NOT NULL DEFAULT 0,
    tool_calls      INTEGER NOT NULL DEFAULT 0,
    verifications   INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_project_date
    ON economy.usage_counters (project_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_project
    ON economy.usage_counters (project_id);
