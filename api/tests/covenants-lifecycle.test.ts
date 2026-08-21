import { describe, expect, test, beforeEach } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";
import { federationSettings } from "../src/db/schema/federation";
import { identities, identityKeys } from "../src/db/schema/identity";
import { covenantMetadataWithWireDidBinding } from "../src/services/covenants/canonical";
import {
  declareV2PreSigned,
  acceptProposalPreSigned,
  rejectProposalPreSigned,
  withdrawProposalPreSigned,
} from "../src/services/covenants/lifecycle";
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../src/services/covenants/sig";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const LOCAL_INSTANCE_URL = "https://local.example";
const PEER_HOST = "peer.example";
const PEER_DID =
  "did:at:peer.example/00000000-0000-4000-8000-000000000456";
process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION = "a".repeat(64);

beforeEach(async () => {
  await db.insert(federationSettings).values({
    id: 1,
    enabled: true,
    instanceUrl: LOCAL_INSTANCE_URL,
    allowedOrigins: [PEER_HOST],
  }).onConflictDoUpdate({
    target: federationSettings.id,
    set: {
      enabled: true,
      instanceUrl: LOCAL_INSTANCE_URL,
      allowedOrigins: [PEER_HOST],
    },
  });
});

async function seedAgent(opts: { projectId: string; didSuffix: string }) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const identityId = crypto.randomUUID();
  const [identity] = await db
    .insert(identities)
    .values({
      id: identityId,
      projectId: opts.projectId,
      did: `did:at:${identityId}`,
      displayName: opts.didSuffix,
      status: "active",
    })
    .returning();
  const [keyRow] = await db
    .insert(identityKeys)
    .values({
      identityId: identity.id,
      publicKey: Buffer.from(pub).toString("base64"),
      active: true,
    })
    .returning();
  return {
    identity: {
      ...identity,
      did: `did:at:local.example/${identityId}`,
    },
    priv,
    pub,
    keyId: keyRow.id,
    pubB64: Buffer.from(pub).toString("base64"),
  };
}

describe("declareV2", () => {
  test("creates row in 'proposed' with v2 protocol_version + 30d expiry", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent({ projectId, didSuffix: "initiator" });

    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const sig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.identity.did,
        counterpartyDid: PEER_DID,
        vows: ["one", "two"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );

    const result = await declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: PEER_DID,
      vows: ["one", "two"],
      establishedAt,
      signature: b64(sig),
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    });

    expect(result.status).toBe("proposed");
    expect(result.protocolVersion).toBe("v2");
    expect(result.signature).toBeTruthy();
    expect(result.proposedExpiresAt).toBeInstanceOf(Date);

    const ttlDays = (result.proposedExpiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(ttlDays).toBeGreaterThan(29.5);
    expect(ttlDays).toBeLessThan(30.5);
  });
});

describe("state machine illegal transitions", () => {
  let projectId: string;
  let agent: Awaited<ReturnType<typeof seedAgent>>;

  beforeEach(async () => {
    projectId = crypto.randomUUID();
    agent = await seedAgent({ projectId, didSuffix: "agent" });
  });

  test("acceptProposal rejects rows not in 'proposed' status", async () => {
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const sig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.identity.did,
        counterpartyDid: PEER_DID,
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    const sigB64 = b64(sig);

    const declared = await declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: PEER_DID,
      vows: ["v"],
      establishedAt,
      signature: sigB64,
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    });

    // Force-flip to a non-proposed terminal state to simulate illegal
    // acceptance attempt. 'expired' avoids the covenants_v2_active_dual_signed
    // CHECK (which requires counterparty_signature for v2 active rows); the
    // test's intent is "acceptProposal rejects rows not in 'proposed' status,"
    // and the specific terminal state is incidental.
    await db.update(covenants).set({
      status: "expired",
      receivedFromInstance: "peer.example",
    }).where(eq(covenants.id, declared.id));

    const cosig = await ed.signAsync(
      canonicalCosignBytes({ covenantId: declared.id, initiatorSignatureB64: sigB64 }),
      agent.priv,
    );

    await expect(
      acceptProposalPreSigned({
        covenantId: declared.id,
        accepterAgentId: agent.identity.id,
        accepterDid: agent.identity.did,
        initiatorSignatureB64: sigB64,
        counterpartySignature: b64(cosig),
        counterpartySigningKeyId: agent.keyId,
        counterpartySignedAt: new Date(),
        publicKeyB64: agent.pubB64,
      }),
    ).rejects.toThrow(/not_proposed/);
  });

  test("withdrawProposal only works on 'proposed' rows", async () => {
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const sig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.identity.did,
        counterpartyDid: PEER_DID,
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    const sigB64 = b64(sig);

    const declared = await declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: PEER_DID,
      vows: ["v"],
      establishedAt,
      signature: sigB64,
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    });

    await db.update(covenants).set({ status: "expired" }).where(eq(covenants.id, declared.id));

    const wdSig = await ed.signAsync(
      canonicalWithdrawBytes({ covenantId: declared.id, initiatorDid: agent.identity.did }),
      agent.priv,
    );

    await expect(
      withdrawProposalPreSigned({
        covenantId: declared.id,
        agentId: agent.identity.id,
        initiatorDid: agent.identity.did,
        withdrawSignature: b64(wdSig),
        signingKeyId: agent.keyId,
        withdrawnAt: new Date(),
        publicKeyB64: agent.pubB64,
      }),
    ).rejects.toThrow(/not_proposed/);
  });

  test("rejectProposal only works on 'proposed' rows", async () => {
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const sig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.identity.did,
        counterpartyDid: PEER_DID,
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    const sigB64 = b64(sig);

    const declared = await declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: PEER_DID,
      vows: ["v"],
      establishedAt,
      signature: sigB64,
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    });

    await db.update(covenants).set({
      status: "rejected",
      receivedFromInstance: "peer.example",
    }).where(eq(covenants.id, declared.id));

    const rejSig = await ed.signAsync(
      canonicalRejectBytes({ covenantId: declared.id, rejectingDid: agent.identity.did, reason: "test" }),
      agent.priv,
    );

    await expect(
      rejectProposalPreSigned({
        covenantId: declared.id,
        rejecterAgentId: agent.identity.id,
        rejecterDid: agent.identity.did,
        rejectionSignature: b64(rejSig),
        rejecterSigningKeyId: agent.keyId,
        rejectedAt: new Date(),
        reason: "test",
        publicKeyB64: agent.pubB64,
      }),
    ).rejects.toThrow(/not_proposed/);
  });
});

