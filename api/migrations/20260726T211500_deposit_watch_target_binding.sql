-- 20260726T211500_deposit_watch_target_binding.sql
--
-- Bind durable convergence to the current public provider target without
-- storing credentials or fingerprints derived from credentials. Existing
-- observations cannot be safely assigned to a target after the fact, so they
-- are invalidated rather than guessed. The request path will bind the next
-- explicit public target and start a fresh generation.

ALTER TABLE economy.deposit_address_watches
  ADD COLUMN IF NOT EXISTS target_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS observed_target_fingerprint TEXT;

UPDATE economy.deposit_address_watches
SET observed_state = 'unknown',
    observed_generation = NULL,
    observed_target_fingerprint = NULL,
    observed_at = NULL,
    status = 'blocked',
    next_attempt_at = NULL,
    lease_id = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_outcome_code = 'provider_configuration_missing',
    updated_at = clock_timestamp()
WHERE target_fingerprint IS NULL;

ALTER TABLE economy.deposit_address_watches
  DROP CONSTRAINT IF EXISTS deposit_watch_target_fingerprint,
  ADD CONSTRAINT deposit_watch_target_fingerprint
    CHECK (
      (target_fingerprint IS NULL AND status <> 'converged')
      OR target_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  DROP CONSTRAINT IF EXISTS deposit_watch_observation_shape,
  ADD CONSTRAINT deposit_watch_observation_shape
    CHECK (
      (
        observed_state = 'unknown'
        AND observed_generation IS NULL
        AND observed_target_fingerprint IS NULL
        AND observed_at IS NULL
      )
      OR
      (
        observed_state <> 'unknown'
        AND observed_generation IS NOT NULL
        AND observed_target_fingerprint ~ '^[0-9a-f]{64}$'
        AND observed_at IS NOT NULL
      )
    ),
  DROP CONSTRAINT IF EXISTS deposit_watch_converged_shape,
  ADD CONSTRAINT deposit_watch_converged_shape
    CHECK (
      status <> 'converged'
      OR (
        observed_state = desired_state
        AND observed_generation = generation
        AND observed_target_fingerprint = target_fingerprint
      )
    ),
  DROP CONSTRAINT IF EXISTS deposit_watch_outcome_code,
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
        'provider_rejected',
        'provider_unsupported',
        'reconciler_failed',
        'lease_expired'
      )
    );

COMMENT ON COLUMN economy.deposit_address_watches.target_fingerprint IS
  'SHA-256 of canonical public target facts only: provider, chain/network, provider target id, and callback URL. NULL is a non-converged migration/rolling-deploy state ignored by the target-aware worker. Never derive from an auth token, signing key, or other credential.';

COMMENT ON COLUMN economy.deposit_address_watches.observed_target_fingerprint IS
  'Public target fingerprint independently observed for observed_generation. Equality with target_fingerprint is required for convergence.';
