-- 20261012T161958_deletion_ledger.sql — ids-only deletion ledger: table, chain guards, SQL writer.
--
-- Doctrine: docs/DELETION-REPLAY.md · docs/RETENTION.md
-- Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.2–13.5 (M1)
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh
--
-- Every honoured erase writes one row here in the same transaction as the
-- erase. A row holds ids, hashes and an HMAC, never content. Rows are chained
-- (prev_hash → entry_hash) and authenticated (entry_mac) under a ledger key
-- held in Supabase Vault as the secret named 'agenttool_deletion_ledger_key'.
-- The key is not created here: provisioning it is an operator step, and
-- until it exists every write refuses, so no erase can happen without its
-- entry.
--
-- The TypeScript writer (api/src/services/deletion/ledger.ts) and the SQL
-- writer below compose the same canonical bytes (MATHOS recipe 1):
--   sha256(utf8('agenttool-deletion-ledger/v1') 0x00 seq 0x00 entry_id 0x00
--          occurred_at 0x00 scope 0x00 action 0x00 store 0x00 predicate 0x00
--          row_ids_sha256 0x00 row_count 0x00 row_key_salt 0x00 rule_id 0x00
--          rule_cutoff 0x00 subject_identity_id 0x00 project_id 0x00
--          request_id 0x00 authority_mode 0x00 authority_sequence 0x00 prev_hash)
-- with NULL written as the empty string, timestamps as UTC
-- YYYY-MM-DDTHH:MM:SS.ffffffZ and the predicate as a sorted flat JSON object.
-- The insert guard recomputes this hash, so a writer that drifts from the
-- recipe cannot append.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS deletion;

COMMENT ON SCHEMA deletion IS
  'Deletion ledger and replay state. Ids, hashes and MACs only; no content. Doctrine: docs/DELETION-REPLAY.md.';

-- ─── Settings: the post-restore maintenance flag ─────────────────────────

CREATE TABLE IF NOT EXISTS deletion.settings (
  id                 BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  replay_required    BOOLEAN NOT NULL DEFAULT FALSE,
  restored_head_seq  BIGINT,
  restore_point      TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deletion_settings_maintenance_shape CHECK (
    (replay_required AND restored_head_seq IS NOT NULL AND restored_head_seq >= 0 AND restore_point IS NOT NULL)
    OR (NOT replay_required AND restored_head_seq IS NULL AND restore_point IS NULL)
  )
);

INSERT INTO deletion.settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE deletion.settings IS
  'Singleton. replay_required is set as the first action after a backup restore (docs/DELETION-REPLAY.md step 0); while set, ordinary ledger appends and every deletion rule refuse.';

