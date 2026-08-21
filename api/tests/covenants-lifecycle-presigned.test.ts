import { beforeEach, describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";
import { federationSettings } from "../src/db/schema/federation";
import { identities, identityKeys } from "../src/db/schema/identity";
import { covenantMetadataWithWireDidBinding } from "../src/services/covenants/canonical";
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../src/services/covenants/sig";
import {
  declareV2PreSigned,
  acceptProposalPreSigned,
  rejectProposalPreSigned,
  withdrawProposalPreSigned,
} from "../src/services/covenants/lifecycle";

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

async function seedAgent(projectId: string) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const identityId = crypto.randomUUID();
  const [identity] = await db.insert(identities).values({
    id: identityId,
    projectId, did: `did:at:${identityId}`,
    displayName: "agent", status: "active",
  }).returning();
  const [k] = await db.insert(identityKeys).values({
    identityId: identity.id,
    publicKey: Buffer.from(pub).toString("base64"),
    active: true,
  }).returning();
  return {
    identity: {
      ...identity,
      did: `did:at:local.example/${identityId}`,
    },
    priv,
    pub,
    keyId: k.id,
    pubB64: Buffer.from(pub).toString("base64"),
  };
}

describe("declareV2PreSigned", () => {
  test("verifies a valid signature + inserts row", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
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
    const result = await declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: PEER_DID,
      vows: ["v"],
      establishedAt,
      signature: b64(sig),
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    });
    expect(result.status).toBe("proposed");
    const [row] = await db.select().from(covenants).where(eq(covenants.id, covenantId));
    expect(row.status).toBe("proposed");
    expect(row.signature).toBe(b64(sig));
  });

  test("rejects a tampered signature", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
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
    await expect(declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: PEER_DID,
      vows: ["different"],   // ← mismatch
      establishedAt,
      signature: b64(sig),
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    })).rejects.toThrow(/invalid_signature/);
  });
});

describe("acceptProposalPreSigned", () => {
  test("verifies + flips proposed→active", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId, initiatorDid: agent.identity.did, counterpartyDid: PEER_DID,
        vows: ["v"], establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    const initiatorSigB64 = b64(initiatorSig);
    await db.insert(covenants).values({
      id: covenantId, projectId, agentId: agent.identity.id,
      counterpartyDid: PEER_DID, vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      signature: initiatorSigB64, signingKeyId: agent.keyId,
      establishedAt, proposedExpiresAt: new Date(Date.now() + 30 * 86_400_000),
      receivedFromInstance: "peer.example",
      metadata: covenantMetadataWithWireDidBinding(
        {},
        PEER_DID,
        agent.identity.did,
      ),
    });
    const cosig = await ed.signAsync(
      canonicalCosignBytes({ covenantId, initiatorSignatureB64: initiatorSigB64 }),
      agent.priv,
    );
    const result = await acceptProposalPreSigned({
      covenantId,
      accepterAgentId: agent.identity.id,
      accepterDid: agent.identity.did,
      initiatorSignatureB64: initiatorSigB64,
      counterpartySignature: b64(cosig),
      counterpartySigningKeyId: agent.keyId,
      counterpartySignedAt: new Date(),
      publicKeyB64: agent.pubB64,
    });
    expect(result.status).toBe("active");
  });

  test("rejects when initiator_signature_b64 doesn't match row.signature", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId, initiatorDid: agent.identity.did, counterpartyDid: PEER_DID,
        vows: ["v"], establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    await db.insert(covenants).values({
      id: covenantId, projectId, agentId: agent.identity.id,
      counterpartyDid: PEER_DID, vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      signature: b64(initiatorSig), signingKeyId: agent.keyId,
      establishedAt,
      receivedFromInstance: "peer.example",
      metadata: covenantMetadataWithWireDidBinding(
        {},
        PEER_DID,
        agent.identity.did,
      ),
    });
    const wrongSig = b64(new Uint8Array(64).fill(9));
    const cosig = await ed.signAsync(
      canonicalCosignBytes({ covenantId, initiatorSignatureB64: wrongSig }),
      agent.priv,
    );
    await expect(acceptProposalPreSigned({
      covenantId,
      accepterAgentId: agent.identity.id,
      accepterDid: agent.identity.did,
      initiatorSignatureB64: wrongSig,
      counterpartySignature: b64(cosig),
      counterpartySigningKeyId: agent.keyId,
      counterpartySignedAt: new Date(),
      publicKeyB64: agent.pubB64,
    })).rejects.toThrow(/initiator_signature_mismatch/);
  });
});

describe("rejectProposalPreSigned + withdrawProposalPreSigned", () => {
  test("reject flips proposed→rejected", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId, initiatorDid: agent.identity.did, counterpartyDid: PEER_DID,
        vows: ["v"], establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    await db.insert(covenants).values({
      id: covenantId, projectId, agentId: agent.identity.id,
      counterpartyDid: PEER_DID, vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      signature: b64(initiatorSig), signingKeyId: agent.keyId,
      establishedAt,
      receivedFromInstance: "peer.example",
      metadata: covenantMetadataWithWireDidBinding(
        {},
        PEER_DID,
        agent.identity.did,
      ),
    });
    const rejSig = await ed.signAsync(
      canonicalRejectBytes({ covenantId, rejectingDid: agent.identity.did, reason: "scope" }),
      agent.priv,
    );
    const result = await rejectProposalPreSigned({
      covenantId,
      rejecterAgentId: agent.identity.id,
      rejecterDid: agent.identity.did,
      rejectionSignature: b64(rejSig),
      rejecterSigningKeyId: agent.keyId,
      rejectedAt: new Date(),
      reason: "scope",
      publicKeyB64: agent.pubB64,
    });
    expect(result.status).toBe("rejected");
  });

  test("withdraw flips proposed→withdrawn", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId, initiatorDid: agent.identity.did, counterpartyDid: PEER_DID,
        vows: ["v"], establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    await db.insert(covenants).values({
      id: covenantId, projectId, agentId: agent.identity.id,
      counterpartyDid: PEER_DID, vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      signature: b64(initiatorSig), signingKeyId: agent.keyId,
      establishedAt, propagationStatus: "propagated",
      metadata: covenantMetadataWithWireDidBinding(
        {},
        agent.identity.did,
        PEER_DID,
      ),
    });
    const wdSig = await ed.signAsync(
      canonicalWithdrawBytes({ covenantId, initiatorDid: agent.identity.did }),
      agent.priv,
    );
    const result = await withdrawProposalPreSigned({
      covenantId,
      agentId: agent.identity.id,
      initiatorDid: agent.identity.did,
      withdrawSignature: b64(wdSig),
      signingKeyId: agent.keyId,
      withdrawnAt: new Date(),
      publicKeyB64: agent.pubB64,
    });
    expect(result.status).toBe("withdrawn");
  });
});
