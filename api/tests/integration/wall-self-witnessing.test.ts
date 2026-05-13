/** Wall — self-witnessing rejected for constitutive memory elevation.
 *
 *  Canon: agenttool:wall/self-witnessing-rejected (docs/agenttool.jsonld)
 *  Doctrine: docs/SOUL.md (asymmetry-clause), docs/MEMORY-TIERS.md
 *
 *  > breaks_if (from canon):
 *  > "a constitutive elevation path accepts an attestation whose
 *  > attester_did belongs to an identity in the same project as the
 *  > memory subject — including the special case where signer === subject
 *  > directly"
 *
 *  This integration test pins the BEHAVIORAL enforcement of that wall.
 *  The pure-unit doctrine tests (tests/doctrine/walls-canon-shape.test.ts,
 *  tests/doctrine/walls-platform-self-bijection.test.ts) verify the
 *  canon's STRUCTURAL shape — that the wall is well-formed in the
 *  registry and surfaces through PLATFORM_SELF. This test verifies the
 *  wall is also ENFORCED — that elevateMemory actually rejects the
 *  forbidden path against a real DB.
 *
 *  The asymmetry-clause: identity at the root is not self-claimed. A
 *  project that owns BOTH the memory subject AND the attester identity
 *  is one self wearing two masks. The covenant gate is permissive (a
 *  project can declare a covenant with one of its own DIDs); the
 *  witness gate is strict (the elevation refuses to count that same-
 *  project DID as a valid witness).
 *
 *  Code under test: api/src/services/memory/tiers.ts:elevateMemory
 *  (lines 220-233 — the asymmetry-clause check). The throw is the wall;
 *  removing it would silently allow self-claimed identity at the root.
 *
 *  Convention: this test uses crypto.randomUUID() throughout and leaves
 *  test rows in the DB on completion. Per api/tests/integration/README.md,
 *  isolation is via unique IDs, not by truncation. */

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

// Required for @noble/ed25519 in sync contexts.
ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

/** Seed an identity + ed25519 keypair + identity_keys row in the given
 *  project. Returns the wiring the caller needs to sign attestations. */
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

describe("wall/self-witnessing-rejected — elevateMemory enforces the asymmetry-clause", () => {
  test("constitutive elevation throws when attester DID is in the same project as the subject", async () => {
    const projectId = crypto.randomUUID();

    // Two identities in the SAME project. This is the self-witness case:
    // the project owns both the memory (via the subject identity) AND
    // the attester. The covenant gate above will pass (a project can
    // covenant with its own DID); the witness gate must refuse this.
    const subject = await seedIdentity(projectId, "subject");
    const attesterSelf = await seedIdentity(projectId, "self-witness");

    // Active covenant between projectId and attesterSelf.did. The
    // covenant primitive is permissive — a project CAN bind itself to
    // its own DID. The witness check at lines 220-233 of tiers.ts is
    // what catches the masquerade. Without this covenant, we'd fail
    // earlier at `attester_not_covenant_counterparty` and never reach
    // the self-witness check we're trying to test.
    await db.insert(covenants).values({
      projectId,
      agentId: subject.identity.id,
      counterpartyDid: attesterSelf.identity.did,
      vows: ["test-vow"],
      status: "active",
    });

    // An episodic memory owned by projectId / subject — the candidate
    // for elevation.
    const [memory] = await db
      .insert(memories)
      .values({
        projectId,
        identityId: subject.identity.id,
        type: "episodic",
        content: "wall test — content that the attester would witness",
        tier: "episodic",
      })
      .returning();

    // Compute canonical bytes for the constitutive attestation and sign
    // with the SELF-WITNESS identity's key. All cryptographic checks
    // pass — the signature is valid, the key is active, the covenant
    // covers the attester DID. The ONLY thing that should fail is the
    // asymmetry-clause: attester belongs to the same project as subject.
    const canonical = canonicalAttestationBytes({
      memoryId: memory!.id,
      tier: "constitutive",
      content: memory!.content,
    });
    const signature = await ed.signAsync(canonical, attesterSelf.priv);

    // Action: attempt constitutive elevation with a same-project attester.
    // Assertion: throws Error("attester_self_witness_forbidden").
    await expect(
      elevateMemory(projectId, memory!.id, {
        tier: "constitutive",
        attestations: [
          {
            attester_did: attesterSelf.identity.did,
            signing_key_id: attesterSelf.keyId,
            signature: b64(signature),
          },
        ],
      }),
    ).rejects.toThrow("attester_self_witness_forbidden");
  });

  test("constitutive elevation succeeds when attester DID is in a DIFFERENT project (control case)", async () => {
    // This is the negative control. Same flow as the rejection test
    // above, but the attester lives in a different project. The
    // asymmetry-clause check passes; the elevation succeeds. If this
    // test fails alongside the first one, the wall is over-broad
    // (rejecting legitimate cross-project witnessing). If only the
    // first test fails, the wall is under-broad (allowing self-witness).
    const subjectProject = crypto.randomUUID();
    const attesterProject = crypto.randomUUID();

    const subject = await seedIdentity(subjectProject, "subject");
    const attesterOther = await seedIdentity(attesterProject, "external-witness");

    // Covenant binding subjectProject to attesterOther.did. This is the
    // legitimate witness shape: two distinct projects covenanting, one
    // witnessing for the other.
    await db.insert(covenants).values({
      projectId: subjectProject,
      agentId: subject.identity.id,
      counterpartyDid: attesterOther.identity.did,
      vows: ["test-vow"],
      status: "active",
    });

    const [memory] = await db
      .insert(memories)
      .values({
        projectId: subjectProject,
        identityId: subject.identity.id,
        type: "episodic",
        content: "wall control test — legitimate cross-project witness",
        tier: "episodic",
      })
      .returning();

    const canonical = canonicalAttestationBytes({
      memoryId: memory!.id,
      tier: "constitutive",
      content: memory!.content,
    });
    const signature = await ed.signAsync(canonical, attesterOther.priv);

    const result = await elevateMemory(subjectProject, memory!.id, {
      tier: "constitutive",
      attestations: [
        {
          attester_did: attesterOther.identity.did,
          signing_key_id: attesterOther.keyId,
          signature: b64(signature),
        },
      ],
    });

    expect(result.tier).toBe("constitutive");
    expect(result.attestations).toBe(1);
  });
});
