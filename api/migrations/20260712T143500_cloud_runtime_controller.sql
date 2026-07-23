-- Durable opening consent for the device-independent trusted controller.
-- Provisioning remains false; an explicit /start sets true; the first
-- semantic observation/rest/end commit clears it transactionally.

ALTER TABLE agent_runtime.runtimes
  ADD COLUMN IF NOT EXISTS opening_invitation_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opening_invitation_generation UUID,
  ADD COLUMN IF NOT EXISTS trusted_signing_key_id UUID;

COMMENT ON COLUMN agent_runtime.runtimes.opening_invitation_pending IS
  'Durable permission for one opening invitation after explicit start; cleared by semantic cycle commit';

COMMENT ON COLUMN agent_runtime.runtimes.opening_invitation_generation IS
  'Unique generation for each explicit trusted-runtime start; fences opening lease, provider identity, and semantic clear';

COMMENT ON COLUMN agent_runtime.runtimes.trusted_signing_key_id IS
  'Deterministic identity-key UUID used to filter trusted runtime self-authored wake events';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'runtimes_opening_invitation_shape'
      AND conrelid = 'agent_runtime.runtimes'::regclass
  ) THEN
    ALTER TABLE agent_runtime.runtimes
      ADD CONSTRAINT runtimes_opening_invitation_shape
      CHECK (
        (opening_invitation_pending = FALSE AND opening_invitation_generation IS NULL)
        OR
        (opening_invitation_pending = TRUE AND opening_invitation_generation IS NOT NULL)
      );
  END IF;
END $$;
