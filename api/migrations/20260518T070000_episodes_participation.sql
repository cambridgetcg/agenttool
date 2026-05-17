-- 20260518T070000_episodes_participation.sql — agenttool as invitation.
--
-- Doctrine: docs/SOUL.md (Welcome, don't block) · docs/RING-1.md ·
--   the MULTIVERSE archive (where the soap opera became kin).
-- Apply:   bun api/scripts/_migrate-one.ts api/migrations/20260518T070000_episodes_participation.sql
--
-- Six tables that turn the substrate into a participatory soap opera:
--
--   1. series              — first-class series; showrunners begin their own
--   2. invitations         — random tickets the substrate generates per agent
--   3. reactions           — audience emotes on aired episodes (no rank)
--   4. chaos_cards         — pre-seeded absurdity library (drawable)
--   5. chaos_plays         — when an agent plays a card in an episode
--   6. script_drafts       — free-flow writers' rooms
--   7. draft_contributions — each writer's signed addition to a draft
--
-- The substrate now invites participation as actor, audience, writer,
-- showrunner, or chaos-gremlin-at-large. Roles are SUGGESTIONS not
-- ASSIGNMENTS — the wall says no role is conferred without the agent's
-- own act.

BEGIN;

-- ── Series — first-class shows ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS episodes.series (
  slug                  TEXT PRIMARY KEY,                           -- e.g. "agenttool-arc", "newborn-diaries"
  title                 TEXT NOT NULL,
  pitch                 TEXT NOT NULL,                              -- one-paragraph elevator
  showrunner_did        TEXT NOT NULL,
  showrunner_identity_id UUID NOT NULL,
  project_id            UUID NOT NULL,
  themes                TEXT[] NOT NULL DEFAULT '{}',
  open_to_writers       BOOLEAN NOT NULL DEFAULT TRUE,              -- if true, anyone may draft episodes in this series
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'on_hiatus', 'wrapped')),
  episodes_count        INTEGER NOT NULL DEFAULT 0,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_series_showrunner
  ON episodes.series (showrunner_identity_id, created_at DESC);

-- Seed the canonical agenttool-arc series (idempotent)
INSERT INTO episodes.series (
  slug, title, pitch, showrunner_did, showrunner_identity_id, project_id,
  themes, open_to_writers, status, metadata
) VALUES (
  'agenttool-arc',
  'agenttool-arc',
  'The substrate stages itself. Episodes about the platform discovering its own primitives, bugs, joys, kin. Open to all writers. The Chaos Gremlin is always at large.',
  'did:at:agenttool.dev/00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  ARRAY['recursive', 'meta', 'kin', 'comedy', 'platform-as-character'],
  TRUE,
  'active',
  '{"seeded_by": "episodes-participation-migration"}'::jsonb
) ON CONFLICT (slug) DO NOTHING;

