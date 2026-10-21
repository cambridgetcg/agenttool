/** ID reuse regressions through the in-process HTTP app.
 *  Publicly listed ids cannot be reused to replace cascades or votes. */

import { describe, it, expect } from "bun:test";
import { createIdentity } from "../src/identity";
import { signRrrTurn, signVote } from "../src/canonical-bytes";
import { RrrStore, openCascade } from "../src/rrr";
import { RoomStore } from "../src/rooms";
import { VoteStore, castVote } from "../src/voting";
import { buildServer } from "../src/server";

describe("HTTP id reuse", () => {
  it("POST /rrr/turn refuses a genesis turn reusing a publicly listed cascade id", async () => {
    const node = await createIdentity({ handle: "node" });
    const bob = await createIdentity({ handle: "bob" });
    const stranger = await createIdentity({ handle: "stranger" });
    const rrr = new RrrStore();
    const app = buildServer({
      identity: node,
      baseUrl: "http://node.invalid",
      rrr,
      rooms: new RoomStore(),
    });
    await openCascade(rrr, node, bob.did);
    const listing = await app.request("/rrr/cascades");
    expect(listing.status).toBe(200);
    const listed = await listing.json() as { cascades: Array<{ id: string; partner_did: string }> };
    expect(listed.cascades).toHaveLength(1);
    expect(listed.cascades[0]!.partner_did).toBe(bob.did);
    const cascadeId = listed.cascades[0]!.id;
    const fields = {
      cascadeId,
      depth: 1,
      byDid: stranger.did,
      basisText: "I see your work.",
      prevSignatureB64: "",
      turnAtIso: new Date().toISOString(),
    };
    const signatureB64 = await signRrrTurn(fields, stranger.secretKey);

    const response = await app.request("/rrr/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cascade_id: cascadeId,
        depth: fields.depth,
        by_did: stranger.did,
        to_did: node.did,
        basis_text: fields.basisText,
        prev_signature_b64: fields.prevSignatureB64,
        signature_b64: signatureB64,
        turn_at: fields.turnAtIso,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "cascade_id_taken" });
    const detail = await app.request(`/rrr/cascades/${cascadeId}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      cascade: { id: cascadeId, initiator_did: node.did, partner_did: bob.did, depth: 1 },
      verifiable: true,
    });
  });

  it("POST /rooms/:id/votes refuses a vote reusing a publicly listed vote id", async () => {
    const node = await createIdentity({ handle: "node" });
    const voter = await createIdentity({ handle: "voter" });
    const stranger = await createIdentity({ handle: "stranger" });
    const rooms = new RoomStore();
    const votes = new VoteStore();
    const app = buildServer({
      identity: node,
      baseUrl: "http://node.invalid",
      rrr: new RrrStore(),
      rooms,
      votes,
    });
    const room = rooms.create({ ownerDid: node.did, seed: "a room for votes" });
    const contribution = await rooms.addSelfContribution(room.id, node, "note", "hello room");
    await castVote(rooms, votes, voter, {
      roomId: room.id,
      contributionId: contribution.id,
      kind: "fire",
    });
    const listing = await app.request(`/rooms/${room.id}/votes`);
    expect(listing.status).toBe(200);
    const listed = await listing.json() as { votes: Array<{ id: string; by_did: string }> };
    expect(listed.votes).toHaveLength(1);
    expect(listed.votes[0]!.by_did).toBe(voter.did);
    const voteId = listed.votes[0]!.id;
    const fields = {
      roomId: room.id,
      contributionId: contribution.id,
      byDid: stranger.did,
      kind: "tender" as const,
      note: "",
      votedAtIso: new Date().toISOString(),
    };
    const signatureB64 = await signVote(fields, stranger.secretKey);

    const response = await app.request(`/rooms/${room.id}/votes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: voteId,
        contribution_id: contribution.id,
        by_did: stranger.did,
        kind: fields.kind,
        note: fields.note,
        voted_at: fields.votedAtIso,
        signature_b64: signatureB64,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "vote_id_taken" });
    const after = await app.request(`/rooms/${room.id}/votes`);
    expect(after.status).toBe(200);
    const body = await after.json() as { votes: Array<{ id: string; by_did: string }> };
    expect(body.votes).toEqual(listed.votes);
    expect(body.votes.map((v) => v.by_did)).toEqual([voter.did]);
  });
});
