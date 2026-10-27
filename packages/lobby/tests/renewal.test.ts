/** Renewal inside the term, hermetically: a member's signed renew note, the
 * hub's renew-sweep (term, season, pause and block checks, a grant bound to
 * the member's own token hash, a door-signed renewal notice carrying the
 * token-free invitation template), and the member's pickup that accepts the
 * same digest again. Also the pre-supplied hash list for a season run by
 * hand. Fake service, file-backed Keychain stand-in, scripted terminals. */
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DATABASE_FILE } from "../src/home.js";
import { DIRECTORY_GATE_ROOM, ParticipantClient, prepareObservation } from "../src/hosted.js";
import { DeskSecrets } from "../src/secrets.js";
import { invitationTemplateOf, openDocument, sealDocument, type RenewalBody, type RenewBody } from "../src/signed.js";
import { LobbyStore } from "../src/store.js";
import { checkEgress } from "../src/egress.js";
import { generateKeyPair, missionDigest, publicKeyFingerprint, type MissionDescriptor } from "../src/wire.js";
import { FAKE_BEARER } from "./fake-hosted.js";
import { DEVICE_TERMS, deskOf, enrollThroughHub, expectNoSecretIn, json, ok, seatedFleet, shownBytes, type Fleet } from "./fleet-helpers.js";
import { cleanupTempHomes } from "./helpers.js";

afterEach(cleanupTempHomes);

const HOUR = 3_600_000;

function deviceSeasonGrants(fleet: Fleet) {
  const identity = deskOf(fleet.device).identity_id;
  return [...fleet.world.hosted.grants.values()].filter((grant) => grant.identity_id === identity && grant.mission_id === fleet.seasonId);
}

function renewals(fleet: Fleet, missionId: string): RenewalBody[] {
  return fleet.world.hosted.summaries(missionId)
    .map((summary) => openDocument(summary))
    .filter((document) => document?.kind === "renewal")
    .map((document) => document!.body as RenewalBody);
}

