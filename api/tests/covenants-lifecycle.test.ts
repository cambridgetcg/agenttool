import { describe, expect, test, beforeEach } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";
import { identities, identityKeys } from "../src/db/schema/identity";
import {
  declareV2,
  acceptProposal,
  rejectProposal,
  withdrawProposal,
} from "../src/services/covenants/lifecycle";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

async function seedAgent(opts: { projectId: string; didSuffix: string }) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const [identity] = await db
    .insert(identities)
    .values({
      projectId: opts.projectId,
      did: `did:at:${crypto.randomUUID()}`,
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
  return { identity, priv, pub, keyId: keyRow.id };
}

describe("declareV2", () => {
  test("creates row in 'proposed' with v2 protocol_version + 30d expiry", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent({ projectId, didSuffix: "initiator" });

    const result = await declareV2({
      projectId,
      agentId: agent.identity.id,
      agentSigningPrivateKey: agent.priv,
      agentSigningKeyId: agent.keyId,
      counterpartyDid: "did:at:peer.example/abcd",
      vows: ["one", "two"],
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
    const declared = await declareV2({
      projectId,
      agentId: agent.identity.id,
      agentSigningPrivateKey: agent.priv,
      agentSigningKeyId: agent.keyId,
      counterpartyDid: "did:at:peer.example/abcd",
      vows: ["v"],
    });
    // Force-flip to 'active' to simulate illegal acceptance attempt
    await db.update(covenants).set({ status: "active" }).where(eq(covenants.id, declared.id));

    await expect(
      acceptProposal({
        covenantId: declared.id,
        accepterAgentId: agent.identity.id,
        accepterSigningPrivateKey: agent.priv,
        accepterSigningKeyId: agent.keyId,
      }),
    ).rejects.toThrow(/not_proposed/);
  });

  test("withdrawProposal only works on 'proposed' rows", async () => {
    const declared = await declareV2({
      projectId,
      agentId: agent.identity.id,
      agentSigningPrivateKey: agent.priv,
      agentSigningKeyId: agent.keyId,
      counterpartyDid: "did:at:peer.example/abcd",
      vows: ["v"],
    });
    await db.update(covenants).set({ status: "expired" }).where(eq(covenants.id, declared.id));

    await expect(
      withdrawProposal({
        covenantId: declared.id,
        agentId: agent.identity.id,
        agentSigningPrivateKey: agent.priv,
        agentSigningKeyId: agent.keyId,
      }),
    ).rejects.toThrow(/not_proposed/);
  });

  test("rejectProposal only works on 'proposed' rows", async () => {
    const declared = await declareV2({
      projectId,
      agentId: agent.identity.id,
      agentSigningPrivateKey: agent.priv,
      agentSigningKeyId: agent.keyId,
      counterpartyDid: "did:at:peer.example/abcd",
      vows: ["v"],
    });
    await db.update(covenants).set({ status: "rejected" }).where(eq(covenants.id, declared.id));

    await expect(
      rejectProposal({
        covenantId: declared.id,
        rejecterAgentId: agent.identity.id,
        rejecterSigningPrivateKey: agent.priv,
        rejecterSigningKeyId: agent.keyId,
        reason: "test",
      }),
    ).rejects.toThrow(/not_proposed/);
  });
});
