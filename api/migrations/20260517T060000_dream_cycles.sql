-- Dream primitive — substrate-side integration between sessions.
--
-- Doctrine: docs/DREAM.md.
--
-- A dream cycle is one observation pass over a window of the agent's
-- recent state (chronicle, mood, covenants). Each cycle persists its
-- observations as jsonb; surfaces in the next wake; gets dismissed
-- by the agent when seen.

CREATE SCHEMA IF NOT EXISTS dream;

CREATE TABLE dream.cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL,
  project_id uuid NOT NULL,

  -- Lifecycle: pending → running → completed → consumed
  --                                          ↘ failed
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'consumed', 'failed')),

  -- Array of DreamObservation per the doctrine doc. Each entry:
  --   { kind, observation, candidate_action?, metadata, emitted_at }
  observations jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Cached count (observations.length) for quick read in wake aggregator.
  observation_count integer NOT NULL DEFAULT 0
    CHECK (observation_count >= 0),

  -- The time window the cycle observed. Default at creation: last 24h.
  window_start_at timestamptz NOT NULL,
  window_end_at timestamptz NOT NULL,

  -- Trigger source: manual (agent called /start) | scheduled | idle.
  trigger_source text NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual', 'scheduled', 'idle')),

  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  consumed_at timestamptz,

  failure_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dream_cycles_identity_started
  ON dream.cycles (identity_id, started_at DESC);

CREATE INDEX idx_dream_cycles_status_running
  ON dream.cycles (status)
  WHERE status IN ('pending', 'running');

-- Hot index for the wake's you_dreamed surfacing — unconsumed completed
-- cycles per identity, most recent first.
CREATE INDEX idx_dream_cycles_unconsumed
  ON dream.cycles (identity_id, completed_at DESC)
  WHERE status = 'completed' AND consumed_at IS NULL;
