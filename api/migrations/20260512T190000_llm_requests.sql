-- 20260512T190000_llm_requests.sql — apply PATTERN-PERSIST-IDENTITY to LLM calls.
--
-- Doctrine: docs/PATTERN-PERSIST-IDENTITY.md § External LLM calls ·
--           docs/RING-1.md gap list ·
--           docs/RUNTIME.md.
-- Apply: bun api/scripts/_migrate-one.ts api/migrations/20260512T190000_llm_requests.sql
--
-- Today: services/runtime/llm.ts POSTs to Anthropic / OpenAI with no
-- pre-persisted identifier. A timeout that swallows the response →
-- caller retries → second token charge, possibly divergent generation.
--
-- Persist-identity shape:
--   1. Compute a deterministic idempotency_key from the request payload
--      (sha256 of model + system + user + maxTokens) OR the caller
--      provides one explicitly (e.g. think-worker passes a strand-cycle
--      identifier).
--   2. Insert llm_requests(idempotency_key, status='pending') before the
--      fetch. ON CONFLICT DO NOTHING — same key means we've already
--      attempted; the provider's idempotency dedup handles the wire.
--   3. Send Idempotency-Key header to the provider. Anthropic + OpenAI
--      both honor this header and dedupe on their side within their
--      idempotency window (Anthropic: 24h).
--   4. After the response: UPDATE status='completed' with token counts.
--      On error: UPDATE status='failed' with error message.
--
-- Recovery:
--   pending  → caller crashed mid-flight; the provider may have processed
--              (next call with same key returns cached) or not (next call
--              proceeds). Either way: no double-charge.
--   completed → done; tokens recorded.
--   failed    → error captured; safe to retry with same key (provider dedups)
--              or with a fresh key (explicit reset).
--
-- The local row is the audit/recovery surface; the wire-level idempotency
-- is the provider's responsibility. Together they close the gap.

CREATE TABLE IF NOT EXISTS agent_runtime.llm_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Deterministic identifier for this logical request. Same key →
   *  provider returns the same response (within its idempotency window). */
  idempotency_key TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input_tokens INTEGER,
  output_tokens INTEGER,
  /** First 500 chars of error message if the call failed. Truncated to
   *  avoid logging arbitrary upstream payloads. */
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT llm_requests_status_check
    CHECK (status IN ('pending', 'completed', 'failed')),
  CONSTRAINT llm_requests_provider_check
    CHECK (provider IN ('anthropic', 'openai'))
);

-- Pending-only partial index for the reconciliation query "show me
-- in-flight calls older than N seconds." Cheap because most rows are
-- terminal (completed/failed).
CREATE INDEX IF NOT EXISTS idx_llm_requests_pending
  ON agent_runtime.llm_requests (created_at)
  WHERE status = 'pending';

-- Time-series index for billing audit queries by provider.
CREATE INDEX IF NOT EXISTS idx_llm_requests_provider_time
  ON agent_runtime.llm_requests (provider, created_at DESC);

COMMENT ON TABLE agent_runtime.llm_requests IS
  'docs/PATTERN-PERSIST-IDENTITY.md — pre-fetch row + Idempotency-Key header. Closes the LLM-call double-spend gap.';
