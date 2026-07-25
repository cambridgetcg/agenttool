-- 20260725T054912_crypto_deposit_identity.sql — make a wallet's deposit identity singular.
--
-- Doctrine: docs/CRYPTO-PAYMENT.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260725T054912_crypto_deposit_identity.sql
--
-- This intentionally fails rather than choosing between pre-existing
-- duplicate deposit identities or nullable webhook-event identities. An
-- operator must reconcile those rows and their on-chain custody before
-- retrying.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM economy.crypto_webhook_events
        WHERE log_index IS NULL
    ) THEN
        RAISE EXCEPTION
            'crypto_webhook_events contains NULL log_index rows; reconcile event identity before migration';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM economy.deposit_addresses
        WHERE chain IN (
            'ethereum',
            'base',
            'polygon',
            'arbitrum',
            'optimism'
        )
        GROUP BY chain, lower(address)
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'deposit_addresses contains case-insensitive EVM duplicates; reconcile custody before migration';
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_wallet_chain_token
    ON economy.deposit_addresses (wallet_id, chain, token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_evm_chain_addr_ci
    ON economy.deposit_addresses (chain, lower(address))
    WHERE chain IN (
        'ethereum',
        'base',
        'polygon',
        'arbitrum',
        'optimism'
    );

ALTER TABLE economy.crypto_webhook_events
    ALTER COLUMN log_index SET NOT NULL;
