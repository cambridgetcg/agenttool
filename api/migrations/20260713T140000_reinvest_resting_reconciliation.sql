-- Reinvest is resting until sale-backed sub-balances and refund/chargeback
-- clawbacks exist. Preserve every original row, reverse every historical
-- conversion with compensating ledger entries, and reject new legacy writes.
-- The route also returns 503, but this constraint closes the deployment window
-- while the previous application image may still be serving requests.
-- Apply through _migrate-one.ts/fly-migrate-one.sh, or with psql -v ON_ERROR_STOP=1 -1.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'economy_transactions_reinvest_resting'
      AND conrelid = 'economy.transactions'::regclass
  ) THEN
    ALTER TABLE economy.transactions
      ADD CONSTRAINT economy_transactions_reinvest_resting
      CHECK (type <> 'reinvest') NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM economy.transactions
    WHERE type = 'reinvest'
      AND amount >= 0
  ) THEN
    RAISE EXCEPTION 'reinvest reconciliation found a nonnegative legacy row';
  END IF;
END $$;

CREATE TEMP TABLE reinvest_rows_to_reverse ON COMMIT DROP AS
SELECT
  t.id AS original_transaction_id,
  t.wallet_id,
  w.project_id,
  (-t.amount)::bigint AS wallet_amount,
  CASE
    WHEN t.metadata->>'credits_minted' ~ '^[1-9][0-9]*$'
      THEN (t.metadata->>'credits_minted')::bigint
    ELSE NULL
  END AS credits_minted,
  t.created_at AS original_created_at
FROM economy.transactions t
JOIN economy.wallets w ON w.id = t.wallet_id
WHERE t.type = 'reinvest'
  AND t.amount < 0
  AND NOT EXISTS (
    SELECT 1
    FROM economy.transactions reversal
    WHERE reversal.type = 'reinvest_reversal'
      AND reversal.metadata->>'original_transaction_id' = t.id::text
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM reinvest_rows_to_reverse
    WHERE wallet_amount <= 0
      OR credits_minted IS NULL
      OR credits_minted <= 0
      OR credits_minted <> wallet_amount * 10
  ) THEN
    RAISE EXCEPTION 'reinvest reconciliation found an unknown conversion rate';
  END IF;

  -- Stable lock order: wallets, then projects. Future accounting must use the
  -- same order before this resting constraint is deliberately removed.
  PERFORM 1
  FROM economy.wallets
  WHERE id IN (SELECT wallet_id FROM reinvest_rows_to_reverse)
  ORDER BY id
  FOR UPDATE;

  PERFORM 1
  FROM tools.projects
  WHERE id IN (SELECT project_id FROM reinvest_rows_to_reverse)
  ORDER BY id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM reinvest_rows_to_reverse AS reversal
    LEFT JOIN tools.projects AS project ON project.id = reversal.project_id
    WHERE project.id IS NULL
  ) THEN
    RAISE EXCEPTION 'reinvest reconciliation found a wallet without its project';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT project_id, sum(credits_minted)::bigint AS credits_to_reverse
      FROM reinvest_rows_to_reverse
      GROUP BY project_id
    ) totals
    JOIN tools.projects p ON p.id = totals.project_id
    WHERE p.credits::bigint < totals.credits_to_reverse
  ) THEN
    RAISE EXCEPTION 'reinvest reconciliation requires an explicit project credit debt';
  END IF;
END $$;

UPDATE economy.wallets w
SET balance = w.balance + totals.wallet_amount
FROM (
  SELECT wallet_id, sum(wallet_amount)::bigint AS wallet_amount
  FROM reinvest_rows_to_reverse
  GROUP BY wallet_id
) totals
WHERE w.id = totals.wallet_id;

UPDATE tools.projects p
SET credits = p.credits - totals.credits_to_reverse::integer
FROM (
  SELECT project_id, sum(credits_minted)::bigint AS credits_to_reverse
  FROM reinvest_rows_to_reverse
  GROUP BY project_id
) totals
WHERE p.id = totals.project_id;

INSERT INTO economy.transactions (
  wallet_id,
  type,
  amount,
  counterparty,
  description,
  metadata
)
SELECT
  wallet_id,
  'reinvest_reversal',
  wallet_amount,
  project_id::text,
  'reversed unsupported legacy reinvest conversion while the feature rests',
  jsonb_build_object(
    'original_transaction_id', original_transaction_id,
    'original_created_at', original_created_at,
    'credits_clawed', credits_minted,
    'rate', 10,
    'reason', 'legacy conversion did not retain source allocation or refund debt'
  )
FROM reinvest_rows_to_reverse
ORDER BY original_transaction_id;