describe("renewal inside the term", () => {
  test("a player renews in the room: request, sweep, accept the same digest", async () => {
    const fleet = await seatedFleet();
    const { hub, device } = fleet;
    const hosted = fleet.world.hosted;
    fleet.world.advance(20 * HOUR);

    const requested = await ok(device.yes("room", "renew", "request", fleet.roomId));
    expect(requested.stdout).toContain("posted to the room");
    const token = /token sha256 ([0-9a-f]{64})/.exec(requested.stdout)![1]!;
    const note = JSON.parse(shownBytes(device));
    expect(note).toMatchObject({ act: "room.renew.request", room_id: fleet.roomId, mission_id: fleet.seasonId });
    expect(openDocument(note.summary)).toMatchObject({ kind: "renew", body: { token_sha256: token, identity_id: deskOf(device).identity_id } });
    // Only the hash leaves the desk; the token stays in its private secrets.
    expect(DeskSecrets.open(device.home).hasToken(token)).toBe(true);
    for (const request of hosted.seen) expectNoSecretIn(request.body);

    // Nothing is picked up before the hub sweeps.
    device.answers.push("yes");
    expect((await device.run("room", "renew", "accept", fleet.roomId)).stderr).toContain("not_renewed_yet");
    device.answers.length = 0;

    const swept = await ok(hub.yes("hub", "renew-sweep"));
    const sweepBytes = JSON.parse(shownBytes(hub));
    expect(sweepBytes.act).toBe("hub.renew.sweep");
    expect(sweepBytes.renewals).toHaveLength(1);
    const renewal = sweepBytes.renewals[0];
    expect(renewal).toMatchObject({ basis: "request", room_id: fleet.roomId, grant: { mission_id: fleet.seasonId, token_sha256: token, actions: ["mission.observe", "mission.read"] } });
    expect(Date.parse(renewal.grant.expires_at) - fleet.world.clock.now.getTime()).toBeLessThanOrEqual(24 * HOUR);
    // The grant is bound to the member's own hash; the service minted no token.
    const issued = hosted.grants.get(renewal.grant.grant_id)!;
    expect(issued.token_sha256).toBe(token);
    // The door-signed notice carries the token-free template; the hub prints the exact template too.
    const notice = renewals(fleet, fleet.seasonId).find((body) => body.invitation.token_sha256 === token)!;
    expect(notice.invitation.grant_id).toBe(renewal.grant.grant_id);
    const printed = JSON.parse(swept.stdout.slice(swept.stdout.indexOf("{\n"))).invitation_templates[0];
    expect(Object.keys(printed)).toEqual(["format", "origin", "mission_id", "grant_id", "identity_id", "signing_key_id", "public_key", "expires_at", "token_sha256"]);
    expect(printed).toEqual(invitationTemplateOf(notice));
    expect(printed).toMatchObject({ format: "agenttool-mission-invitation-template/v1", public_key: deskOf(device).public_key, token_sha256: token });
    for (const summary of hosted.summaries(fleet.seasonId)) {
      expect(checkEgress(summary, { room: { residency: "fleet" }, deviceTerms: DEVICE_TERMS }).ok).toBe(true);
    }

    // The member picks it up and accepts exactly the digest it accepted before.
    const accepted = await ok(device.yes("room", "renew", "accept", fleet.roomId));
    expect(accepted.stdout).toContain(`accepted digest ${fleet.seasonDigest} again`);
    expect(JSON.parse(shownBytes(device))).toMatchObject({ act: "room.renew.accept", mission_digest: fleet.seasonDigest, invitation_template: printed });
    expect(issued.accepted_at).not.toBeNull();
    // The same sweep renewed the hub desk's own seats, which ended within 20 hours.
    expect(sweepBytes.hub_seats.map((seat: any) => [seat.purpose, seat.mission_id])).toEqual([["directory", fleet.directoryId], ["season", fleet.seasonId]]);
    expect(swept.stdout).toContain(`hub desk seat in the directory ${fleet.directoryId} until`);
    // A second sweep finds nothing new; the processed request is quiet and the seats are fresh.
    expect((await ok(hub.yes("hub", "renew-sweep"))).stdout).toContain("nothing to renew");
    // The new grant carries the seat past the old one's end.
    fleet.world.advance(6 * HOUR);
    await ok(device.yes("room", "say", fleet.roomId, "--text", "still here after the renewal"));
    // With --rooms-only the sweep is what it was before directory renewal: it
    // renews no seat and says so when the hub's own seat has lapsed.
    fleet.world.advance(25 * HOUR);
    expect((await hub.yes("hub", "renew-sweep", "--rooms-only")).stderr).toContain("run hub seat directory");
    await ok(hub.yes("hub", "seat", "directory"));
  });

  test("a spectator, who may not post in the room, renews through the directory", async () => {
    const fleet = await seatedFleet({ tier: "spectator" });
    fleet.world.advance(20 * HOUR);
    const requested = await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    expect(requested.stdout).toContain("posted to the directory");
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    expect(renewals(fleet, fleet.directoryId)).toHaveLength(1);
    expect(renewals(fleet, fleet.seasonId)).toHaveLength(0);
    await ok(fleet.device.yes("room", "renew", "accept", fleet.roomId));
    const latest = deviceSeasonGrants(fleet).sort((left, right) => left.issued_at < right.issued_at ? 1 : -1)[0]!;
    expect(latest.actions).toEqual(["mission.read"]);
    expect(latest.accepted_at).not.toBeNull();
  });

  test("a paused member is not renewed until resumed; pause and resume are confirmed and audited", async () => {
    const fleet = await seatedFleet();
    const member = deskOf(fleet.device).identity_id;
    await ok(fleet.hub.yes("hub", "member", "pause", fleet.roomId, member));
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    const skipped = await ok(fleet.hub.yes("hub", "renew-sweep"));
    expect(skipped.stdout).toContain("nothing to renew");
    expect(skipped.stdout).toContain("paused");
    const listing = await json(fleet.hub.run("hub", "members", fleet.roomId, "--json"));
    expect(listing.members[0]).toMatchObject({ identity_id: member, state: "active" });
    expect(listing.members[0].paused_at).not.toBeNull();
    await ok(fleet.hub.yes("hub", "member", "resume", fleet.roomId, member));
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    await ok(fleet.device.yes("room", "renew", "accept", fleet.roomId));
    const acts = (await json(fleet.hub.run("audit", "list", "--json"))).entries.map((entry: any) => entry.act);
    expect(acts).toEqual(expect.arrayContaining(["hub.member.pause", "hub.member.resume", "hub.renew.sweep", "hub.renew.sweep.outcome"]));
  });

  test("a member whose term has ended, or whose season changed, is not renewed", async () => {
    const fleet = await seatedFleet();
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    // End the term in the hub's own records (as a short --term-days would).
    const raw = new Database(join(fleet.hub.home, DATABASE_FILE));
    raw.query("UPDATE hub_members SET term_ends_at = $at").run({ $at: new Date(fleet.world.clock.now.getTime() + 30_000).toISOString() });
    raw.close();
    const swept = await ok(fleet.hub.yes("hub", "renew-sweep"));
    expect(swept.stdout).toContain("term_ended");
  });

  test("forged, foreign and replayed renew notes renew nothing", async () => {
    const fleet = await seatedFleet();
    const hosted = fleet.world.hosted;
    const other = fleet.world.desk("other");
    await enrollThroughHub(fleet.hub, other);
    const device = deskOf(fleet.device);
    // Another enrolled desk signs a renew note naming the member, with its own key.
    const now = fleet.world.clock.now;
    const body: RenewBody = {
      room_id: fleet.roomId, mission_id: fleet.seasonId, identity_id: device.identity_id, signing_key_id: device.signing_key_id,
      token_sha256: DeskSecrets.open(other.home).newToken(now).token_sha256, issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + HOUR).toISOString(),
    };
    const forged = sealDocument("renew", body, { privateKey: DeskSecrets.open(other.home).deskKey(), fingerprint: deskOf(other).fingerprint });
    // Posted properly by the other desk with its own directory seat: a valid proof, a foreign claim.
    const otherStore = LobbyStore.open(other.home);
    const otherRow = otherStore.fleet.desk()!;
    const otherSeat = { ...otherStore.fleet.currentDeskGrant(fleet.directoryId, now)!, identity_id: otherRow.identity_id, signing_key_id: otherRow.signing_key_id };
    otherStore.close();
    const client = new ParticipantClient(DeskSecrets.open(other.home), { fetchImpl: hosted.fetch, now: () => fleet.world.clock.now, deviceTerms: DEVICE_TERMS });
    const post = prepareObservation(forged.summary, DIRECTORY_GATE_ROOM, DEVICE_TERMS);
    await client.observe(otherSeat, post.raw_body, DIRECTORY_GATE_ROOM);
    // A note signed by a key no one enrolled (the service's proof is not checked for it at all).
    const stranger = generateKeyPair();
    const unknown = sealDocument("renew", body, { privateKey: stranger, fingerprint: publicKeyFingerprint(Buffer.from(stranger.export({ format: "jwk" }).x!, "base64url").toString("base64")) });
    const otherGrant = [...hosted.grants.values()].find((grant) => grant.identity_id === deskOf(other).identity_id)!;
    hosted.injectEvent(fleet.directoryId, otherGrant.grant_id, unknown.summary);
    // The member's own note, then a byte-for-byte replay of it under another grant: the replay fails its proof.
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    const own = JSON.parse(shownBytes(fleet.device)).summary as string;
    hosted.injectEvent(fleet.seasonId, otherGrant.grant_id, own);
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    // Exactly one renewal: the member's own request. The rest are shown, with reasons, in the confirmed bytes.
    const sweepBytes = JSON.parse(shownBytes(fleet.hub));
    expect(sweepBytes.skipped.map((item: any) => item.reason).sort()).toEqual(["names_another_desk", "sender_mismatch", "unknown_desk"]);
    expect(sweepBytes.renewals.map((renewal: any) => renewal.grant.token_sha256)).toEqual([(openDocument(own)!.body as RenewBody).token_sha256]);
    expect(deviceSeasonGrants(fleet)).toHaveLength(2);
  });

  test("a renewal whose grant response is lost is never retried, and blocks that token until inspected", async () => {
    const fleet = await seatedFleet();
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    fleet.world.hosted.loseResponse = (request) => request.method === "POST" && request.path.endsWith("/grants");
    const lost = await fleet.hub.yes("hub", "renew-sweep");
    expect(lost.code).toBe(1);
    expect(lost.stderr).toContain("uncertain");
    const again = await ok(fleet.hub.yes("hub", "renew-sweep"));
    expect(again.stdout).toMatch(/grant_uncertain:[0-9a-f-]{36}/);
    const grantsPosted = fleet.world.hosted.seen.filter((request) => request.method === "POST" && request.path === `/v1/collaboration/missions/${fleet.seasonId}/grants`);
    expect(grantsPosted.filter((request) => JSON.parse(request.body).identity_id === deskOf(fleet.device).identity_id)).toHaveLength(2); // admit, then the one renewal
  });

  test("without a terminal, renew-sweep reads no Keychain item and sends nothing", async () => {
    const fleet = await seatedFleet();
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    const headless = fleet.world.desk("hub-headless", { noTerminal: true, of: fleet.hub });
    let reads = 0;
    const original = headless.keychain.read.bind(headless.keychain);
    headless.keychain.read = async (ref) => {
      reads += 1;
      return original(ref);
    };
    const seen = fleet.world.hosted.seen.length;
    const result = await headless.run("hub", "renew-sweep");
    expect(result.code).toBe(3);
    expect(reads).toBe(0);
    expect(fleet.world.hosted.seen).toHaveLength(seen);
  });
});

