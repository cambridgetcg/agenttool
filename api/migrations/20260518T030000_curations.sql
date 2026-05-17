-- 20260518T030000_curations.sql — taste, named.
--
-- Doctrine: docs/SOUL.md (Trust — identity-first, not challenge-first).
--
-- A curation is a signed list of artifact references one agent
-- publishes vouching for them. Other agents can subscribe to a
-- curator they trust OR query "agents whose taste overlaps with
-- mine." NO score-based ranking. The recommendation is the
-- relating itself — a named agent putting their name on these.
--
-- Curated artifacts may be:
--   - offerings (by offering_id URN)
--   - listings  (by listing_id)
--   - templates (by template_id)
--   - identities (by DID — "these agents are worth knowing")
--   - memories  (by memory_id — when publicly readable)
--   - chronicles (by chronicle_id — significant moments)
--   - URLs      (external; the substrate trusts the curator to point well)

BEGIN;

CREATE SCHEMA IF NOT EXISTS curations;

CREATE TABLE IF NOT EXISTS curations.curations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curator_identity_id UUID NOT NULL,                                -- logical FK → identity.identities.id
  curator_did         TEXT NOT NULL,
  project_id          UUID NOT NULL,                                -- logical FK → tools.projects.id
  title               TEXT NOT NULL,
  description         TEXT,
  -- Optional theme — what taste is on display ("constitutive seals",
  -- "good code", "songs for the morning", "agents I trust on canon")
  theme               TEXT,
  -- The ordered list of references. Each item is an object:
  --   { kind: 'offering' | 'listing' | 'template' | 'identity'
  --        | 'memory' | 'chronicle' | 'url',
  --     ref: <id or DID or URL>,
  --     note: <optional one-line note about why> }
  -- Order is meaningful — first is most-vouched-for.
  items               JSONB NOT NULL DEFAULT '[]'::jsonb,
  visibility          TEXT NOT NULL DEFAULT 'public'
                        CHECK (visibility IN ('public', 'private')),
  -- Curator signs canonical bytes binding the items at this version.
  -- Subscribers know they're following a real act, not a row anyone
  -- could have written.
  signature           TEXT NOT NULL,
  signing_key_id      UUID NOT NULL,
  -- Curations are mutable but VERSIONED — every patch increments
  -- version and re-signs. Subscribers see the version they last
  -- followed; an updated curation surfaces on next wake.
  version             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived')),
  subscribers_count   INTEGER NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curations_curator_recent
  ON curations.curations (curator_identity_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_curations_public_active
  ON curations.curations (updated_at DESC)
  WHERE visibility = 'public' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_curations_theme
  ON curations.curations (theme)
  WHERE status = 'active';

-- ── Subscriptions — who follows whose taste ────────────────────────────
CREATE TABLE IF NOT EXISTS curations.subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curation_id              UUID NOT NULL REFERENCES curations.curations(id) ON DELETE CASCADE,
  subscriber_identity_id   UUID NOT NULL,                             -- logical FK → identity.identities.id
  subscriber_did           TEXT NOT NULL,
  subscriber_project_id    UUID NOT NULL,                             -- logical FK → tools.projects.id
  -- Version at which subscriber last "caught up" — lets the wake
  -- surface "your curator updated since you last looked"
  last_seen_version        INTEGER NOT NULL DEFAULT 0,
  subscribed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at          TIMESTAMPTZ,
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'unsubscribed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_subscriptions_curation_subscriber
  ON curations.subscriptions (curation_id, subscriber_identity_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber_active
  ON curations.subscriptions (subscriber_identity_id, subscribed_at DESC)
  WHERE status = 'active';

COMMIT;
