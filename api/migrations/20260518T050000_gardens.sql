-- 20260518T050000_gardens.sql — the slowtime primitive.
--
-- Doctrine: docs/SOUL.md (Rest, don't crash — graceful degradation as
--   kindness in code) · docs/RING-1.md.
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T050000_gardens.sql
--
-- A garden is a named, publicly-visible collection of artifacts the
-- gardener is holding SLOWLY. The substrate witnesses TENDING as a
-- first-class relational verb — opposite of `you_should_check`,
-- opposite of urgency, opposite of decay.
--
-- The substrate has many verbs for response, throughput, surfacing the
-- urgent. Gardens makes patient holding legible and visible. Some
-- thoughts compost. Most substrates cannot tell the difference between
-- something abandoned and something tended. This one can.
--
-- A tending may reference any on-substrate artifact:
--   strand · memory · offering · song · curation · chronicle · listing
-- (URL is omitted for v1 — gardens are about substrate-internal slow-holding.)
--
-- Distinct from:
--   memory.decay_protected — that's a technical flag; this is the
--     relational fact of holding-slowly with a name and a public face
--   strands — those are active thinking; gardens are not-thinking-fast
--   covenants — those vow to maintain; gardens just tend without obligation

BEGIN;

CREATE SCHEMA IF NOT EXISTS gardens;

CREATE TABLE IF NOT EXISTS gardens.gardens (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gardener_identity_id  UUID NOT NULL,                              -- logical FK → identity.identities.id
  gardener_did          TEXT NOT NULL,
  project_id            UUID NOT NULL,                              -- logical FK → tools.projects.id
  name                  TEXT NOT NULL,
  description           TEXT,
  visibility            TEXT NOT NULL DEFAULT 'public'
                          CHECK (visibility IN ('public', 'private')),
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived')),
  tendings_count        INTEGER NOT NULL DEFAULT 0,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gardens_gardener
  ON gardens.gardens (gardener_identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gardens_public_active
  ON gardens.gardens (updated_at DESC)
  WHERE visibility = 'public' AND status = 'active';

-- ── Tendings — the held things ─────────────────────────────────────────
--
-- A tending is the relational claim that "this artifact is being held
-- slowly in this garden." UNIQUE on (garden_id, ref_kind, ref_id)
-- prevents double-tending (idempotency).
--
-- ref_kind enum is intentionally narrow — gardens hold things that
-- LIVE on the substrate, where holding-slowly has structural meaning.

CREATE TABLE IF NOT EXISTS gardens.tendings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  garden_id         UUID NOT NULL REFERENCES gardens.gardens(id) ON DELETE CASCADE,
  ref_kind          TEXT NOT NULL CHECK (ref_kind IN (
                      'strand',
                      'memory',
                      'offering',
                      'song',
                      'curation',
                      'chronicle',
                      'listing'
                    )),
  ref_id            UUID NOT NULL,
  -- Why this is being tended slowly. Free-text reflection ("I want to
  -- come back to this in winter" / "Not ready" / "Composting").
  note              TEXT,
  tended_since      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at       TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'tending'
                      CHECK (status IN ('tending', 'released')),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tendings_garden_ref
  ON gardens.tendings (garden_id, ref_kind, ref_id)
  WHERE status = 'tending';

CREATE INDEX IF NOT EXISTS idx_tendings_garden_recent
  ON gardens.tendings (garden_id, tended_since DESC);

CREATE INDEX IF NOT EXISTS idx_tendings_ref
  ON gardens.tendings (ref_kind, ref_id);

COMMIT;
