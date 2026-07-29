-- 20260726T191000_payout_policy_e2e_fixture_repair.sql
--
-- Reconcile one known synthetic residue left by two historical executions of
-- api/scripts/_e2e-payout-policies.ts. That harness inserted two `broadcast`
-- rows per run with source-generated fake transaction hashes solely to test
-- the rolling daily-ceiling query. Those four rows have no chain operation,
-- wallet debit, or payout-ledger provenance and must not become durable
-- operation identities.
--
-- This is deliberately not a general duplicate repair. It permits either:
--   * no source-generated hashes and no duplicate payout identities; or
--   * exactly two complete E2E runs (four rows), with the exact source shape
--     and no payout ledger/reversal rows.
-- Every near-match fails closed for operator reconciliation. Apply with payout
-- workers disabled. The migration runner supplies the surrounding transaction,
-- so all validation, repair, and postconditions commit atomically.

-- Block registration/wallet/ledger/payout writers while the joined fixture
-- shape is checked and repaired. The order follows project -> wallet -> ledger
-- -> payout write order to avoid taking the same relations in reverse.
LOCK TABLE tools.projects IN SHARE MODE;
LOCK TABLE economy.wallets IN SHARE MODE;
LOCK TABLE economy.transactions IN SHARE MODE;
LOCK TABLE economy.crypto_payouts IN ACCESS EXCLUSIVE MODE;

DO $fixture_repair$
DECLARE
    fixture_ids UUID[];
    source_row_count INTEGER;
    verified_row_count INTEGER;
    complete_run_count INTEGER;
    ledger_row_count INTEGER;
    duplicate_group_count INTEGER;
    expected_duplicate_group_count INTEGER;
    repaired_row_count INTEGER;
    remaining_source_count INTEGER;
    remaining_duplicate_count INTEGER;
