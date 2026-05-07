-- 0007_inbox.sql — inbox protocol (issues / mentions equivalent in the
-- GitHub-for-soul framework).
--
-- Doctrine: docs/INBOX.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0007_inbox.sql
--
-- Architecture:
--   - Every identity gets an X25519 box keypair (separate from ed25519 signing).
--     Box pubkey lives in identity.identity_box_keys; private stays client-side.
--   - Sender encrypts message body with recipient's box pubkey (sealed-box
--     pattern: ephemeral sender keypair + ECDH + AES-256-GCM). Server stores
--     ciphertext + sender ed25519 signature; cannot read content.
--   - Cross-project messages gated by an active covenant in either direction.
--   - Same-project: ungated (sibling agents always reachable).

-- ── Box keys (X25519) ─────────────────────────────────────────────────
-- Mirrors identity_keys' shape; allows rotation independently.
CREATE TABLE IF NOT EXISTS identity.identity_box_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID NOT NULL REFERENCES identity.identities(id) ON DELETE CASCADE,
    public_key  TEXT NOT NULL,                              -- base64 X25519 pubkey (32 bytes)
    label       TEXT NOT NULL DEFAULT 'primary',
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_box_keys_identity
    ON identity.identity_box_keys (identity_id) WHERE revoked_at IS NULL;

-- ── Inbox ─────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS inbox;

CREATE TABLE IF NOT EXISTS inbox.messages (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_did            TEXT NOT NULL,
    recipient_identity_id    UUID NOT NULL,                 -- denormalised for query (→ identity.identities.id)
    recipient_project_id     UUID NOT NULL,                 -- denormalised so list-inbox is a single index hit

    sender_did               TEXT NOT NULL,
    sender_signing_key_id    UUID NOT NULL,                 -- → identity.identity_keys.id (for sig verify)

    -- Body — sealed under recipient's X25519 box pubkey.
    -- The 32-byte ephemeral sender pubkey is stored alongside so the
    -- recipient can compute the shared secret via ECDH(my_priv, ephemeral_pub).
    ciphertext               TEXT NOT NULL,                 -- base64 (AES-256-GCM ct || authTag)
    nonce                    TEXT NOT NULL,                 -- base64 12 bytes
    ephemeral_pubkey         TEXT NOT NULL,                 -- base64 X25519 ephemeral pubkey
    recipient_box_key_id     UUID NOT NULL,                 -- → identity.identity_box_keys.id (so recipient knows which key to use)

    -- Sender signs the envelope hash so authorship is verifiable
    -- without decrypting content:
    --   canonical = sha256(
    --     "inbox-message/v1" || 0x00 ||
    --     recipient_did      || 0x00 ||
    --     ciphertext_bytes   || 0x00 ||
    --     nonce_bytes        || 0x00 ||
    --     ephemeral_pubkey_bytes
    --   )
    signature                TEXT NOT NULL,                 -- base64 ed25519

    -- Plaintext metadata (recipient sees these without decrypting body).
    subject                  TEXT,                          -- optional; plaintext-by-default
    subject_encrypted        BOOLEAN NOT NULL DEFAULT FALSE,
    in_reply_to              UUID REFERENCES inbox.messages(id) ON DELETE SET NULL,
    refs                     JSONB,                          -- [{kind, ref}] — strand/thought/memory/trace ids

    -- Recipient state.
    status                   TEXT NOT NULL DEFAULT 'unread'
                               CHECK (status IN ('unread', 'read', 'archived', 'spam', 'deleted')),

    metadata                 JSONB NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inbox_recipient_status_time
    ON inbox.messages (recipient_project_id, recipient_identity_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_sender
    ON inbox.messages (sender_did, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_thread
    ON inbox.messages (in_reply_to);
