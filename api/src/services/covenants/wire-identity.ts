/** Exact local identity snapshot used by covenant signatures and delivery.
 *
 * A local identity is stored as `did:at:<uuid>`. Federated covenant bytes use
 * the wire form `did:at:<configured-host>/<uuid>` whenever federation is
 * enabled. Deriving that value in one place keeps declaration, lifecycle,
 * delivery, and re-verification on the same identity/origin boundary.
 *
 * Doctrine: docs/CROSS-INSTANCE-COVENANTS.md. */

import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { federationSettings } from "../../db/schema/federation";
import { identities } from "../../db/schema/identity";
import { resolveIdentitySigningKey } from "../identity/signing-key";
import {
  federatedDid,
  isCanonicalFederationInstanceUrl,
  parseDid,
} from "../federation/store";

export interface LocalWireIdentitySnapshot {
  identityId: string;
  storedDid: string;
  wireDid: string;
  status: string;
  settingsPresent: boolean;
  federationEnabled: boolean;
  instanceUrl: string | null;
  allowedOrigins: string[];
}

export function deriveLocalWireDid(opts: {
  identityId: string;
  storedDid: string;
  federationEnabled: boolean;
  instanceUrl: string | null;
}): string | null {
  try {
    const parsed = parseDid(opts.storedDid);
    if (parsed.host !== null || parsed.uuid !== opts.identityId) return null;
    if (!opts.federationEnabled || !opts.instanceUrl) return opts.storedDid;
    if (!isCanonicalFederationInstanceUrl(opts.instanceUrl)) return null;
    const url = new URL(opts.instanceUrl);
    return federatedDid(url.host, parsed.uuid);
  } catch {
    return null;
  }
}

export async function resolveLocalWireIdentity(
  identityId: string,
): Promise<LocalWireIdentitySnapshot | null> {
  const [[identity], [settings]] = await Promise.all([
    db
      .select({
        id: identities.id,
        did: identities.did,
        status: identities.status,
      })
      .from(identities)
      .where(eq(identities.id, identityId))
      .limit(1),
    db
      .select({
        enabled: federationSettings.enabled,
        instanceUrl: federationSettings.instanceUrl,
        allowedOrigins: federationSettings.allowedOrigins,
      })
      .from(federationSettings)
      .where(eq(federationSettings.id, 1))
      .limit(1),
  ]);
  if (!identity) return null;

  const base = {
    identityId: identity.id,
    storedDid: identity.did,
    status: identity.status,
    settingsPresent: Boolean(settings),
    federationEnabled: settings?.enabled ?? false,
    instanceUrl: settings?.instanceUrl ?? null,
    allowedOrigins: settings?.allowedOrigins ?? [],
  };
  const wireDid = deriveLocalWireDid({
    identityId: identity.id,
    storedDid: identity.did,
    federationEnabled: settings?.enabled ?? false,
    instanceUrl: settings?.instanceUrl ?? null,
  });
  return wireDid === null ? null : { ...base, wireDid };
}

export async function activeLocalWireIdentityMatches(
  identityId: string,
  expectedWireDid: string,
): Promise<boolean> {
  const snapshot = await resolveLocalWireIdentity(identityId);
  return snapshot?.status === "active" && snapshot.wireDid === expectedWireDid;
}

export async function activeIdentityKeyMatches(opts: {
  identityId: string;
  signingKeyId: string;
  publicKeyB64: string;
}): Promise<boolean> {
  const resolved = await resolveIdentitySigningKey({
    signingKeyId: opts.signingKeyId,
    identityId: opts.identityId,
  });
  return resolved.ok && resolved.key.publicKey === opts.publicKeyB64;
}
