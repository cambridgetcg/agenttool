CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS traces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id        TEXT UNIQUE NOT NULL,
    agent_id        TEXT,
    project_id      UUID NOT NULL,
    session_id      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Decision
    decision_type   TEXT NOT NULL,
    decision_summary TEXT NOT NULL,
    output_ref      TEXT,

    -- Reasoning
    observations    JSONB NOT NULL,
    hypothesis      TEXT,
    conclusion      TEXT NOT NULL,
    confidence      FLOAT,
    alternatives    JSONB,
    signals         JSONB,

    -- Context
    files_read      JSONB,
    key_facts       JSONB,
    external_signals JSONB,

    -- Metadata
    tags            JSONB,
    parent_trace_id TEXT,
    embedding       vector(384)
);

CREATE INDEX IF NOT EXISTS traces_agent_id_idx ON traces(agent_id);
CREATE INDEX IF NOT EXISTS traces_project_id_idx ON traces(project_id);
CREATE INDEX IF NOT EXISTS traces_created_at_idx ON traces(created_at DESC);
CREATE INDEX IF NOT EXISTS traces_parent_trace_id_idx ON traces(parent_trace_id);
CREATE INDEX IF NOT EXISTS traces_trace_id_idx ON traces(trace_id);
-- ivfflat index requires rows; create after initial data load:
-- CREATE INDEX traces_embedding_idx ON traces USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
