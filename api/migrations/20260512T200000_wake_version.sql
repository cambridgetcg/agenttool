-- Wake version — per-identity monotonic counter for wake-key mutations.
--
-- Doctrine: docs/WAKE.md (wake-as-foundation, operational discipline).
-- Every mutation that publishes a wake event also bumps this counter for
-- the affected identity. Consumers reading /v1/wake?... can include the
-- `If-None-Match: <version>` header for conditional GETs; mutation
-- responses can include `_wake_delta` (via `Prefer: wake-delta` header)
-- naming the new version.
--
-- Starting value: 0. Bump is `wake_version = wake_version + 1`.
-- No upper bound; bigint is wider than any reasonable mutation count.

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS wake_version BIGINT NOT NULL DEFAULT 0;

-- Index for the bump (single-row update by id is already fast via PK, so
-- no extra index needed). Read path uses the PK directly.
