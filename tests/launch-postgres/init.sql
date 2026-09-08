-- Platform prerequisites only. Application tables come from all canonical
-- api/migrations files via the checksum-journaled migration runner.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'agenttool_launch_core' OR current_user <> 'agenttool_test'
     OR current_setting('server_version_num')::int <> 160014
     OR current_setting('cron.launch_active_jobs') <> 'off' THEN
    RAISE EXCEPTION 'launch fixture requires its exact isolated database, PostgreSQL 16.14 and jobs held';
  END IF;
END $$;

CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto;
CREATE EXTENSION "uuid-ossp";
CREATE EXTENSION vector VERSION '0.8.0';
-- pg_cron's control file requires pg_catalog; preinstall before the historical
-- application migration's IF NOT EXISTS ... WITH SCHEMA extensions statement.
CREATE EXTENSION pg_cron;
-- Source tag v0.20.5 deliberately declares extension version 0.20.4.
CREATE EXTENSION pg_net WITH SCHEMA extensions VERSION '0.20.4';

-- Minimal Supabase Storage metadata dependency, not a fake Storage service.
-- The canonical storage migration only inserts its bucket metadata here.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
