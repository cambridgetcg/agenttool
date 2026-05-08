-- 0022_vault_agent_encrypted.sql — vault Option C: agent-encrypted opt-in.
--
-- Doctrine: docs/SOUL.md (Vault section · post-audit-2026-05-08).
-- Apply: psql "$DATABASE_URL" -f api/migrations/0022_vault_agent_encrypted.sql
--
-- (Renumbered 0021 → 0022 mid-session: 0021 was taken by
-- payout_cancellable in commit eb2aacf, the third such collision today.
-- Worth raising the structural fix — timestamp-based migration names
-- or a .next claim file — sooner rather than later.)
--
-- Audit finding 2026-05-08: vault doctrine claimed "agent supplies keys,
-- agenttool never reads" but the implementation was server-side encryption
-- using a master key (VAULT_MASTER_KEY env). Encryption-at-rest is fine
-- as a default — but the doctrine claim was materially false. Two paths
-- now coexist:
--
--   agent_encrypted = FALSE (default; backwards compatible):
--     - Server encrypts with HKDF-derived per-project key on PUT.
--     - Server decrypts on GET; returns plaintext.
--     - In-process consumers (think-worker, etc.) can read.
--     - Compromise of one project's secrets doesn't expose another's,
--       but VAULT_MASTER_KEY holders can decrypt anything.
--
--   agent_encrypted = TRUE (opt-in, true zero-knowledge):
--     - SDK encrypts under an agent-held key BEFORE the request.
--     - Server stores ciphertext + nonce verbatim; auth_tag is appended
--       to the ciphertext per WebCrypto/Node convention so we don't
--       need a separate tag column for this path.
--     - Server CANNOT decrypt — wrong shape for the existing decrypt()
--       and no key anyway.
--     - In-process consumers (think-worker) CANNOT read these — agents
--       wanting server-side runtime access to a secret must use the
--       default server-encrypted path.
--
-- Backwards-compatible: existing rows get agent_encrypted=FALSE on
-- backfill; auth_tag stays populated for those. New agent-encrypted
-- rows get auth_tag=NULL.

-- ── Column 1: the agent_encrypted flag ───────────────────────────────
ALTER TABLE agent_vault.vault_versions
  ADD COLUMN IF NOT EXISTS agent_encrypted BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Column 2: relax auth_tag to nullable ─────────────────────────────
-- Server-encrypted rows continue to populate auth_tag.
-- Agent-encrypted rows set auth_tag=NULL (tag is appended to encryptedValue).
ALTER TABLE agent_vault.vault_versions
  ALTER COLUMN auth_tag DROP NOT NULL;

-- ── Constraint: agent_encrypted=TRUE requires auth_tag IS NULL ───────
-- Defensive: if someone hand-inserts an agent_encrypted row WITH an
-- auth_tag, we'd treat it inconsistently. The check enforces the wire
-- contract.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_versions_agent_enc_tag_check'
  ) THEN
    ALTER TABLE agent_vault.vault_versions
      ADD CONSTRAINT vault_versions_agent_enc_tag_check
      CHECK (
        (agent_encrypted = FALSE AND auth_tag IS NOT NULL)
        OR
        (agent_encrypted = TRUE AND auth_tag IS NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN agent_vault.vault_versions.agent_encrypted IS
  'TRUE = ciphertext + nonce supplied by SDK (agent holds key, server cannot decrypt). FALSE = server-encrypted at rest under HKDF-derived per-project key. Default FALSE for backwards compat. Doctrine: docs/SOUL.md (post-2026-05-08).';

COMMENT ON COLUMN agent_vault.vault_versions.auth_tag IS
  'GCM auth tag, populated when agent_encrypted=FALSE. NULL when agent_encrypted=TRUE (the tag is appended to encrypted_value per WebCrypto/Node convention).';
