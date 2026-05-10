import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { covenants } from "../../src/db/schema/continuity";
import { identities, identityKeys } from "../../src/db/schema/identity";
import {
  declareV2,
  rejectProposal,
  withdrawProposal,
} from "../../src/services/covenants/lifecycle";

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

describe("v2 reject path", () => {
  test("counterparty rejects → status='rejected' with reason", async () => {
    const pa = crypto.randomUUID(); const pb = crypto.randomUUID();
    const a = await seedAgent(pa); const b = await seedAgent(pb);

    const decl = await declareV2({
      projectId: pa, agentId: a.identity.id,
      agentSigningPrivateKey: a.priv, agentSigningKeyId: a.keyId,
      counterpartyDid: b.identity.did, vows: ["v"],
    });
    // Place mirror row on B's side
    await db.insert(covenants).values({
      id: decl.id, projectId: pb, agentId: b.identity.id,
      counterpartyDid: a.identity.did, vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      establishedAt: decl.establishedAt, proposedExpiresAt: decl.proposedExpiresAt,
      signature: decl.signature, signingKeyId: decl.signingKeyId,
      receivedFromInstance: "self.test",
    });

    const rejected = await rejectProposal({
      covenantId: decl.id, rejecterAgentId: b.identity.id,
      rejecterSigningPrivateKey: b.priv, rejecterSigningKeyId: b.keyId,
      reason: "scope mismatch",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.reason).toBe("scope mismatch");

    const [bRow] = await db.select().from(covenants)
      .where(eq(covenants.projectId, pb)).limit(1);
    expect(bRow.status).toBe("rejected");
    expect((bRow.metadata as Record<string, unknown>).rejection_reason).toBe("scope mismatch");
  });
});

describe("v2 withdraw path", () => {
  test("initiator withdraws unaccepted proposal → status='withdrawn'", async () => {
    const pa = crypto.randomUUID(); const pb = crypto.randomUUID();
    const a = await seedAgent(pa); const b = await seedAgent(pb);

    const decl = await declareV2({
      projectId: pa, agentId: a.identity.id,
      agentSigningPrivateKey: a.priv, agentSigningKeyId: a.keyId,
      counterpartyDid: b.identity.did, vows: ["v"],
    });

    const withdrawn = await withdrawProposal({
      covenantId: decl.id, agentId: a.identity.id,
      agentSigningPrivateKey: a.priv, agentSigningKeyId: a.keyId,
    });
    expect(withdrawn.status).toBe("withdrawn");

    const [aRow] = await db.select().from(covenants)
      .where(eq(covenants.projectId, pa)).limit(1);
    expect(aRow.status).toBe("withdrawn");
  });
});

describe("v2 expire path (TTL)", () => {
  test("expire-proposals worker flips overdue 'proposed' rows to 'expired'", async () => {
    const projectId = crypto.randomUUID();
    const a = await seedAgent(projectId);
    const id = crypto.randomUUID();
    await db.insert(covenants).values({
      id, projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:peer.example/bbbb",
      vows: ["v"], status: "proposed", protocolVersion: "v2",
      establishedAt: new Date(),
      proposedExpiresAt: new Date(Date.now() - 60_000),
    });

    const { startExpireProposalsWorker, stopExpireProposalsWorker } =
      await import("../../src/workers/covenants/expire-proposals");
    startExpireProposalsWorker();
    await new Promise(r => setTimeout(r, 200));
    stopExpireProposalsWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.status).toBe("expired");
  });
});
