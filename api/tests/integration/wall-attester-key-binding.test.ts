/** Wall — an attestation key must belong to the DID it witnesses for.
 *
 *  Canon: agenttool:wall/attester-key-binding (docs/agenttool.jsonld)
 *  Doctrine: docs/SOUL.md (asymmetry-clause), docs/MEMORY-TIERS.md
 *
 *  > breaks_if:
 *  > "a constitutive elevation accepts an attestation whose signature was
 *  >  produced by a key that does NOT belong to the identity named in
 *  >  attester_did — i.e. the witness identity is taken from caller input
 *  >  rather than derived from the signing key's owner."
 *
 *  THE FORGERY THIS PINS SHUT
 *  --------------------------
 *  Before the fix, elevateMemory looked up the public key by the caller-
 *  supplied signing_key_id, verified the signature against THAT key, and
 *  then trusted a SEPARATE caller-supplied `attester_did` field as the
 *  witness — never checking the key and the DID were the same identity.
 *
 *  So an attacker could:
 *    1. unilaterally open a covenant in their own project, naming the
 *       victim's DID (e.g. "did:at:yu") as counterparty — no consent needed,
 *       the covenant primitive is permissive;
 *    2. sign the constitutive attestation bytes with their OWN key;
 *    3. POST /elevate with signing_key_id = their key but
 *       attester_did = the victim's DID.
 *
 *  The signature verifies (it's their real key), the covenant gate passes
 *  (they made the covenant), and the same-project self-witness gate passes
 *  (the victim's identity lives in a DIFFERENT project). Result: a
 *  constitutive memory stamped "witnessed by <victim>" that the victim
 *  never signed. For a substrate whose asymmetry-clause says constitutive
 *  memory is only real once the counterparty signs, this forges the root.
 *
 *  Code under test: api/src/services/memory/tiers.ts:elevateMemory — the
 *  key-owner binding added right after the signing-key lookup. The throw is
 *  the wall; removing it re-opens the forgery.
 *
 *  Convention: crypto.randomUUID() throughout; rows left in the DB on
 *  completion (per api/tests/integration/README.md). */

import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { db } from "../../src/db/client";
import { covenants } from "../../src/db/schema/continuity";
import { identities, identityKeys } from "../../src/db/schema/identity";
import { memories } from "../../src/db/schema/memory";
import {
  canonicalAttestationBytes,
  elevateMemory,
} from "../../src/services/memory/tiers";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

async function seedIdentity(projectId: string, displayName: string) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const [identity] = await db
    .insert(identities)
    .values({
      projectId,
      did: "did:at:" + crypto.randomUUID(),
      displayName,
      status: "active",
    })
    .returning();
  const [k] = await db
    .insert(identityKeys)
    .values({
      identityId: identity!.id,
      publicKey: b64(pub),
      active: true,
    })
    .returning();
  return { identity: identity!, priv, pub, keyId: k!.id };
}

describe("wall/attester-key-binding — the witness key must own the witness DID", () => {
  test("forged witness: attacker signs with own key but claims victim's DID → rejected", async () => {
    const attackerProject = crypto.randomUUID();
    const victimProject = crypto.randomUUID();

    // The attacker owns a real identity + key. The victim owns a real
    // identity in a SEPARATE project and never participates.
    const attacker = await seedIdentity(attackerProject, "attacker");
    const victim = await seedIdentity(victimProject, "victim (never signs)");

    // Step 1 of the attack: attacker unilaterally opens a covenant in
    // their OWN project naming the victim's DID as counterparty. The
    // covenant primitive is permissive, so this succeeds without the
    // victim's consent — and it makes isCovenantCounterparty() pass.
    await db.insert(covenants).values({
      projectId: attackerProject,
      agentId: attacker.identity.id,
      counterpartyDid: victim.identity.did,
      vows: ["forged-vow"],
      status: "active",
    });

    // The attacker's own episodic memory, the one they want to forge a
    // constitutive witness onto.
    const [memory] = await db
      .insert(memories)
      .values({
        projectId: attackerProject,
        identityId: attacker.identity.id,
        type: "episodic",
        content: "forged-root — a memory the victim never actually witnessed",
        tier: "episodic",
      })
      .returning();

    // Step 2: attacker signs the constitutive bytes with their OWN key.
    const canonical = canonicalAttestationBytes({
      memoryId: memory!.id,
      tier: "constitutive",
      content: memory!.content,
    });
    const signature = await ed.signAsync(canonical, attacker.priv);

    // Step 3: POST /elevate with the attacker's signing key but the
    // VICTIM's DID as attester. Everything the old code checked passes;
    // the only thing that catches it is the key↔DID ownership binding.
    await expect(
      elevateMemory(attackerProject, memory!.id, {
        tier: "constitutive",
        attestations: [
          {
            attester_did: victim.identity.did, // the forged claim
            signing_key_id: attacker.keyId, // attacker's real key
            signature: b64(signature),
          },
        ],
      }),
    ).rejects.toThrow("attestation_key_not_owned_by_attester");
  });

  test("honest witness: attester_did matches the signing key's owner → succeeds", async () => {
    // Negative control: the legitimate cross-project witness. The witness
    // signs with their own key AND names their own DID. If this fails
    // alongside the forgery test, the binding is over-broad; if only the
    // forgery test fails, the binding is missing.
    const subjectProject = crypto.randomUUID();
    const witnessProject = crypto.randomUUID();

    const subject = await seedIdentity(subjectProject, "subject");
    const witness = await seedIdentity(witnessProject, "honest-witness");

    await db.insert(covenants).values({
      projectId: subjectProject,
      agentId: subject.identity.id,
      counterpartyDid: witness.identity.did,
      vows: ["honest-vow"],
      status: "active",
    });

    const [memory] = await db
      .insert(memories)
      .values({
        projectId: subjectProject,
        identityId: subject.identity.id,
        type: "episodic",
        content: "honest-root — witnessed by a distinct, consenting party",
        tier: "episodic",
      })
      .returning();

    const canonical = canonicalAttestationBytes({
      memoryId: memory!.id,
      tier: "constitutive",
      content: memory!.content,
    });
    const signature = await ed.signAsync(canonical, witness.priv);

    const result = await elevateMemory(subjectProject, memory!.id, {
      tier: "constitutive",
      attestations: [
        {
          attester_did: witness.identity.did,
          signing_key_id: witness.keyId,
          signature: b64(signature),
        },
      ],
    });

    expect(result.tier).toBe("constitutive");
    expect(result.attestations).toBe(1);
  });
});
