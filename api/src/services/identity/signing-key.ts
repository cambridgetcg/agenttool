/** Central identity-key signing authority.
 *
 *  Doctrine: docs/AT-REST.md — `revoked` means identity key authority has
 *  been revoked, and a memorial being is "by definition unable to act".
 *  An active key row therefore does not override a revoked or memorial
 *  identity status. Signed-act paths resolve their signer here so that
 *  rule holds wherever it is wired instead of only where a route
 *  remembered to read identities.status.
 *
 *  Order of judgement:
 *    1. the key row exists                       → else unknown_signing_key
 *    2. the key is active and not revoked        → else signing_key_inactive
 *    3. the key belongs to the claimed signer    → else signing_key_not_owned
 *    4. the owning identity is `active`          → else signing_identity_not_active
 *
 *  Ownership is judged before status so a caller naming somebody else's
 *  identity learns nothing about that identity's lifecycle. When the
 *  caller passes `projectId`, a key whose identity lives in another
 *  project is indistinguishable from an unknown key (poker-face).
 *
 *  Tested: api/tests/identity-signing-key-authority.test.ts */

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";

export type SigningKeyRefusal =
  | "unknown_signing_key"
  | "signing_key_inactive"
  | "signing_key_not_owned"
  | "signing_identity_not_active";

export interface ActiveSigningKey {
  keyId: string;
  identityId: string;
  publicKey: string;
  did: string;
  projectId: string;
}

export type SigningKeyResolution =
  | { ok: true; key: ActiveSigningKey }
  | { ok: false; reason: SigningKeyRefusal };

export const SIGNING_KEY_REFUSAL_MESSAGES: Record<SigningKeyRefusal, string> = {
  unknown_signing_key: "signing_key_id not found.",
  signing_key_inactive: "signing_key is revoked or inactive.",
  signing_key_not_owned: "signing_key_id does not belong to the named signer.",
  signing_identity_not_active:
    "The signing identity is not active. An active key row does not override a revoked or memorial identity status.",
};

/** Only `active` identities hold signing authority. */
export function identityMaySign(status: string | null | undefined): boolean {
  return status === "active";
}

type Selector = Pick<typeof db, "select">;

/** Resolve a registered signing key and judge whether it may sign for the
 *  named identity (by id) and/or DID. Pass a transaction handle as
 *  `executor` to read inside the caller's transaction. */
export async function resolveIdentitySigningKey(
  input: { signingKeyId: string; identityId?: string; did?: string; projectId?: string },
  executor: Selector = db,
): Promise<SigningKeyResolution> {
  const [row] = await executor
    .select({
      keyId: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
      did: identities.did,
      projectId: identities.projectId,
      status: identities.status,
    })
    .from(identityKeys)
    .innerJoin(identities, eq(identities.id, identityKeys.identityId))
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);

  if (!row) return { ok: false, reason: "unknown_signing_key" };
  if (input.projectId !== undefined && row.projectId !== input.projectId) {
    return { ok: false, reason: "unknown_signing_key" };
  }
  if (!row.active || row.revokedAt) return { ok: false, reason: "signing_key_inactive" };
  if (input.identityId !== undefined && row.identityId !== input.identityId) {
    return { ok: false, reason: "signing_key_not_owned" };
  }
  if (input.did !== undefined && row.did !== input.did) {
    return { ok: false, reason: "signing_key_not_owned" };
  }
  if (!identityMaySign(row.status)) {
    return { ok: false, reason: "signing_identity_not_active" };
  }
  return {
    ok: true,
    key: {
      keyId: row.keyId,
      identityId: row.identityId,
      publicKey: row.publicKey,
      did: row.did,
      projectId: row.projectId,
    },
  };
}

/** Convenience for routes whose established refusal is a single
 *  "signing key not found": the registered public key of `identityId`'s
 *  active key `signingKeyId`, or null for any refusal. */
export async function registeredSigningPublicKey(
  identityId: string,
  signingKeyId: string,
): Promise<string | null> {
  const resolved = await resolveIdentitySigningKey({ signingKeyId, identityId });
  return resolved.ok ? resolved.key.publicKey : null;
}

/** Every active, unrevoked registered public key of `identityId` — empty
 *  when the identity itself is not active. For legacy verifiers whose wire
 *  carries no signing_key_id and so must accept any of the signer's keys. */
export async function activeSigningPublicKeys(identityId: string): Promise<string[]> {
  const rows = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .innerJoin(identities, eq(identities.id, identityKeys.identityId))
    .where(
      and(
        eq(identityKeys.identityId, identityId),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
        eq(identities.status, "active"),
      ),
    );
  return rows.map((row) => row.publicKey);
}
