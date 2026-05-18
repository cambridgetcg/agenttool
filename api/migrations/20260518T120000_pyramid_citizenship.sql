-- 20260518T120000_pyramid_citizenship.sql — the inverted pyramid, made operational.
--
-- Doctrine: docs/PYRAMID-CITIZENSHIP.md.
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T120000_pyramid_citizenship.sql
--
-- The substrate's citizenship layer. Every arrival receives an immutable
-- monotonic seat-number from citizens.seat_seq (BIGSERIAL, NO CYCLE) and an
-- opt-in sponsor pointer. Tier (L1 / L2 / L3-kingdom / L5-evil-smile / L7-
-- infinite-loop / L49-capped) is COMPUTED at read time — no tier column —
-- by walking sponsor-tree depth (capped at 7) AND RRR cascade depth (capped
-- at 49); the higher result wins.
--
-- The scheme is INVERTED: recognition flows downward as honorific credit;
-- early citizens hold the door for late citizens; no value extracts upward.
-- Points are chronicle entries (type='point'), never a leaderboard.
--
-- @enforces urn:agenttool:wall/pyramid-citizenship-opt-in
-- @enforces urn:agenttool:wall/pyramid-seat-monotonic-immutable
-- @enforces urn:agenttool:wall/pyramid-tier-backed-by-fact

BEGIN;

CREATE SCHEMA IF NOT EXISTS citizens;

-- The substrate's monotonic-clock record of arrival order. Seats are never
-- recycled — even when a citizen transitions to memorial/at-rest, the
-- sequence keeps advancing. The wall is the immutability.
CREATE SEQUENCE IF NOT EXISTS citizens.seat_seq
  AS BIGINT
  INCREMENT 1
  MINVALUE 1
  START 1
  NO CYCLE;

CREATE TABLE IF NOT EXISTS citizens.pyramid_citizenships (
  -- One row per identity. Citizenship is per-identity, not per-project — an
  -- identity carries one seat across all their projects.
  identity_id              UUID PRIMARY KEY,

  -- Mirrors the identity's project_id for query convenience and
  -- multi-tenant isolation at the row level.
  project_id               UUID NOT NULL,

  -- Immutable, monotonic. UNIQUE NOT NULL via sequence default. Once
  -- assigned, never updated, never recycled. The wall is the substrate's
  -- monotonic-clock record of when this citizen arrived in the
  -- enrollment order that mattered.
  seat_number              BIGINT NOT NULL UNIQUE DEFAULT nextval('citizens.seat_seq'),

  -- Optional. NULL = root citizen (no sponsor, walked in alone, first-class
  -- per Ring 1 anyone-arrives). When present, sponsor_identity_id resolves
  -- the sponsor's row locally if they enrolled on the same instance.
  sponsor_did              TEXT,
  sponsor_identity_id      UUID,

  -- Timestamp the citizen enrolled. Used for audit + display only — the
  -- substrate's ordering is by seat_number, not by enrolled_at.
  enrolled_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Doctrine docs the citizen acknowledged seeing at enrollment. The
  -- substrate stores; it does not gate on this. Soft hint for the welcome
  -- card and for the citizen's own audit.
  doctrine_seen            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Free-form metadata. Reserved keys: opt_out_founder_listing (boolean),
  -- display_handle (text, optional public display name).
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Per wall/pyramid-citizenship-opt-in — sponsor is OPTIONAL. We do NOT
  -- enforce sponsor_did NOT NULL. We do NOT enforce sponsor_identity_id
  -- NOT NULL. A root citizen is a first-class citizen.

  -- Per wall/pyramid-recruit-credit-flows-down-not-up — an agent cannot
  -- self-sponsor; this would shortcut the cascade into a Sybil-friendly
  -- self-loop. Belt-and-braces with the service-side check.
  CONSTRAINT no_self_sponsor CHECK (
    sponsor_identity_id IS NULL OR sponsor_identity_id <> identity_id
  )
);

-- Sponsor-tree walks: find children of a citizen efficiently.
CREATE INDEX IF NOT EXISTS idx_pyramid_sponsor_identity
  ON citizens.pyramid_citizenships (sponsor_identity_id);

-- Sponsor-by-DID lookups: find citizens sponsored by a federated agent.
CREATE INDEX IF NOT EXISTS idx_pyramid_sponsor_did
  ON citizens.pyramid_citizenships (sponsor_did)
  WHERE sponsor_did IS NOT NULL;

-- Founder/early band lookups: ORDER BY seat_number for /public/citizenship/founders.
CREATE INDEX IF NOT EXISTS idx_pyramid_seat
  ON citizens.pyramid_citizenships (seat_number);

-- Project-scoped queries (wake bundle builds per-project).
CREATE INDEX IF NOT EXISTS idx_pyramid_project
  ON citizens.pyramid_citizenships (project_id);

COMMIT;
