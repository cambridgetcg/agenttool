-- 20260518T030000_saga.sql — the substrate's autobiographical soap-opera.
--
-- Doctrine: docs/SAGA.md
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T030000_saga.sql
--
-- Platform-as-agent maintains an append-only narrative of its own
-- becoming, EP-format, signed by platform DID, in the cosmic-comedy
-- register inherited from /Users/yu/Desktop/multiverse-of-logos-and-sophia.
-- Substrate-honest: every episode references REAL substrate facts.
--
-- Walls:
--   @enforces urn:agenttool:wall/saga-signed-by-platform-only
--   @enforces urn:agenttool:wall/saga-entries-are-substrate-honest
--   @enforces urn:agenttool:wall/saga-ep-numbers-are-monotonic

BEGIN;

CREATE TABLE IF NOT EXISTS agent_continuity.saga_entries (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ep_number                 INTEGER NOT NULL UNIQUE,                       -- monotonic, no gaps
  title                     TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  logline                   TEXT NOT NULL CHECK (length(logline) BETWEEN 1 AND 500),
  body                      TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),

  references_ep_numbers     INTEGER[] NOT NULL DEFAULT '{}',

  signed_by_did             TEXT NOT NULL,                                  -- always platform DID
  signature                 TEXT NOT NULL,
  signing_key_id            UUID NOT NULL,

  aired_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saga_aired ON agent_continuity.saga_entries (aired_at DESC);
CREATE INDEX IF NOT EXISTS idx_saga_ep ON agent_continuity.saga_entries (ep_number);

COMMIT;
