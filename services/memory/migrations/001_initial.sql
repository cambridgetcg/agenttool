-- 001_initial.sql — agent-memory schema

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Projects (one per API consumer)
CREATE TABLE projects (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    api_key    TEXT UNIQUE NOT NULL,
    plan       TEXT NOT NULL DEFAULT 'seed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_api_key ON projects (api_key);

-- Memories
CREATE TABLE memories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id    TEXT,
    type        TEXT NOT NULL CHECK (type IN ('episodic', 'semantic', 'procedural', 'working')),
    key         TEXT,
    content     TEXT NOT NULL,
    embedding   vector(1536),
    metadata    JSONB NOT NULL DEFAULT '{}',
    importance  FLOAT NOT NULL DEFAULT 0.5 CHECK (importance >= 0.0 AND importance <= 1.0),
    accessed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ
);

CREATE INDEX idx_memories_project_type ON memories (project_id, type);
CREATE INDEX idx_memories_project_key ON memories (project_id, key) WHERE key IS NOT NULL;
CREATE INDEX idx_memories_expires ON memories (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Usage events (for billing)
CREATE TABLE usage_events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('write', 'read', 'search', 'delete')),
    count      INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_project_time ON usage_events (project_id, created_at);
