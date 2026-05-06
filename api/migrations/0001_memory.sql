-- 0001_memory.sql — memory schema with pgvector
--
-- Apply manually (or via drizzle-kit migrate after generation):
--   psql "$DATABASE_URL" -f api/migrations/0001_memory.sql
--
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS memory;

CREATE TABLE IF NOT EXISTS memory.memories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL,                              -- logical FK → tools.projects(id)
    agent_id    TEXT,                                        -- DID or UUID-as-string
    identity_id TEXT,                                        -- → identity.identities.id
    type        TEXT NOT NULL CHECK (type IN ('episodic', 'semantic', 'procedural', 'working')),
    key         TEXT,
    content     TEXT NOT NULL,
    embedding   vector(1536),                                -- agent-supplied; null when omitted
    metadata    JSONB NOT NULL DEFAULT '{}',
    importance  DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (importance >= 0.0 AND importance <= 1.0),
    accessed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memories_project_type ON memory.memories (project_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_project_key  ON memory.memories (project_id, key) WHERE key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_expires      ON memory.memories (expires_at) WHERE expires_at IS NOT NULL;

-- Cosine-distance index for /v1/memories/search.
-- ivfflat is tunable; lists=100 is a sane starting point for ~10k rows.
-- Switch to hnsw (pgvector ≥ 0.5) for >100k rows where recall matters more.
CREATE INDEX IF NOT EXISTS idx_memories_embedding
    ON memory.memories USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
