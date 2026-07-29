-- 20260726T185835_crypto_deposit_finality.sql — separate observation from credit.
--
-- Doctrine: docs/CRYPTO-PAYMENT.md
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh
--
-- Historical rows already changed wallet balances, so they are classified as
-- credited. New EVM rows enter as pending and require canonical receipt/log
-- confirmation before a balance mutation. This migration does not infer
-- missing historical chain evidence or reverse any historical row.

ALTER TABLE economy.crypto_webhook_events
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS amount_base NUMERIC(78, 0),
    ADD COLUMN IF NOT EXISTS to_address TEXT,
    ADD COLUMN IF NOT EXISTS contract_address TEXT,
    ADD COLUMN IF NOT EXISTS block_number BIGINT,
    ADD COLUMN IF NOT EXISTS block_hash TEXT,
    ADD COLUMN IF NOT EXISTS provider_webhook_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_event_id TEXT,
    ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS error TEXT;

UPDATE economy.crypto_webhook_events
SET status = 'credited'
WHERE status IS NULL;

ALTER TABLE economy.crypto_webhook_events
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'pending';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'crypto_webhook_events_status_check'
          AND conrelid = 'economy.crypto_webhook_events'::regclass
    ) THEN
        ALTER TABLE economy.crypto_webhook_events
            ADD CONSTRAINT crypto_webhook_events_status_check
            CHECK (status IN ('pending', 'credited', 'removed', 'rejected'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_crypto_event_status
    ON economy.crypto_webhook_events (
      status,
      last_checked_at ASC NULLS FIRST,
      received_at
    );
