-- 20261012T161958_retention_rules.sql — scheduled retention rules that erase by published rule.
--
-- Doctrine: docs/RETENTION.md · docs/DELETION-REPLAY.md · docs/WORKERS-IN-DB.md
-- Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.5, §16 (M3)
-- Apply with the checksum-journaled runner: bin/migrate-pending.sh
--
-- Three pg_cron rules, following 20260519T090000_workers_in_db.sql:
--   expired_working_memory_24h  hourly  working memories expired more than
--                                       24 h ago are deleted; one with a paid
--                                       witness receipt (either provenance
--                                       form) is erased in place.
--   vault_audit_ip_30d          daily   vault audit ip_address → NULL after 30 days.
--   ledger_compaction_15d       daily   ledger entries older than 15 days lose
--                                       their row ids (money stores also lose
--                                       project and subject).
-- Each run that changes rows appends one retention-scope ledger entry per
-- (store, action) through deletion.append_ledger_entry(), in the same
-- transaction. A run that cannot write its entry rolls back its erase.
-- Every rule refuses while deletion.settings.replay_required is set
-- (docs/DELETION-REPLAY.md step 0). The apply_* functions hold the rule
-- itself; the replay script re-runs them with an entry's recorded cutoff.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION deletion.assert_rules_may_run()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce((SELECT replay_required FROM deletion.settings WHERE id), FALSE) THEN
    RAISE EXCEPTION 'deletion_ledger_replay_required'
      USING DETAIL = 'Deletion rules are paused while a backup restore is replayed.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION deletion.withdrawal_marker(p_at TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT 'withdrawn by author on ' || to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
$$;

-- ─── expired_working_memory_24h ──────────────────────────────────────────

-- A paid witness receipt holds the memory: one that names its grant
-- (source_grant_id, since 2026-07-13), or one a memory-witness grant points
-- back at. Receipts issued before 20260713T120000 keep source_grant_id NULL,
-- but their grant references them ON DELETE RESTRICT, so deleting such a
-- memory would abort the whole run. The API uses the same test
-- (api/src/services/deletion/purges.ts paidReceiptMemoryIds).
CREATE OR REPLACE FUNCTION deletion.memory_has_paid_receipt(p_memory_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM memory.memory_attestations a
     WHERE a.memory_id = p_memory_id
       AND (a.source_grant_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM marketplace.memory_witness_grants g WHERE g.memory_attestation_id = a.id)))
$$;

CREATE OR REPLACE FUNCTION deletion.apply_expired_working_memory(
  p_cutoff TIMESTAMPTZ,
  p_action TEXT,
  p_at     TIMESTAMPTZ
)
RETURNS UUID[] LANGUAGE plpgsql AS $$
DECLARE
  v_ids UUID[];
BEGIN
  IF p_action = 'delete' THEN
    WITH doomed AS (
      SELECT m.id FROM memory.memories m
       WHERE m.type = 'working' AND m.expires_at < p_cutoff AND m.content_purged_at IS NULL
         AND NOT deletion.memory_has_paid_receipt(m.id)
       FOR UPDATE OF m
    ), gone AS (
      DELETE FROM memory.memories m USING doomed WHERE m.id = doomed.id RETURNING m.id
    )
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_ids FROM gone;
  ELSIF p_action = 'purge_content' THEN
    WITH kept AS (
      SELECT m.id FROM memory.memories m
       WHERE m.type = 'working' AND m.expires_at < p_cutoff AND m.content_purged_at IS NULL
         AND deletion.memory_has_paid_receipt(m.id)
       FOR UPDATE OF m
    ), erased AS (
      UPDATE memory.memories m
         SET content = deletion.withdrawal_marker(p_at),
             key = NULL,
             embedding = NULL,
             expression_patch = NULL,
             metadata = '{}'::jsonb,
             content_purged_at = p_at
        FROM kept WHERE m.id = kept.id
      RETURNING m.id
    )
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_ids FROM erased;
  ELSE
    RAISE EXCEPTION 'deletion_rule_action_invalid' USING DETAIL = p_action;
  END IF;
  RETURN v_ids;
END;
$$;

CREATE OR REPLACE FUNCTION deletion.run_expired_working_memory_rule()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_cutoff  TIMESTAMPTZ := now() - interval '24 hours';
  v_deleted UUID[];
  v_erased  UUID[];
  v_entries INTEGER := 0;
