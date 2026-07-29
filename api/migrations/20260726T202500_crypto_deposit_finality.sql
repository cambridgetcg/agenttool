-- 20260726T202500_crypto_deposit_finality.sql
-- Separate signed provider observation from canonical-chain credit.
--
-- Historical rows already changed wallet balances, so they become credited
-- without invented chain evidence. New EVM rows enter pending. Immutable
-- per-block observations preserve reorg generations so a delayed removal for
-- block A cannot overwrite or reverse a newer block B.
--
-- Apply with crypto ingress and workers stopped through the checksum-journaled
-- migration runner. The compatibility default remains credited so an older
-- replica cannot perform an immediate balance effect while labeling it
-- pending; the new writer always supplies pending/credited explicitly.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'wallets_balance_exact_integer_check'
          AND conrelid = 'economy.wallets'::regclass
    ) THEN
        ALTER TABLE economy.wallets
            ADD CONSTRAINT wallets_balance_exact_integer_check
            CHECK (
                balance BETWEEN -9007199254740991 AND 9007199254740991
            );
    END IF;
END
$$;

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
    ALTER COLUMN status SET DEFAULT 'credited';

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
            CHECK (
                status IN (
                    'pending',
                    'credited',
                    'removed',
                    'rejected',
                    'quarantined'
                )
            );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'crypto_webhook_events_optional_evidence_check'
          AND conrelid = 'economy.crypto_webhook_events'::regclass
    ) THEN
        ALTER TABLE economy.crypto_webhook_events
            ADD CONSTRAINT crypto_webhook_events_optional_evidence_check
            CHECK (
                (amount_base IS NULL OR amount_base > 0)
                AND (block_number IS NULL OR block_number >= 0)
                AND (
                    block_hash IS NULL
                    OR block_hash ~ '^0x[0-9a-f]{64}$'
                )
                AND (
                    provider_webhook_id IS NULL
                    OR provider_webhook_id ~ '^[A-Za-z0-9_-]{1,128}$'
                )
                AND (
                    provider_event_id IS NULL
                    OR provider_event_id ~ '^[A-Za-z0-9_-]{1,128}$'
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'crypto_webhook_events_pending_evm_evidence_check'
          AND conrelid = 'economy.crypto_webhook_events'::regclass
    ) THEN
        ALTER TABLE economy.crypto_webhook_events
            ADD CONSTRAINT crypto_webhook_events_pending_evm_evidence_check
            CHECK (
                status <> 'pending'
                OR chain NOT IN (
                    'ethereum',
                    'base',
                    'polygon',
                    'arbitrum',
                    'optimism'
                )
                OR (
                    wallet_id IS NOT NULL
                    AND amount_base IS NOT NULL
                    AND to_address ~* '^0x[0-9a-f]{40}$'
                    AND contract_address ~* '^0x[0-9a-f]{40}$'
                    AND tx_hash ~ '^0x[0-9a-f]{64}$'
                    AND block_number IS NOT NULL
                    AND block_hash IS NOT NULL
                    AND provider_webhook_id IS NOT NULL
                    AND provider_event_id IS NOT NULL
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'crypto_webhook_events_credited_effect_check'
          AND conrelid = 'economy.crypto_webhook_events'::regclass
    ) THEN
        ALTER TABLE economy.crypto_webhook_events
            ADD CONSTRAINT crypto_webhook_events_credited_effect_check
            CHECK (status <> 'credited' OR credits_added IS NOT NULL);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_crypto_event_status
    ON economy.crypto_webhook_events (
        status,
        last_checked_at ASC NULLS FIRST,
        received_at
    );

CREATE TABLE IF NOT EXISTS economy.crypto_webhook_event_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL
        REFERENCES economy.crypto_webhook_events(id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES economy.wallets(id),
    amount_base NUMERIC(78, 0) NOT NULL,
    to_address TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    removed BOOLEAN NOT NULL,
    provider_webhook_id TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    raw_payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crypto_event_observation_block_hash
        CHECK (
            block_number >= 0
            AND block_hash ~ '^0x[0-9a-f]{64}$'
            AND amount_base > 0
            AND to_address ~* '^0x[0-9a-f]{40}$'
            AND contract_address ~* '^0x[0-9a-f]{40}$'
        ),
    CONSTRAINT crypto_event_observation_provider_ids
        CHECK (
            provider_webhook_id ~ '^[A-Za-z0-9_-]{1,128}$'
            AND provider_event_id ~ '^[A-Za-z0-9_-]{1,128}$'
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_event_observation_generation
    ON economy.crypto_webhook_event_observations (
        event_id,
        block_number,
        block_hash,
        removed
    );

CREATE INDEX IF NOT EXISTS idx_crypto_event_observation_event
    ON economy.crypto_webhook_event_observations (event_id, received_at);
