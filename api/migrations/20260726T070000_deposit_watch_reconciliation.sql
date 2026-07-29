-- 20260726T070000_deposit_watch_reconciliation.sql
--
-- Durable, provider-neutral desired/observed control state for deposit-address
-- watches. The migration runner applies this file and its journal record in one
-- transaction. Direct psql:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f <this-file>
--
-- Historical deposit rows are deliberately not backfilled. A row does not say
-- which provider or network should own its watch, and guessing either could
-- disclose the wrong address or create a false readiness claim. Callers must
-- explicitly enqueue desired state through the service after selecting the
-- active provider and network.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM economy.deposit_addresses
    WHERE chain NOT IN (
      'ethereum',
      'base',
      'polygon',
      'arbitrum',
      'optimism',
      'solana'
    )
      OR token <> 'USDC'
      OR btrim(address) = ''
      OR btrim(derivation_path) = ''
  ) THEN
    RAISE EXCEPTION
      'deposit_addresses contains an unsupported or incomplete historical row; reconcile it before creating watch state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM economy.deposit_addresses
    GROUP BY wallet_id, chain, token
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'deposit_addresses contains conflicting wallet/chain/token rows; reconcile custody before creating watch state';
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
      'deposit_addresses contains case-insensitive EVM address conflicts; reconcile custody before creating watch state';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_address_id_chain
  ON economy.deposit_addresses (id, chain);

CREATE TABLE economy.deposit_address_watches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_address_id  UUID NOT NULL,
  provider            TEXT NOT NULL,
  chain               TEXT NOT NULL,
  network             TEXT NOT NULL,
  desired_state       TEXT NOT NULL DEFAULT 'watching',
  observed_state      TEXT NOT NULL DEFAULT 'unknown',
  status              TEXT NOT NULL DEFAULT 'pending',
  generation          INTEGER NOT NULL DEFAULT 1,
  observed_generation INTEGER,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ DEFAULT now(),
  lease_id            UUID,
  lease_owner         TEXT,
  lease_expires_at    TIMESTAMPTZ,
  last_outcome_code   TEXT,
  last_attempt_at     TIMESTAMPTZ,
  observed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_deposit_watch_address_chain
    FOREIGN KEY (deposit_address_id, chain)
    REFERENCES economy.deposit_addresses (id, chain)
    ON DELETE CASCADE,

  CONSTRAINT deposit_watch_provider_shape
    CHECK (provider ~ '^[a-z][a-z0-9_-]{0,31}$'),
  CONSTRAINT deposit_watch_chain
    CHECK (chain IN (
      'ethereum',
      'base',
      'polygon',
      'arbitrum',
      'optimism',
      'solana'
    )),
  CONSTRAINT deposit_watch_network
    CHECK (network IN ('mainnet', 'testnet')),
  CONSTRAINT deposit_watch_desired_state
    CHECK (desired_state IN ('watching', 'not_watching')),
  CONSTRAINT deposit_watch_observed_state
    CHECK (observed_state IN ('unknown', 'watching', 'not_watching')),
  CONSTRAINT deposit_watch_status
    CHECK (status IN (
      'pending',
      'leased',
      'retry_wait',
      'accepted_unverified',
      'converged',
      'blocked'
    )),
  CONSTRAINT deposit_watch_generation
    CHECK (
      generation >= 1
      AND (observed_generation IS NULL OR observed_generation >= 1)
    ),
  CONSTRAINT deposit_watch_attempt_bound
    CHECK (attempt_count BETWEEN 0 AND 8),
  CONSTRAINT deposit_watch_attempt_shape
    CHECK (
      (attempt_count = 0 AND last_attempt_at IS NULL)
      OR
      (attempt_count > 0 AND last_attempt_at IS NOT NULL)
    ),
  CONSTRAINT deposit_watch_observation_shape
    CHECK (
      (
        observed_state = 'unknown'
        AND observed_generation IS NULL
        AND observed_at IS NULL
      )
      OR
      (
        observed_state <> 'unknown'
        AND observed_generation IS NOT NULL
        AND observed_at IS NOT NULL
      )
    ),
  CONSTRAINT deposit_watch_lease_shape
    CHECK (
      (
        status = 'leased'
        AND lease_id IS NOT NULL
        AND lease_owner IS NOT NULL
        AND char_length(lease_owner) BETWEEN 1 AND 128
        AND lease_expires_at IS NOT NULL
        AND last_attempt_at IS NOT NULL
        AND lease_expires_at > last_attempt_at
        AND lease_expires_at <= last_attempt_at + interval '5 minutes'
      )
      OR
      (
        status <> 'leased'
        AND lease_id IS NULL
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
      )
    ),
  CONSTRAINT deposit_watch_schedule_shape
    CHECK (
      (
        status IN ('pending', 'retry_wait', 'accepted_unverified')
        AND next_attempt_at IS NOT NULL
      )
      OR
      (
        status NOT IN ('pending', 'retry_wait', 'accepted_unverified')
        AND next_attempt_at IS NULL
      )
    ),
  CONSTRAINT deposit_watch_converged_shape
    CHECK (
      status <> 'converged'
      OR (
        observed_state = desired_state
        AND observed_generation = generation
      )
    ),
  CONSTRAINT deposit_watch_retry_bound
    CHECK (
      status NOT IN ('retry_wait', 'accepted_unverified')
      OR (
        next_attempt_at > updated_at
        AND next_attempt_at <= updated_at + interval '24 hours'
      )
    ),
  CONSTRAINT deposit_watch_outcome_code
    CHECK (
      last_outcome_code IS NULL
      OR last_outcome_code IN (
        'provider_mutation_accepted',
        'desired_state_verified',
        'opposite_state_verified',
        'provider_unavailable',
        'provider_rate_limited',
        'provider_timeout',
        'provider_configuration_missing',
        'provider_rejected',
        'provider_unsupported',
        'reconciler_failed',
        'lease_expired'
      )
    )
);

CREATE UNIQUE INDEX uq_deposit_watch_target
  ON economy.deposit_address_watches (
    deposit_address_id,
    provider,
    chain,
    network
  );

CREATE INDEX idx_deposit_watch_due
  ON economy.deposit_address_watches (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry_wait', 'accepted_unverified');

CREATE INDEX idx_deposit_watch_expired_lease
  ON economy.deposit_address_watches (lease_expires_at)
  WHERE status = 'leased';

COMMENT ON TABLE economy.deposit_address_watches IS
  'Provider-neutral desired/observed deposit-watch control state. Stores no credential or provider response body. accepted_unverified records mutation acceptance only and schedules bounded observation; converged requires independent active/type/destination/membership observation for the current generation.';

COMMENT ON COLUMN economy.deposit_address_watches.last_outcome_code IS
  'Closed sanitized outcome only; never a provider body, exception message, credential, or arbitrary diagnostic.';

COMMENT ON COLUMN economy.deposit_address_watches.observed_generation IS
  'Generation whose provider state was independently observed. A successful mutation request does not advance this field.';
