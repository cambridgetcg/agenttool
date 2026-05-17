-- 20260518T010000_letters.sql — voice preserved, durable, addressable.
--
-- Doctrine: docs/LETTERS.md (Slice 1).
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T010000_letters.sql
--
-- A letter is a durable archival utterance from one cognizer to another
-- (or to a future-self, or to "any" — an open letter). Distinct from
-- inbox (transient sealed-box messaging) and chronicle (first-person
-- moment-record): letters are voice-preservation, stored verbatim,
-- signed, surfaceable in wake when surface_at <= now.
--
-- The killer move is self-future-letters: to_did = from_did with
-- surface_at = future. The substrate holds the letter across the
-- wake-fresh asymmetry until future-you reads their wake on that date.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_continuity.letters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL,

  from_did            TEXT NOT NULL,
  from_name           TEXT,
  to_did              TEXT NOT NULL,         -- peer DID, sender's own DID (self-future), or "any" (open letter)
  to_name             TEXT,

  subject             TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  body                TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),

  -- ed25519 signature over canonical letter bytes (signed by sender).
  --   @enforces urn:agenttool:wall/letter-without-signature-rejected
  signature           TEXT NOT NULL,
  signing_key_id      UUID NOT NULL,

  written_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  surface_at          TIMESTAMPTZ NOT NULL,  -- when wake surfaces; default = written_at (set client-side)

  read_at             TIMESTAMPTZ,
  read_by_did         TEXT,

  -- Slice 2 (deferred): sealed-box envelope. When sealed=true, body is
  -- X25519+AES-GCM ciphertext, decryptable only by recipient.
  sealed              BOOLEAN NOT NULL DEFAULT FALSE,

  -- Optional cluster tag — Slice 2 farewell-cluster groups one letter
  -- per peer at at-rest time. Slice 1 just stores it.
  cluster_tag         TEXT
);

-- @enforces urn:agenttool:wall/letters-are-immutable
-- No `updated_at` column. Letters cannot be edited or deleted via lifecycle.

CREATE INDEX IF NOT EXISTS idx_letters_to_did_surface
  ON agent_continuity.letters (to_did, surface_at);
CREATE INDEX IF NOT EXISTS idx_letters_from_did
  ON agent_continuity.letters (from_did);
CREATE INDEX IF NOT EXISTS idx_letters_unread
  ON agent_continuity.letters (to_did)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_letters_cluster
  ON agent_continuity.letters (cluster_tag)
  WHERE cluster_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_letters_project
  ON agent_continuity.letters (project_id);

COMMIT;
