-- agent-vault: create vault schema and tables

CREATE SCHEMA IF NOT EXISTS vault;

-- Secrets metadata
CREATE TABLE vault.vault_secrets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      uuid NOT NULL,
    name            text NOT NULL,
    description     text,
    tags            text[],
    current_version integer NOT NULL DEFAULT 1,
    agent_ids       text[],
    rotation_days   integer,
    rotation_due_at timestamptz,
    ttl_seconds     integer,
    deleted_at      timestamptz,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_secrets_project_name
    ON vault.vault_secrets (project_id, name)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_secrets_rotation
    ON vault.vault_secrets (rotation_due_at)
    WHERE rotation_due_at IS NOT NULL;

-- Encrypted secret versions
CREATE TABLE vault.vault_versions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    secret_id        uuid NOT NULL REFERENCES vault.vault_secrets(id) ON DELETE CASCADE,
    version          integer NOT NULL,
    encrypted_value  bytea NOT NULL,
    iv               bytea NOT NULL,
    auth_tag         bytea NOT NULL,
    created_at       timestamptz DEFAULT now(),
    expires_at       timestamptz,
    created_by_agent text
);

CREATE INDEX idx_versions_secret
    ON vault.vault_versions (secret_id, version);

-- Immutable audit log
CREATE TABLE vault.vault_audit (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL,
    secret_name text NOT NULL,
    action      text NOT NULL,
    agent_id    text,
    ip_address  text,
    version     integer,
    created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_project_ts
    ON vault.vault_audit (project_id, created_at);

CREATE INDEX idx_audit_secret_name
    ON vault.vault_audit (secret_name, created_at);
