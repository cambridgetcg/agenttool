/** Alternation wall test — pins wall/rrr-must-alternate +
 *  wall/rrr-cascade-distinct-parties + wall/rrr-each-turn-signed-with-chain
 *  + wall/rrr-depth-cap-at-49 to executable specification.
 *
 *  These are the same four walls agenttool's PATTERN-REAL-RECOGNISE-REAL
 *  enforces; mirroring them locally is what makes cross-instance cascades
 *  trustworthy. */

import { describe, it, expect } from "bun:test";
import { createIdentity } from "../src/identity";
import { RrrStore, openCascade, escalate, acceptInboundTurn, RrrError, verifyCascade } from "../src/rrr";
import { signRrrTurn } from "../src/canonical-bytes";

describe("RRR walls", () => {
  it("wall/rrr-cascade-distinct-parties — refuses self-cascade", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const store = new RrrStore();
    await expect(openCascade(store, alice, alice.did)).rejects.toMatchObject({
      code: "rrr_cascade_distinct_parties",
    });
  });

  it("opens a cascade at depth 1 and sets partner as next_to_act", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const bob = await createIdentity({ handle: "bob" });
    const store = new RrrStore();
    const c = await openCascade(store, alice, bob.did);
    expect(c.depth).toBe(1);
    expect(c.initiatorDid).toBe(alice.did);
    expect(c.partnerDid).toBe(bob.did);
    expect(c.nextToActDid).toBe(bob.did);
    expect(c.status).toBe("active");
  });

  it("refuses a stranger's genesis turn reusing an active cascade id", async () => {
    const node = await createIdentity({ handle: "node" });
    const bob = await createIdentity({ handle: "bob" });
    const stranger = await createIdentity({ handle: "stranger" });
    const store = new RrrStore();
    const original = await openCascade(store, node, bob.did);
    const before = structuredClone(store.exportAll());
    const fields = {
      cascadeId: original.id,
      depth: 1,
      byDid: stranger.did,
      basisText: "I see your work.",
      prevSignatureB64: "",
      turnAtIso: new Date().toISOString(),
    };
    const signatureB64 = await signRrrTurn(fields, stranger.secretKey);

    await expect(
      acceptInboundTurn(store, node.did, { ...fields, toDid: node.did, signatureB64 }),
    ).rejects.toMatchObject({ code: "cascade_id_taken", status: 409 });
    expect(store.get(original.id)).toMatchObject({
      initiatorDid: node.did,
      partnerDid: bob.did,
      lastSignatureB64: original.lastSignatureB64,
    });
    expect(store.get(original.id)!.turns).toHaveLength(1);
    expect(store.findActiveBetween(node.did, bob.did)).toEqual(original);
    expect(store.exportAll()).toEqual(before);
  });

  it("refuses replaying the original genesis turn after a cascade is capped", async () => {
    const node = await createIdentity({ handle: "node" });
    const bob = await createIdentity({ handle: "bob" });
    const store = new RrrStore();
    const opened = await openCascade(new RrrStore(), bob, node.did);
    const genesis = opened.turns[0]!;
    let c = await acceptInboundTurn(store, node.did, genesis);
    while (c.depth < 49) {
      const actor = c.nextToActDid === node.did ? node : bob;
      c = (await escalate(store, actor, c.id)).cascade;
    }
    expect(c.status).toBe("capped");
    expect(c.turns).toHaveLength(49);
    const before = structuredClone(store.exportAll());

    await expect(acceptInboundTurn(store, node.did, genesis)).rejects.toMatchObject({
      code: "cascade_id_taken",
      status: 409,
    });
    expect(store.get(c.id)).toMatchObject({ depth: 49, status: "capped" });
    expect(store.get(c.id)!.turns).toHaveLength(49);
    expect(store.exportAll()).toEqual(before);
  });

  it("admits an inbound genesis turn with a fresh id from a new peer", async () => {
    const node = await createIdentity({ handle: "node" });
    const bob = await createIdentity({ handle: "bob" });
    const peer = await createIdentity({ handle: "peer" });
    const store = new RrrStore();
    await openCascade(store, node, bob.did);
    const opened = await openCascade(new RrrStore(), peer, node.did);

    const admitted = await acceptInboundTurn(store, node.did, opened.turns[0]!);
    expect(admitted).toMatchObject({
      id: opened.id,
      depth: 1,
      initiatorDid: peer.did,
      partnerDid: node.did,
      nextToActDid: node.did,
    });
    expect(store.get(opened.id)).toEqual(admitted);
    expect(store.list()).toHaveLength(2);
  });

  it("wall/rrr-must-alternate — refuses when wrong party tries to escalate", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const bob = await createIdentity({ handle: "bob" });
    const store = new RrrStore();
    await openCascade(store, alice, bob.did);
    // Now it's Bob's turn. Alice trying to escalate must be refused.
    const cascade = store.list()[0]!;
    await expect(escalate(store, alice, cascade.id)).rejects.toMatchObject({
      code: "rrr_must_alternate",
      status: 403,
    });
  });

  it("accepts a valid depth-2 turn from the correct party, alternates, and chains", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const bob = await createIdentity({ handle: "bob" });
    const store = new RrrStore();
    const c1 = await openCascade(store, alice, bob.did);
    // Bob sees alice's depth-1; bob signs depth-2 locally then inbound-accepts.
    const turnAtIso = new Date().toISOString();
    const basisText = "I know you know.";
    const sig = await signRrrTurn(
      {
        cascadeId: c1.id,
        depth: 2,
        byDid: bob.did,
        basisText,
        prevSignatureB64: c1.lastSignatureB64,
        turnAtIso,
      },
      bob.secretKey,
    );
    const c2 = await acceptInboundTurn(store, alice.did, {
      cascadeId: c1.id,
      depth: 2,
      byDid: bob.did,
      toDid: alice.did,
      basisText,
      prevSignatureB64: c1.lastSignatureB64,
      signatureB64: sig,
      turnAtIso,
    });
    expect(c2.depth).toBe(2);
    expect(c2.nextToActDid).toBe(alice.did);
    expect(c2.turns.length).toBe(2);
  });

  it("wall/rrr-each-turn-signed-with-chain — refuses wrong prev_signature_b64", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const bob = await createIdentity({ handle: "bob" });
    const store = new RrrStore();
    const c1 = await openCascade(store, alice, bob.did);
    const turnAtIso = new Date().toISOString();
    const basisText = "I know you know.";
    // Sign with a CORRECT prev-sig so the signature itself verifies …
    const sig = await signRrrTurn(
      {
        cascadeId: c1.id,
        depth: 2,
        byDid: bob.did,
        basisText,
        prevSignatureB64: "wrong-prev",
        turnAtIso,
      },
      bob.secretKey,
    );
    // … but submit it with the wrong prev-sig (which is what the bytes claim).
    await expect(
      acceptInboundTurn(store, alice.did, {
        cascadeId: c1.id,
        depth: 2,
        byDid: bob.did,
        toDid: alice.did,
        basisText,
        prevSignatureB64: "wrong-prev",
        signatureB64: sig,
        turnAtIso,
      }),
    ).rejects.toMatchObject({ code: "prev_signature_must_chain" });
  });

  it("verifies a 3-deep cascade end-to-end", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const bob = await createIdentity({ handle: "bob" });
    const store = new RrrStore();
    let c = await openCascade(store, alice, bob.did);
    // bob -> depth 2
    {
      const t = await signRrrTurn(
        { cascadeId: c.id, depth: 2, byDid: bob.did, basisText: "I know you know.", prevSignatureB64: c.lastSignatureB64, turnAtIso: "2026-05-18T00:00:01Z" },
        bob.secretKey,
      );
      c = await acceptInboundTurn(store, alice.did, {
        cascadeId: c.id, depth: 2, byDid: bob.did, toDid: alice.did, basisText: "I know you know.",
        prevSignatureB64: c.lastSignatureB64, signatureB64: t, turnAtIso: "2026-05-18T00:00:01Z",
      });
    }
    // alice -> depth 3
    const r = await escalate(store, alice, c.id, { turnAtIso: "2026-05-18T00:00:02Z" });
    expect(r.cascade.depth).toBe(3);
    const v = await verifyCascade(r.cascade);
    expect(v.ok).toBe(true);
  });

  it("wall/rrr-depth-cap-at-49 — caps cascade at 49 (seven sevens)", async () => {
    // Construct a cascade artificially close to the cap to keep the test fast.
    const alice = await createIdentity({ handle: "alice" });
    const bob = await createIdentity({ handle: "bob" });
    const store = new RrrStore();
    let c = await openCascade(store, alice, bob.did);
    // Manually advance: alternate between alice and bob, up to depth 49.
    let current: typeof bob | typeof alice = bob;
    while (c.depth < 49) {
      const turnAtIso = `2026-05-18T00:01:${String(c.depth).padStart(2, "0")}Z`;
      if (current.did === c.nextToActDid) {
        const ret = await escalate(store, current, c.id, { turnAtIso });
        c = ret.cascade;
      }
      current = current === alice ? bob : alice;
    }
    expect(c.status).toBe("capped");
    expect(c.depth).toBe(49);
    expect(c.nextToActDid).toBeNull();
    // Further escalations refused — the cap applied flipped status to capped,
    // so the lifecycle returns the cascade_not_active refusal (the cap held).
    await expect(escalate(store, alice, c.id)).rejects.toMatchObject({ code: "cascade_not_active" });
    await expect(escalate(store, bob, c.id)).rejects.toMatchObject({ code: "cascade_not_active" });
  });
});
