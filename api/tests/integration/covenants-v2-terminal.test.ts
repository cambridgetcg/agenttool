import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { covenants } from "../../src/db/schema/continuity";
import { identities, identityKeys } from "../../src/db/schema/identity";
import {
  canonicalDeclareBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../../src/services/covenants/sig";
import {
  declareV2PreSigned,
  rejectProposalPreSigned,
  withdrawProposalPreSigned,
} from "../../src/services/covenants/lifecycle";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

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
  return { identity, priv, pub, keyId: k.id, pubB64: Buffer.from(pub).toString("base64") };
}

describe("v2 reject path", () => {
  // SKIP: same single-DB pkey collision as the v2 happy path test —
  // simulating B's mirror row with the same covenant_id as A's collides
  // on covenants_pkey. A two-instance integration harness is the right
  // shape. Doctrine: docs/CROSS-INSTANCE-COVENANTS.md.
  test.skip("counterparty rejects → status='rejected' with reason", async () => {
    const pa = crypto.randomUUID(); const pb = crypto.randomUUID();
    const a = await seedAgent(pa); const b = await seedAgent(pb);

    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: a.identity.did,
        counterpartyDid: b.identity.did,
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      a.priv,
    );
    const initiatorSigB64 = b64(initiatorSig);

    const decl = await declareV2PreSigned({
      projectId: pa, agentId: a.identity.id,
      covenantId,
      agentDid: a.identity.did,
      counterpartyDid: b.identity.did, vows: ["v"],
      establishedAt,
      signature: initiatorSigB64,
      signingKeyId: a.keyId,
      publicKeyB64: a.pubB64,
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

    const rejSig = await ed.signAsync(
      canonicalRejectBytes({ covenantId: decl.id, rejectingDid: b.identity.did, reason: "scope mismatch" }),
      b.priv,
    );

    const rejected = await rejectProposalPreSigned({
      covenantId: decl.id, rejecterAgentId: b.identity.id,
      rejecterDid: b.identity.did,
      rejectionSignature: b64(rejSig),
      rejecterSigningKeyId: b.keyId,
      rejectedAt: new Date(),
      reason: "scope mismatch",
      publicKeyB64: b.pubB64,
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

    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: a.identity.did,
        counterpartyDid: b.identity.did,
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      a.priv,
    );
    const initiatorSigB64 = b64(initiatorSig);

    const decl = await declareV2PreSigned({
      projectId: pa, agentId: a.identity.id,
      covenantId,
      agentDid: a.identity.did,
      counterpartyDid: b.identity.did, vows: ["v"],
      establishedAt,
      signature: initiatorSigB64,
      signingKeyId: a.keyId,
      publicKeyB64: a.pubB64,
    });

    const wdSig = await ed.signAsync(
      canonicalWithdrawBytes({ covenantId: decl.id, initiatorDid: a.identity.did }),
      a.priv,
    );

    const withdrawn = await withdrawProposalPreSigned({
      covenantId: decl.id, agentId: a.identity.id,
      initiatorDid: a.identity.did,
      withdrawSignature: b64(wdSig),
      signingKeyId: a.keyId,
      withdrawnAt: new Date(),
      publicKeyB64: a.pubB64,
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
      proposedExpiresAt: new Date(Date.now() - 25 * 60 * 60_000), // 25 hours ago — well past the 24h grace period
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
