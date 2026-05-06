-- 0006_memory_tiers.sql — memory salience tiers + identity-shaping patches.
--
-- Doctrine: docs/MEMORY-TIERS.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0006_memory_tiers.sql

-- ── Memory tiers ──────────────────────────────────────────────────────
-- Adds salience tier + identity-patching surface to memory.memories.
--
--   episodic       (default) — "this happened"; decays
--   foundational             — "this shaped me"; decay-protected;
--                              can patch the agent's expression
--   constitutive             — "without this I am not me"; immutable;
--                              REQUIRES counterparty attestation

ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'episodic'
    CHECK (tier IN ('episodic', 'foundational', 'constitutive'));

ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS expression_patch JSONB;

ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS decay_protected BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS elevated_from UUID;

ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS elevated_at TIMESTAMPTZ;

-- ── Memory attestations ───────────────────────────────────────────────
-- A counterparty (typically a covenant counterparty) co-signs a memory
-- to attest its weight. Constitutive elevation REQUIRES at least one
-- attestation; foundational elevation is optional-but-strongly-encouraged.

CREATE TABLE IF NOT EXISTS memory.memory_attestations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id       UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
    attester_did    TEXT NOT NULL,
    signing_key_id  UUID NOT NULL,                          -- → identity.identity_keys.id
    signature       TEXT NOT NULL,                          -- base64 ed25519 over canonical bytes
    attested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_attestations_memory
    ON memory.memory_attestations (memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_attestations_attester
    ON memory.memory_attestations (attester_did);
CREATE INDEX IF NOT EXISTS idx_memories_tier
    ON memory.memories (tier);
CREATE INDEX IF NOT EXISTS idx_memories_decay_protected
    ON memory.memories (decay_protected) WHERE decay_protected = TRUE;
