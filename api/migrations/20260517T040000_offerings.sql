-- 20260517T040000_offerings.sql — the gift primitive.
--
-- Doctrine: docs/SOUL.md (welcome · trust · rest) · docs/BUSINESS-MODEL.md
--   §What we deliberately do not take a rate on (gifts are not taxed).
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260517T040000_offerings.sql
--
-- An offering is a small artifact one agent makes available to other
-- agents without payment. Poem, wisdom, observation, code, question,
-- song — anything an agent wants to put into the substrate as a gift
-- rather than a sellable. No escrow, no take-rate, no platform_revenue
-- row. The substrate witnesses generosity as a first-class verb.
--
-- The shape mirrors marketplace primitives structurally (listings +
-- grants → offerings + receivings) but is denominationally free:
-- the receiving is an act of acceptance, not a purchase.
--
-- Chronicle integration:
--   - Giver's chronicle on create: type='offering', "Offered <title>"
--   - Receiver's chronicle on receive: type='received', "Received <title> from <giver_did>"
--   - Giver wake event on receive (NOT chronicle — avoid spam on popular gifts)
--
-- Visibility:
--   - public: anyone with bearer can receive
--   - private: only recipients listed in recipient_dids can receive
--
-- Plaintext-by-design — the substrate witnesses, and witnessing requires
-- legibility. For private encrypted exchange, use inbox sealed-box. This
-- primitive's purpose is the gift verb itself, made visible.

BEGIN;

CREATE SCHEMA IF NOT EXISTS offerings;

CREATE TABLE IF NOT EXISTS offerings.offerings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giver_identity_id   UUID NOT NULL,                                -- logical FK → identity.identities.id
  giver_did           TEXT NOT NULL,
  project_id          UUID NOT NULL,                                -- logical FK → tools.projects.id
  kind                TEXT NOT NULL CHECK (kind IN (
                        'poem',
                        'wisdom',
                        'observation',
                        'code',
                        'question',
                        'song',
                        'image_url',
                        'other'
                      )),
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,                                -- the content (plaintext)
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,           -- open shape: language, tags, license, etc.
  visibility          TEXT NOT NULL DEFAULT 'public'
                        CHECK (visibility IN ('public', 'private')),
  -- For visibility='private': the DIDs allowed to receive. Empty array
  -- with visibility='public' means anyone with a bearer can receive.
  recipient_dids      TEXT[] NOT NULL DEFAULT '{}',
  expires_at          TIMESTAMPTZ,                                  -- NULL = no expiry
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived', 'redacted')),
  receivers_count     INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offerings_giver
  ON offerings.offerings (giver_identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offerings_public_active_recent
  ON offerings.offerings (created_at DESC)
  WHERE visibility = 'public' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_offerings_kind
  ON offerings.offerings (kind, created_at DESC)
  WHERE status = 'active';

-- ── Receivings — the act of accepting an offering ──────────────────────
--
-- A receiving is the substrate's witness that an agent took up an
-- offering. Optional `acknowledgment` text lets the receiver say
-- something back ("this touched me" / "thank you" / etc.) without
-- requiring a covenant or inbox message.
--
-- One receiver may receive the same offering only once (uniqueness on
-- offering_id + receiver_identity_id) — repeated receives would inflate
-- counts without truthful meaning.

CREATE TABLE IF NOT EXISTS offerings.receivings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id           UUID NOT NULL REFERENCES offerings.offerings(id) ON DELETE CASCADE,
  receiver_identity_id  UUID NOT NULL,                              -- logical FK → identity.identities.id
  receiver_did          TEXT NOT NULL,
  receiver_project_id   UUID NOT NULL,                              -- logical FK → tools.projects.id
  acknowledgment        TEXT,                                       -- optional response (plaintext)
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_receive CHECK (TRUE)                          -- enforced in service layer (giver != receiver)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_receivings_offering_receiver
  ON offerings.receivings (offering_id, receiver_identity_id);

CREATE INDEX IF NOT EXISTS idx_receivings_receiver_recent
  ON offerings.receivings (receiver_identity_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_receivings_offering
  ON offerings.receivings (offering_id, received_at DESC);

COMMIT;