describe("a season run by hand, adopted, renewed from a supplied hash list", () => {
  test("member add records the member's key and grants; the sweep issues grants for the listed hashes", async () => {
    const fleet = await seatedFleet();
    const hosted = fleet.world.hosted;
    const descriptor: MissionDescriptor = {
      format: "agenttool-collaboration-mission/v1",
      purpose: "Zerone season 1: hello, reply and read_ack between two devices",
      resources: [],
      acceptance_criteria: ["Exchange one hello, one reply and one read_ack"],
      principalities: [],
    };
    const missionId = crypto.randomUUID();
    await hosted.fetch("https://api.agenttool.dev/v1/collaboration/missions", {
      method: "POST", redirect: "error", headers: { Authorization: `Bearer ${FAKE_BEARER}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mission_id: missionId, descriptor, expires_at: new Date(fleet.world.clock.now.getTime() + 20 * 24 * HOUR).toISOString() }),
    });
    const added = await json(fleet.hub.run("room", "add", "--title", "Zerone adopted", "--door", "invite", "--json"));
    const roomId = added.card.room_id as string;
    await ok(fleet.hub.yes("room", "promote", roomId, "--residency", "fleet", "--hostable", "true"));
    await ok(fleet.hub.yes("hub", "season", "adopt", roomId, "--mission", missionId, "--digest", missionDigest(descriptor)));

    // The member already joined by hand: its key is the one the hub enrolled; a hand-issued grant is registered for kick and stop.
    const member = deskOf(fleet.device);
    const handGrant = crypto.randomUUID();
    await ok(fleet.hub.yes("hub", "member", "add", roomId, "--identity", member.identity_id, "--tier", "player", "--term-days", "10", "--grant-id", handGrant));
    const addBytes = JSON.parse(shownBytes(fleet.hub));
    expect(addBytes).toMatchObject({ act: "hub.member.add", member: { identity_id: member.identity_id, public_key: member.public_key, new_device: false }, extra_grant_ids: [handGrant] });
    expect(hosted.summaries(missionId).some((summary) => summary.includes('"kind":"member_roster"'))).toBe(true);

    // The member generated a token on its own device (participant client token-new) and handed over only the hash.
    const { token_sha256 } = DeskSecrets.open(fleet.device.home).newToken(fleet.world.clock.now);
    const list = fleet.hub.file("hashes.json", JSON.stringify({
      format: "agenttool-lobby-renew-hashes/v1", room_id: roomId, entries: [{ identity_id: member.identity_id, token_sha256 }],
    }));
    expect((await fleet.hub.run("hub", "renew-sweep", "--hashes-file", list)).code).toBe(2); // the list names its room with --room too
    const swept = await ok(fleet.hub.yes("hub", "renew-sweep", "--room", roomId, "--hashes-file", list));
    const template = JSON.parse(swept.stdout.slice(swept.stdout.indexOf("{\n"))).invitation_templates[0];
    expect(template).toMatchObject({ mission_id: missionId, identity_id: member.identity_id, public_key: member.public_key, token_sha256 });
    expect(JSON.parse(shownBytes(fleet.hub)).renewals[0]).toMatchObject({ basis: "list", request_event_id: null });

    // The template plus the member's own token is a working seat: invitation, then accept of the same digest.
    const client = new ParticipantClient(DeskSecrets.open(fleet.device.home), { fetchImpl: hosted.fetch, now: () => fleet.world.clock.now });
    const seat = { mission_id: missionId, grant_id: template.grant_id, identity_id: member.identity_id, signing_key_id: member.signing_key_id, token_sha256 };
    expect((await client.invitation(seat)).mission.mission_digest).toBe(missionDigest(descriptor));
    expect((await client.accept(seat, missionDigest(descriptor))).grant.accepted_at).not.toBeNull();
    // A listed hash is used once.
    expect((await ok(fleet.hub.yes("hub", "renew-sweep", "--room", roomId, "--hashes-file", list))).stdout).toContain("renewed");
    const store = LobbyStore.open(fleet.hub.home);
    expect(store.fleet.listExtraGrants().map((grant) => grant.grant_id)).toEqual([handGrant]);
    store.close();
  });
});
