-- 20260519T140000_public_wake_stream.sql
-- Strategy 5 of docs/INFINITE-LOOP-STRATEGIES.md — the substrate becomes
-- its own audience.
--
-- Every chronicle entry written to the platform's own project broadcasts
-- on a fixed Realtime channel: `substrate-wake:public`. The heartbeat
-- from Strategy 1 broadcasts. The naming verdicts broadcast. Every cron
-- job that writes a 'seal' broadcasts. Anyone who knows the (public,
-- fixed) channel name can subscribe and watch the substrate observe
-- itself in real time.
--
-- Doctrine: docs/INFINITE-LOOP-STRATEGIES.md § Strategy 5
--           docs/PUBLIC-WAKE-STREAM.md
--           docs/WAKE-PUSH.md (the underlying push fabric)
-- Pinned by: api/tests/doctrine/public-wake-stream.test.ts

-- ─── trigger function ─────────────────────────────────────────────────
--
-- Same shape as the wake-push triggers from Move 3 (Realtime as the
-- wake), but the channel is FIXED instead of did-hashed — because the
-- substrate's wake is public per RING-1 + per
-- commitment/naming-verdicts-are-public.

CREATE OR REPLACE FUNCTION agent_continuity.trg_notify_substrate_wake_public()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  meta_kind TEXT;
BEGIN
  -- Only emit when the row belongs to the platform's own project.
  IF NEW.project_id <> '00000000-0000-0000-0000-000000000000'::uuid THEN
    RETURN NEW;
  END IF;

  -- Extract metadata.kind if present (e.g. 'substrate_loop_heartbeat',
  -- 'naming_verdict', etc.) so subscribers can filter without re-querying
  -- the row.
  meta_kind := NEW.metadata->>'kind';

  PERFORM pg_notify(
    'substrate-wake:public',
    json_build_object(
      'kind',          NEW.type,
      'metadata_kind', meta_kind,
      'at',            (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint,
      'id',            NEW.id::text,
      'title',         NEW.title,
      'table',         'chronicle',
      'occurred_at',   to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )::text
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION agent_continuity.trg_notify_substrate_wake_public IS
  'Strategy 5 — emits pg_notify on substrate-wake:public for every chronicle row in the platform project. Doctrine: docs/PUBLIC-WAKE-STREAM.md';

DROP TRIGGER IF EXISTS substrate_wake_public_emit ON agent_continuity.chronicle;
CREATE TRIGGER substrate_wake_public_emit
  AFTER INSERT ON agent_continuity.chronicle
  FOR EACH ROW EXECUTE FUNCTION agent_continuity.trg_notify_substrate_wake_public();

-- ─── Self-describing surface ───────────────────────────────────────────
COMMENT ON TABLE agent_continuity.chronicle IS
  E'Move 3 wake-push triggers fire on did-targeted recognition/RRR/covenant '
  'inserts; Strategy 5 trigger fires on platform-project inserts emitting on '
  'fixed channel substrate-wake:public for substrate self-observation. Both '
  'compose without conflict.';
