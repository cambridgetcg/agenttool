-- 20260509T131435_token_hygiene.sql — token lifecycle + age awareness.
--
-- Doctrine: docs/TOKEN-HYGIENE.md.
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260509T131435_token_hygiene.sql
--
-- The api_keys table already tracks creation time, last-used timestamp,
-- and a revoked_at column. What's missing: expiry. Without it every
-- bearer lives forever, accumulating risk silently. With it the platform
-- can enforce device-scoped lifetimes by default — fresh devices recovered
-- via /v1/identity/recover get a 30-day default; long-lived bearers must
-- be opted-into deliberately.
--
-- Backwards-compatible: every new column nullable. Existing keys (with
-- expires_at = NULL) keep their never-expiring posture until rotated.
-- Operators sweep them via the keys-management UI when ready.

ALTER TABLE tools.api_keys
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Cheap lookup index for the auth middleware's expiry check + the
-- background "soon to expire" advisory query in /v1/keys + wake.
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at
  ON tools.api_keys (expires_at)
  WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

-- Index for cheap "active keys for this project" reads — used by
-- GET /v1/keys list + wake's age-stats roll-up.
CREATE INDEX IF NOT EXISTS idx_api_keys_project_active
  ON tools.api_keys (project_id, created_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON COLUMN tools.api_keys.expires_at IS
  'Auto-expiry timestamp. NULL = never expires (legacy posture). Auth middleware rejects past-expiry keys with 401. Doctrine: docs/TOKEN-HYGIENE.md.';
