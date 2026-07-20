/** vault/store.ts — in-process secret retrieval (no HTTP, no Bearer).
 *
 *  The HTTP surface lives in routes/vault/secrets.ts and enforces audit +
 *  agent_id policy. This module is the slimmer counterpart used by other
 *  services (think-worker, etc.) that need a secret value while already
 *  inside the API's project context. It does NOT enforce X-Agent-Id
 *  policy — callers that need that should hit the HTTP route.
 *
 *  Two encryption paths exist (per migration 0022_vault_agent_encrypted.sql):
 *
 *    agent_encrypted=false (default): server-encrypted at rest under
 *      HKDF-derived per-project key. We decrypt here and return plaintext.
 *      Suitable for runtime-consumed secrets (LLM provider API keys etc.).
 *
 *    agent_encrypted=true (caller-supplied opaque-byte path): the normal
 *      server consumer has no decrypt key. The API does not prove the caller
 *      encrypted the bytes. This
 *      function throws Error("agent_encrypted_secret_not_in_process_readable")
 *      so callers fail loudly rather than crashing deep inside the
 *      cryptography library on a NULL auth_tag. Agents using
 *      put_encrypted should not expect server-side runtimes to consume
 *      the value — that's the trade-off of the privacy lever. */

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../../db/client";
import { vaultSecrets, vaultVersions } from "../../db/schema/vault";
import { decrypt } from "./crypto";

/** Fetch + decrypt a secret value by (projectId, name). Returns null if
 *  the secret doesn't exist, is expired, or has no current version.
 *  Throws Error("agent_encrypted_secret_not_in_process_readable") when
 *  the version was stored via the agent-encrypted opt-in path — the
 *  in-process consumer can't decrypt without the agent's K_vault.
 *
 *  No agent_id policy enforcement — caller is presumed in-process and
 *  trusted. Audit rows are NOT written for in-process reads (the runtime
 *  event log carries the audit trail at a different granularity). */
export async function getSecretValue(
  projectId: string,
  name: string,
): Promise<string | null> {
  const [secret] = await db
    .select()
    .from(vaultSecrets)
    .where(
      and(
        eq(vaultSecrets.projectId, projectId),
        eq(vaultSecrets.name, name),
        isNull(vaultSecrets.deletedAt),
      ),
    )
    .limit(1);
  if (!secret) return null;

  const [v] = await db
    .select()
    .from(vaultVersions)
    .where(
      and(
        eq(vaultVersions.secretId, secret.id),
        eq(vaultVersions.version, secret.currentVersion),
      ),
    )
    .limit(1);
  if (!v) return null;
  if (v.expiresAt && v.expiresAt < new Date()) return null;

  // The normal server consumer does not decrypt caller-supplied opaque bytes
  // (auth_tag is NULL and this path has no key). This does not prove the caller
  // encrypted them. Throw a named error rather than letting the cryptography
  // library crash with an opaque message about NULL buffers.
  if (v.agentEncrypted) {
    throw new Error("agent_encrypted_secret_not_in_process_readable");
  }

  // After the check above, auth_tag is guaranteed non-null by the schema
  // CHECK constraint (agent_encrypted=FALSE ⇒ auth_tag IS NOT NULL).
  return decrypt(v.encryptedValue, v.iv, v.authTag!, projectId);
}
