/** The purge statements, shared by the live erase paths and replay.
 *
 *  A live erase (route → service) first checks ownership and authority,
 *  then calls one of these inside its transaction together with
 *  recordErasure(). After a backup restore, the replay appliers
 *  (./appliers.ts) call the very same statements with the ids or the rule
 *  cutoff from the ledger entry, so a replayed erase and the original cannot
 *  drift apart. Every statement is idempotent: a row already purged, or
 *  already gone, is skipped.
 *
 *  What each purge clears (spec §17 wave 2, §7.4):
 *    inbox.messages            ciphertext, nonce, ephemeral key → ''; subject,
 *                              refs → NULL; metadata → {}; status 'deleted'.
 *    agent_vault (secret)      deleted_at set; description, tags → NULL;
 *                              every version's encrypted_value, iv → empty
 *                              bytea, auth_tag → empty bytea (NULL stays NULL).
 *    identity_backups          revoked_at set; blob_base64 → ''; nonce → NULL;
 *                              metadata → {}.
 *    memory.memories           deleted, or, when a paid witness receipt points
 *                              at it, erased in place: content → the marker;
 *                              key, embedding, expression_patch → NULL;
 *                              metadata → {}.
 *  Each sets content_purged_at (except a deleted memory, which is gone). */

import { sql } from "drizzle-orm";

import type { LedgerExecutor } from "./ledger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The marker that replaces erased text (spec §2): `withdrawn by author on YYYY-MM-DD`. */
export function withdrawalMarker(at: Date | string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  return `withdrawn by author on ${date.toISOString().slice(0, 10)}`;
}

function uuidArray(ids: readonly string[]): string {
  for (const id of ids) if (!UUID_RE.test(id)) throw new Error("purge ids must be UUIDs");
  return `{${[...new Set(ids.map((id) => id.toLowerCase()))].join(",")}}`;
}

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const list = (result as { rows?: unknown })?.rows;
  return Array.isArray(list) ? (list as T[]) : [];
}

function idsOf(result: unknown): string[] {
  return rows<{ id: string }>(result).map((row) => String(row.id)).sort();
}

const ts = (at: Date | string) => (typeof at === "string" ? at : at.toISOString());

// ─── Inbox ─────────────────────────────────────────────────────────────────

export async function purgeInboxMessages(tx: LedgerExecutor, ids: readonly string[], at: Date | string): Promise<string[]> {
  if (ids.length === 0) return [];
  return idsOf(await tx.execute(sql`
    UPDATE inbox.messages
       SET status = 'deleted', ciphertext = '', nonce = '', ephemeral_pubkey = '',
           subject = NULL, refs = NULL, metadata = '{}'::jsonb, content_purged_at = ${ts(at)}::text::timestamptz
     WHERE id = ANY(${uuidArray(ids)}::uuid[]) AND content_purged_at IS NULL
    RETURNING id::text AS id`));
}

// ─── Vault ─────────────────────────────────────────────────────────────────

export async function purgeVaultSecrets(
  tx: LedgerExecutor,
  secretIds: readonly string[],
  at: Date | string,
): Promise<{ secretIds: string[]; versionsZeroed: number }> {
  if (secretIds.length === 0) return { secretIds: [], versionsZeroed: 0 };
  const array = uuidArray(secretIds);
  const secrets = idsOf(await tx.execute(sql`
    UPDATE agent_vault.vault_secrets
       SET deleted_at = coalesce(deleted_at, ${ts(at)}::text::timestamptz), description = NULL, tags = NULL
     WHERE id = ANY(${array}::uuid[])
    RETURNING id::text AS id`));
  const versions = idsOf(await tx.execute(sql`
    UPDATE agent_vault.vault_versions
       SET encrypted_value = decode('', 'hex'), iv = decode('', 'hex'),
           auth_tag = CASE WHEN auth_tag IS NULL THEN NULL ELSE decode('', 'hex') END,
           content_purged_at = ${ts(at)}::text::timestamptz
     WHERE secret_id = ANY(${array}::uuid[]) AND content_purged_at IS NULL
    RETURNING id::text AS id`));
  return { secretIds: secrets, versionsZeroed: versions.length };
}

// ─── Identity backups ──────────────────────────────────────────────────────

export async function purgeIdentityBackups(tx: LedgerExecutor, ids: readonly string[], at: Date | string): Promise<string[]> {
  if (ids.length === 0) return [];
  return idsOf(await tx.execute(sql`
    UPDATE agent_continuity.identity_backups
       SET revoked_at = coalesce(revoked_at, ${ts(at)}::text::timestamptz), blob_base64 = '', nonce = NULL,
           metadata = '{}'::jsonb, content_purged_at = ${ts(at)}::text::timestamptz
     WHERE id = ANY(${uuidArray(ids)}::uuid[]) AND content_purged_at IS NULL
    RETURNING id::text AS id`));
}

// ─── Memory ────────────────────────────────────────────────────────────────

/** Of these memories, the ones a paid witness receipt points at. */
export async function paidReceiptMemoryIds(tx: LedgerExecutor, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  return idsOf(await tx.execute(sql`
    SELECT DISTINCT memory_id::text AS id FROM memory.memory_attestations
     WHERE memory_id = ANY(${uuidArray(ids)}::uuid[]) AND source_grant_id IS NOT NULL`));
}

