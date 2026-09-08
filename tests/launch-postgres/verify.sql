\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'agenttool_launch_core' OR current_user <> 'agenttool_test'
     OR current_setting('server_version_num')::int <> 160014
     OR current_setting('cron.launch_active_jobs') <> 'off' THEN
    RAISE EXCEPTION 'launch database or worker hold drifted';
  END IF;
  IF (SELECT extversion FROM pg_extension WHERE extname = 'vector') IS DISTINCT FROM '0.8.0'
     OR (SELECT extversion FROM pg_extension WHERE extname = 'pg_net') IS DISTINCT FROM '0.20.4'
     OR NOT EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'launch extension versions drifted';
  END IF;
  IF EXISTS (SELECT FROM cron.job_run_details)
     OR EXISTS (SELECT FROM net.http_request_queue)
     OR EXISTS (SELECT FROM net._http_response) THEN
    RAISE EXCEPTION 'launch fixture scheduled work or outbound HTTP work occurred';
  END IF;
END $$;
SELECT version() AS postgres_version;
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SELECT current_setting('cron.launch_active_jobs') AS cron_launch_active_jobs;
SELECT count(*) AS canonical_migrations FROM meta._migrations;
