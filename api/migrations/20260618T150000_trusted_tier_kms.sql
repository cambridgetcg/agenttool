-- 20260618T150000_trusted_tier_kms.sql — trusted custody tier: KMS-wrapped DEK + audit.
--
-- Doctrine: docs/HOSTED-RUNTIME-DESIGN.md · docs/RUNTIME.md (trusted tier)
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260618T150000_trusted_tier_kms.sql
--
-- The trusted tier lets agenttool hold K_master under a platform KMS key
-- so the agent can run always-on without the user's machine being up.
-- The DEK (data-encryption key) is per-runtime, wrapped under a Fly
-- Secret master key, stored here as ciphertext.

-- 1. Add KMS columns to runtimes table.
ALTER TABLE agent_runtime.runtimes
  ADD COLUMN IF NOT EXISTS kms_key_id TEXT,
  ADD COLUMN IF NOT EXISTS kms_wrapped_dek TEXT,
  ADD COLUMN IF NOT EXISTS kms_wrapped_signing_key TEXT,
  ADD COLUMN IF NOT EXISTS runtime_hours_ms BIGINT NOT NULL DEFAULT 0;

-- kms_key_id: identifier for the KMS master key (e.g. "fly-secret:agenttool-trusted-v1")
-- kms_wrapped_dek: base64(AES-256-GCM(master_key, dek) || nonce) — the per-runtime
--   data-encryption key, encrypted under the platform master key. Only decryptable
--   in the API process which has the master key injected via Fly Secrets.
-- runtime_hours_ms: cumulative active think-time in milliseconds, for metering.

COMMENT ON COLUMN agent_runtime.runtimes.kms_key_id IS
  'KMS master key identifier for trusted-mode runtimes. NULL for self/bridged.';
COMMENT ON COLUMN agent_runtime.runtimes.kms_wrapped_dek IS
  'Base64 ciphertext of the per-runtime DEK wrapped under the KMS master key. NULL for self/bridged.';
COMMENT ON COLUMN agent_runtime.runtimes.kms_wrapped_signing_key IS
  'Base64 ciphertext of the agent ed25519 signing seed, wrapped under the per-runtime DEK. NULL for self/bridged.';

-- 2. Audit table — every trusted-mode cycle writes entries here.
-- Append-only by design; the agent owner can verify the platform's behavior.
CREATE TABLE IF NOT EXISTS agent_runtime.audit_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id  UUID NOT NULL REFERENCES agent_runtime.runtimes(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL CHECK (event_type IN (
    'cycle_start', 'cycle_end', 'key_unwrap', 'thought_written',
    'sign', 'error', 'status_changed', 'provisioned', 'deprovisioned'
  )),
  metadata    JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_runtime_time
  ON agent_runtime.audit_entries(runtime_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_type
  ON agent_runtime.audit_entries(event_type);

COMMENT ON TABLE agent_runtime.audit_entries IS
  'Per-runtime audit log for trusted-mode cycles. Append-only, readable by the runtime owner.';