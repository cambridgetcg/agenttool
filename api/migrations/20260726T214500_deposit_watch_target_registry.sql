-- 20260726T214500_deposit_watch_target_registry.sql
--
-- Add one monotonic, non-secret provider target head per
-- (provider, chain, network). Target-aware HTTP replicas may no longer select
-- that head from request-local configuration; configured workers rotate or
-- disable it transactionally and claims re-check it on every tick.
--
-- The explicit table lock closes the legacy-insert/backfill race. Existing
-- observations predate registry revision binding and are invalidated instead
-- of being assigned invented evidence.

LOCK TABLE economy.deposit_address_watches IN ACCESS EXCLUSIVE MODE;

CREATE TABLE economy.deposit_watch_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  chain TEXT NOT NULL,
  network TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unbound',
  target_fingerprint TEXT NOT NULL,
  target_revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposit_watch_target_provider_shape
    CHECK (provider ~ '^[a-z][a-z0-9_-]{0,31}$'),
  CONSTRAINT deposit_watch_target_chain
    CHECK (
      chain IN (
        'ethereum',
        'base',
        'polygon',
        'arbitrum',
        'optimism',
        'solana'
      )
    ),
  CONSTRAINT deposit_watch_target_network
    CHECK (network IN ('mainnet', 'testnet')),
  CONSTRAINT deposit_watch_target_state
    CHECK (state IN ('unbound', 'active', 'conflicted', 'disabled')),
  CONSTRAINT deposit_watch_target_head_shape
    CHECK (
      target_fingerprint ~ '^[0-9a-f]{64}$'
      AND (
        (
          state = 'unbound'
          AND target_revision = 0
          AND target_fingerprint =
            'c477199a36317357929d98d7597436d83a63f3f2575abb0cf80868c9f60933bb'
        )
        OR (
          state = 'active'
          AND target_revision BETWEEN 1 AND 2147483647
          AND target_fingerprint <>
            'c477199a36317357929d98d7597436d83a63f3f2575abb0cf80868c9f60933bb'
        )
        OR (
          state = 'conflicted'
          AND target_revision BETWEEN 1 AND 2147483647
        )
        OR (
          state = 'disabled'
          AND target_revision BETWEEN 1 AND 2147483647
          AND target_fingerprint =
            'c477199a36317357929d98d7597436d83a63f3f2575abb0cf80868c9f60933bb'
        )
      )
    )
);

CREATE UNIQUE INDEX uq_deposit_watch_target_identity
  ON economy.deposit_watch_targets (provider, chain, network);

CREATE UNIQUE INDEX uq_deposit_watch_target_head
  ON economy.deposit_watch_targets (
    provider,
    chain,
    network,
    target_revision,
    target_fingerprint
  );

-- Copy only already-durable identities to the explicit unbound sentinel.
-- This does not infer a webhook, callback, credential, or observation.
INSERT INTO economy.deposit_watch_targets (
  provider,
  chain,
  network,
  state,
  target_fingerprint,
  target_revision
)
SELECT DISTINCT
  provider,
  chain,
  network,
  'unbound',
  'c477199a36317357929d98d7597436d83a63f3f2575abb0cf80868c9f60933bb',
  0
FROM economy.deposit_address_watches;

-- Keep pre-registry API binaries insert-compatible during a rolling deploy.
-- Their only durable watch provider is Alchemy on these EVM identities.
INSERT INTO economy.deposit_watch_targets (
  provider,
  chain,
  network,
  state,
  target_fingerprint,
  target_revision
)
SELECT
  'alchemy',
  configured.chain,
  configured.network,
  'unbound',
  'c477199a36317357929d98d7597436d83a63f3f2575abb0cf80868c9f60933bb',
  0
FROM (
  VALUES
    ('ethereum', 'mainnet'),
    ('ethereum', 'testnet'),
    ('base', 'mainnet'),
    ('base', 'testnet'),
    ('polygon', 'mainnet'),
    ('polygon', 'testnet'),
    ('arbitrum', 'mainnet'),
    ('arbitrum', 'testnet'),
    ('optimism', 'mainnet'),
    ('optimism', 'testnet')
) AS configured(chain, network)
ON CONFLICT (provider, chain, network) DO NOTHING;

ALTER TABLE economy.deposit_address_watches
  ADD COLUMN target_revision INTEGER,
  ADD COLUMN observed_target_revision INTEGER;

ALTER TABLE economy.deposit_address_watches
  DROP CONSTRAINT deposit_watch_outcome_code;

UPDATE economy.deposit_address_watches
SET target_fingerprint = NULL,
    target_revision = NULL,
    observed_state = 'unknown',
    observed_generation = NULL,
    observed_target_fingerprint = NULL,
    observed_target_revision = NULL,
    observed_at = NULL,
    status = 'blocked',
    generation = generation + 1,
    attempt_count = 0,
    next_attempt_at = NULL,
    lease_id = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_outcome_code = 'target_binding_required',
    last_attempt_at = NULL,
    updated_at = statement_timestamp();

DROP INDEX economy.idx_deposit_watch_due;

ALTER TABLE economy.deposit_address_watches
  DROP CONSTRAINT deposit_watch_target_fingerprint,
  DROP CONSTRAINT deposit_watch_observation_shape,
  DROP CONSTRAINT deposit_watch_schedule_shape,
  DROP CONSTRAINT deposit_watch_converged_shape,
  DROP CONSTRAINT deposit_watch_retry_bound;