BEGIN
  PERFORM deletion.assert_rules_may_run();
  v_deleted := deletion.apply_expired_working_memory(v_cutoff, 'delete', now());
  v_erased := deletion.apply_expired_working_memory(v_cutoff, 'purge_content', now());
  IF cardinality(v_deleted) > 0 THEN
    PERFORM deletion.append_ledger_entry(
      'retention', 'delete', 'memory.memories', NULL, '{}'::text[], NULL,
      deletion.row_ids_digest(v_deleted::text[]), cardinality(v_deleted),
      'expired_working_memory_24h', v_cutoff, NULL, NULL, NULL, 'retention_rule', NULL);
    v_entries := v_entries + 1;
  END IF;
  IF cardinality(v_erased) > 0 THEN
    PERFORM deletion.append_ledger_entry(
      'retention', 'purge_content', 'memory.memories', NULL, '{}'::text[], NULL,
      deletion.row_ids_digest(v_erased::text[]), cardinality(v_erased),
      'expired_working_memory_24h', v_cutoff, NULL, NULL, NULL, 'retention_rule', NULL);
    v_entries := v_entries + 1;
  END IF;
  RETURN v_entries;
END;
$$;

-- ─── vault_audit_ip_30d ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION deletion.apply_vault_audit_ip_rule(p_cutoff TIMESTAMPTZ)
RETURNS UUID[] LANGUAGE sql AS $$
  WITH cleared AS (
    UPDATE agent_vault.vault_audit
       SET ip_address = NULL
     WHERE created_at < p_cutoff AND ip_address IS NOT NULL
    RETURNING id
  )
  SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM cleared
$$;

CREATE OR REPLACE FUNCTION deletion.run_vault_audit_ip_rule()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_cutoff  TIMESTAMPTZ := now() - interval '30 days';
  v_cleared UUID[];
BEGIN
  PERFORM deletion.assert_rules_may_run();
  v_cleared := deletion.apply_vault_audit_ip_rule(v_cutoff);
  IF cardinality(v_cleared) = 0 THEN
    RETURN 0;
  END IF;
  PERFORM deletion.append_ledger_entry(
    'retention', 'purge_content', 'agent_vault.vault_audit', NULL, '{}'::text[], NULL,
    deletion.row_ids_digest(v_cleared::text[]), cardinality(v_cleared),
    'vault_audit_ip_30d', v_cutoff, NULL, NULL, NULL, 'retention_rule', NULL);
  RETURN 1;
END;
$$;

-- ─── ledger_compaction_15d ───────────────────────────────────────────────
-- Only entries that still hold something to clear are compacted, so the
-- rule falls silent when there is nothing left to unlink.

CREATE OR REPLACE FUNCTION deletion.apply_ledger_compaction(p_cutoff TIMESTAMPTZ)
RETURNS UUID[] LANGUAGE sql AS $$
  WITH compacted AS (
    UPDATE deletion.ledger
       SET row_ids = '{}'::text[],
           compacted_at = now(),
           project_id = CASE WHEN deletion.is_money_store(store) THEN NULL ELSE project_id END,
           subject_identity_id = CASE WHEN deletion.is_money_store(store) THEN NULL ELSE subject_identity_id END
     WHERE compacted_at IS NULL
       AND occurred_at < p_cutoff
       AND occurred_at < now() - interval '15 days'
       AND (cardinality(row_ids) > 0
            OR (deletion.is_money_store(store) AND (project_id IS NOT NULL OR subject_identity_id IS NOT NULL)))
    RETURNING entry_id
  )
  SELECT coalesce(array_agg(entry_id ORDER BY entry_id), '{}') FROM compacted
$$;

CREATE OR REPLACE FUNCTION deletion.run_ledger_compaction_rule()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_cutoff    TIMESTAMPTZ := now() - interval '15 days';
  v_compacted UUID[];
BEGIN
  PERFORM deletion.assert_rules_may_run();
  v_compacted := deletion.apply_ledger_compaction(v_cutoff);
  IF cardinality(v_compacted) = 0 THEN
    RETURN 0;
  END IF;
  PERFORM deletion.append_ledger_entry(
    'retention', 'purge_content', 'deletion.ledger', NULL, '{}'::text[], NULL,
    deletion.row_ids_digest(v_compacted::text[]), cardinality(v_compacted),
    'ledger_compaction_15d', v_cutoff, NULL, NULL, NULL, 'retention_rule', NULL);
  RETURN 1;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA deletion FROM PUBLIC;

-- ─── Schedules ───────────────────────────────────────────────────────────
-- Jobs run as the scheduling role (this migration's connection), which owns
-- the deletion schema and can read the Vault ledger key.

SELECT cron.unschedule('deletion-expired-working-memory')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deletion-expired-working-memory');
SELECT cron.schedule(
  'deletion-expired-working-memory',
  '17 * * * *',
  $$ SELECT deletion.run_expired_working_memory_rule(); $$
);

SELECT cron.unschedule('deletion-vault-audit-ip')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deletion-vault-audit-ip');
SELECT cron.schedule(
  'deletion-vault-audit-ip',
  '23 3 * * *',
  $$ SELECT deletion.run_vault_audit_ip_rule(); $$
);

SELECT cron.unschedule('deletion-ledger-compaction')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deletion-ledger-compaction');
SELECT cron.schedule(
  'deletion-ledger-compaction',
  '41 3 * * *',
  $$ SELECT deletion.run_ledger_compaction_rule(); $$
);
