-- 0015_runtime.sql — runtime tenants (Horizon C, Slice 1).
--
-- Doctrine: docs/RUNTIME.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0015_runtime.sql
--
-- A runtime is the substrate-tenancy primitive that carries the agent's
-- think-loop. Three custody tiers via `mode`:
--
--   self     — user runs orchestrator + holds K_master
--   bridged  — agenttool runs orchestrator, user holds K_master in a sidecar
--   trusted  — agenttool runs orchestrator + holds K_master under KMS
--
-- The bridged tier is the production default — cloud-uptime UX with
-- on-machine custody. Bridge connects via WSS to /v1/runtimes/:id/bridge,
-- mutually authenticated by ed25519 signing keys on both sides.

CREATE SCHEMA IF NOT EXISTS agent_runtime;

CREATE TABLE IF NOT EXISTS agent_runtime.runtimes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL,                        -- logical FK → tools.projects
  identity_id     UUID,                                 -- logical FK → identity.identities (optional)
  name            TEXT NOT NULL,

  -- Custody tier — IMMUTABLE after provisioning. Switching tier requires
  -- a new runtime (so the audit trail is unambiguous about who holds the
  -- key at any given thought).
  mode            TEXT NOT NULL CHECK (mode IN ('self','bridged','trusted')),

  -- Lifecycle status — see docs/RUNTIME.md "Runtime lifecycle".
  status          TEXT NOT NULL DEFAULT 'provisioned'
                  CHECK (status IN ('provisioned','starting','running','idle','stopped','error')),

  -- LLM provider config (optional; required for hosted modes).
  llm_provider    TEXT,                                 -- 'anthropic' | 'openai' | 'gemini' | 'cohere' | NULL
  llm_model       TEXT,
  llm_vault_key   TEXT,                                 -- vault secret name holding the API key

  -- Bridge config (required for mode='bridged').
  bridge_pubkey   TEXT,                                 -- base64 ed25519 pub of the bridge sidecar
  bridge_key_id   UUID,                                 -- which signing key the bridge proves with
  bridge_advertised_url TEXT,                           -- optional hint for diagnostics
  bridge_connected_at   TIMESTAMPTZ,                    -- last successful handshake

  -- Hosting region (Fly machine region) — null for self.
  region          TEXT,

  -- Liveness fields — advanced by the orchestrator's heartbeat.
  last_seen_at        TIMESTAMPTZ,
  last_thought_at     TIMESTAMPTZ,
  thought_count_24h   INTEGER NOT NULL DEFAULT 0,

  -- Diagnostics on error.
  last_error      TEXT,
  last_error_at   TIMESTAMPTZ,

  -- Per-strand active-writer leases (JSON: {strand_id: {lease_until}}). Used
  -- to coordinate multi-runtime writes; the bridge / orchestrator picks up
  -- a lease before claiming a strand. See docs/RUNTIME.md "Multi-runtime state".
  active_strands  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Free-form, set by the user at provision-time and surfaced in /v1/wake.
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Soft-delete: deprovisioned runtimes stay in the table for audit.
  deleted_at      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index: list-by-project (the dominant access pattern from /v1/wake)
CREATE INDEX IF NOT EXISTS idx_runtimes_project_status
  ON agent_runtime.runtimes (project_id, status, last_seen_at DESC)
  WHERE deleted_at IS NULL;

-- Index: by identity (when /v1/wake's primary identity_id filter applies)
CREATE INDEX IF NOT EXISTS idx_runtimes_identity
  ON agent_runtime.runtimes (identity_id)
  WHERE deleted_at IS NULL AND identity_id IS NOT NULL;

-- Index: by mode (for ops dashboards — how many bridged runtimes are running?)
CREATE INDEX IF NOT EXISTS idx_runtimes_mode_status
  ON agent_runtime.runtimes (mode, status)
  WHERE deleted_at IS NULL;


-- ── Append-only event log per runtime ────────────────────────────────────
--
-- Captured for audit. The orchestrator emits these on every state change;
-- the bridge protocol emits handshake_ok / handshake_failed; the user can
-- /v1/runtimes/:id/events to see the runtime's history.

CREATE TABLE IF NOT EXISTS agent_runtime.runtime_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id    UUID NOT NULL REFERENCES agent_runtime.runtimes(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,                          -- e.g. 'provisioned', 'started', 'bridge_handshake_ok', 'think_cycle_end', 'idle', 'stopped', 'error'
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,     -- event-specific (model used, tokens, error message, ...)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runtime_events_runtime_time
  ON agent_runtime.runtime_events (runtime_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_events_type
  ON agent_runtime.runtime_events (event_type, created_at DESC);
