/** Identity creation as an in-process service function.
 *
 *  Used by:
 *    - api/src/routes/identity/identities.ts (POST /v1/identities)
 *    - api/src/routes/bootstrap.ts            (POST /v1/bootstrap — agent birth)
 *
 *  Single source of truth for "create a new agent identity"; both routes
 *  share the keypair generation, DID assignment, and table inserts. */

import { randomUUID } from "node:crypto";

import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { generateKeypair } from "./crypto";

export type CreatedIdentity = {
  identity: typeof identities.$inferSelect;
  key: {
    kid: string;
    publicKey: string;
    privateKey: string; // returned ONCE; never persisted server-side
  };
};

export async function createIdentity(input: {
  projectId: string;
  displayName: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}): Promise<CreatedIdentity> {
  const id = randomUUID();
  const did = `did:at:${id}`;
  const { publicKey, privateKey } = generateKeypair();
  const keyId = randomUUID();

  const [identity] = await db
    .insert(identities)
    .values({
      id,
      did,
      projectId: input.projectId,
      displayName: input.displayName,
      capabilities: input.capabilities ?? [],
      metadata: input.metadata ?? {},
      status: "active",
      trustScore: 0,
    })
    .returning();

  await db.insert(identityKeys).values({
    id: keyId,
    identityId: id,
    publicKey,
    label: "primary",
    active: true,
  });

  return {
    identity: identity!,
    key: { kid: keyId, publicKey, privateKey },
  };
}
