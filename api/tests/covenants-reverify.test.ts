import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";
import { identities, identityKeys } from "../src/db/schema/identity";
import { canonicalDeclareBytes } from "../src/services/covenants/sig";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

describe("reverify worker", () => {
  test("clears verification_error on a valid row", async () => {
    const projectId = crypto.randomUUID();
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const [identity] = await db.insert(identities).values({
      projectId, did: "did:at:" + crypto.randomUUID(), displayName: "x", status: "active",
    }).returning();
    const [keyRow] = await db.insert(identityKeys).values({
      identityId: identity.id, publicKey: Buffer.from(pub).toString("base64"), active: true,
    }).returning();

    const id = crypto.randomUUID();
    const counterpartyDid = "human:Yu"; // not federated, so cosign verification path is skipped
    const established = new Date();
    const canonical = canonicalDeclareBytes({
      covenantId: id,
      initiatorDid: identity.did,
      counterpartyDid,
      vows: ["one"],
      establishedAtIso: established.toISOString(),
    });
    const sig = await ed.signAsync(canonical, priv);

    await db.insert(covenants).values({
      id,
      projectId,
      agentId: identity.id,
      counterpartyDid,
      vows: ["one"],
      status: "active",
      protocolVersion: "v2",
      signature: Buffer.from(sig).toString("base64"),
      signingKeyId: keyRow.id,
      // Counterparty cosign omitted to keep this test focused on initiator verify path
      establishedAt: established,
      verificationError: "stale_error_should_be_cleared",
    });

    const { startReverifyWorker, stopReverifyWorker } =
      await import("../src/workers/covenants/reverify");
    startReverifyWorker();
    await new Promise(r => setTimeout(r, 300));
    stopReverifyWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.verificationError).toBeNull();
    expect(row.verifiedAt).not.toBeNull();
  });
});
