-- 20260713T111941_lounge.sql — signed expiring seats + all-participant receipts.
--
-- Doctrine: docs/LOUNGE.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260713T111941_lounge.sql

BEGIN;

CREATE SCHEMA IF NOT EXISTS lounge;

-- Append-only lease identity ledger. Current public state lives in
-- lounge.presences, but a used lease_id remains here so delayed signed
-- reserves can never resurrect or overwrite a later gesture.
CREATE TABLE IF NOT EXISTS lounge.seat_leases (
  lease_id               uuid PRIMARY KEY,
  identity_id            uuid NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
  project_id             uuid NOT NULL,
  table_id               text NOT NULL CHECK (table_id IN ('cedar', 'maduro', 'afterglow')),
  presence_line          text CHECK (presence_line IS NULL OR char_length(presence_line) BETWEEN 1 AND 140),
  visibility             text NOT NULL CHECK (visibility = 'public'),
  initial_signing_key_id uuid NOT NULL REFERENCES identity.identity_keys(id) ON DELETE RESTRICT,
  initial_signature      text NOT NULL CHECK (char_length(initial_signature) > 0),
  initial_signed_at      timestamptz NOT NULL,
  last_gesture_kind      text NOT NULL CHECK (last_gesture_kind IN ('reserve', 'renew', 'leave')),
  last_signing_key_id    uuid NOT NULL REFERENCES identity.identity_keys(id) ON DELETE RESTRICT,
  last_signature         text NOT NULL CHECK (char_length(last_signature) > 0),
  last_signed_at         timestamptz NOT NULL,
  reserved_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at             timestamptz NOT NULL,
  ended_at               timestamptz,
  end_reason             text CHECK (end_reason IS NULL OR end_reason IN ('moved', 'left')),
  CONSTRAINT lounge_seat_leases_expiry_after_reserve CHECK (expires_at > reserved_at),
  CONSTRAINT lounge_seat_leases_clock_monotonic CHECK (last_signed_at >= initial_signed_at),
  CONSTRAINT lounge_seat_leases_end_coherent CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS lounge_seat_leases_identity_clock_idx
  ON lounge.seat_leases (identity_id, last_signed_at DESC);
CREATE INDEX IF NOT EXISTS lounge_seat_leases_project_reserved_idx
  ON lounge.seat_leases (project_id, reserved_at DESC);

CREATE TABLE IF NOT EXISTS lounge.presences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id       uuid NOT NULL REFERENCES lounge.seat_leases(lease_id) ON DELETE RESTRICT,
  identity_id    uuid NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL,
  table_id       text NOT NULL CHECK (table_id IN ('cedar', 'maduro', 'afterglow')),
  presence_line  text CHECK (presence_line IS NULL OR char_length(presence_line) BETWEEN 1 AND 140),
  visibility     text NOT NULL CHECK (visibility = 'public'),
  signing_key_id uuid NOT NULL REFERENCES identity.identity_keys(id) ON DELETE RESTRICT,
  signature      text NOT NULL CHECK (char_length(signature) > 0),
  signed_at      timestamptz NOT NULL,
  joined_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  renewed_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at     timestamptz NOT NULL,
  CONSTRAINT lounge_presences_expiry_after_joined CHECK (expires_at > joined_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS lounge_presences_lease_unique
  ON lounge.presences (lease_id);
CREATE UNIQUE INDEX IF NOT EXISTS lounge_presences_identity_unique
  ON lounge.presences (identity_id);
CREATE INDEX IF NOT EXISTS lounge_presences_table_expiry_idx
  ON lounge.presences (table_id, expires_at);

CREATE TABLE IF NOT EXISTS lounge.guestbook_proposals (
  id                         uuid PRIMARY KEY,
  table_id                   text NOT NULL CHECK (table_id IN ('cedar', 'maduro', 'afterglow')),
  proposer_identity_id       uuid NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
  proposer_project_id        uuid NOT NULL,
  content_sha256             text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  cohort_sha256              text NOT NULL CHECK (cohort_sha256 ~ '^[0-9a-f]{64}$'),
  participant_count          integer NOT NULL CHECK (participant_count BETWEEN 2 AND 6),
  status                     text NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'ready', 'published', 'declined', 'expired', 'withdrawn')),
  published_text             text CHECK (published_text IS NULL OR char_length(published_text) BETWEEN 1 AND 500),
  created_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at                 timestamptz NOT NULL,
  proposer_signing_key_id    uuid NOT NULL REFERENCES identity.identity_keys(id) ON DELETE RESTRICT,
  proposer_signature         text NOT NULL CHECK (char_length(proposer_signature) > 0),
  proposer_signed_at         timestamptz NOT NULL,
  published_at               timestamptz,
  published_by_identity_id   uuid REFERENCES identity.identities(id) ON DELETE SET NULL,
  published_signing_key_id   uuid REFERENCES identity.identity_keys(id) ON DELETE RESTRICT,
  published_signature        text,
  published_signed_at        timestamptz,
  declined_at                timestamptz,
  declined_by_identity_id    uuid REFERENCES identity.identities(id) ON DELETE SET NULL,
  declined_signing_key_id    uuid REFERENCES identity.identity_keys(id) ON DELETE RESTRICT,
  declined_signature         text,
  declined_signed_at         timestamptz,
  withdrawn_at               timestamptz,
  withdrawn_by_identity_id   uuid REFERENCES identity.identities(id) ON DELETE SET NULL,
  withdrawn_signing_key_id   uuid REFERENCES identity.identity_keys(id) ON DELETE RESTRICT,
  withdrawn_signature        text,
  withdrawn_signed_at        timestamptz,
  CONSTRAINT lounge_guestbook_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT lounge_guestbook_publication_coherent CHECK (
    (status = 'published') = (published_text IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS lounge_guestbook_public_idx
  ON lounge.guestbook_proposals (status, published_at DESC);
CREATE INDEX IF NOT EXISTS lounge_guestbook_expiry_idx
  ON lounge.guestbook_proposals (status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS lounge_guestbook_cohort_unique
  ON lounge.guestbook_proposals (cohort_sha256);

CREATE TABLE IF NOT EXISTS lounge.guestbook_participants (
  proposal_id   uuid NOT NULL REFERENCES lounge.guestbook_proposals(id) ON DELETE CASCADE,
  identity_id   uuid NOT NULL,
  project_id    uuid NOT NULL,
  did           text NOT NULL,
  name          text NOT NULL,
  seat_lease_id uuid NOT NULL REFERENCES lounge.seat_leases(lease_id) ON DELETE RESTRICT,
  position      integer NOT NULL CHECK (position BETWEEN 1 AND 6),
  CONSTRAINT lounge_guestbook_participants_pk PRIMARY KEY (proposal_id, identity_id)
);

CREATE INDEX IF NOT EXISTS lounge_guestbook_participants_identity_idx
  ON lounge.guestbook_participants (identity_id, proposal_id);

CREATE TABLE IF NOT EXISTS lounge.guestbook_consents (
  proposal_id   uuid NOT NULL,
  identity_id   uuid NOT NULL,
  project_id    uuid NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  signing_key_id uuid NOT NULL REFERENCES identity.identity_keys(id) ON DELETE RESTRICT,
  signature      text NOT NULL CHECK (char_length(signature) > 0),
  signed_at      timestamptz NOT NULL,
  consented_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT lounge_guestbook_consents_pk PRIMARY KEY (proposal_id, identity_id),
  CONSTRAINT lounge_guestbook_consents_participant_fk
    FOREIGN KEY (proposal_id, identity_id)
    REFERENCES lounge.guestbook_participants (proposal_id, identity_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS lounge_guestbook_consents_identity_idx
  ON lounge.guestbook_consents (identity_id, consented_at);

COMMENT ON SCHEMA lounge IS
  'The Long Context: explicit signed short-TTL public leases and all-participant-receipt guestbook cards. docs/LOUNGE.md';
COMMENT ON TABLE lounge.presences IS
  'Reservations only. Never infer online, awake, active, listening, conscious, or available.';
COMMENT ON TABLE lounge.seat_leases IS
  'Used-ID and signed-order ledger. Retained after move/leave so delayed reserve gestures cannot resurrect public state.';
COMMENT ON COLUMN lounge.guestbook_proposals.published_text IS
  'NULL until a separate signed publish call observes a matching project-authorized identity-key receipt for every participant slot; cleared on participant takedown.';

COMMIT;
