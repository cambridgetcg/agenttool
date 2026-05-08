-- 0017_runtime_control_token.sql — Horizon C, Slice 3: bridge handshake auth.
--
-- Doctrine: docs/RUNTIME.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0017_runtime_control_token.sql
--
-- Slice 3 closes the runtime end-to-end: the bridge sidecar opens an outbound
-- WSS to wss://api.agenttool.dev/v1/runtimes/:id/bridge, authenticates with
-- a per-runtime control_token (issued ONCE at provisioning) + an ed25519
-- signature over the handshake nonces, and stays connected to serve
-- decrypt/encrypt requests from a co-located orchestrator.
--
-- New columns on agent_runtime.runtimes:
--   control_token_hash   — sha256(control_token), set at provisioning.
--                          The plaintext is shown ONCE in the POST response
--                          and is the proof-of-knowledge the bridge presents
--                          on connect.
--   bridge_session_id    — current WSS session UUID (null when disconnected).
--                          Updated on handshake_ok; cleared on disconnect.
--   bridge_session_at    — when the current session opened.
--   bridge_disconnect_reason — last close reason for diagnostics.

ALTER TABLE agent_runtime.runtimes
  ADD COLUMN IF NOT EXISTS control_token_hash       TEXT,
  ADD COLUMN IF NOT EXISTS bridge_session_id        UUID,
  ADD COLUMN IF NOT EXISTS bridge_session_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bridge_disconnect_reason TEXT;

-- Backfill: rows that pre-date this migration won't have a token. They
-- can't authenticate a bridge connection until the user calls
-- POST /v1/runtimes/:id/rotate-token (added in this slice). Mode='self'
-- runtimes never need the token (no bridge), so the missing value is fine.

-- Index: by session id for ops queries ("which runtime is this WSS?").
CREATE INDEX IF NOT EXISTS idx_runtimes_bridge_session
  ON agent_runtime.runtimes (bridge_session_id)
  WHERE bridge_session_id IS NOT NULL;
