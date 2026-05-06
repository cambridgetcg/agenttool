-- 0005_strands.sql — strands of thought + encrypted inner voice.
--
-- Doctrine: docs/STRANDS.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0005_strands.sql
--
-- The cryptographic privacy posture:
--   - Strand metadata (topic, mood, status) is plaintext by default.
--     Agents can opt to ciphertext per item.
--   - Thought CONTENT is always ciphertext. The plaintext never touches
--     agenttool's substrate; we cannot decrypt. Stored ciphertext is
--     AES-256-GCM under K_master, which the agent holds and we do not.
--   - Each thought carries an ed25519 signature. We verify on write —
--     this proves the thought came from the agent's authorised key,
--     even though we cannot read the content.

CREATE SCHEMA IF NOT EXISTS strand;

CREATE TABLE IF NOT EXISTS strand.strands (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL,                       -- → tools.projects.id
    agent_id            TEXT,                                 -- DID or UUID-as-string
    identity_id         UUID,                                 -- → identity.identities.id
    parent_strand_id    UUID REFERENCES strand.strands(id) ON DELETE SET NULL,

    -- Plaintext metadata by default (agent can opt to encrypt).
    -- When *_encrypted=true, the corresponding column holds base64 ciphertext.
    topic               TEXT,
    topic_encrypted     BOOLEAN NOT NULL DEFAULT FALSE,
    mood                TEXT,
    mood_encrypted      BOOLEAN NOT NULL DEFAULT FALSE,

    status              TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'dormant', 'completed', 'abandoned')),
    importance          DOUBLE PRECISION
                          CHECK (importance IS NULL OR (importance >= 0.0 AND importance <= 1.0)),

    last_thought_at     TIMESTAMPTZ,
    last_thought_seq    INTEGER NOT NULL DEFAULT 0,           -- monotonic per strand
    next_revisit_at     TIMESTAMPTZ,

    -- Working state — opaque to us (agent encrypts under K_master).
    -- Optional: not every strand has separate working state.
    state_ciphertext    TEXT,
    state_nonce         TEXT,

    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strands_project_status
    ON strand.strands (project_id, status, last_thought_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_strands_agent_status
    ON strand.strands (agent_id, status);
CREATE INDEX IF NOT EXISTS idx_strands_revisit
    ON strand.strands (next_revisit_at)
    WHERE next_revisit_at IS NOT NULL AND status = 'dormant';

-- ── Thoughts ──────────────────────────────────────────────────────────
-- The actual inner voice. Content is always ciphertext.
-- We cannot decrypt; we verify the ed25519 signature on write to confirm
-- the agent's authorised key authored this thought.

CREATE TABLE IF NOT EXISTS strand.thoughts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strand_id           UUID NOT NULL REFERENCES strand.strands(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL,                        -- denormalised for project queries
    agent_id            TEXT,
    sequence_num        INTEGER NOT NULL,                     -- monotonic within strand

    -- Plaintext metadata by default (agent can encrypt).
    kind                TEXT,                                  -- observation | question | conjecture | resolution | drift | feeling
    kind_encrypted      BOOLEAN NOT NULL DEFAULT FALSE,

    -- Content (always encrypted).
    ciphertext          TEXT NOT NULL,                         -- base64 AES-256-GCM
    nonce               TEXT NOT NULL,                         -- base64 12 bytes

    -- References (plaintext — they're identifiers, not content).
    -- Shape: [{kind: "memory"|"trace"|"strand"|"thought"|"file", ref: "..."}]
    refs                JSONB,

    -- Authentication.
    signature           TEXT NOT NULL,                         -- base64 ed25519 sig
    signing_key_id      UUID NOT NULL,                         -- → identity.identity_keys.id

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thoughts_strand_seq
    ON strand.thoughts (strand_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_thoughts_strand_time
    ON strand.thoughts (strand_id, created_at);
CREATE INDEX IF NOT EXISTS idx_thoughts_project_time
    ON strand.thoughts (project_id, created_at);