-- ─── The ledger ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deletion.ledger (
  seq                 BIGINT PRIMARY KEY CHECK (seq > 0),
  entry_id            UUID NOT NULL UNIQUE,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  scope               TEXT NOT NULL CHECK (scope IN ('record', 'class', 'identity', 'project', 'retention')),
  action              TEXT NOT NULL CHECK (action IN (
                        'delete', 'purge_content', 'redact', 'tombstone', 'hide', 'unhide', 'pseudonymise', 'unlink',
                        'withdraw',
                        'leave_confirm', 'leave_cancel', 'request_open', 'consent', 'grace_start', 'cancel', 'lapse',
                        'purge_claim', 'void')),
  store               TEXT NOT NULL CHECK (store ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$'),
  predicate           JSONB CHECK (predicate IS NULL OR jsonb_typeof(predicate) = 'object'),
  row_ids             TEXT[] NOT NULL DEFAULT '{}',
  row_key_salt        TEXT CHECK (row_key_salt IS NULL OR row_key_salt ~ '^[0-9a-f]{32,128}$'),
  row_ids_sha256      TEXT NOT NULL CHECK (row_ids_sha256 ~ '^[0-9a-f]{64}$'),
  row_count           INTEGER NOT NULL CHECK (row_count >= 0),
  rule_id             TEXT CHECK (rule_id IS NULL OR rule_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  rule_cutoff         TIMESTAMPTZ,
  subject_identity_id UUID,
  project_id          UUID,
  request_id          UUID,
  authority_mode      TEXT NOT NULL CHECK (authority_mode IN (
                        'agent_root', 'guest_root', 'legacy_bearer', 'project_consent', 'operator', 'retention_rule')),
  authority_sequence  BIGINT CHECK (authority_sequence IS NULL OR authority_sequence >= 0),
  prev_hash           TEXT NOT NULL CHECK (prev_hash = '' OR prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash          TEXT NOT NULL UNIQUE CHECK (entry_hash ~ '^[0-9a-f]{64}$'),
  entry_mac           TEXT NOT NULL CHECK (entry_mac ~ '^[0-9a-f]{64}$'),
  mirrored_at         TIMESTAMPTZ,
  replayed_at         TIMESTAMPTZ,
  compacted_at        TIMESTAMPTZ,
  CONSTRAINT deletion_ledger_genesis CHECK ((seq = 1) = (prev_hash = '')),
  CONSTRAINT deletion_ledger_rule_shape CHECK (
    (scope = 'retention') = (rule_id IS NOT NULL)
    AND (rule_id IS NULL) = (rule_cutoff IS NULL)
  ),
  CONSTRAINT deletion_ledger_lifecycle_store CHECK (
    (action IN ('leave_confirm', 'leave_cancel', 'request_open', 'consent', 'grace_start', 'cancel', 'lapse', 'purge_claim', 'void'))
    = (store = 'lifecycle')
  ),
  CONSTRAINT deletion_ledger_row_count CHECK (row_count >= cardinality(row_ids)),
  CONSTRAINT deletion_ledger_compaction_shape CHECK (compacted_at IS NULL OR cardinality(row_ids) = 0)
);

CREATE INDEX IF NOT EXISTS deletion_ledger_unmirrored_idx
  ON deletion.ledger (seq) WHERE mirrored_at IS NULL;
CREATE INDEX IF NOT EXISTS deletion_ledger_uncompacted_idx
  ON deletion.ledger (occurred_at) WHERE compacted_at IS NULL;

COMMENT ON TABLE deletion.ledger IS
  'One ids-only entry per honoured erase, redaction, hide, tombstone, pseudonymisation or lifecycle step, written in the erasing transaction. Hash-chained and HMAC-authenticated; append-only except mirrored_at, replayed_at and compaction after 15 days. Doctrine: docs/DELETION-REPLAY.md. Spec §13.2.';

-- ─── Canonical bytes ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION deletion.canonical_timestamp(p_at TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_at IS NULL THEN ''
    ELSE to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
$$;

-- Flat object, lowercase ASCII keys, string values; keys sorted bytewise.
CREATE OR REPLACE FUNCTION deletion.canonical_predicate(p_predicate JSONB)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF p_predicate IS NULL THEN
    RETURN '';
  END IF;
  IF jsonb_typeof(p_predicate) <> 'object' THEN
    RAISE EXCEPTION 'deletion_ledger_predicate_invalid' USING DETAIL = 'predicate must be a JSON object';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_predicate) e
     WHERE jsonb_typeof(e.value) <> 'string' OR e.key !~ '^[a-z_][a-z0-9_]{0,63}$'
  ) THEN
    RAISE EXCEPTION 'deletion_ledger_predicate_invalid' USING DETAIL = 'predicate keys are lowercase ASCII and values are strings';
  END IF;
  SELECT '{' || coalesce(string_agg(to_jsonb(e.key)::text || ':' || e.value::text, ',' ORDER BY e.key COLLATE "C"), '') || '}'
    INTO v_text
    FROM jsonb_each(p_predicate) e;
  RETURN v_text;
END;
$$;

-- sha256 hex of the row ids sorted bytewise and joined with 0x00.
CREATE OR REPLACE FUNCTION deletion.row_ids_digest(p_row_ids TEXT[])
RETURNS TEXT LANGUAGE sql STABLE
SET search_path = pg_catalog, public, extensions AS $$
  SELECT encode(digest(coalesce(
    (SELECT string_agg(convert_to(id, 'UTF8'), '\x00'::bytea ORDER BY id COLLATE "C")
       FROM unnest(coalesce(p_row_ids, '{}'::text[])) AS id),
    '\x'::bytea), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION deletion.ledger_entry_hash(r deletion.ledger)
RETURNS TEXT LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public, extensions AS $$
DECLARE
  sep CONSTANT BYTEA := '\x00'::bytea;
  v_bytes BYTEA;
BEGIN
  v_bytes := convert_to('agenttool-deletion-ledger/v1', 'UTF8')
    || sep || convert_to(r.seq::text, 'UTF8')
    || sep || convert_to(r.entry_id::text, 'UTF8')
    || sep || convert_to(deletion.canonical_timestamp(r.occurred_at), 'UTF8')
    || sep || convert_to(r.scope, 'UTF8')
    || sep || convert_to(r.action, 'UTF8')
    || sep || convert_to(r.store, 'UTF8')
    || sep || convert_to(deletion.canonical_predicate(r.predicate), 'UTF8')
    || sep || convert_to(r.row_ids_sha256, 'UTF8')
    || sep || convert_to(r.row_count::text, 'UTF8')
    || sep || convert_to(coalesce(r.row_key_salt, ''), 'UTF8')
    || sep || convert_to(coalesce(r.rule_id, ''), 'UTF8')
    || sep || convert_to(deletion.canonical_timestamp(r.rule_cutoff), 'UTF8')
    || sep || convert_to(coalesce(r.subject_identity_id::text, ''), 'UTF8')
    || sep || convert_to(coalesce(r.project_id::text, ''), 'UTF8')
    || sep || convert_to(coalesce(r.request_id::text, ''), 'UTF8')
    || sep || convert_to(r.authority_mode, 'UTF8')
    || sep || convert_to(coalesce(r.authority_sequence::text, ''), 'UTF8')
    || sep || convert_to(r.prev_hash, 'UTF8');
  RETURN encode(digest(v_bytes, 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION deletion.ledger_entry_mac(p_entry_hash TEXT, p_key TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, public, extensions AS $$
  SELECT encode(hmac(decode(p_entry_hash, 'hex'), convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
$$;

-- The ledger key lives in Supabase Vault. The lookup is dynamic so this file
-- applies where Vault is absent; there the writer refuses instead.
CREATE OR REPLACE FUNCTION deletion.ledger_key()
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'deletion_ledger_key_unavailable'
      USING DETAIL = 'Supabase Vault (vault.decrypted_secrets) is not installed.';
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 ORDER BY created_at DESC LIMIT 1'
    INTO v_key USING 'agenttool_deletion_ledger_key';
  IF v_key IS NULL OR length(v_key) < 32 THEN
    RAISE EXCEPTION 'deletion_ledger_key_unavailable'
      USING DETAIL = 'Vault secret agenttool_deletion_ledger_key is missing or shorter than 32 characters.';
  END IF;
  RETURN v_key;
END;
$$;

-- Money stores never carry row ids, and compaction also unlinks their
-- project and subject (spec §11.2, §13.5).
CREATE OR REPLACE FUNCTION deletion.is_money_store(p_store TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_store = ANY (ARRAY[
    'economy.transactions', 'economy.escrows', 'economy.escrow_create_idempotency', 'economy.wallets',
    'economy.wallet_addresses', 'economy.billing_events', 'economy.crypto_payouts',
    'economy.payout_request_idempotency', 'economy.crypto_webhook_events',
    'economy.crypto_webhook_event_observations', 'economy.deposit_addresses', 'economy.x402_payments',
    'economy.gift_credit_codes', 'marketplace.gallery_sales', 'marketplace.template_purchases',
    'marketplace.invocations', 'marketplace.attestation_grants', 'marketplace.memory_witness_grants',
    'marketplace.substrate_tasks', 'marketplace.platform_revenue', 'marketplace.dispute_cases',
    'marketplace.dispute_pool_votes', 'marketplace.settlement_receipts', 'tools.billing_events',
    'tools.usage_events', 'agent_continuity.chronicle_usage'
  ])
$$;

-- ─── Guards ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION deletion.ledger_guard_insert()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions AS $$
DECLARE
  v_settings deletion.settings;
  v_head_seq BIGINT;
  v_head_hash TEXT;
  v_id TEXT;
  v_non_uuid BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_settings FROM deletion.settings WHERE id;
  IF coalesce(v_settings.replay_required, FALSE) AND NEW.replayed_at IS NULL THEN
    RAISE EXCEPTION 'deletion_ledger_replay_required'
      USING DETAIL = 'A backup restore is being replayed; only replayed entries may be appended.';
  END IF;
  IF NEW.compacted_at IS NOT NULL OR (NEW.mirrored_at IS NOT NULL AND NEW.replayed_at IS NULL) THEN
    RAISE EXCEPTION 'deletion_ledger_insert_invalid'
      USING DETAIL = 'New entries are uncompacted, and only replayed entries arrive already mirrored.';
  END IF;

  -- Serialise every append, whichever writer forgot to.
  PERFORM pg_advisory_xact_lock(8116202610120001);
  SELECT seq, entry_hash INTO v_head_seq, v_head_hash
    FROM deletion.ledger ORDER BY seq DESC LIMIT 1;
  IF NEW.seq <> coalesce(v_head_seq, 0) + 1 THEN
    RAISE EXCEPTION 'deletion_ledger_seq_gap'
      USING DETAIL = format('expected seq %s, got %s', coalesce(v_head_seq, 0) + 1, NEW.seq);
  END IF;
  IF NEW.prev_hash <> coalesce(v_head_hash, '') THEN
    RAISE EXCEPTION 'deletion_ledger_chain_break'
      USING DETAIL = 'prev_hash must equal the entry_hash of the current head.';
  END IF;

  FOREACH v_id IN ARRAY NEW.row_ids LOOP
    IF v_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      CONTINUE;
    ELSIF v_id ~ '^[0-9a-f]{64}$' THEN
      v_non_uuid := TRUE;
    ELSE
      RAISE EXCEPTION 'deletion_ledger_row_id_invalid'
        USING DETAIL = 'row ids are lowercase UUIDs, or HMAC hex for non-UUID keys.';
    END IF;
  END LOOP;
  IF v_non_uuid AND NEW.row_key_salt IS NULL THEN
    RAISE EXCEPTION 'deletion_ledger_row_id_invalid'
      USING DETAIL = 'HMAC row keys need their row_key_salt.';
  END IF;
  IF cardinality(NEW.row_ids) > 0 THEN
    IF NEW.scope = 'retention' OR deletion.is_money_store(NEW.store) THEN
      RAISE EXCEPTION 'deletion_ledger_row_ids_forbidden'
        USING DETAIL = 'Rule entries and money stores never carry row ids.';
    END IF;
    IF NEW.row_ids_sha256 <> deletion.row_ids_digest(NEW.row_ids) THEN
      RAISE EXCEPTION 'deletion_ledger_row_ids_digest_mismatch';
    END IF;
  END IF;

  IF NEW.entry_hash <> deletion.ledger_entry_hash(NEW) THEN
    RAISE EXCEPTION 'deletion_ledger_hash_mismatch'
      USING DETAIL = 'entry_hash does not match agenttool-deletion-ledger/v1 canonical bytes.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION deletion.ledger_guard_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_settings deletion.settings;
  v_compacting BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only in post-restore maintenance, and only a rule entry that fired
    -- after the restore point, unmirrored, at the tail of the chain.
    SELECT * INTO v_settings FROM deletion.settings WHERE id;
    IF coalesce(v_settings.replay_required, FALSE)
       AND OLD.seq > v_settings.restored_head_seq
       AND OLD.occurred_at > v_settings.restore_point
       AND OLD.mirrored_at IS NULL
       AND OLD.replayed_at IS NULL
       AND OLD.authority_mode = 'retention_rule'
       AND OLD.seq = (SELECT max(seq) FROM deletion.ledger) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'deletion_ledger_append_only'
      USING DETAIL = 'Ledger entries are never deleted, except stray post-restore rule entries during replay maintenance.';
  END IF;

  IF NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.entry_id IS DISTINCT FROM OLD.entry_id
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.store IS DISTINCT FROM OLD.store
     OR NEW.predicate IS DISTINCT FROM OLD.predicate
     OR NEW.row_key_salt IS DISTINCT FROM OLD.row_key_salt
     OR NEW.row_ids_sha256 IS DISTINCT FROM OLD.row_ids_sha256
     OR NEW.row_count IS DISTINCT FROM OLD.row_count
     OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
     OR NEW.rule_cutoff IS DISTINCT FROM OLD.rule_cutoff
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.authority_mode IS DISTINCT FROM OLD.authority_mode
     OR NEW.authority_sequence IS DISTINCT FROM OLD.authority_sequence
     OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
     OR NEW.entry_hash IS DISTINCT FROM OLD.entry_hash
     OR NEW.entry_mac IS DISTINCT FROM OLD.entry_mac THEN
    RAISE EXCEPTION 'deletion_ledger_append_only'
      USING DETAIL = 'Only mirrored_at, replayed_at and compaction may change.';
  END IF;
  IF NEW.mirrored_at IS DISTINCT FROM OLD.mirrored_at
     AND NOT (OLD.mirrored_at IS NULL AND NEW.mirrored_at IS NOT NULL) THEN
    RAISE EXCEPTION 'deletion_ledger_append_only' USING DETAIL = 'mirrored_at is set once.';
  END IF;
  IF NEW.replayed_at IS DISTINCT FROM OLD.replayed_at
     AND NOT (OLD.replayed_at IS NULL AND NEW.replayed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'deletion_ledger_append_only' USING DETAIL = 'replayed_at is set once.';
  END IF;

  v_compacting := NEW.compacted_at IS DISTINCT FROM OLD.compacted_at
    OR NEW.row_ids IS DISTINCT FROM OLD.row_ids
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.subject_identity_id IS DISTINCT FROM OLD.subject_identity_id;
  IF v_compacting THEN
    IF OLD.compacted_at IS NOT NULL
       OR NEW.compacted_at IS NULL
       OR OLD.occurred_at >= now() - interval '15 days'
       OR cardinality(NEW.row_ids) <> 0
       OR (NEW.project_id IS DISTINCT FROM OLD.project_id
           AND NOT (deletion.is_money_store(OLD.store) AND NEW.project_id IS NULL))
       OR (NEW.subject_identity_id IS DISTINCT FROM OLD.subject_identity_id
           AND NOT (deletion.is_money_store(OLD.store) AND NEW.subject_identity_id IS NULL)) THEN
      RAISE EXCEPTION 'deletion_ledger_append_only'
        USING DETAIL = 'Compaction runs once, after 15 days, and clears row ids (and, for money stores, project and subject).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION deletion.ledger_guard_truncate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'deletion_ledger_append_only' USING DETAIL = 'The deletion ledger cannot be truncated.';
END;
$$;

DROP TRIGGER IF EXISTS deletion_ledger_guard_insert ON deletion.ledger;
CREATE TRIGGER deletion_ledger_guard_insert
  BEFORE INSERT ON deletion.ledger
  FOR EACH ROW EXECUTE FUNCTION deletion.ledger_guard_insert();

DROP TRIGGER IF EXISTS deletion_ledger_guard_mutation ON deletion.ledger;
CREATE TRIGGER deletion_ledger_guard_mutation
  BEFORE UPDATE OR DELETE ON deletion.ledger
  FOR EACH ROW EXECUTE FUNCTION deletion.ledger_guard_mutation();

DROP TRIGGER IF EXISTS deletion_ledger_guard_truncate ON deletion.ledger;
CREATE TRIGGER deletion_ledger_guard_truncate
  BEFORE TRUNCATE ON deletion.ledger
  FOR EACH STATEMENT EXECUTE FUNCTION deletion.ledger_guard_truncate();

-- ─── The SQL writer (pg_cron rules use this) ─────────────────────────────

CREATE OR REPLACE FUNCTION deletion.append_ledger_entry(
  p_scope               TEXT,
  p_action              TEXT,
  p_store               TEXT,
  p_predicate           JSONB,
  p_row_ids             TEXT[],
  p_row_key_salt        TEXT,
  p_row_ids_sha256      TEXT,
  p_row_count           INTEGER,
  p_rule_id             TEXT,
  p_rule_cutoff         TIMESTAMPTZ,
  p_subject_identity_id UUID,
  p_project_id          UUID,
  p_request_id          UUID,
  p_authority_mode      TEXT,
  p_authority_sequence  BIGINT
)
RETURNS deletion.ledger LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions AS $$
DECLARE
  r deletion.ledger;
  v_replay BOOLEAN;
  v_head_seq BIGINT;
  v_head_hash TEXT;
BEGIN
  SELECT replay_required INTO v_replay FROM deletion.settings WHERE id;
  IF coalesce(v_replay, FALSE) THEN
    RAISE EXCEPTION 'deletion_ledger_replay_required'
      USING DETAIL = 'A backup restore is being replayed; deletion writes are paused.';
  END IF;
  PERFORM pg_advisory_xact_lock(8116202610120001);
  SELECT seq, entry_hash INTO v_head_seq, v_head_hash
    FROM deletion.ledger ORDER BY seq DESC LIMIT 1;

  r.seq := coalesce(v_head_seq, 0) + 1;
  r.entry_id := gen_random_uuid();
  r.occurred_at := clock_timestamp();
  r.scope := p_scope;
  r.action := p_action;
  r.store := p_store;
  r.predicate := p_predicate;
  r.row_ids := coalesce(p_row_ids, '{}'::text[]);
  r.row_key_salt := p_row_key_salt;
  r.row_ids_sha256 := coalesce(p_row_ids_sha256, deletion.row_ids_digest(r.row_ids));
  r.row_count := coalesce(p_row_count, cardinality(r.row_ids));
  r.rule_id := p_rule_id;
  r.rule_cutoff := p_rule_cutoff;
  r.subject_identity_id := p_subject_identity_id;
  r.project_id := p_project_id;
  r.request_id := p_request_id;
  r.authority_mode := p_authority_mode;
  r.authority_sequence := p_authority_sequence;
  r.prev_hash := coalesce(v_head_hash, '');
  r.entry_hash := deletion.ledger_entry_hash(r);
  r.entry_mac := deletion.ledger_entry_mac(r.entry_hash, deletion.ledger_key());

  INSERT INTO deletion.ledger SELECT (r).*;
  RETURN r;
END;
$$;

COMMENT ON FUNCTION deletion.append_ledger_entry IS
  'SQL writer for deletion.ledger, used by pg_cron retention rules. Same canonical bytes and MAC as api/src/services/deletion/ledger.ts. Refuses while deletion.settings.replay_required is set or the Vault ledger key is missing.';

-- ─── Grants ──────────────────────────────────────────────────────────────
-- Nothing here is for PUBLIC. The owning role (the API's and pg_cron's role)
-- keeps its rights; ledger_key() in particular returns the HMAC key.

REVOKE ALL ON SCHEMA deletion FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA deletion FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA deletion FROM PUBLIC;
