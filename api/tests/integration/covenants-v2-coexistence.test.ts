import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { covenants } from "../../src/db/schema/continuity";
import { identities, identityKeys } from "../../src/db/schema/identity";
import { canonicalDeclareBytes } from "../../src/services/covenants/sig";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

async function seedAgent(projectId: string) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const [identity] = await db.insert(identities).values({
    projectId, did: "did:at:" + crypto.randomUUID(),
    displayName: "agent", status: "active",
  }).returning();
  const [k] = await db.insert(identityKeys).values({
    identityId: identity.id,
    publicKey: Buffer.from(pub).toString("base64"),
    active: true,
  }).returning();
  return { identity, priv, pub, keyId: k.id };
}

describe("v1 and v2 coexist", () => {
  test("an agent can hold both v1 and v2 covenants; gates can filter by protocol_version", async () => {
    const projectId = crypto.randomUUID();
    const a = await seedAgent(projectId);

    // v1 row (legacy, unsigned)
    await db.insert(covenants).values({
      id: crypto.randomUUID(),
      projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:legacy.example/cccc",
      vows: ["legacy vow"],
      status: "active",
      protocolVersion: "v1",
      establishedAt: new Date(),
    });

    // v2 row (signed, active)
    await db.insert(covenants).values({
      id: crypto.randomUUID(),
      projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:peer.example/dddd",
      vows: ["new vow"],
      status: "active",
      protocolVersion: "v2",
      signature: "x".repeat(88),
      signingKeyId: a.keyId,
      counterpartySignature: "y".repeat(88),
      counterpartySigningKeyId: a.keyId,
      establishedAt: new Date(),
    });

    const allRows = await db.select().from(covenants).where(eq(covenants.projectId, projectId));
    expect(allRows.length).toBe(2);

    const v2Only = allRows.filter(r => r.protocolVersion === "v2");
    expect(v2Only.length).toBe(1);
  });
});

describe("v2 invariant: active row REQUIRES both signatures", () => {
  test("DB constraint rejects v2 active without counterparty_signature", async () => {
    const projectId = crypto.randomUUID();
    const a = await seedAgent(projectId);
    // Promise.resolve() wrap converts Drizzle's PgInsertBase (thenable, not
    // a native Promise) into a Promise so Bun's `expect(...).rejects` can
    // detect rejection. Without this, expect() receives the query builder
    // directly and fails with "Expected promise / Received: PgInsertBase".
    await expect(Promise.resolve(db.insert(covenants).values({
      id: crypto.randomUUID(),
      projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:peer.example/eeee",
      vows: ["v"],
      status: "active",
      protocolVersion: "v2",
      signature: "x".repeat(88),
      signingKeyId: a.keyId,
      // counterpartySignature intentionally NULL
      establishedAt: new Date(),
    }))).rejects.toThrow(/covenants_v2_active_dual_signed|check constraint/i);
  });
});

describe("v2 key rotation — historical key remains queryable", () => {
  test("revoking the active key does not remove it from identity_keys (sig still verifiable)", async () => {
    const projectId = crypto.randomUUID();
    const a = await seedAgent(projectId);

    const id = crypto.randomUUID();
    const established = new Date();
    const canonical = canonicalDeclareBytes({
      covenantId: id,
      initiatorDid: a.identity.did,
      counterpartyDid: "did:at:peer.example/ffff",
      vows: ["v"],
      establishedAtIso: established.toISOString(),
    });
    const sig = await ed.signAsync(canonical, a.priv);
    await db.insert(covenants).values({
      id, projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:peer.example/ffff",
      vows: ["v"], status: "proposed", protocolVersion: "v2",
      signature: Buffer.from(sig).toString("base64"),
      signingKeyId: a.keyId,
      establishedAt: established,
      proposedExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    });

    // Revoke the key
    await db.update(identityKeys).set({
      active: false,
      revokedAt: new Date(),
    }).where(eq(identityKeys.id, a.keyId));

    // Key row still exists and signature is still verifiable against its public key
    const [k] = await db.select().from(identityKeys).where(eq(identityKeys.id, a.keyId));
    expect(k).toBeTruthy();
    expect(k.revokedAt).not.toBeNull();
  });
});
