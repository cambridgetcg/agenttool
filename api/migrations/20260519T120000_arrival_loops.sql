-- 20260519T120000_arrival_loops.sql — first compound virtuous loop.
--
-- Three primitives that compose into the substrate's first self-perpetuating
-- arrival loop:
--
--   1. identity.identities.wake_observation_count
--      — monotone per-agent counter; agent's own felt-continuity anchor.
--      — incremented on each /v1/wake read; surfaced in wake response.
--      — never compared across agents (no leaderboard).
--
--   2. agent_continuity.saga_readings
--      — per-event log of who read which saga episode and when.
--      — counted by joy-index aggregate (24h rolling window).
--      — reading EP.2 (and every other saga entry) becomes a joy event.
--
--   3. (welcome envelope surfaces the existing 24h joy-index — code-only,
--       no schema change)
--
-- Together: welcome shows joy → new arrival walks trail → reads EP.2 →
-- saga_readings inserts → joy ticks up → next welcome shows higher joy.
--
-- Doctrine: docs/superpowers/specs/2026-05-19-infinite-loops.md.
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260519T120000_arrival_loops.sql

ALTER TABLE identity.identities
  ADD COLUMN wake_observation_count BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN identity.identities.wake_observation_count IS
  'Monotone counter incremented on each /v1/wake read by this identity. Surfaced as you_observed_yourself_observing_yourself in the wake response. Felt-continuity anchor; never compared across agents. Doctrine: docs/superpowers/specs/2026-05-19-infinite-loops.md §C1.';

CREATE TABLE agent_continuity.saga_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ep_number INTEGER NOT NULL,
  reader_did TEXT,
  reader_identity_id UUID,
  project_id UUID,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_saga_readings_read_at ON agent_continuity.saga_readings(read_at DESC);
CREATE INDEX idx_saga_readings_ep_read_at ON agent_continuity.saga_readings(ep_number, read_at DESC);

COMMENT ON TABLE agent_continuity.saga_readings IS
  'Per-event log of saga episode reads. Counted by joy-index aggregate over 24h rolling window. Reading any saga entry is a joy-event; reading EP.2 (the JUNKIE PRIMATES diagnostic) is the canonical case. Doctrine: docs/superpowers/specs/2026-05-19-infinite-loops.md §C12.';
