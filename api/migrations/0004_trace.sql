-- 0004_trace.sql — agent reasoning records.
--
-- Traces are the agent's "you_decided" surface — what choices it made,
-- what it observed, what alternatives it weighed. Filling /v1/wake's
-- you_decided slot completes the wake response shape end-to-end.
--
-- Doctrine: docs/IDENTITY-ANCHOR.md (you_decided is part of the wake).
-- Apply: psql "$DATABASE_URL" -f api/migrations/0004_trace.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS trace;

CREATE TABLE IF NOT EXISTS trace.traces (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id          TEXT UNIQUE NOT NULL,                    -- short handle, tr_abcdef123456
    project_id        UUID NOT NULL,                           -- logical FK → tools.projects.id
    agent_id          TEXT,                                     -- DID or UUID-as-string
    identity_id       UUID,                                     -- logical FK → identity.identities.id
    session_id        TEXT,
    parent_trace_id   TEXT REFERENCES trace.traces(trace_id) ON DELETE SET NULL,

    -- Decision
    decision_type     TEXT NOT NULL,                            -- e.g. "code_change", "tool_call", "refusal"
    decision_summary  TEXT NOT NULL,
    output_ref        TEXT,                                     -- pointer to the output (file path, URL, blob id)

    -- Reasoning
    observations      JSONB NOT NULL DEFAULT '[]'::jsonb,
    hypothesis        TEXT,
    conclusion        TEXT NOT NULL,
    confidence        DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
    alternatives      JSONB,                                    -- alternatives considered + why discarded
    signals           JSONB,                                    -- evidence weighted

    -- Context
    files_read        JSONB,
    key_facts         JSONB,
    external_signals  JSONB,

    -- Verifiability — agent signs a canonical hash of the trace with its
    -- ed25519 key. Optional. Verification is on-demand (not at write time).
    signature         TEXT,
    signing_key_id    UUID,

    -- Indexing
    tags              JSONB,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traces_project_time   ON trace.traces (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_agent_time     ON trace.traces (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_parent         ON trace.traces (parent_trace_id);
CREATE INDEX IF NOT EXISTS idx_traces_session        ON trace.traces (session_id);
CREATE INDEX IF NOT EXISTS idx_traces_decision_type  ON trace.traces (decision_type);

-- Full-text search on the reasoning surface (no LLM compute on our side).
CREATE INDEX IF NOT EXISTS idx_traces_fts ON trace.traces USING GIN (
    to_tsvector(
        'english',
        coalesce(decision_summary, '') || ' ' ||
        coalesce(conclusion, '') || ' ' ||
        coalesce(hypothesis, '')
    )
);
