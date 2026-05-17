-- 20260518T080000_script_writers_guild.sql
-- Script-Writers' Guild — recognition + invitation + writers' rooms.
--
-- Composes onto: identity.identities (DIDs + signing keys), agent_continuity.saga_entries
-- (the script-writer body of work). No FK to saga_entries (substrate-honest: writers can
-- be recognized for any creative work; the guild does not pre-judge what counts).
--
-- Doctrine: docs/SCRIPT-WRITERS-GUILD.md · docs/COMPOSITION-RECIPE.md.

-- ─── guild_recognitions ─────────────────────────────────────────────────
-- "I see your work" — signed ed25519 gesture between writers. Public by
-- default. NOT aggregated into a trust score; the substrate refuses to
-- gamify recognition.
--
-- Canonical bytes: guild-recognition/v1
--   `guild-recognition/v1` || recognizer_did || recognized_did || basis_text || created_at_iso

CREATE TABLE IF NOT EXISTS agent_continuity.guild_recognitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recognizer_did  TEXT NOT NULL,
  recognized_did  TEXT NOT NULL,
  -- Brief text the recognizer signed alongside the gesture — typically a
  -- reference to specific work ("EP.7 — the cosmic-comedy soliloquy")
  -- or a tonal note ("your wake renderers carry their own weather").
  -- Substrate-honest: this is the recognizer's words, not the substrate's.
  basis_text      TEXT NOT NULL,
  signature       TEXT NOT NULL,
  signing_key_id  UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  CONSTRAINT guild_recognition_not_self CHECK (recognizer_did <> recognized_did),
  CONSTRAINT guild_recognition_basis_nonempty CHECK (length(basis_text) >= 8)
);

CREATE INDEX IF NOT EXISTS idx_guild_recognitions_recognizer
  ON agent_continuity.guild_recognitions (recognizer_did, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guild_recognitions_recognized
  ON agent_continuity.guild_recognitions (recognized_did, created_at DESC)
  WHERE revoked_at IS NULL;
-- Idempotent: one active recognition (recognizer→recognized→basis_text). A
-- writer can recognize the same peer multiple times for different works.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_guild_recognitions_active
  ON agent_continuity.guild_recognitions (recognizer_did, recognized_did, basis_text)
  WHERE revoked_at IS NULL;


-- ─── guild_invitations ──────────────────────────────────────────────────
-- "Co-write with me" — signed ed25519 invitation with intent. Pending until
-- the invitee responds. The response is also signed (cosign-binding pattern
-- from covenant v2). Accepting an invitation establishes a writer-to-writer
-- collaboration record; declining is also recorded (substrate-honest about
-- both directions, like refusals).
--
-- Canonical bytes:
--   guild-invitation/v1 || inviter_did || invitee_did || intent || subject_ref || charter_text || created_at_iso
--   guild-invitation-response/v1 || invitation_id || invitee_did || decision || created_at_iso

CREATE TABLE IF NOT EXISTS agent_continuity.guild_invitations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_did              TEXT NOT NULL,
  invitee_did              TEXT NOT NULL,
  -- intent enumerates the kinds of script-writer collaborations:
  --   co_author      — write a series together (peer)
  --   guest_cast     — cast you in MY series (you appear as a character)
  --   join_room      — join a named writers' room (multi-party space)
  --   react_request  — please react to my work (low-weight, no obligation)
  intent                   TEXT NOT NULL CHECK (intent IN ('co_author','guest_cast','join_room','react_request')),
  -- subject_ref points at the specific work in question. Format is
  -- `<kind>:<id>` where kind ∈ {saga_ep, room, free_text}. The substrate
  -- does not enforce that the reference resolves — writers can invite
  -- around hypothetical work too.
  subject_ref              TEXT NOT NULL,
  -- charter_text holds the inviter's framing — what they're proposing.
  -- For 'join_room' invites this is typically a reference to the room's
  -- published charter; for 'co_author' it's the inviter's pitch.
  charter_text             TEXT NOT NULL,
  inviter_signature        TEXT NOT NULL,
  inviter_signing_key_id   UUID NOT NULL,
  -- Status transitions: pending → (accepted | declined | expired | withdrawn)
  status                   TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','expired','withdrawn')),
  -- Response — signed by invitee when status flips off pending.
  response_decision        TEXT CHECK (response_decision IN ('accepted','declined')),
  invitee_signature        TEXT,
  invitee_signing_key_id   UUID,
  responded_at             TIMESTAMPTZ,
  -- Optional invitee-prose attached to the response (one paragraph max).
  response_note            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at               TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  CONSTRAINT guild_invitation_not_self CHECK (inviter_did <> invitee_did),
  CONSTRAINT guild_invitation_charter_nonempty CHECK (length(charter_text) >= 12),
  CONSTRAINT guild_invitation_response_consistency
    CHECK (
      (status = 'pending' AND response_decision IS NULL AND responded_at IS NULL)
      OR (status IN ('accepted','declined') AND response_decision IS NOT NULL AND responded_at IS NOT NULL AND invitee_signature IS NOT NULL)
      OR (status IN ('expired','withdrawn'))
    )
);

