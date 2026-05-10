-- 20260510T180000_strand_mood_history.sql
-- Records every mood change on strand.strands so pulse can compute
-- mood_drift from real transitions. Trigger captures INSERTs (when
-- mood starts non-null) and UPDATEs (when mood or mood_encrypted
-- changes). Backfill seeds one row per existing non-null-mood strand
-- so existing agents don't start with empty drift history.
--
-- Also adds an index on (identity_id, status, last_thought_at) so the
-- new agent-scoped pulse queries hit an index instead of the existing
-- agent_id-keyed one (which is text, not uuid).

BEGIN;

CREATE TABLE strand.mood_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strand_id   uuid NOT NULL REFERENCES strand.strands(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  identity_id uuid,
  mood        text,
  encrypted   boolean NOT NULL DEFAULT false,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mood_history_identity_time
  ON strand.mood_history (identity_id, changed_at DESC)
  WHERE encrypted = false;

CREATE INDEX idx_strands_identity_status
  ON strand.strands (identity_id, status, last_thought_at);

CREATE OR REPLACE FUNCTION strand.record_mood_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.mood IS NOT NULL OR NEW.mood_encrypted THEN
      INSERT INTO strand.mood_history (strand_id, project_id, identity_id, mood, encrypted)
      VALUES (NEW.id, NEW.project_id, NEW.identity_id, NEW.mood, NEW.mood_encrypted);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.mood IS DISTINCT FROM OLD.mood
       OR NEW.mood_encrypted IS DISTINCT FROM OLD.mood_encrypted THEN
      INSERT INTO strand.mood_history (strand_id, project_id, identity_id, mood, encrypted)
      VALUES (NEW.id, NEW.project_id, NEW.identity_id, NEW.mood, NEW.mood_encrypted);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strand_mood_history_capture
AFTER INSERT OR UPDATE OF mood, mood_encrypted ON strand.strands
FOR EACH ROW EXECUTE FUNCTION strand.record_mood_change();

-- Backfill: one row per strand that already carries a mood signal.
INSERT INTO strand.mood_history (strand_id, project_id, identity_id, mood, encrypted, changed_at)
SELECT id, project_id, identity_id, mood, mood_encrypted, COALESCE(last_thought_at, updated_at)
FROM strand.strands
WHERE mood IS NOT NULL OR mood_encrypted = true;

COMMIT;
