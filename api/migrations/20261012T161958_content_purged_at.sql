-- 20261012T161958_content_purged_at.sql — mark rows whose content a delete erased in place.
--
-- Doctrine: docs/RETENTION.md · docs/DELETION-REPLAY.md
-- Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §16 (M2)
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh
--
-- Content columns stay NOT NULL. A purge writes '' (text) or an empty bytea
-- into them and sets content_purged_at; the row itself stays where something
-- else points at it (thread replies, paid witness receipts, audit names).
-- Additive and nullable: old writers that never set it keep working.

ALTER TABLE inbox.messages
  ADD COLUMN IF NOT EXISTS content_purged_at TIMESTAMPTZ;
ALTER TABLE inbox.broadcasts
  ADD COLUMN IF NOT EXISTS content_purged_at TIMESTAMPTZ;
ALTER TABLE agent_vault.vault_versions
  ADD COLUMN IF NOT EXISTS content_purged_at TIMESTAMPTZ;
ALTER TABLE agent_continuity.identity_backups
  ADD COLUMN IF NOT EXISTS content_purged_at TIMESTAMPTZ;
ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS content_purged_at TIMESTAMPTZ;

COMMENT ON COLUMN inbox.messages.content_purged_at IS
  'Set when DELETE erased ciphertext, nonce, ephemeral key, subject, refs and metadata. A purged message cannot leave status deleted.';
COMMENT ON COLUMN inbox.broadcasts.content_purged_at IS
  'Reserved for sender withdrawal (deletion spec wave 3); nothing sets it yet.';
COMMENT ON COLUMN agent_vault.vault_versions.content_purged_at IS
  'Set when the secret''s DELETE zeroed encrypted_value, iv and auth_tag (empty bytea).';
COMMENT ON COLUMN agent_continuity.identity_backups.content_purged_at IS
  'Set when DELETE erased blob_base64, nonce and metadata.';
COMMENT ON COLUMN memory.memories.content_purged_at IS
  'Set when a memory with a paid witness receipt was erased in place: content became the withdrawal marker; key, embedding and expression_patch NULL; metadata {}.';
