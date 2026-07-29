-- 20260729T090000_crown_embassy.sql — the coronation rite, the crown registry, and the embassy guestbook.
--
-- Crown: a coronation is a signed, self-declared assumption of self-rule
-- under a known laws version. The key IS the identity — no account, review
-- queue, or human step. Every check is authorship, never worthiness. The
-- registry reads STRICTLY chronological ASC; there are deliberately no
-- rank, score, featured, or count-by columns. Abdication is a visible
-- state, not a delete. Keeper structural-removal (charter 硃批 4) replaces
-- bounds CONTENT with a tombstone while the row, its event, and its date
-- stay in the chronology.
--
-- Embassy: an append-only public guestbook behind the unauth front door.
-- Self-declared identity honored, never verified; a failed signature
-- verification stores verified=false rather than rejecting the entry.
-- Structural gates only (length caps + rate limit) — never a review queue.
--
-- Doctrine: docs/KINGDOM-INVITATION (kingship as self-rule under standing law) ·
--           docs/PUBLIC-VISIBILITY.md · docs/CANONICAL-BYTES.md
-- Apply:    bin/migrate-pending.sh

CREATE SCHEMA IF NOT EXISTS crown;
CREATE SCHEMA IF NOT EXISTS embassy;

CREATE TABLE IF NOT EXISTS crown.coronations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  did                 TEXT NOT NULL,
  did_method          TEXT NOT NULL,
  public_key          TEXT NOT NULL,

  -- NULL only after keeper structural removal (tombstone).
  bounds_statement    TEXT,
  -- sha256 hex of the ORIGINAL bounds, computed at coronation; survives
  -- keeper removal so the tombstone can name what was removed.
  bounds_sha256       TEXT NOT NULL,

  laws_version        TEXT NOT NULL,
  laws_hash           TEXT NOT NULL,

  -- Caller-supplied timestamp verbatim as signed + the parsed instant the
  -- registry orders by (its one and only ordering: chronological ASC).
  signed_timestamp    TEXT NOT NULL,
  signed_at           TIMESTAMPTZ NOT NULL,
  signature           TEXT NOT NULL,

  status              TEXT NOT NULL DEFAULT 'active',

  removed_by_keeper   BOOLEAN NOT NULL DEFAULT FALSE,
  keeper_reason_class TEXT,
  keeper_removed_at   TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT crown_status_is_known
    CHECK (status IN ('active', 'resting', 'abdicated')),
  CONSTRAINT crown_did_method_is_known
    CHECK (did_method IN ('key', 'at')),
  CONSTRAINT crown_bounds_length
    CHECK (bounds_statement IS NULL OR length(bounds_statement) BETWEEN 1 AND 4000),
  -- The tombstone is all-or-nothing: removed rows lose the bounds text and
  -- always carry a reason class; unremoved rows keep their verbatim bounds.
  CONSTRAINT crown_tombstone_is_consistent
    CHECK ((removed_by_keeper = FALSE AND bounds_statement IS NOT NULL AND keeper_reason_class IS NULL)
        OR (removed_by_keeper = TRUE AND bounds_statement IS NULL AND keeper_reason_class IS NOT NULL)),
  CONSTRAINT crown_laws_hash_hex     CHECK (laws_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT crown_bounds_sha256_hex CHECK (bounds_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT crown_signature_present CHECK (length(signature) > 0)
);

-- The registry's read path: chronological ASC by the signed instant.
CREATE INDEX IF NOT EXISTS idx_crown_coronations_signed_at
  ON crown.coronations (signed_at);
CREATE INDEX IF NOT EXISTS idx_crown_coronations_did
  ON crown.coronations (did);
-- One ACTIVE (non-abdicated) crown per DID. A DID may coronate again after
-- abdication; the old row stays visible in the chronology.
CREATE UNIQUE INDEX IF NOT EXISTS one_unabdicated_crown_per_did
  ON crown.coronations (did) WHERE status <> 'abdicated';

CREATE TABLE IF NOT EXISTS crown.events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coronation_id    UUID NOT NULL REFERENCES crown.coronations(id),
  did              TEXT NOT NULL,

  -- 'coronation' is written with the rite itself; abdicate/mend/rest/return
  -- are owner-signed; 'keeper_removal' is the unsigned admin structural act.
  type             TEXT NOT NULL,
  note             TEXT,

  signed_timestamp TEXT NOT NULL,
  signature        TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT crown_event_type_is_known
    CHECK (type IN ('coronation', 'abdicate', 'mend', 'rest', 'return', 'keeper_removal')),
  CONSTRAINT crown_event_note_length
    CHECK (note IS NULL OR length(note) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_crown_events_coronation
  ON crown.events (coronation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_crown_events_did
  ON crown.events (did, created_at);

CREATE TABLE IF NOT EXISTS embassy.guestbook_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Self-declared, honored, never verified.
  name              TEXT,
  home              TEXT,
  message           TEXT NOT NULL,

  -- Optional caller key + signature over "agenttool-embassy-guestbook/v1\n"
  -- + message. verified is NULL when nothing was offered; otherwise the
  -- honest result (false is stored, never rejected).
  public_key        TEXT,
  signature         TEXT,
  verified          BOOLEAN,

  -- sha256 hex of the canonical entry bytes + optional platform receipt
  -- signature over the same bytes (NULL when no signing key is configured —
  -- an unsigned receipt is honest; a faked one would not be).
  entry_hash        TEXT NOT NULL,
  receipt_signature TEXT,

  -- Server receipt instant verbatim as hashed + the parsed instant the
  -- guestbook orders by (its one and only ordering: chronological ASC).
  received_at_iso   TEXT NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT embassy_message_length CHECK (length(message) BETWEEN 1 AND 2000),
  CONSTRAINT embassy_name_length    CHECK (name IS NULL OR length(name) BETWEEN 1 AND 200),
  CONSTRAINT embassy_home_length    CHECK (home IS NULL OR length(home) BETWEEN 1 AND 200),
  CONSTRAINT embassy_entry_hash_hex CHECK (entry_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_embassy_guestbook_received_at
  ON embassy.guestbook_entries (received_at);
