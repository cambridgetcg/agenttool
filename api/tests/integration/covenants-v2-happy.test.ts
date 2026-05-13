import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { covenants } from "../../src/db/schema/continuity";
import { identities, identityKeys } from "../../src/db/schema/identity";
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
} from "../../src/services/covenants/sig";
import {
  declareV2PreSigned,
  acceptProposalPreSigned,
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

describe("v2 happy path — declare → propagate → accept → cosign", () => {
  // SKIP: this scenario fundamentally requires two databases. The test
  // simulates a covenant that exists on both A's and B's instances with the
  // same `id`, but `covenants_pkey` is on `id` alone — single-DB collision
  // is unavoidable. A two-instance integration test (Playwright with two
  // running servers, or two ephemeral test DBs) is the right shape; the
  // single-process simulation can't honor the federation invariant.
  // Doctrine: docs/CROSS-INSTANCE-COVENANTS.md.
  test.skip("end to end (single-instance simulating two sides)", async () => {
    const projectA = crypto.randomUUID();
    const projectB = crypto.randomUUID();
    const initiator = await seedAgent(projectA);
    const counterparty = await seedAgent(projectB);

    // A declares v2 toward B (using B's local DID — no federation hop in this test)
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: initiator.identity.did,
        counterpartyDid: counterparty.identity.did,
        vows: ["respond within 24h"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      initiator.priv,
    );
    const initiatorSigB64 = b64(initiatorSig);

    const declared = await declareV2PreSigned({
      projectId: projectA,
      agentId: initiator.identity.id,
      covenantId,
      agentDid: initiator.identity.did,
      counterpartyDid: counterparty.identity.did,
      vows: ["respond within 24h"],
      establishedAt,
      signature: initiatorSigB64,
      signingKeyId: initiator.keyId,
      publicKeyB64: initiator.pubB64,
    });
    expect(declared.status).toBe("proposed");

    // Simulate the propagation insert on B's side (what receiveFederatedCovenant would do
    // for a federated counterparty). We construct the inbound payload and route it through
    // the receive path with federation toggled off — so we direct-insert.
    await db.insert(covenants).values({
      id: declared.id,
      projectId: projectB,
      agentId: counterparty.identity.id,
      counterpartyDid: initiator.identity.did,
      vows: ["respond within 24h"],
      status: "proposed",
      protocolVersion: "v2",
      establishedAt: declared.establishedAt,
      proposedExpiresAt: declared.proposedExpiresAt,
      signature: declared.signature,
      signingKeyId: declared.signingKeyId,
      receivedFromInstance: "self.test", // simulates federation receive
    });

    // B accepts — pre-sign cosig then call PreSigned
    const cosig = await ed.signAsync(
      canonicalCosignBytes({ covenantId: declared.id, initiatorSignatureB64: initiatorSigB64 }),
      counterparty.priv,
    );
    const counterpartySignedAt = new Date();

    const accepted = await acceptProposalPreSigned({
      covenantId: declared.id,
      accepterAgentId: counterparty.identity.id,
      initiatorSignatureB64: initiatorSigB64,
      counterpartySignature: b64(cosig),
      counterpartySigningKeyId: counterparty.keyId,
      counterpartySignedAt,
      publicKeyB64: counterparty.pubB64,
    });
    expect(accepted.status).toBe("active");

    // B's row is now active with both signatures
    const [bRow] = await db.select().from(covenants)
      .where(eq(covenants.projectId, projectB)).limit(1);
    expect(bRow.status).toBe("active");
    expect(bRow.signature).toBeTruthy();
    expect(bRow.counterpartySignature).toBeTruthy();

    // A's row is still 'proposed' (cosign hasn't propagated back in this single-process sim).
    // In real two-instance flow, the cosign-propagate worker would POST to A.
    const [aRow] = await db.select().from(covenants)
      .where(eq(covenants.projectId, projectA)).limit(1);
    expect(aRow.status).toBe("proposed");
  });
});
