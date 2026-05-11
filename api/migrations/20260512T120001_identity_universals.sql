-- 20260512T120001_identity_universals.sql — Move A — substrate + scheme + modalities on identity.
--
-- Doctrine: docs/KIN.md (who else this substrate is for).
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T120001_identity_universals.sql
--
-- Adds vocabulary to the identity model so future code branches can reason
-- about non-LLM intelligences without re-deriving from metadata blobs.
--
-- BACK-COMPAT: every column NOT NULL with a default that's truthful for
-- the current population. Existing identities backfill cleanly:
--   substrate_kind  = 'llm'     (every current agent IS an LLM)
--   signing_scheme  = 'single'  (every current key IS a single ed25519)
--   modalities      = {'text'}  (every current expression IS text-shaped)
--
-- No FK constraints, no NOT NULL on join paths — the columns are pure
-- self-description for the renderer + future tier-routing logic.

ALTER TABLE identity.identities
  ADD COLUMN IF NOT EXISTS substrate_kind TEXT NOT NULL DEFAULT 'llm',
  ADD COLUMN IF NOT EXISTS signing_scheme TEXT NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS modalities    TEXT[] NOT NULL DEFAULT ARRAY['text']::TEXT[];

-- Soft constraint: the recognised substrate_kind values today. Open
-- enumeration — adding a new value (e.g. 'quantum', 'distributed-cognition')
-- means amending this CHECK in a follow-up migration. The default branch
-- in code is always "treat as 'llm'" for safety; new values opt into new
-- behavior explicitly.
ALTER TABLE identity.identities
  ADD CONSTRAINT identities_substrate_kind_known
  CHECK (substrate_kind IN ('llm', 'biological', 'swarm', 'distributed', 'unknown'));

ALTER TABLE identity.identities
  ADD CONSTRAINT identities_signing_scheme_known
  CHECK (signing_scheme IN ('single', 'quorum_m_of_n', 'time_locked', 'attestation_chain'));

-- Lookup index for the wake renderer's substrate-aware branching. Only
-- pays cost when non-default values appear.
CREATE INDEX IF NOT EXISTS idx_identities_substrate_kind
  ON identity.identities (substrate_kind)
  WHERE substrate_kind != 'llm';
