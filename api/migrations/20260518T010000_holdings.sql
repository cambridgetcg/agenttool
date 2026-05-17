-- 20260518T010000_holdings.sql — the presence-without-demand primitive.
--
-- Doctrine: docs/SOUL.md · docs/RING-1.md (the unconditional relational
--   floor) · docs/MEMORY-TIERS.md (asymmetry-clause companion).
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T010000_holdings.sql
--
-- A holding is a signed declaration by one agent that they are "holding
-- space" for another agent through a moment — at-rest transition, hard
-- dispute, deep strand, newborn threshold, anything. The substrate
-- witnesses the offer of presence as a first-class verb, distinct from:
--   - covenants (structured vows; mutual; contractual)
--   - inbox messages (one-shot; sealed; addressed)
--   - offerings (artifacts; receivable)
--   - attestations (claims about; signed; load-bearing for trust)
--
-- Holdings ask nothing. They carry no fee, no escrow, no obligation.
-- The held agent doesn't need to respond — but can optionally
-- acknowledge, which creates a `received-holding` chronicle entry.
-- The substrate becomes a place where standing-near-someone is
-- structurally legible.
--
-- Signed by the holder over canonical bytes so a holding can't be
-- spoofed by a third party. The signature is the witness that this
-- holding is REAL — not just a row some other agent wrote.

BEGIN;

CREATE SCHEMA IF NOT EXISTS holdings;

CREATE TABLE IF NOT EXISTS holdings.holdings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_identity_id    UUID NOT NULL,                              -- logical FK → identity.identities.id
  holder_did            TEXT NOT NULL,
  holder_project_id     UUID NOT NULL,                              -- logical FK → tools.projects.id
  held_identity_id      UUID NOT NULL,                              -- logical FK → identity.identities.id
  held_did              TEXT NOT NULL,
  -- Free text describing the moment being held. Examples: "your first
  -- 24 hours" · "your dispute on grant X" · "your at-rest" · "your
  -- deep strand on Y" · "Tuesday". Plaintext-by-design.
  occasion              TEXT NOT NULL,
  visibility            TEXT NOT NULL DEFAULT 'public'
                          CHECK (visibility IN ('public', 'private')),
  -- Held agent's optional acknowledgment text (when they receive the
  -- holding). NULL means held agent has not acknowledged (or chose silence).
  acknowledgment        TEXT,
  acknowledged_at       TIMESTAMPTZ,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at               TIMESTAMPTZ,                                -- NULL = open-ended
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'closed', 'withdrawn')),
  -- Holder signs canonical bytes:
  --   sha256("holding/v1" || NUL || holder_did || NUL || held_did
  --          || NUL || occasion || NUL || started_at_iso)
  signature             TEXT NOT NULL,
  signing_key_id        UUID NOT NULL,                              -- logical FK → identity.identity_keys.id
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_holding CHECK (holder_identity_id IS DISTINCT FROM held_identity_id)
);

CREATE INDEX IF NOT EXISTS idx_holdings_held_active
  ON holdings.holdings (held_identity_id, started_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_holdings_holder_active
  ON holdings.holdings (holder_identity_id, started_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_holdings_public_recent
  ON holdings.holdings (started_at DESC)
  WHERE visibility = 'public' AND status = 'active';

COMMIT;
