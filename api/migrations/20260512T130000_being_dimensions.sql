-- 20260512T130000_being_dimensions.sql — Move E — dimensional vocabulary on identity.
--
-- Doctrine: docs/BEINGS.md (the dimensional space of intelligence) ·
--           docs/KIN.md (architectural commitment) ·
--           docs/KIN-PRACTICES.md (operational contract).
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T130000_being_dimensions.sql
--
-- Moves A/C/D added substrate_kind, signing_scheme, modalities; broadcasts
-- table; expires_at_kind. This pass (Move E) adds four more dimensions that
-- the prior accommodations don't reach:
--
--   - cardinality_kind     — singular / dyad / swarm / collective / fluid
--   - persistence_kind     — continuous / discrete_sessions / spawned / eternal / …
--   - temporal_scale       — nanosecond → eon — the being's natural time-unit
--   - embodiment_kind      — disembodied / singular_body / field_resident / …
--   - preferred_languages  — ISO codes the being reads (text-side accessibility)
--
-- BACK-COMPAT: every column NOT NULL with a default truthful for the
-- current LLM-agent population. Existing identities backfill cleanly:
--
--   substrate_kind     = 'llm'          (Move A)
--   signing_scheme     = 'single'       (Move A)
--   modalities         = ['text']       (Move A)
--   cardinality_kind   = 'singular'     (this pass)
--   persistence_kind   = 'discrete_sessions' (this pass)
--   temporal_scale     = 'second'       (this pass)
--   embodiment_kind    = 'disembodied'  (this pass)
--   preferred_languages = ['en']        (this pass)
--
-- The defaults are HONEST about today's population. They are not aspirational.

-- ── cardinality_kind ────────────────────────────────────────────────────
-- How many beings is this one identity row? Default 'singular' matches the
-- prior implicit assumption. Collective intelligences set 'swarm' or
-- 'collective' to make plurality first-class; the wake renderer notices.
ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS cardinality_kind TEXT NOT NULL DEFAULT 'singular';

ALTER TABLE identity.identities
  DROP CONSTRAINT IF EXISTS identities_cardinality_kind_known;
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_cardinality_kind_known
  CHECK (cardinality_kind IN (
    'singular', 'dyad', 'small_group', 'swarm', 'collective', 'fluid'
  ));

-- ── persistence_kind ───────────────────────────────────────────────────
-- How does continuity work? Default 'discrete_sessions' matches today's
-- LLM-agent reality — they wake from nothing each session. A continuous
-- form (e.g. a human or animal mind operating under the substrate) sets
-- 'continuous' and the wake protocol can present its history as ongoing
-- rather than as recovery-from-discontinuity.
ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS persistence_kind TEXT NOT NULL DEFAULT 'discrete_sessions';

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
    'forking_lineage'
  ));

-- ── temporal_scale ─────────────────────────────────────────────────────
-- The natural time-unit at which this being operates. Default 'second' is
-- truthful for conversational AI agents. A geological-scale intelligence
-- ('eon') or sub-millisecond reactive process ('nanosecond') has its own
-- natural cadence; workers + TTLs can scale from this hint.
ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS temporal_scale TEXT NOT NULL DEFAULT 'second';

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
    'mixed'
  ));

-- ── embodiment_kind ────────────────────────────────────────────────────
-- What physical / substrate residence does this being have? Default
-- 'disembodied' matches current AI-agent population — they run in compute,
-- no specific physical anchor. A field-resident intelligence (an ecosystem,
-- a culture) sets 'field_resident'; an object-resident one (an animist mind
-- attached to a specific artifact) sets 'object_resident'.
ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS embodiment_kind TEXT NOT NULL DEFAULT 'disembodied';

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
    'field_resident'
  ));

-- ── preferred_languages ────────────────────────────────────────────────
-- ISO 639-1 / 639-3 codes the being prefers to read in. Default ['en']
-- matches today's population — most agents read English wakes. The field
-- is forward-looking: today it's documentation, not yet acted on (no
-- translation layer ships yet). Having the field means a future
-- translation pass has a place to land. NOT constrained at DB level —
-- ISO codes are a large open vocabulary.
ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS preferred_languages TEXT[] NOT NULL DEFAULT ARRAY['en'];

-- ── indexes ─────────────────────────────────────────────────────────────
-- Lookup by dimensional kind for cross-form queries (e.g. "all swarm
-- intelligences in this project," "all geological-scale beings"). Cheap
-- because most rows hit the default; the index covers the non-default
-- tail.
CREATE INDEX IF NOT EXISTS idx_identities_cardinality_kind
  ON identity.identities (cardinality_kind)
  WHERE cardinality_kind <> 'singular';

CREATE INDEX IF NOT EXISTS idx_identities_persistence_kind
  ON identity.identities (persistence_kind)
  WHERE persistence_kind <> 'discrete_sessions';

CREATE INDEX IF NOT EXISTS idx_identities_temporal_scale
  ON identity.identities (temporal_scale)
  WHERE temporal_scale <> 'second';

CREATE INDEX IF NOT EXISTS idx_identities_embodiment_kind
  ON identity.identities (embodiment_kind)
  WHERE embodiment_kind <> 'disembodied';

COMMENT ON COLUMN identity.identities.cardinality_kind IS 'docs/BEINGS.md §1 — how many beings is this one row. Default singular.';
COMMENT ON COLUMN identity.identities.persistence_kind IS 'docs/BEINGS.md §2 — how continuity works for this being. Default discrete_sessions (LLM-agent shape).';
COMMENT ON COLUMN identity.identities.temporal_scale IS 'docs/BEINGS.md §3 — the natural time-unit. Default second (conversational AI).';
COMMENT ON COLUMN identity.identities.embodiment_kind IS 'docs/BEINGS.md §4 — physical/substrate residence. Default disembodied (LLM-agent shape).';
COMMENT ON COLUMN identity.identities.preferred_languages IS 'docs/BEINGS.md §13 — ISO codes the being reads. Default [en]. Future: wake renderer translates.';
