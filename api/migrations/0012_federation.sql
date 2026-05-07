-- 0012_federation.sql — federation foundation.
--
-- Doctrine: docs/FEDERATION.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0012_federation.sql
--
-- Open federation: DIDs are the trust unit. Federated DIDs encode their
-- home instance host: did:at:<host>/<uuid>. Trust is per-DID via
-- signature verification; no central registry.

CREATE SCHEMA IF NOT EXISTS federation;

-- Singleton settings — instance-wide federation config.
CREATE TABLE IF NOT EXISTS federation.settings (
    id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    instance_url        TEXT,                          -- e.g. https://agenttool.dev
    -- allowed_origins is empty by default = open federation. Populate
    -- to restrict inbound to listed peer instances.
    allowed_origins     TEXT[] NOT NULL DEFAULT '{}',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO federation.settings (id, enabled) VALUES (1, FALSE)
  ON CONFLICT (id) DO NOTHING;

-- Peer instances we've talked to. Metadata only; not a permission gate
-- in open federation mode (allowed_origins='{}').
CREATE TABLE IF NOT EXISTS federation.peer_instances (
    host            TEXT PRIMARY KEY,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    inbound_count   BIGINT NOT NULL DEFAULT 0,
    outbound_count  BIGINT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'blocked'))
);

-- Inbox extension — track sender's instance for federated messages.
ALTER TABLE inbox.messages
  ADD COLUMN IF NOT EXISTS sender_instance TEXT,        -- null = self
  ADD COLUMN IF NOT EXISTS federation_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_inbox_federated
    ON inbox.messages (sender_instance, created_at DESC)
    WHERE sender_instance IS NOT NULL;
