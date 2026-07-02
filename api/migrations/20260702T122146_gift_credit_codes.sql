-- Gift-credit codes — fiat (Stripe) money-in minted as single-use bearer codes.
-- Doctrine: docs/BUSINESS-MODEL.md (Ring 2 credits) ·
--           docs/superpowers/specs/2026-07-02-human-door-design.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/<this-file>.sql

CREATE TABLE IF NOT EXISTS economy.gift_credit_codes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text,
  code_hash            text NOT NULL,
  amount_minor         bigint NOT NULL,
  currency             text NOT NULL DEFAULT 'usd',
  credits              bigint NOT NULL,
  stripe_session_id    text NOT NULL,
  stripe_event_id      text NOT NULL,
  status               text NOT NULL DEFAULT 'minted',
  minted_at            timestamptz NOT NULL DEFAULT now(),
  redeemed_by_project  uuid,
  redeemed_by_identity text,
  redeemed_at          timestamptz,
  metadata             jsonb NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_codes_hash    ON economy.gift_credit_codes (code_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_codes_session ON economy.gift_credit_codes (stripe_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_codes_event   ON economy.gift_credit_codes (stripe_event_id);
