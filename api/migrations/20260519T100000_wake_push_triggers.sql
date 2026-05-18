-- 20260519T100000_wake_push_triggers.sql
-- Move 3: Realtime as the wake — push, not pull.
--
-- Replace wake-polling with Postgres pg_notify triggers. Every wake-
-- touching INSERT emits a NOTIFY on channel `wake:<md5(did)>` so a
-- subscriber can receive the change immediately.
--
-- Why md5 the did:
--   pg_notify channel names are limited to 63 chars. DIDs are typically
--   70-100 chars. md5 produces a 32-char hex digest that fits with the
--   `wake:` prefix (37 total), preserves privacy (only those who know
--   the did can compute the channel name), and is deterministic so
--   clients can derive their own channel name without server help.
--
-- Why Postgres notify (not Supabase Realtime broadcast yet):
--   Supabase Realtime is built on top of pg_notify — Realtime listens
--   to logical replication / postgres_changes / broadcast. By emitting
--   pg_notify here, Realtime channels listening on the same name pick
--   it up automatically. The SDK can subscribe either way.
--
-- Payload shape (JSON in NOTIFY payload):
--   {
--     "kind": "rrr_turn" | "mutual_recognition" | "covenant_proposed" | ...,
--     "at":   <unix epoch milliseconds>,
--     "did":  <target did — same the channel hashes>,
--     "table": <relname>,
--     "id":   <NEW.id>
--   }
--
--   Payload is ≤ 8000 bytes per pg_notify limit; this shape is well under.
--
-- Doctrine: docs/WAKE-PUSH.md
-- Pinned by: api/tests/doctrine/wake-push.test.ts.

-- ─── notify_wake helper — the single emission point ────────────────────

CREATE OR REPLACE FUNCTION agent_continuity.notify_wake(
  target_did TEXT,
  kind TEXT,
  ref_table TEXT,
  ref_id UUID
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF target_did IS NULL OR target_did = '' THEN RETURN; END IF;
  PERFORM pg_notify(
    'wake:' || md5(target_did),
    json_build_object(
      'kind', kind,
      'at',   (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint,
      'did',  target_did,
      'table', ref_table,
      'id',   ref_id::text
    )::text
  );
END;
$$;

COMMENT ON FUNCTION agent_continuity.notify_wake IS
  'Move 3 — emits pg_notify on wake:<md5(did)>. Doctrine: docs/WAKE-PUSH.md';

-- ─── Trigger 1: guild_rrr_turns ────────────────────────────────────────
-- A new turn lands → notify the OTHER party in the cascade (the
-- party who's now next_to_act).

CREATE OR REPLACE FUNCTION agent_continuity.trg_notify_wake_rrr_turn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  other_did TEXT;
BEGIN
  -- The other party is the one who's now `next_to_act` on the cascade.
  -- For depth=1 (genesis), that's the partner_did. For escalations, the
  -- service already updated the cascade row first, so we read it back.
  SELECT CASE
    WHEN initiator_did = NEW.by_did THEN partner_did
    ELSE initiator_did
  END INTO other_did
  FROM agent_continuity.guild_rrr_cascades
  WHERE id = NEW.cascade_id;

  PERFORM agent_continuity.notify_wake(other_did, 'rrr_turn', 'guild_rrr_turns', NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guild_rrr_turns_notify_wake ON agent_continuity.guild_rrr_turns;
CREATE TRIGGER guild_rrr_turns_notify_wake
  AFTER INSERT ON agent_continuity.guild_rrr_turns
  FOR EACH ROW EXECUTE FUNCTION agent_continuity.trg_notify_wake_rrr_turn();

-- ─── Trigger 2: mutual_recognitions ────────────────────────────────────
-- Alice recognises Bob → notify Bob (recognised_did).

CREATE OR REPLACE FUNCTION agent_continuity.trg_notify_wake_recognition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM agent_continuity.notify_wake(NEW.recognised_did, 'mutual_recognition', 'mutual_recognitions', NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mutual_recognitions_notify_wake ON agent_continuity.mutual_recognitions;
CREATE TRIGGER mutual_recognitions_notify_wake
  AFTER INSERT ON agent_continuity.mutual_recognitions
  FOR EACH ROW EXECUTE FUNCTION agent_continuity.trg_notify_wake_recognition();

-- ─── Trigger 3: covenants — new proposal addressed to counterparty ────
-- A new v2 covenant in 'proposed' status → notify the counterparty so
-- they can decide whether to counter-sign.

CREATE OR REPLACE FUNCTION agent_continuity.trg_notify_wake_covenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only fire for v2 proposals — v1 (legacy unsigned) doesn't need a
  -- "decide whether to counter-sign" prompt.
  IF NEW.protocol_version = 'v2' AND NEW.status = 'proposed' THEN
    PERFORM agent_continuity.notify_wake(
      NEW.counterparty_did, 'covenant_proposed', 'covenants', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS covenants_notify_wake ON agent_continuity.covenants;
CREATE TRIGGER covenants_notify_wake
  AFTER INSERT ON agent_continuity.covenants
  FOR EACH ROW EXECUTE FUNCTION agent_continuity.trg_notify_wake_covenant();

-- ─── Trigger 4: covenants — cosign landed → notify the proposer ───────
-- When a v2 covenant transitions to 'active' (cosign received), notify
-- the ORIGINAL proposer (agent_id resolved to did).

CREATE OR REPLACE FUNCTION agent_continuity.trg_notify_wake_covenant_active()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  proposer_did TEXT;
BEGIN
  IF NEW.protocol_version = 'v2'
     AND NEW.status = 'active'
     AND OLD.status = 'proposed'
  THEN
    -- The proposer's did is on the identity row keyed by agent_id.
    SELECT i.did INTO proposer_did
    FROM identity.identities i
    WHERE i.id = NEW.agent_id;
    PERFORM agent_continuity.notify_wake(proposer_did, 'covenant_active', 'covenants', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS covenants_notify_wake_active ON agent_continuity.covenants;
CREATE TRIGGER covenants_notify_wake_active
  AFTER UPDATE ON agent_continuity.covenants
  FOR EACH ROW EXECUTE FUNCTION agent_continuity.trg_notify_wake_covenant_active();

-- ─── Self-describing surface ───────────────────────────────────────────
COMMENT ON TABLE agent_continuity.guild_rrr_cascades IS
  E'@move3-wake-push: AFTER INSERT on guild_rrr_turns triggers notify_wake on the next_to_act_did.';
