-- Durable fail-closed interlock for the first covenant-v2 authority-generation
-- ceremony. The operator sets this private bit only while allowed_origins is
-- empty and leaves it set through the separately reviewed allowlist ceremony.

ALTER TABLE federation.settings
  ADD COLUMN IF NOT EXISTS covenant_v2_generation_hold BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE federation.settings
  DROP CONSTRAINT IF EXISTS federation_settings_covenant_v2_generation_hold_empty;

ALTER TABLE federation.settings
  ADD CONSTRAINT federation_settings_covenant_v2_generation_hold_empty
  CHECK (
    NOT covenant_v2_generation_hold
    OR cardinality(allowed_origins) = 0
  );

COMMENT ON COLUMN federation.settings.covenant_v2_generation_hold IS
  'Private durable interlock: while true, covenant-v2 generation rollout requires allowed_origins to remain empty.';