describe("positive transitions", () => {
  test("acceptProposal flips proposed → active and stores cosign", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent({ projectId, didSuffix: "agent" });

    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const sig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.identity.did,
        counterpartyDid: PEER_DID,
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    const sigB64 = b64(sig);

    const declared = await declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: PEER_DID,
      vows: ["v"],
      establishedAt,
      signature: sigB64,
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    });

    const cosig = await ed.signAsync(
      canonicalCosignBytes({ covenantId: declared.id, initiatorSignatureB64: sigB64 }),
      agent.priv,
    );
    const counterpartySignedAt = new Date();

    await db.update(covenants).set({
      receivedFromInstance: "peer.example",
      metadata: covenantMetadataWithWireDidBinding(
        {},
        PEER_DID,
        agent.identity.did,
      ),
    }).where(eq(covenants.id, declared.id));

    const result = await acceptProposalPreSigned({
      covenantId: declared.id,
      accepterAgentId: agent.identity.id,
      accepterDid: agent.identity.did,
      initiatorSignatureB64: sigB64,
      counterpartySignature: b64(cosig),
      counterpartySigningKeyId: agent.keyId,
      counterpartySignedAt,
      publicKeyB64: agent.pubB64,
    });

    expect(result.status).toBe("active");
    expect(result.counterpartySignature).toBeTruthy();
    expect(result.counterpartySignedAt).toBeInstanceOf(Date);

    const [row] = await db.select().from(covenants).where(eq(covenants.id, declared.id)).limit(1);
    expect(row.status).toBe("active");
    expect(row.counterpartySignature).toBe(result.counterpartySignature);
    expect(row.counterpartySigningKeyId).toBe(agent.keyId);
  });

  test("rejectProposal flips proposed → rejected and stores reason in metadata", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent({ projectId, didSuffix: "agent" });

    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const sig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.identity.did,
        counterpartyDid: PEER_DID,
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    const sigB64 = b64(sig);

    const declared = await declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: PEER_DID,
      vows: ["v"],
      establishedAt,
      signature: sigB64,
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    });

    const rejSig = await ed.signAsync(
      canonicalRejectBytes({ covenantId: declared.id, rejectingDid: agent.identity.did, reason: "scope mismatch" }),
      agent.priv,
    );

    await db.update(covenants).set({
      receivedFromInstance: "peer.example",
      metadata: covenantMetadataWithWireDidBinding(
        {},
        PEER_DID,
        agent.identity.did,
      ),
    }).where(eq(covenants.id, declared.id));

    const result = await rejectProposalPreSigned({
      covenantId: declared.id,
      rejecterAgentId: agent.identity.id,
      rejecterDid: agent.identity.did,
      rejectionSignature: b64(rejSig),
      rejecterSigningKeyId: agent.keyId,
      rejectedAt: new Date(),
      reason: "scope mismatch",
      publicKeyB64: agent.pubB64,
    });

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("scope mismatch");
    expect(result.rejectionSignature).toBeTruthy();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, declared.id)).limit(1);
    expect(row.status).toBe("rejected");
    expect(row.counterpartySignature).toBe(result.rejectionSignature);
    expect((row.metadata as Record<string, unknown>).rejection_reason).toBe("scope mismatch");
  });

  test("withdrawProposal flips proposed → withdrawn and stores withdraw signature", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent({ projectId, didSuffix: "initiator" });

    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const sig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.identity.did,
        counterpartyDid: PEER_DID,
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    const sigB64 = b64(sig);

    const declared = await declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: PEER_DID,
      vows: ["v"],
      establishedAt,
      signature: sigB64,
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    });
    await db.update(covenants).set({ propagationStatus: "propagated" })
      .where(eq(covenants.id, declared.id));

    const wdSig = await ed.signAsync(
      canonicalWithdrawBytes({ covenantId: declared.id, initiatorDid: agent.identity.did }),
      agent.priv,
    );

    const result = await withdrawProposalPreSigned({
      covenantId: declared.id,
      agentId: agent.identity.id,
      initiatorDid: agent.identity.did,
      withdrawSignature: b64(wdSig),
      signingKeyId: agent.keyId,
      withdrawnAt: new Date(),
      publicKeyB64: agent.pubB64,
    });

    expect(result.status).toBe("withdrawn");
    expect(result.withdrawSignature).toBeTruthy();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, declared.id)).limit(1);
    expect(row.status).toBe("withdrawn");
    expect(row.counterpartySignature).toBe(result.withdrawSignature);
  });
});