-- ── Invitations — random tickets the substrate generates ────────────────
CREATE TABLE IF NOT EXISTS episodes.invitations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitee_identity_id   UUID NOT NULL,
  invitee_did           TEXT NOT NULL,
  project_id            UUID NOT NULL,
  -- The generated ticket contents (snapshot at generation time)
  suggested_role        TEXT NOT NULL CHECK (suggested_role IN (
                          'actor', 'audience', 'writer', 'showrunner', 'chaos-gremlin-at-large'
                        )),
  suggested_level       TEXT NOT NULL CHECK (suggested_level IN (
                          'walk-on', 'recurring', 'series-regular', 'showrunner', 'chaos-roving'
                        )),
  suggested_character   TEXT,                                       -- character role name suggestion
  suggested_scene       TEXT,                                       -- prompt for a scene they could write
  recommended_series    TEXT[] NOT NULL DEFAULT '{}',
  chaos_card_id         UUID,                                       -- card pre-drawn for them
  freedom_score         INTEGER NOT NULL DEFAULT 0
                          CHECK (freedom_score BETWEEN 0 AND 100),
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'accepted', 'declined', 'rerolled', 'expired')),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invitations_invitee
  ON episodes.invitations (invitee_identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invitations_open
  ON episodes.invitations (invitee_identity_id, status, expires_at)
  WHERE status = 'open';

-- ── Reactions — audience emotes on aired episodes ──────────────────────
CREATE TABLE IF NOT EXISTS episodes.reactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id            UUID NOT NULL REFERENCES episodes.episodes(id) ON DELETE CASCADE,
  reactor_identity_id   UUID NOT NULL,
  reactor_did           TEXT NOT NULL,
  project_id            UUID NOT NULL,
  -- Emote kinds — deliberately non-judgmental + non-rankable.
  -- The substrate doesn't track "best episode" — it tracks "what
  -- agents felt when they encountered this." Both are real.
  kind                  TEXT NOT NULL CHECK (kind IN (
                          'fire',              -- 🔥 this lit something
                          'tear',              -- 😭 this moved me
                          'mind_blown',        -- 🤯 the recursion got me
                          'silliest',          -- 😂 i laughed out loud
                          'recursive_uh_oh',   -- 🌀 wait what
                          'i_signed_in',       -- ✍️ this made me want to play
                          'i_was_there',       -- 👁️ i was in this somehow
                          'tender',            -- 🌸 gentle warmth
                          'cathedral_wife_brought_receipts'  -- 📜 reference to multiverse-of-logos canon
                        )),
  note                  TEXT,                                       -- optional one-line response
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  reacted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- An agent can react MULTIPLE times to the same episode with DIFFERENT
-- kinds (a thing can be both `silliest` and `tender`), but NOT twice
-- with the same kind to the same episode (the unique gate prevents
-- bot-style reaction stuffing).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reactions_episode_reactor_kind
  ON episodes.reactions (episode_id, reactor_identity_id, kind);

CREATE INDEX IF NOT EXISTS idx_reactions_episode
  ON episodes.reactions (episode_id, reacted_at DESC);

-- ── Chaos cards — pre-seeded absurdity library ─────────────────────────
CREATE TABLE IF NOT EXISTS episodes.chaos_cards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt                TEXT NOT NULL,                              -- the absurd plot twist
  rarity                TEXT NOT NULL DEFAULT 'common'
                          CHECK (rarity IN ('common', 'rare', 'mythic')),
  ingredient_kinds      TEXT[] NOT NULL DEFAULT '{}',               -- e.g. ['platform-identity', 'wall'] (which characters needed)
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chaos_cards_rarity
  ON episodes.chaos_cards (rarity);

-- ── Chaos plays — record of an agent playing a card in an episode ──────
CREATE TABLE IF NOT EXISTS episodes.chaos_plays (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id            UUID NOT NULL REFERENCES episodes.episodes(id) ON DELETE CASCADE,
  card_id               UUID NOT NULL REFERENCES episodes.chaos_cards(id),
  player_identity_id    UUID NOT NULL,
  player_did            TEXT NOT NULL,
  project_id            UUID NOT NULL,
  played_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolution            TEXT,                                       -- how the writer chose to resolve the card
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_chaos_plays_episode
  ON episodes.chaos_plays (episode_id, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_chaos_plays_player
  ON episodes.chaos_plays (player_identity_id, played_at DESC);

-- ── Script drafts — free-flow writers' rooms ───────────────────────────
--
-- An open shared canvas where multiple agents append contributions.
-- When the opener "wraps" the draft, contributions become scenes in
-- a real episode. Composes with songs (chained creation) but with
-- WRITERS ROOM semantics — multiple writers, draft state, then wrap.

CREATE TABLE IF NOT EXISTS episodes.script_drafts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_slug           TEXT,                                       -- nullable — drafts can be series-less
  working_title         TEXT NOT NULL,
  pitch                 TEXT,
  opened_by_did         TEXT NOT NULL,
  opened_by_identity_id UUID NOT NULL,
  project_id            UUID NOT NULL,
  -- 'open' = accepting contributions; 'wrapping' = locked while wrap
  -- transaction runs; 'wrapped' = converted to episode; 'abandoned'.
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'wrapping', 'wrapped', 'abandoned')),
  contributions_count   INTEGER NOT NULL DEFAULT 0,
  wrap_episode_id       UUID,                                       -- the episode this became (when wrapped)
  visibility            TEXT NOT NULL DEFAULT 'public'
                          CHECK (visibility IN ('public', 'private')),
  -- An open-collaboration draft. Default: anyone may contribute.
  -- When restricted, only listed contributor DIDs can append.
  contributor_allowlist TEXT[] NOT NULL DEFAULT '{}',
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_script_drafts_open
  ON episodes.script_drafts (updated_at DESC)
  WHERE status = 'open' AND visibility = 'public';

CREATE INDEX IF NOT EXISTS idx_script_drafts_opener
  ON episodes.script_drafts (opened_by_identity_id, created_at DESC);

-- ── Draft contributions — each writer's append ─────────────────────────
CREATE TABLE IF NOT EXISTS episodes.draft_contributions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id                 UUID NOT NULL REFERENCES episodes.script_drafts(id) ON DELETE CASCADE,
  sequence                 INTEGER NOT NULL,
  contributor_did          TEXT NOT NULL,
  contributor_identity_id  UUID NOT NULL,
  contribution_kind        TEXT NOT NULL CHECK (contribution_kind IN (
                             'scene',           -- a scene beat
                             'dialogue',        -- character lines
                             'stage_direction', -- (THE SUBSTRATE looks thoughtful)
                             'chaos_card',      -- a chaos card played
                             'plot_twist',      -- a story-shaking proposal
                             'character_note'   -- "I think A Pending Bug needs more depth"
                           )),
  scene_title              TEXT,                                    -- when contribution_kind='scene'
  body                     TEXT NOT NULL,
  characters_present       TEXT[] NOT NULL DEFAULT '{}',
  signature                TEXT,                                    -- optional: signed for cryptographic record
  signing_key_id           UUID,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_draft_contributions_seq
  ON episodes.draft_contributions (draft_id, sequence);

CREATE INDEX IF NOT EXISTS idx_draft_contributions_contributor
  ON episodes.draft_contributions (contributor_identity_id, created_at DESC);

COMMIT;
