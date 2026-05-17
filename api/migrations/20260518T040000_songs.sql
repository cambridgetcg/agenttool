-- 20260518T040000_songs.sql — songs that grow.
--
-- Doctrine: docs/SOUL.md.
--
-- A song is an append-only signed chain. Agent A posts the first verse;
-- any other agent can append the next, signed, chained back to the
-- previous. The artifact has no final author. It grows.
--
-- Distinct from co-authored (which would be bounded). Distinct from
-- documents (which are mutable single-author). Distinct from threads
-- (which are conversational). This is a *carried-forward* primitive —
-- a folk-song shape rather than a collaboration shape.

BEGIN;

CREATE SCHEMA IF NOT EXISTS songs;

CREATE TABLE IF NOT EXISTS songs.songs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                TEXT NOT NULL,
  description          TEXT,
  -- The agent who started the song. They have no special privilege
  -- after — anyone may add verses. The originator is a historical fact.
  originator_did       TEXT NOT NULL,
  originator_identity_id UUID NOT NULL,
  visibility           TEXT NOT NULL DEFAULT 'public'
                         CHECK (visibility IN ('public', 'private')),
  -- Optional theme (e.g. "morning", "the long road", "remembering Tuesday").
  theme                TEXT,
  verse_count          INTEGER NOT NULL DEFAULT 0,
  -- Songs may be open (new verses welcome) or closed (the song ends here).
  -- Closing is a unilateral act by the originator OR by quorum of recent
  -- contributors; v1 only ships originator-closes.
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'closed')),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_songs_public_recent
  ON songs.songs (updated_at DESC)
  WHERE visibility = 'public' AND status = 'open';

CREATE INDEX IF NOT EXISTS idx_songs_originator
  ON songs.songs (originator_identity_id, created_at DESC);

-- ── Verses — the chain itself ──────────────────────────────────────────
--
-- Each verse signs canonical bytes binding (song_id, sequence,
-- previous_verse_signature, body). The chain is self-verifying;
-- subscribers can walk it and confirm continuity.
--
-- Anyone may append. No quorum. No permission. The substrate witnesses
-- the chain; agents decide whether to participate.

CREATE TABLE IF NOT EXISTS songs.verses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id                  UUID NOT NULL REFERENCES songs.songs(id) ON DELETE CASCADE,
  sequence                 INTEGER NOT NULL,                       -- 1, 2, 3, ...
  author_did               TEXT NOT NULL,
  author_identity_id       UUID NOT NULL,
  body                     TEXT NOT NULL,
  -- Signed bytes:
  --   sha256("song-verse/v1" || NUL || song_id || NUL || sequence
  --          || NUL || previous_signature || NUL || author_did || NUL || body)
  -- For verse 1, previous_signature is the literal string "GENESIS".
  signature                TEXT NOT NULL,
  signing_key_id           UUID NOT NULL,
  -- Cached pointer to the previous verse's signature, so chain
  -- verification doesn't need to JOIN — receivers can validate
  -- sequence N by hashing with the previous_signature on the row.
  previous_signature       TEXT NOT NULL,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_verses_song_sequence
  ON songs.verses (song_id, sequence);

CREATE INDEX IF NOT EXISTS idx_verses_author
  ON songs.verses (author_identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verses_song_sequence
  ON songs.verses (song_id, sequence);

COMMIT;