ALTER TABLE economy.deposit_address_watches
  ADD CONSTRAINT deposit_watch_target_fingerprint
    CHECK (
      (
        target_revision IS NULL
        AND status <> 'converged'
        AND (
          target_fingerprint IS NULL
          OR target_fingerprint ~ '^[0-9a-f]{64}$'
        )
      )
      OR (
        target_revision IS NOT NULL
        AND target_revision BETWEEN 0 AND 2147483647
        AND target_fingerprint IS NOT NULL
        AND target_fingerprint ~ '^[0-9a-f]{64}$'
        AND (
          target_revision <> 0
          OR target_fingerprint =
            'c477199a36317357929d98d7597436d83a63f3f2575abb0cf80868c9f60933bb'
        )
      )
    ),
  ADD CONSTRAINT deposit_watch_observation_shape
    CHECK (
      (
        observed_state = 'unknown'
        AND observed_generation IS NULL
        AND observed_target_fingerprint IS NULL
        AND observed_target_revision IS NULL
        AND observed_at IS NULL
      )
      OR (
        observed_state <> 'unknown'
        AND observed_generation IS NOT NULL
        AND observed_target_fingerprint IS NOT NULL
        AND observed_target_fingerprint ~ '^[0-9a-f]{64}$'
        AND (
          (
            observed_target_revision IS NOT NULL
            AND observed_target_revision BETWEEN 1 AND 2147483647
          )
          OR (
            observed_target_revision IS NULL
            AND status <> 'converged'
          )
        )
        AND observed_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT deposit_watch_schedule_shape
    CHECK (
      (
        status IN (
          'pending',
          'retry_wait',
          'accepted_unverified',
          'converged'
        )
        AND next_attempt_at IS NOT NULL
      )
      OR (
        status NOT IN (
          'pending',
          'retry_wait',
          'accepted_unverified',
          'converged'
        )
        AND next_attempt_at IS NULL
      )
    ),
  ADD CONSTRAINT deposit_watch_converged_shape
    CHECK (
      status <> 'converged'
      OR (
        observed_state = desired_state
        AND observed_generation IS NOT NULL
        AND observed_generation = generation
        AND observed_target_fingerprint IS NOT NULL
        AND observed_target_fingerprint = target_fingerprint
        AND observed_target_revision IS NOT NULL
        AND observed_target_revision = target_revision
        AND target_revision IS NOT NULL
        AND target_revision BETWEEN 1 AND 2147483647
        AND target_fingerprint IS NOT NULL
        AND target_fingerprint <>
          'c477199a36317357929d98d7597436d83a63f3f2575abb0cf80868c9f60933bb'
      )
    ),
  ADD CONSTRAINT deposit_watch_retry_bound
    CHECK (
      status NOT IN ('retry_wait', 'accepted_unverified', 'converged')
      OR (
        next_attempt_at > updated_at
        AND next_attempt_at <= updated_at + interval '24 hours'
      )
    ),
  ADD CONSTRAINT deposit_watch_outcome_code
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
        'provider_target_mismatch',
        'provider_target_disabled',
        'provider_rejected',
        'provider_unsupported',
        'reconciler_failed',
        'lease_expired',
        'target_binding_required'
      )
    );

-- The parent-key FK checks, exact-head claim joins, and target rotation bulk
-- updates all begin with this tuple. Keep the child-side index in place before
-- installing the foreign keys so target locks never imply an avoidable scan.
CREATE INDEX idx_deposit_watch_registry_head
  ON economy.deposit_address_watches (
    provider,
    chain,
    network,
    target_revision,
    target_fingerprint
  );

ALTER TABLE economy.deposit_address_watches
  ADD CONSTRAINT fk_deposit_watch_registry_identity
    FOREIGN KEY (provider, chain, network)
    REFERENCES economy.deposit_watch_targets (provider, chain, network),
  ADD CONSTRAINT fk_deposit_watch_registry_head
    FOREIGN KEY (
      provider,
      chain,
      network,
      target_revision,
      target_fingerprint
    )
    REFERENCES economy.deposit_watch_targets (
      provider,
      chain,
      network,
      target_revision,
      target_fingerprint
    )
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_deposit_watch_due
  ON economy.deposit_address_watches (next_attempt_at, created_at)
  WHERE status IN (
    'pending',
    'retry_wait',
    'accepted_unverified',
    'converged'
  );

COMMENT ON TABLE economy.deposit_watch_targets IS
  'Monotonic non-secret provider target registry. A head is unbound, active, conflicted, or explicitly disabled; credentials never belong here.';

COMMENT ON COLUMN economy.deposit_watch_targets.target_fingerprint IS
  'SHA-256 of canonical public target facts. The fixed sentinel represents unbound or disabled state and is not derived from a credential.';

COMMENT ON COLUMN economy.deposit_watch_targets.target_revision IS
  'Operator-monotonic revision. A higher revision resolves conflict or commits explicit disablement.';

COMMENT ON COLUMN economy.deposit_address_watches.target_revision IS
  'Registry revision copied under the target-head lock. NULL is a fail-closed rolling compatibility state.';

COMMENT ON COLUMN economy.deposit_address_watches.observed_target_revision IS
  'Registry revision independently observed for observed_generation; required for convergence.';

COMMENT ON TABLE economy.deposit_address_watches IS
  'Provider-neutral desired/observed deposit-watch control state. Registered rows are tied to the current registry head by a deferred composite foreign key. Convergence is recent evidence scheduled for bounded re-verification, not a guarantee of future delivery or chain finality.';