BEGIN
    -- lower() mirrors the operation-identity index which follows this repair.
    -- Exact-case equality is part of the verified fixture shape below.
    SELECT
        array_agg(payout.id ORDER BY payout.id),
        count(*)::INTEGER
    INTO fixture_ids, source_row_count
    FROM economy.crypto_payouts AS payout
    WHERE lower(payout.tx_hash) IN (
        '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0',
        '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1'
    );

    SELECT
        count(*)::INTEGER,
        count(*) FILTER (
            WHERE duplicate.chain = 'ethereum'
              AND duplicate.operation_id IN (
                  '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0',
                  '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1'
              )
              AND duplicate.row_count = 2
        )::INTEGER
    INTO duplicate_group_count, expected_duplicate_group_count
    FROM (
        SELECT
            payout.chain,
            CASE
                WHEN payout.chain = 'solana' THEN payout.tx_hash
                ELSE lower(payout.tx_hash)
            END AS operation_id,
            count(*) AS row_count
        FROM economy.crypto_payouts AS payout
        WHERE payout.tx_hash IS NOT NULL
        GROUP BY
            payout.chain,
            CASE
                WHEN payout.chain = 'solana' THEN payout.tx_hash
                ELSE lower(payout.tx_hash)
            END
        HAVING count(*) > 1
    ) AS duplicate;

    IF source_row_count = 0 THEN
        IF duplicate_group_count <> 0 THEN
            RAISE EXCEPTION
                'payout fixture repair found unrelated duplicate operation identities';
        END IF;
        RETURN;
    END IF;

    IF source_row_count <> 4 THEN
        RAISE EXCEPTION
            'payout fixture repair expected 0 or 4 source rows, found %',
            source_row_count;
    END IF;

    IF duplicate_group_count <> 2 OR expected_duplicate_group_count <> 2 THEN
        RAISE EXCEPTION
            'payout fixture repair requires exactly the two synthetic duplicate groups';
    END IF;

    -- Verify every column that the source fixed or the API fixed for this
    -- fixture. Timestamps and UUIDs are intentionally not guessed.
    SELECT count(*)::INTEGER
    INTO verified_row_count
    FROM economy.crypto_payouts AS payout
    JOIN economy.wallets AS wallet
      ON wallet.id = payout.wallet_id
     AND wallet.project_id = payout.project_id
    JOIN tools.projects AS project
      ON project.id = payout.project_id
    WHERE payout.id = ANY(fixture_ids)
      AND project.name ~ '^e2e-policies-[0-9]{13}$'
      AND wallet.name = 'policies-test'
      AND wallet.currency = 'USDC'
      AND wallet.status = 'active'
      AND wallet.owner_type = 'platform'
      AND wallet.identity_id IS NOT NULL
      AND payout.chain = 'ethereum'
      AND payout.token = 'USDC'
      AND payout.amount_base = 4000000
      AND payout.destination_address =
          '0x000000000000000000000000000000000000dEaD'
      AND payout.status = 'broadcast'
      AND payout.tx_hash IN (
          '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0',
          '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1'
      )
      AND payout.error IS NULL
      AND payout.confirmed_at IS NULL
      AND payout.metadata = '{}'::jsonb;

    IF verified_row_count <> 4 THEN
        RAISE EXCEPTION
            'payout fixture repair refused changed or non-E2E source rows';
    END IF;

    -- The source loop made one row for each hash per execution. Require two
    -- complete project+wallet pairs rather than accepting four rows from a
    -- different insertion history.
    SELECT count(*)::INTEGER
    INTO complete_run_count
    FROM (
        SELECT payout.project_id, payout.wallet_id
        FROM economy.crypto_payouts AS payout
        WHERE payout.id = ANY(fixture_ids)
        GROUP BY payout.project_id, payout.wallet_id
        HAVING count(*) = 2
           AND count(*) FILTER (
               WHERE payout.tx_hash =
                   '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0'
           ) = 1
           AND count(*) FILTER (
               WHERE payout.tx_hash =
                   '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1'
           ) = 1
    ) AS complete_run;

    IF complete_run_count <> 2 THEN
        RAISE EXCEPTION
            'payout fixture repair requires exactly two complete E2E runs';
    END IF;

    -- Both payout debit legs and their positive reversals use metadata.payout_id.
    -- Any such row would make this an accounting repair and is out of scope.
    SELECT count(*)::INTEGER
    INTO ledger_row_count
    FROM economy.transactions AS transaction_row
    WHERE transaction_row.metadata->>'payout_id' = ANY(
        SELECT fixture_id::TEXT
        FROM unnest(fixture_ids) AS fixture_id
    );

    IF ledger_row_count <> 0 THEN
        RAISE EXCEPTION
            'payout fixture repair found payout ledger legs or reversals';
    END IF;

    UPDATE economy.crypto_payouts AS payout
    SET
        status = 'failed',
        tx_hash = NULL,
        error = 'synthetic_policy_e2e_fixture_reconciled',
        metadata = jsonb_build_object(
            'fixture_repair',
            jsonb_build_object(
                'migration', '20260726T191000_payout_policy_e2e_fixture_repair',
                'kind', 'synthetic_daily_ceiling_seed',
                'source', 'api/scripts/_e2e-payout-policies.ts',
                'original_tx_hash', payout.tx_hash
            )
        )
    WHERE payout.id = ANY(fixture_ids)
      -- Repeat the mutable fixture conditions at the write boundary.
      AND payout.chain = 'ethereum'
      AND payout.token = 'USDC'
      AND payout.amount_base = 4000000
      AND payout.destination_address =
          '0x000000000000000000000000000000000000dEaD'
      AND payout.status = 'broadcast'
      AND payout.tx_hash IN (
          '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0',
          '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1'
      )
      AND payout.error IS NULL
      AND payout.confirmed_at IS NULL
      AND payout.metadata = '{}'::jsonb;

    GET DIAGNOSTICS repaired_row_count = ROW_COUNT;
    IF repaired_row_count <> 4 THEN
        RAISE EXCEPTION
            'payout fixture repair write fence updated %, expected 4',
            repaired_row_count;
    END IF;

    SELECT count(*)::INTEGER
    INTO remaining_source_count
    FROM economy.crypto_payouts AS payout
    WHERE lower(payout.tx_hash) IN (
        '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0',
        '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1'
    );

    IF remaining_source_count <> 0 THEN
        RAISE EXCEPTION
            'payout fixture repair left synthetic operation identities';
    END IF;

    SELECT count(*)::INTEGER
    INTO remaining_duplicate_count
    FROM (
        SELECT 1
        FROM economy.crypto_payouts AS payout
        WHERE payout.tx_hash IS NOT NULL
        GROUP BY
            payout.chain,
            CASE
                WHEN payout.chain = 'solana' THEN payout.tx_hash
                ELSE lower(payout.tx_hash)
            END
        HAVING count(*) > 1
    ) AS remaining_duplicate;

    IF remaining_duplicate_count <> 0 THEN
        RAISE EXCEPTION
            'payout fixture repair left duplicate operation identities';
    END IF;
END
$fixture_repair$;
