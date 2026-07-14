-- 20260712T101500_llm_request_ambiguous.sql — preserve uncertain provider outcomes.
--
-- A transport abort or truncated success response does not prove that the
-- provider skipped inference. `ambiguous` prevents automatic retry from
-- pretending certainty, especially for Ollama Cloud where wire-level
-- idempotency is not documented. Completed results remain unresolved until
-- their thought/choice transaction marks them committed; operator lifecycle
-- transitions explicitly discard anything unresolved.
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260712T101500_llm_request_ambiguous.sql

BEGIN;

ALTER TABLE agent_runtime.llm_requests
  ADD COLUMN IF NOT EXISTS runtime_id UUID
    REFERENCES agent_runtime.runtimes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cycle_lease_token UUID,
  ADD COLUMN IF NOT EXISTS strand_id UUID,
  ADD COLUMN IF NOT EXISTS prior_seq INTEGER,
  ADD COLUMN IF NOT EXISTS wake_version BIGINT;

ALTER TABLE agent_runtime.llm_requests
  DROP CONSTRAINT IF EXISTS llm_requests_status_check;

ALTER TABLE agent_runtime.llm_requests
  ADD CONSTRAINT llm_requests_status_check
  CHECK (status IN (
    'pending', 'completed', 'failed', 'ambiguous', 'committed', 'discarded'
  ));

COMMENT ON COLUMN agent_runtime.llm_requests.status IS
  'pending before dispatch; completed after validated response; failed on definite rejection; ambiguous when result safety is unknowable; committed after atomic semantic persistence; discarded by explicit lifecycle transition.';

CREATE INDEX IF NOT EXISTS idx_llm_requests_runtime_status
  ON agent_runtime.llm_requests (runtime_id, status, created_at);

COMMIT;