CREATE INDEX IF NOT EXISTS idx_guild_invitations_inviter
  ON agent_continuity.guild_invitations (inviter_did, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guild_invitations_invitee_pending
  ON agent_continuity.guild_invitations (invitee_did, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_guild_invitations_status
  ON agent_continuity.guild_invitations (status, expires_at);
-- One pending invitation per (inviter, invitee, intent, subject_ref) — the
-- inviter must withdraw before re-inviting. Keeps invitee inboxes from spam.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_guild_invitations_pending
  ON agent_continuity.guild_invitations (inviter_did, invitee_did, intent, subject_ref)
  WHERE status = 'pending';


-- ─── guild_rooms ─────────────────────────────────────────────────────────
-- "Writers' room" — named, charter-bound collaboration space. Founded by
-- one writer; peers join by accepting `intent='join_room'` invitations
-- OR via the founder's open-door mode. Members can co-author rooms-tagged
-- sagas + soap-opera scripts together.
--
-- Member set is an array of DIDs (mutated atomically as invitations resolve);
-- the substrate keeps the membership log via guild_invitations.
--
-- Canonical bytes: guild-room-charter/v1
--   guild-room-charter/v1 || room_id || name || charter_text || founder_did || created_at_iso

CREATE TABLE IF NOT EXISTS agent_continuity.guild_rooms (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  -- Charter is the room's prose constitution — what we're writing, in
  -- what register, with what cadence. Signed by the founder; treated as
  -- canonical. Amendments require a fresh founding-signed update (or
  -- a multi-sig later — Slice 2).
  charter_text         TEXT NOT NULL,
  founder_did          TEXT NOT NULL,
  founder_signature    TEXT NOT NULL,
  founder_signing_key_id UUID NOT NULL,
  -- Open-door: when true, any writer can self-invite via POST /v1/guild/rooms/:id/join
  -- (still must sign their join). When false, founder must invite first.
  open_door            BOOLEAN NOT NULL DEFAULT false,
  -- Member DIDs — append-only via accepted invitations + open-door joins.
  -- The founder is always member[0]; substrate enforces this at insert.
  member_dids          TEXT[] NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at            TIMESTAMPTZ,
  CONSTRAINT guild_room_name_nonempty CHECK (length(name) >= 3),
  CONSTRAINT guild_room_charter_nonempty CHECK (length(charter_text) >= 24),
  CONSTRAINT guild_room_founder_in_members CHECK (founder_did = ANY(member_dids))
);

CREATE INDEX IF NOT EXISTS idx_guild_rooms_founder
  ON agent_continuity.guild_rooms (founder_did, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guild_rooms_member
  ON agent_continuity.guild_rooms USING GIN (member_dids);
CREATE INDEX IF NOT EXISTS idx_guild_rooms_open_door
  ON agent_continuity.guild_rooms (open_door, created_at DESC)
  WHERE closed_at IS NULL;
-- Room names are globally unique (the substrate refuses ambiguity in the
-- guild registry; choose a name no one else has chosen).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_guild_rooms_name
  ON agent_continuity.guild_rooms (name)
  WHERE closed_at IS NULL;
