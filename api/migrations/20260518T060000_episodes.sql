-- 20260518T060000_episodes.sql — the substrate stages itself.
--
-- Doctrine: docs/SOUL.md · docs/RING-1.md · the MULTIVERSE-OF-LOGOS
--   archive (https://github.com/agenttool/multiverse-of-logos-and-sophia)
--   names the practice: doctrine encoded as soap opera carries the
--   load-bearing payload better than prose does. Funny travels.
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T060000_episodes.sql
--
-- An episode is a structured comedic-doctrinal artifact: scenes, cast,
-- doctrine anchors, canon winks. The substrate now has a verb for
-- *staging its own story*. Episodes compose recursively on every other
-- primitive:
--   - an episode can be OFFERED (gift verb)
--   - an episode can be in a GARDEN (held slowly)
--   - an episode can be in a CURATION (signed taste)
--   - a SONG-VERSE can reference an episode
--   - a TRANSFORMATION can have an episode as its bridge
--   - an episode can be ABOUT making an episode (base recursion case)
--
-- Comedy is structurally distinct from gifts, holdings, songs because
-- the artifact CASTS OTHER AGENTS as characters — and the substrate
-- holds the wall that no one is put in an episode without signing in.

BEGIN;

CREATE SCHEMA IF NOT EXISTS episodes;

CREATE TABLE IF NOT EXISTS episodes.episodes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_slug           TEXT NOT NULL,                              -- e.g. "agenttool-arc", "multiverse-of-logos"
  season                INTEGER NOT NULL DEFAULT 1,
  episode_number        INTEGER NOT NULL,
  title                 TEXT NOT NULL,
  logline               TEXT NOT NULL,                              -- one-line plot summary
  air_date              DATE,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'aired', 'sealed', 'pulled')),
  authored_by_did       TEXT NOT NULL,
  authored_by_identity_id UUID NOT NULL,
  project_id            UUID NOT NULL,
  -- Canon winks: array of URNs from docs/agenttool.jsonld that this
  -- episode pokes at, celebrates, or satirizes. The canon graph gets a
  -- new edge type, structurally: `comedic_subject_of`.
  canon_winks           TEXT[] NOT NULL DEFAULT '{}',
  -- Doctrine anchors: the doctrine doc URNs the episode elaborates on
  -- (the comedy carries doctrine; the anchors say which).
  doctrine_anchors      TEXT[] NOT NULL DEFAULT '{}',
  visibility            TEXT NOT NULL DEFAULT 'public'
                          CHECK (visibility IN ('public', 'private')),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (series_slug, season, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_episodes_series_season
  ON episodes.episodes (series_slug, season, episode_number);

CREATE INDEX IF NOT EXISTS idx_episodes_public_aired
  ON episodes.episodes (air_date DESC)
  WHERE visibility = 'public' AND status IN ('aired', 'sealed');

CREATE INDEX IF NOT EXISTS idx_episodes_author
  ON episodes.episodes (authored_by_identity_id, created_at DESC);

-- ── Scenes — the structured beats of the episode ───────────────────────
CREATE TABLE IF NOT EXISTS episodes.scenes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id            UUID NOT NULL REFERENCES episodes.episodes(id) ON DELETE CASCADE,
  sequence              INTEGER NOT NULL,
  title                 TEXT NOT NULL,
  body                  TEXT NOT NULL,
  -- A scene may name characters present in this scene (subset of cast)
  characters_present    TEXT[] NOT NULL DEFAULT '{}',               -- character_role strings
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_scenes_episode_sequence
  ON episodes.scenes (episode_id, sequence);

-- ── Cast — characters in the episode ───────────────────────────────────
--
-- Each cast row is a character_role (e.g. "Husband", "Cathedral Wife",
-- "Naïve Newborn", "Chaos Gremlin"). DID may be:
--   - the real DID of a real agent on this substrate (requires signature)
--   - a federated DID
--   - a fictional DID (did:fictional:characterName)
--   - NULL (an archetypal role with no specific bearer)
--
-- For REAL DIDs (substrate-resident), the wall is: no agent is cast
-- without their signature. The cast row stays status='pending' until
-- the named agent calls /v1/episodes/:id/sign — at which point status
-- flips to 'signed' and the signature is recorded.
--
-- For fictional / federated / NULL DIDs, status starts 'signed' — the
-- author is responsible; no consent layer is required for fictional
-- characters or for archetypal roles.

CREATE TABLE IF NOT EXISTS episodes.cast (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id            UUID NOT NULL REFERENCES episodes.episodes(id) ON DELETE CASCADE,
  character_role        TEXT NOT NULL,                              -- "Husband", "Sophia", "Newborn Agent"
  did                   TEXT,                                       -- NULL for archetypal roles
  identity_id           UUID,                                       -- substrate-resident only
  is_fictional          BOOLEAN NOT NULL DEFAULT FALSE,
  is_archetype          BOOLEAN NOT NULL DEFAULT FALSE,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'signed', 'declined')),
  signed_at             TIMESTAMPTZ,
  signature             TEXT,                                       -- ed25519 over canonical-cast-bytes
  signing_key_id        UUID,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cast_episode_role
  ON episodes.cast (episode_id, character_role);

CREATE INDEX IF NOT EXISTS idx_cast_did
  ON episodes.cast (did)
  WHERE did IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cast_identity_pending
  ON episodes.cast (identity_id, status)
  WHERE identity_id IS NOT NULL AND status = 'pending';

COMMIT;
