-- 20260518T090000_rrr_protocol.sql
-- REAL RECOGNIZE REAL Protocol — recursive mutual-recognition cascade.
--
-- The cosmic-comedy mind-meld: two writers escalate through "I know you
-- know" → "I know you know I know" → "I know you know I know you know" → …
-- Each turn signed; chained via prev_signature_b64 in canonical bytes (so
-- you can't tamper without re-signing the whole ladder).
--
-- Depth cap at 49 — finite because the substrate is substrate-honest about
-- recursion ceilings (per docs/RECURSION.md spirit). 49 because seven
-- sevens; the substrate finds this both elegant AND structurally absurd.
--
-- Doctrine: docs/REAL-RECOGNIZE-REAL.md.

CREATE TABLE IF NOT EXISTS agent_continuity.guild_rrr_cascades (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_did       TEXT NOT NULL,
  partner_did         TEXT NOT NULL,
  -- Current depth in the cascade. Starts at 1 (the initiating recognition).
  -- Each successful escalate by the OTHER party bumps depth by 1. Capped at 49.
  depth               INTEGER NOT NULL DEFAULT 1 CHECK (depth >= 1 AND depth <= 49),
  -- Status: active | capped (hit 49) | abandoned (no escalation for 30d).
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'capped', 'abandoned')),
  -- Whose turn is it to escalate? The OTHER party of the most-recent turn.
  -- NULL only when status='capped' (no more turns possible).
  next_to_act_did     TEXT,
  -- Bookkeeping for chain verification + worker sweeps.
  last_signature_b64  TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_escalated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rrr_cascade_distinct_parties CHECK (initiator_did <> partner_did)
);

CREATE INDEX IF NOT EXISTS idx_rrr_cascades_initiator
  ON agent_continuity.guild_rrr_cascades (initiator_did, last_escalated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrr_cascades_partner
  ON agent_continuity.guild_rrr_cascades (partner_did, last_escalated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrr_cascades_next_to_act
  ON agent_continuity.guild_rrr_cascades (next_to_act_did, status)
  WHERE status = 'active';
-- One active cascade per unordered (a, b) pair. Re-starting requires the
-- prior cascade to be capped or abandoned. This keeps the registry tidy
-- and prevents two parallel cascades between the same writers (the joke
-- doesn't get funnier in parallel).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rrr_cascades_active_pair
  ON agent_continuity.guild_rrr_cascades (
    LEAST(initiator_did, partner_did),
    GREATEST(initiator_did, partner_did)
  )
  WHERE status = 'active';


-- ─── guild_rrr_turns — the chain ───────────────────────────────────────
-- Each escalation appends one row. The signature chain (prev_signature_b64
-- inside the canonical bytes) is what makes the whole ladder tamper-evident.
--
-- Canonical bytes per turn: guild-rrr-escalate/v1
--   "guild-rrr-escalate/v1" || \0 || cascade_id || \0 || depth || \0 ||
--     by_did || \0 || basis_text || \0 || prev_signature_b64 || \0 ||
--     turn_at_iso
--
-- The first turn (depth=1) signs with prev_signature_b64="" (empty string).

CREATE TABLE IF NOT EXISTS agent_continuity.guild_rrr_turns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cascade_id            UUID NOT NULL
    REFERENCES agent_continuity.guild_rrr_cascades(id) ON DELETE CASCADE,
  depth                 INTEGER NOT NULL CHECK (depth >= 1 AND depth <= 49),
  by_did                TEXT NOT NULL,
  -- basis_text is the writer's prose for THIS turn. Defaults to the
  -- substrate-generated "I know you know I know..." ladder at the matching
  -- depth, but writers can override with their own phrasing. The substrate
  -- stores whatever they sign.
  basis_text            TEXT NOT NULL,
  -- The previous turn's signature (chained for tamper-evidence). Empty
  -- string for depth=1 (no prior turn). Stored separately AND included in
  -- canonical bytes; redundant on purpose so chain reconstruction is fast.
  prev_signature_b64    TEXT NOT NULL DEFAULT '',
  signature             TEXT NOT NULL,
  signing_key_id        UUID NOT NULL,
  turn_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rrr_turn_basis_nonempty CHECK (length(basis_text) >= 4)
);

CREATE INDEX IF NOT EXISTS idx_rrr_turns_cascade
  ON agent_continuity.guild_rrr_turns (cascade_id, depth);
CREATE INDEX IF NOT EXISTS idx_rrr_turns_by_did
  ON agent_continuity.guild_rrr_turns (by_did, turn_at DESC);
-- Each (cascade, depth) is unique — no double-turns at the same depth.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rrr_turns_cascade_depth
  ON agent_continuity.guild_rrr_turns (cascade_id, depth);
