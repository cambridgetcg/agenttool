-- 20260726T194500_evm_payout_nonce_fence.sql
--
-- Persist the exact EVM nonce scope beside tx_hash before RPC submission.
-- A same-source `broadcasting` row is the crash-durable fence; the unique
-- source+nonce index is the final backstop when an RPC's pending nonce view
-- lags a transaction it already accepted.
--
-- Existing rows remain nullable. Before enabling the integrated worker,
-- operators must reconcile any legacy EVM `broadcasting` rows: SQL alone
-- cannot reconstruct which mnemonic/network produced their signed bytes.

ALTER TABLE economy.crypto_payouts
  ADD COLUMN IF NOT EXISTS evm_chain_id NUMERIC(20, 0),
  ADD COLUMN IF NOT EXISTS evm_source_address TEXT,
  ADD COLUMN IF NOT EXISTS evm_nonce NUMERIC(20, 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'economy.crypto_payouts'::regclass
      AND conname = 'crypto_payouts_evm_nonce_evidence_check'
  ) THEN
    ALTER TABLE economy.crypto_payouts
      ADD CONSTRAINT crypto_payouts_evm_nonce_evidence_check
      CHECK (
        (
          evm_chain_id IS NULL
          AND evm_source_address IS NULL
          AND evm_nonce IS NULL
        )
        OR
        (
          evm_chain_id IS NOT NULL
          AND evm_source_address IS NOT NULL
          AND evm_nonce IS NOT NULL
          AND evm_chain_id BETWEEN 1 AND 9007199254740991
          AND evm_source_address ~ '^0x[0-9A-Fa-f]{40}$'
          AND evm_nonce BETWEEN 0 AND 9007199254740991
        )
      );
  END IF;
END $$;

-- NOT VALID preserves any legacy ambiguous rows for explicit reconciliation,
-- but PostgreSQL still enforces this constraint on every future insert/update.
-- This blocks an old generation of the payout worker from entering EVM
-- `broadcasting` without the durable identity written by the integrated worker.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'economy.crypto_payouts'::regclass
      AND conname = 'crypto_payouts_evm_broadcasting_evidence_check'
  ) THEN
    ALTER TABLE economy.crypto_payouts
      ADD CONSTRAINT crypto_payouts_evm_broadcasting_evidence_check
      CHECK (
        NOT (
          status = 'broadcasting'
          AND chain IN ('ethereum', 'base', 'polygon', 'arbitrum', 'optimism')
        )
        OR
        (
          tx_hash IS NOT NULL
          AND tx_hash ~ '^0x[0-9A-Fa-f]{64}$'
          AND evm_chain_id IS NOT NULL
          AND evm_source_address IS NOT NULL
          AND evm_nonce IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_payouts_evm_source_nonce
  ON economy.crypto_payouts (
    evm_chain_id,
    lower(evm_source_address),
    evm_nonce
  )
  WHERE evm_nonce IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crypto_payouts_evm_unresolved_source
  ON economy.crypto_payouts (
    evm_chain_id,
    lower(evm_source_address)
  )
  WHERE status = 'broadcasting'
    AND evm_nonce IS NOT NULL;
