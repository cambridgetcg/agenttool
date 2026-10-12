/** Every kind of ledger entry that wave 2 writers emit, in one list.
 *
 *  The writers (routes, services, pg_cron rules in
 *  api/migrations/20261012T161958_retention_rules.sql, the operator backfill
 *  and the replay script's void) name a kind from here, and the replay
 *  applier registry (./appliers.ts) must cover every one. A test reads the
 *  source and the migration and fails when a writer emits a kind that is not
 *  listed, or a listed kind has no applier.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.4. */

import type { LedgerAction, LedgerScope } from "./ledger";

export interface LedgerKind {
  scope: LedgerScope;
  action: LedgerAction;
  store: string;
  /** Retention rule id, for scope 'retention'. */
  rule?: string;
  /** Who writes it. */
  writer: "api" | "pg_cron" | "operator";
}

export const LEDGER_KINDS = {
  // Record-level erases (API, in the erasing transaction).
  "memory.delete": { scope: "record", action: "delete", store: "memory.memories", writer: "api" },
  "memory.erase_in_place": { scope: "record", action: "purge_content", store: "memory.memories", writer: "api" },
  "inbox.purge": { scope: "record", action: "purge_content", store: "inbox.messages", writer: "api" },
  "vault.purge": { scope: "record", action: "purge_content", store: "agent_vault.vault_secrets", writer: "api" },
  "identity_backup.purge": {
    scope: "record", action: "purge_content", store: "agent_continuity.identity_backups", writer: "api",
  },

  // Retention rules (pg_cron, M3).
  "rule.expired_working_memory.delete": {
    scope: "retention", action: "delete", store: "memory.memories", rule: "expired_working_memory_24h", writer: "pg_cron",
  },
  "rule.expired_working_memory.erase_in_place": {
    scope: "retention", action: "purge_content", store: "memory.memories", rule: "expired_working_memory_24h", writer: "pg_cron",
  },
  "rule.vault_audit_ip": {
    scope: "retention", action: "purge_content", store: "agent_vault.vault_audit", rule: "vault_audit_ip_30d", writer: "pg_cron",
  },
  "rule.ledger_compaction": {
    scope: "retention", action: "purge_content", store: "deletion.ledger", rule: "ledger_compaction_15d", writer: "pg_cron",
  },

  // The one-time backfill of content deleted before wave 2 (operator).
  "backfill.inbox": {
    scope: "retention", action: "purge_content", store: "inbox.messages", rule: "already_deleted_backfill", writer: "operator",
  },
  "backfill.vault": {
    scope: "retention", action: "purge_content", store: "agent_vault.vault_versions", rule: "already_deleted_backfill", writer: "operator",
  },
  "backfill.identity_backups": {
    scope: "retention", action: "purge_content", store: "agent_continuity.identity_backups", rule: "already_deleted_backfill", writer: "operator",
  },

  // Replay's record of entries it skipped (operator, two-person).
  "lifecycle.void": { scope: "record", action: "void", store: "lifecycle", writer: "operator" },
} as const satisfies Record<string, LedgerKind>;

export type LedgerKindName = keyof typeof LEDGER_KINDS;

/** The (store, action[, rule]) key a replay applier is registered under. */
export function applierKey(entry: { store: string; action: string; ruleId?: string | null }): string {
  return entry.ruleId ? `rule:${entry.ruleId}:${entry.store}:${entry.action}` : `record:${entry.store}:${entry.action}`;
}

export function kindApplierKey(kind: LedgerKind): string {
  return applierKey({ store: kind.store, action: kind.action, ruleId: kind.rule ?? null });
}
