-- 20260726T191500_payout_operation_identity.sql
-- One persisted chain operation may authorize at most one payout row.
--
-- Apply only with payout workers disabled. The ordinary unique-index build
-- takes the table lock needed to exclude concurrent payout identity writes.
-- Existing duplicate identities are never deleted or guessed between: this
-- migration fails so an operator can reconcile the affected ledger rows and
-- on-chain evidence first.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM economy.crypto_payouts
        WHERE tx_hash IS NOT NULL
        GROUP BY
            chain,
            CASE
                WHEN chain = 'solana' THEN tx_hash
                ELSE lower(tx_hash)
            END
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'crypto_payouts contains duplicate chain transaction identities; reconcile before migration';
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_payout_chain_tx_hash
    ON economy.crypto_payouts (
        chain,
        (
            CASE
                WHEN chain = 'solana' THEN tx_hash
                ELSE lower(tx_hash)
            END
        )
    )
    WHERE tx_hash IS NOT NULL;
