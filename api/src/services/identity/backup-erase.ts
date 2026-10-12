/** DELETE /v1/identity/backup/:id — revoke and purge.
 *
 *  In one transaction: revoked_at is set (an earlier revocation keeps its
 *  time), blob_base64 becomes '', nonce NULL and metadata {}, one ids-only
 *  ledger entry is appended and the identity's deletion moment written. If
 *  the entry cannot be written the transaction rolls back and nothing
 *  changes. A backup revoked before purges existed still holds its blob;
 *  deleting it again purges it now.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §6 group 2, §17 wave 2. */

import { and, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { identityBackups } from "../../db/schema/continuity";
import type { AppendedLedgerEntry } from "../deletion/ledger";
import { purgeIdentityBackups } from "../deletion/purges";
import { recordErasure, type ErasureAuthority } from "../deletion/record";

export interface BackupEraseResult {
  alreadyRevoked: boolean;
  revokedAt: string;
  /** True when an earlier delete already erased the blob; nothing new was written. */
  alreadyPurged: boolean;
  purgedAt: string;
  entry: AppendedLedgerEntry | null;
}

export async function eraseIdentityBackup(
  projectId: string,
  id: string,
  authority: ErasureAuthority = { mode: "legacy_bearer" },
): Promise<BackupEraseResult | null> {
  return db.transaction(async (tx) => {
    const [backup] = await tx
      .select({
        id: identityBackups.id,
        agentId: identityBackups.agentId,
        revokedAt: identityBackups.revokedAt,
        contentPurgedAt: identityBackups.contentPurgedAt,
      })
      .from(identityBackups)
      .where(and(eq(identityBackups.id, id), eq(identityBackups.projectId, projectId)))
      .for("update")
      .limit(1);
    if (!backup) return null;
    if (backup.contentPurgedAt) {
      return {
        alreadyRevoked: true,
        revokedAt: (backup.revokedAt ?? backup.contentPurgedAt).toISOString(),
        alreadyPurged: true,
        purgedAt: backup.contentPurgedAt.toISOString(),
        entry: null,
      };
    }
    const { entry } = await recordErasure(tx, {
      kind: "identity_backup.purge",
      projectId,
      rowIds: [backup.id],
      authority,
      owners: [{ agentId: backup.agentId, rowIds: [backup.id] }],
    });
    await purgeIdentityBackups(tx, [backup.id], entry.occurredAt);
    return {
      alreadyRevoked: backup.revokedAt !== null,
      revokedAt: backup.revokedAt ? backup.revokedAt.toISOString() : entry.occurredAt,
      alreadyPurged: false,
      purgedAt: entry.occurredAt,
      entry,
    };
  });
}