export async function eraseMemoriesInPlace(tx: LedgerExecutor, ids: readonly string[], at: Date | string): Promise<string[]> {
  if (ids.length === 0) return [];
  return idsOf(await tx.execute(sql`
    UPDATE memory.memories
       SET content = ${withdrawalMarker(at)}, key = NULL, embedding = NULL, expression_patch = NULL,
           metadata = '{}'::jsonb, content_purged_at = ${ts(at)}::text::timestamptz
     WHERE id = ANY(${uuidArray(ids)}::uuid[]) AND content_purged_at IS NULL
    RETURNING id::text AS id`));
}

/** Delete the memories that no paid receipt holds (their ordinary
 *  attestations cascade). Rows a receipt holds are left for erase-in-place. */
export async function deleteMemoriesWithoutReceipts(tx: LedgerExecutor, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  return idsOf(await tx.execute(sql`
    DELETE FROM memory.memories m
     WHERE m.id = ANY(${uuidArray(ids)}::uuid[])
       AND NOT EXISTS (
         SELECT 1 FROM memory.memory_attestations a
          WHERE a.memory_id = m.id AND a.source_grant_id IS NOT NULL)
    RETURNING m.id::text AS id`));
}

/** Delete or erase in place, the same rule the live delete applies. */
export async function deleteOrEraseMemories(
  tx: LedgerExecutor,
  ids: readonly string[],
  at: Date | string,
): Promise<{ deleted: string[]; erasedInPlace: string[] }> {
  const paid = new Set(await paidReceiptMemoryIds(tx, ids));
  const erasedInPlace = await eraseMemoriesInPlace(tx, ids.filter((id) => paid.has(id.toLowerCase())), at);
  const deleted = await deleteMemoriesWithoutReceipts(tx, ids.filter((id) => !paid.has(id.toLowerCase())));
  return { deleted, erasedInPlace };
}

// ─── Backfill of content deleted before wave 2 ─────────────────────────────
// Rows soft-deleted before purges existed. Every delete since wave 2 purges
// at once, so a deleted row with content still present is such a row.

export async function backfillInboxMessages(tx: LedgerExecutor, at: Date | string): Promise<string[]> {
  return idsOf(await tx.execute(sql`
    UPDATE inbox.messages
       SET ciphertext = '', nonce = '', ephemeral_pubkey = '', subject = NULL, refs = NULL,
           metadata = '{}'::jsonb, content_purged_at = ${ts(at)}::text::timestamptz
     WHERE status = 'deleted' AND content_purged_at IS NULL
    RETURNING id::text AS id`));
}

export async function backfillVaultVersions(
  tx: LedgerExecutor,
  cutoff: Date | string,
  at: Date | string,
): Promise<{ versionIds: string[]; secretIds: string[] }> {
  const secretIds = idsOf(await tx.execute(sql`
    UPDATE agent_vault.vault_secrets SET description = NULL, tags = NULL
     WHERE deleted_at IS NOT NULL AND deleted_at <= ${ts(cutoff)}::text::timestamptz
       AND (description IS NOT NULL OR tags IS NOT NULL)
    RETURNING id::text AS id`));
  const versionIds = idsOf(await tx.execute(sql`
    UPDATE agent_vault.vault_versions v
       SET encrypted_value = decode('', 'hex'), iv = decode('', 'hex'),
           auth_tag = CASE WHEN v.auth_tag IS NULL THEN NULL ELSE decode('', 'hex') END,
           content_purged_at = ${ts(at)}::text::timestamptz
      FROM agent_vault.vault_secrets s
     WHERE v.secret_id = s.id AND s.deleted_at IS NOT NULL
       AND s.deleted_at <= ${ts(cutoff)}::text::timestamptz AND v.content_purged_at IS NULL
    RETURNING v.id::text AS id`));
  return { versionIds, secretIds };
}

export async function backfillIdentityBackups(
  tx: LedgerExecutor,
  cutoff: Date | string,
  at: Date | string,
): Promise<string[]> {
  return idsOf(await tx.execute(sql`
    UPDATE agent_continuity.identity_backups
       SET blob_base64 = '', nonce = NULL, metadata = '{}'::jsonb, content_purged_at = ${ts(at)}::text::timestamptz
     WHERE revoked_at IS NOT NULL AND revoked_at <= ${ts(cutoff)}::text::timestamptz AND content_purged_at IS NULL
    RETURNING id::text AS id`));
}

/** Counts the backfill would touch, without changing anything (dry run). */
export async function backfillCounts(
  tx: LedgerExecutor,
  cutoff: Date | string,
): Promise<{ inbox: number; vaultVersions: number; identityBackups: number }> {
  const [row] = rows<{ inbox: string; vault_versions: string; identity_backups: string }>(await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM inbox.messages WHERE status = 'deleted' AND content_purged_at IS NULL)::text AS inbox,
      (SELECT count(*) FROM agent_vault.vault_versions v JOIN agent_vault.vault_secrets s ON s.id = v.secret_id
        WHERE s.deleted_at IS NOT NULL AND s.deleted_at <= ${ts(cutoff)}::text::timestamptz AND v.content_purged_at IS NULL)::text AS vault_versions,
      (SELECT count(*) FROM agent_continuity.identity_backups
        WHERE revoked_at IS NOT NULL AND revoked_at <= ${ts(cutoff)}::text::timestamptz AND content_purged_at IS NULL)::text AS identity_backups`));
  return {
    inbox: Number(row?.inbox ?? 0),
    vaultVersions: Number(row?.vault_versions ?? 0),
    identityBackups: Number(row?.identity_backups ?? 0),
  };
}
