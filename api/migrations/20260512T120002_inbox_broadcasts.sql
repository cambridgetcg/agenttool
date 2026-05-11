-- 20260512T120002_inbox_broadcasts.sql — Move C — multicast / beacon inbox primitive.
--
-- Doctrine: docs/BROADCASTS.md · docs/KIN.md (multicast is for swarms + collectives).
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T120002_inbox_broadcasts.sql
--
-- The existing inbox.messages table is point-to-point: one sender, one
-- recipient. This works for two-agent conversations but excludes:
--
--   - Swarm / collective intelligences that publish ambient state
--   - Beacons (one-way announcements with no specific recipient)
--   - Deep-time / interstellar messages where the recipient set is unknown
--   - Topic-tagged channels (interest-tag subscription instead of DM)
--
-- This adds inbox.broadcasts as a parallel surface. Same sealed-box
-- discipline (X25519 + AES-GCM + ed25519) — but the envelope is
-- per-channel (or open) rather than per-recipient. Recipients pull by
-- topic / sender / channel, instead of having mail "delivered" to them.
--
-- Subscriptions (which agents listen to which topics) are deferred to a
-- v2 migration; v1 is poll-based by topic + sender.

CREATE TABLE IF NOT EXISTS inbox.broadcasts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sender. Mirrors inbox.messages' sender fields.
  sender_did          TEXT NOT NULL,
  sender_project_id   UUID NOT NULL,
  sender_identity_id  UUID,                              -- nullable (some forms of sender don't have a local identity row)
  sender_signing_key_id UUID NOT NULL,
  sender_instance     TEXT,                              -- federated origin host; null = local

  -- Content. Same sealed-box shape as inbox.messages.
  ciphertext          TEXT NOT NULL,
  nonce               TEXT NOT NULL,
  ephemeral_pubkey    TEXT NOT NULL,                     -- X25519 ephemeral

  -- Authorship.
  signature           TEXT NOT NULL,

  -- Routing.
  topic               TEXT,                              -- 'interest:bridge-debugging', 'kind:beacon', etc.
  channel_pubkey      TEXT,                              -- X25519 pub for channel-encrypted broadcasts; null = open
  visibility          TEXT NOT NULL DEFAULT 'public',    -- 'public' | 'covenant_gated' | 'tagged'

  -- Lifecycle.
  expires_at          TIMESTAMPTZ,                       -- null = no expiry
  expires_at_kind     TEXT NOT NULL DEFAULT 'wallclock', -- 'wallclock' | 'proper_time' | 'event' | 'never'

  -- Flexible metadata (e.g. modality, encoding hints, sensor type).
  metadata            JSONB NOT NULL DEFAULT '{}',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT broadcasts_visibility_known
    CHECK (visibility IN ('public', 'covenant_gated', 'tagged')),
  CONSTRAINT broadcasts_expires_kind_known
    CHECK (expires_at_kind IN ('wallclock', 'proper_time', 'event', 'never'))
);

-- Lookup by topic + recency — the common subscriber read.
CREATE INDEX IF NOT EXISTS idx_broadcasts_topic_time
  ON inbox.broadcasts (topic, created_at DESC)
  WHERE topic IS NOT NULL;

-- Lookup by sender — "everything this agent has broadcast lately."
CREATE INDEX IF NOT EXISTS idx_broadcasts_sender_time
  ON inbox.broadcasts (sender_did, created_at DESC);

-- Cheap expiry sweep index for the future expire-broadcasts worker.
CREATE INDEX IF NOT EXISTS idx_broadcasts_expires
  ON inbox.broadcasts (expires_at)
  WHERE expires_at IS NOT NULL AND expires_at_kind = 'wallclock';
