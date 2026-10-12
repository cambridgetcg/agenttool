/** Replay appliers: one per kind of ledger entry, keyed by (store, action)
 *  for record entries and by (rule, store, action) for rule entries.
 *
 *  An applier re-applies an entry to a restored database with the same
 *  statements the original erase used (./purges.ts, or the SQL rule
 *  functions in api/migrations/20261012T161958_retention_rules.sql), using
 *  the entry's row ids or its recorded rule cutoff and its occurred_at as the
 *  erase time. Every applier is idempotent: a row already erased or already
 *  gone is skipped and counts zero.
 *
 *  ./kinds.ts lists every kind the writers emit; a test fails when one has
 *  no applier here. Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.4. */

import { sql } from "drizzle-orm";

import { applierKey } from "./kinds";
import type { LedgerExecutor, StoredLedgerEntry } from "./ledger";
import {
  backfillIdentityBackups,
  backfillInboxMessages,
  backfillVaultVersions,
  deleteOrEraseMemories,
  eraseMemoriesInPlace,
  purgeIdentityBackups,
  purgeInboxMessages,
  purgeVaultSecrets,
} from "./purges";
import { markWithdrawn, WITHDRAWABLE } from "./withdrawals";

export interface Applier {
  /** One line for the dry-run plan. */
  describe(entry: StoredLedgerEntry): string;
  /** Re-apply; returns how many rows changed now. */
  apply(tx: LedgerExecutor, entry: StoredLedgerEntry): Promise<number>;
}

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const list = (result as { rows?: unknown })?.rows;
  return Array.isArray(list) ? (list as T[]) : [];
}

async function ruleArray(tx: LedgerExecutor, query: ReturnType<typeof sql>): Promise<number> {
  const [row] = rows<{ ids: unknown }>(await tx.execute(query));
  const ids = row?.ids;
  if (Array.isArray(ids)) return ids.length;
  if (typeof ids === "string") return ids === "{}" ? 0 : ids.replace(/^\{|\}$/g, "").split(",").length;
  return 0;
}

function needCutoff(entry: StoredLedgerEntry): string {
  if (!entry.ruleCutoff) throw new Error(`entry ${entry.seq} has no rule cutoff`);
  return entry.ruleCutoff;
}

