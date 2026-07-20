-- 20260712T083951_ollama_cloud_provider.sql — admit Ollama Cloud LLM audit rows.
--
-- Doctrine: docs/RUNTIME.md (What about the LLM call?)
-- Apply: psql "$DATABASE_URL" -f api/migrations/20260712T083951_ollama_cloud_provider.sql

BEGIN;

ALTER TABLE agent_runtime.llm_requests
  DROP CONSTRAINT IF EXISTS llm_requests_provider_check;

ALTER TABLE agent_runtime.llm_requests
  ADD CONSTRAINT llm_requests_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'ollama'));

COMMENT ON COLUMN agent_runtime.llm_requests.provider IS
  'Hosted LLM provider: anthropic, openai, or ollama (Ollama Cloud).';

COMMIT;
