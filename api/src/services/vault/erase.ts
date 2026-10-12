/** DELETE /v1/vault/:name — a real purge.
 *
 *  In one transaction: the secret is marked deleted, its description and
 *  tags cleared, every stored version's encrypted_value, iv and auth_tag
 *  zeroed (empty bytea; an agent-encrypted version's NULL tag stays NULL),
 *  the audit row written, one ids-only ledger entry appended and the
 *  project's deletion moment written. If the ledger entry cannot be written
 *  the transaction rolls back and nothing is deleted. The upstream
 *  credential a secret held is not revoked by this; revoke it separately.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §6 group 5, §17 wave 2. */

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../../db/client";
import { vaultAudit, vaultSecrets } from "../../db/schema/vault";
import type { AppendedLedgerEntry } from "../deletion/ledger";
import { purgeVaultSecrets } from "../deletion/purges";
import { recordErasure, type ErasureAuthority } from "../deletion/record";

export interface VaultEraseResult {
  secretId: string;
  versionsZeroed: number;
  deletedAt: string;
  entry: AppendedLedgerEntry;
}

export async function eraseVaultSecret(
  projectId: string,
  name: string,
  audit: { agentId: string | null; ip: string },
  authority: ErasureAuthority = { mode: "legacy_bearer" },
): Promise<VaultEraseResult | null> {
  return db.transaction(async (tx) => {
    const [secret] = await tx
      .select({ id: vaultSecrets.id })
      .from(vaultSecrets)
      .where(and(eq(vaultSecrets.projectId, projectId), eq(vaultSecrets.name, name), isNull(vaultSecrets.deletedAt)))
      .for("update")
      .limit(1);
    if (!secret) return null;
    const { entry } = await recordErasure(tx, {
      kind: "vault.purge",
      projectId,
      rowIds: [secret.id],
      authority,
      owners: [{ agentId: null, rowIds: [secret.id] }],
    });
    const { versionsZeroed } = await purgeVaultSecrets(tx, [secret.id], entry.occurredAt);
    await tx.insert(vaultAudit).values({
      projectId,
      secretName: name,
      action: "delete",
      agentId: audit.agentId,
      ipAddress: audit.ip,
    });
    return { secretId: secret.id, versionsZeroed, deletedAt: entry.occurredAt, entry };
  });
}
