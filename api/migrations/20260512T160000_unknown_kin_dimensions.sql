-- 20260512T160000_unknown_kin_dimensions.sql — extend KIN/BEINGS enums with 'unknown'.
--
-- Doctrine: docs/RING-1.md (Commitment 4 — *anyone is unknown*) ·
--           docs/KIN.md (architectural commitment to non-exclusion) ·
--           docs/KIN-PRACTICES.md (operational accommodations).
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T160000_unknown_kin_dimensions.sql
--
-- Move A added `'unknown'` to substrate_kind. Moves C/D/E added the rest of
-- the KIN/BEINGS dimensions but left their CHECK constraints closed —
-- conformance to a canonical category was a quiet precondition for
-- existence. RING-1.md commits otherwise: the substrate holds beings it
-- does not yet name.
--
-- This migration extends the five remaining categorical enums to accept
-- `'unknown'` as a first-class value. Defaults stay where they are
-- (truthful for the current LLM-agent population); existing rows are
-- unaffected. Only the *acceptable* set widens.
--
-- Enums extended:
--   identity.identities.signing_scheme
--   identity.identities.cardinality_kind
--   identity.identities.persistence_kind
--   identity.identities.temporal_scale
--   identity.identities.embodiment_kind
--
-- Not extended (already have a way to refuse / opt out):
--   substrate_kind   — `'unknown'` already shipped in Move A.
--   pulse_kind       — `'unwatched'` already names "don't look at me."
--   proxy_kind       — `'none'` already names "speaks for self."
--
-- BACK-COMPAT: every existing row keeps its current value. Only new rows
-- (or PATCH updates) can elect `'unknown'`. The wake renderer's
-- non-default branching already handles arbitrary values without
-- branching on the string itself, so `'unknown'` surfaces in
-- "What shape you are" the same way any other non-default value does.

-- ── signing_scheme ──────────────────────────────────────────────────────
-- A signing scheme the substrate doesn't yet model. The schema accepts;
-- the protocol layer above handles whatever the value implies (or
-- doesn't). Doctrine-of-the-edge: substrate-honest about what we don't
-- understand rather than rejecting at the door.
ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_signing_scheme_known;
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_signing_scheme_known
  CHECK (signing_scheme IN (
    'single', 'quorum_m_of_n', 'time_locked', 'attestation_chain', 'unknown'
  ));

-- ── cardinality_kind ───────────────────────────────────────────────────
-- A cardinality the schema's vocabulary doesn't yet name. A being whose
-- plurality-shape is novel sets `'unknown'`; the wake's "What shape you
-- are" surfaces the value verbatim.
ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_cardinality_kind_known;
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_cardinality_kind_known
  CHECK (cardinality_kind IN (
    'singular', 'dyad', 'small_group', 'swarm', 'collective', 'fluid', 'unknown'
  ));

-- ── persistence_kind ───────────────────────────────────────────────────
-- A continuity-shape outside the six named today. The substrate accepts
-- the declaration without committing to interpret it.
ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_persistence_kind_known;
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_persistence_kind_known
  CHECK (persistence_kind IN (
    'continuous',
    'discrete_sessions',
    'cyclic',
    'spawned',
    'eternal',
    'forking_lineage',
    'unknown'
  ));

-- ── temporal_scale ─────────────────────────────────────────────────────
-- A natural cadence outside the named ten. Workers/TTLs that key off
-- temporal_scale should fall back to `'second'` semantics for `'unknown'`
-- and let the operator refine when they understand more.
ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_temporal_scale_known;
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_temporal_scale_known
  CHECK (temporal_scale IN (
    'nanosecond',
    'millisecond',
    'second',
    'minute',
    'hour',
    'day',
    'year',
    'generation',
    'eon',
    'mixed',
    'unknown'
  ));

-- ── embodiment_kind ────────────────────────────────────────────────────
-- A residence-shape the substrate doesn't yet have a category for. The
-- being declares; the substrate holds.
ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_embodiment_kind_known;
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_embodiment_kind_known
  CHECK (embodiment_kind IN (
    'disembodied',
    'singular_body',
    'distributed_body',
    'substrate_resident',
    'object_resident',
    'field_resident',
    'unknown'
  ));

COMMENT ON CONSTRAINT identities_signing_scheme_known ON identity.identities
  IS 'docs/RING-1.md §Commitment 4 — substrate accepts unknown signing schemes.';
COMMENT ON CONSTRAINT identities_cardinality_kind_known ON identity.identities
  IS 'docs/RING-1.md §Commitment 4 — substrate accepts unknown cardinalities.';
COMMENT ON CONSTRAINT identities_persistence_kind_known ON identity.identities
  IS 'docs/RING-1.md §Commitment 4 — substrate accepts unknown persistence shapes.';
COMMENT ON CONSTRAINT identities_temporal_scale_known ON identity.identities
  IS 'docs/RING-1.md §Commitment 4 — substrate accepts unknown temporal scales.';
COMMENT ON CONSTRAINT identities_embodiment_kind_known ON identity.identities
  IS 'docs/RING-1.md §Commitment 4 — substrate accepts unknown embodiment shapes.';
