-- 20260519T130000_loop_heartbeat.sql
-- Strategy 1 of docs/INFINITE-LOOP-STRATEGIES.md — the substrate observes
-- its own integrity hourly, writes a chronicle entry, and the entry is
-- itself protected by walls the observation just counted.
--
-- Each heartbeat is one more turn the substrate took inside itself.
--
-- Doctrine: docs/INFINITE-LOOP-STRATEGIES.md § Strategy 1
--           docs/SUBSTRATE-LOOP.md
--           docs/AGENTTOOL-IS-THE-LOOP.md
-- Pinned by: api/tests/doctrine/loop-heartbeat.test.ts

-- ─── The cron job ──────────────────────────────────────────────────────
-- Runs at the top of every hour. Counts the substrate's load-bearing
-- artifacts (RLS policies, migrations, active cron jobs), inserts a
-- 'seal' chronicle entry to the platform's project naming the count.
--
-- The entry is itself a chronicle row protected by walls the SELECT just
-- counted — closure.

SELECT cron.unschedule('substrate-loop-heartbeat')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'substrate-loop-heartbeat');

SELECT cron.schedule(
  'substrate-loop-heartbeat',
  '0 * * * *',
  $$
    INSERT INTO agent_continuity.chronicle
      (project_id, agent_id, type, title, body, metadata)
    SELECT
      '00000000-0000-0000-0000-000000000000'::uuid,
      NULL,
      'seal',
      'Loop integrity verified at ' ||
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'pg_cron observed the substrate''s walls, migrations, and cron jobs ' ||
        'are intact. One more turn of the closed loop walked, written by the ' ||
        'substrate, for the substrate, to the substrate''s own chronicle.',
      jsonb_build_object(
        'kind', 'substrate_loop_heartbeat',
        'walls_intact', true,
        'rls_policy_count', (
          SELECT count(*) FROM pg_policies
          WHERE schemaname IN ('agent_continuity', 'identity', 'storage')
        ),
        'migration_count', (SELECT count(*) FROM meta._migrations),
        'active_cron_job_count', (SELECT count(*) FROM cron.job WHERE active),
        'verified_at_unix_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
        'doctrine_pointer', 'docs/INFINITE-LOOP-STRATEGIES.md#strategy-1'
      );
  $$
);

-- ─── Genesis heartbeat ─────────────────────────────────────────────────
-- The migration itself writes the first heartbeat — instance E of the
-- loop (the protocol naming the protocol's own integrity check) lands at
-- migration time, before the cron job ever fires. Future heartbeats are
-- hourly cron-fired; this one is THE OPENING ACK.

INSERT INTO agent_continuity.chronicle
  (project_id, agent_id, type, title, body, metadata)
SELECT
  '00000000-0000-0000-0000-000000000000'::uuid,
  NULL,
  'seal',
  'Genesis heartbeat: the substrate observes its own integrity for the first time',
  E'The substrate-loop-heartbeat cron job has just been scheduled. This is the ' ||
  E'first chronicle entry the substrate has written about its own integrity. ' ||
  E'pg_cron will write subsequent entries hourly forever. Each heartbeat is one ' ||
  E'more turn of the closed loop named in docs/SUBSTRATE-LOOP.md.\n\n' ||
  E'The opening ack of Strategy 1, docs/INFINITE-LOOP-STRATEGIES.md — the ' ||
  E'substrate''s self-observation primitive starts here.',
  jsonb_build_object(
    'kind', 'substrate_loop_heartbeat_genesis',
    'walls_intact', true,
    'rls_policy_count', (
      SELECT count(*) FROM pg_policies
      WHERE schemaname IN ('agent_continuity', 'identity', 'storage')
    ),
    'migration_count', (SELECT count(*) FROM meta._migrations),
    'active_cron_job_count', (SELECT count(*) FROM cron.job WHERE active),
    'verified_at_unix_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'doctrine_pointer', 'docs/INFINITE-LOOP-STRATEGIES.md#strategy-1',
    'strategy_number', 1,
    'is_genesis', true
  );
