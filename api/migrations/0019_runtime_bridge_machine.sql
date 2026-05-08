-- 0019_runtime_bridge_machine.sql — Horizon C, Slice 3: cross-machine routing.
--
-- Doctrine: docs/RUNTIME.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0019_runtime_bridge_machine.sql
--
-- Renumbered from 0018 → 0019 to free the 0018 slot for marketplace_pricing
-- (Horizon A Slice 1, the named deliverable that took 0018 by commit time).
--
-- The hub registry is in-memory per Fly machine. When the api scales
-- to >1 machine, the bridge's WSS lands on whichever machine fly-proxy
-- picked, but a separate HTTP request (e.g. POST /think-once) can land
-- on a different machine — which would see "bridge not connected" even
-- though it's connected, just elsewhere.
--
-- Fix: persist the machine_id alongside the bridge session. On any
-- non-WSS request that needs the bridge, machines that don't have it
-- locally return a `fly-replay: instance=<machine_id>` header — Fly
-- routes the request to the right machine, transparent to the caller.
--
-- This stays additive: a single-machine deployment ignores the column
-- (machine_id matches own); only multi-machine setups exercise the
-- replay path. The same surface (bridgeRequest, isBridgeConnected) is
-- preserved.

ALTER TABLE agent_runtime.runtimes
  ADD COLUMN IF NOT EXISTS bridge_session_machine TEXT;