export const APPLIERS: Record<string, Applier> = {
  [applierKey({ store: "memory.memories", action: "delete" })]: {
    describe: (entry) => `delete ${entry.rowIds.length} memories (or erase in place where a paid receipt now holds one)`,
    apply: async (tx, entry) => {
      const result = await deleteOrEraseMemories(tx, entry.rowIds, entry.occurredAt);
      return result.deleted.length + result.erasedInPlace.length;
    },
  },
  [applierKey({ store: "memory.memories", action: "purge_content" })]: {
    describe: (entry) => `erase ${entry.rowIds.length} memories in place`,
    apply: async (tx, entry) => (await eraseMemoriesInPlace(tx, entry.rowIds, entry.occurredAt)).length,
  },
  [applierKey({ store: "inbox.messages", action: "purge_content" })]: {
    describe: (entry) => `purge ${entry.rowIds.length} inbox messages`,
    apply: async (tx, entry) => (await purgeInboxMessages(tx, entry.rowIds, entry.occurredAt)).length,
  },
  [applierKey({ store: "agent_vault.vault_secrets", action: "purge_content" })]: {
    describe: (entry) => `delete ${entry.rowIds.length} vault secrets and zero their versions`,
    apply: async (tx, entry) => (await purgeVaultSecrets(tx, entry.rowIds, entry.occurredAt)).versionsZeroed,
  },
  [applierKey({ store: "agent_continuity.identity_backups", action: "purge_content" })]: {
    describe: (entry) => `purge ${entry.rowIds.length} identity backups`,
    apply: async (tx, entry) => (await purgeIdentityBackups(tx, entry.rowIds, entry.occurredAt)).length,
  },

  // Gesture withdrawals: re-mark the rows withdrawn as of the entry's time.
  ...Object.fromEntries(Object.values(WITHDRAWABLE).map(({ store }) => [
    applierKey({ store, action: "withdraw" }),
    {
      describe: (entry: StoredLedgerEntry) => `mark ${entry.rowIds.length} rows of ${store} withdrawn (their words stay)`,
      apply: async (tx: LedgerExecutor, entry: StoredLedgerEntry) =>
        (await markWithdrawn(tx, store, entry.rowIds, entry.occurredAt)).length,
    } satisfies Applier,
  ])),

  [applierKey({ store: "memory.memories", action: "delete", ruleId: "expired_working_memory_24h" })]: {
    describe: (entry) => `re-run expired_working_memory_24h (delete) with cutoff ${entry.ruleCutoff}`,
    apply: (tx, entry) => ruleArray(tx, sql`SELECT deletion.apply_expired_working_memory(
      ${needCutoff(entry)}::text::timestamptz, 'delete', ${entry.occurredAt}::text::timestamptz) AS ids`),
  },
  [applierKey({ store: "memory.memories", action: "purge_content", ruleId: "expired_working_memory_24h" })]: {
    describe: (entry) => `re-run expired_working_memory_24h (erase in place) with cutoff ${entry.ruleCutoff}`,
    apply: (tx, entry) => ruleArray(tx, sql`SELECT deletion.apply_expired_working_memory(
      ${needCutoff(entry)}::text::timestamptz, 'purge_content', ${entry.occurredAt}::text::timestamptz) AS ids`),
  },
  [applierKey({ store: "agent_vault.vault_audit", action: "purge_content", ruleId: "vault_audit_ip_30d" })]: {
    describe: (entry) => `re-run vault_audit_ip_30d with cutoff ${entry.ruleCutoff}`,
    apply: (tx, entry) => ruleArray(tx, sql`SELECT deletion.apply_vault_audit_ip_rule(${needCutoff(entry)}::text::timestamptz) AS ids`),
  },
  [applierKey({ store: "deletion.ledger", action: "purge_content", ruleId: "ledger_compaction_15d" })]: {
    describe: (entry) => `re-run ledger_compaction_15d with cutoff ${entry.ruleCutoff}`,
    apply: (tx, entry) => ruleArray(tx, sql`SELECT deletion.apply_ledger_compaction(${needCutoff(entry)}::text::timestamptz) AS ids`),
  },
  [applierKey({ store: "inbox.messages", action: "purge_content", ruleId: "already_deleted_backfill" })]: {
    describe: () => "re-run already_deleted_backfill for inbox messages",
    apply: async (tx, entry) => (await backfillInboxMessages(tx, entry.occurredAt)).length,
  },
  [applierKey({ store: "agent_vault.vault_versions", action: "purge_content", ruleId: "already_deleted_backfill" })]: {
    describe: (entry) => `re-run already_deleted_backfill for vault versions with cutoff ${entry.ruleCutoff}`,
    apply: async (tx, entry) => (await backfillVaultVersions(tx, needCutoff(entry), entry.occurredAt)).versionIds.length,
  },
  [applierKey({ store: "agent_continuity.identity_backups", action: "purge_content", ruleId: "already_deleted_backfill" })]: {
    describe: (entry) => `re-run already_deleted_backfill for identity backups with cutoff ${entry.ruleCutoff}`,
    apply: async (tx, entry) => (await backfillIdentityBackups(tx, needCutoff(entry), entry.occurredAt)).length,
  },

  [applierKey({ store: "lifecycle", action: "void" })]: {
    describe: (entry) => `record the void of seqs ${entry.predicate?.voided_seqs ?? "?"} (no data change)`,
    apply: async () => 0,
  },
};

export function applierFor(entry: Pick<StoredLedgerEntry, "store" | "action" | "ruleId">): Applier | null {
  return APPLIERS[applierKey(entry)] ?? null;
}
