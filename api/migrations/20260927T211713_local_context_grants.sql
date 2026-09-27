-- 20260927T211713_local_context_grants.sql — attenuated local-context reads.
--
-- Doctrine: docs/LOCAL-CONTEXT-GRANTS.md
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh

CREATE TABLE tools.local_context_grants (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES tools.projects(id),
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  issuing_api_key_id uuid NOT NULL REFERENCES tools.api_keys(id),
  token_hash text NOT NULL UNIQUE,
  origin text NOT NULL,
  action text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT local_context_grant_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT local_context_grant_origin CHECK (length(origin) BETWEEN 9 AND 512 AND origin ~ '^https://[^/?#@[:space:]]+$'),
  CONSTRAINT local_context_grant_action CHECK (action = 'local_context.read'),
  CONSTRAINT local_context_grant_method CHECK (method = 'GET'),
  CONSTRAINT local_context_grant_path CHECK (path = '/v1/identities/' || identity_id::text || '/local-context'),
  CONSTRAINT local_context_grant_expiry CHECK (
    isfinite(issued_at) AND isfinite(expires_at)
    AND expires_at > issued_at AND expires_at <= issued_at + interval '24 hours'
  ),
  CONSTRAINT local_context_grant_revocation CHECK (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= issued_at))
);

-- Restrictive foreign keys retain issuance IDs; grants have no delete/renew API.
CREATE INDEX idx_local_context_grants_subject
  ON tools.local_context_grants (project_id, identity_id, issued_at DESC, id DESC);
CREATE INDEX idx_local_context_grants_parent ON tools.local_context_grants (issuing_api_key_id);
