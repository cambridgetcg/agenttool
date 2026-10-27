/** Leaving and being removed, hermetically: self-leave (POST .../leave with
 * zero body bytes), kick and block (administrator grant revocation with zero
 * body bytes, a door-signed roster without the member, blocked knocks),
 * unblock, the emergency stop (every lobby grant and created mission revoked,
 * the manual key-rotation step printed, nothing more issued), the audit log
 * and the weekly access digest. Fake service, file-backed Keychain stand-in,
 * scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { openDocument, type MemberRosterBody } from "../src/signed.js";
import { LobbyStore } from "../src/store.js";
import { missionDigest, type MissionDescriptor } from "../src/wire.js";
import { FAKE_BEARER } from "./fake-hosted.js";
import { deskOf, expectNoSecretIn, json, ok, seatedFleet, shownBytes, type Fleet } from "./fleet-helpers.js";
import { cleanupTempHomes } from "./helpers.js";

afterEach(cleanupTempHomes);

const HOUR = 3_600_000;
const MISSIONS = "/v1/collaboration/missions";

function memberGrants(fleet: Fleet) {
  const identity = deskOf(fleet.device).identity_id;
  return [...fleet.world.hosted.grants.values()].filter((grant) => grant.identity_id === identity && grant.mission_id === fleet.seasonId);
}

function latestRoster(fleet: Fleet): MemberRosterBody {
  return fleet.world.hosted.summaries(fleet.seasonId)
    .map((summary) => openDocument(summary))
    .filter((document) => document?.kind === "member_roster")
    .map((document) => document!.body as MemberRosterBody)
    .sort((left, right) => right.roster_seq - left.roster_seq)[0]!;
}

describe("a member leaves", () => {
  test("room leave posts a leave notice, then leaves every live grant with zero body bytes", async () => {
    const fleet = await seatedFleet();
    const hosted = fleet.world.hosted;
    // Renew first, so two live grants exist: leave must end both.
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    await ok(fleet.device.yes("room", "renew", "accept", fleet.roomId));
    expect(memberGrants(fleet).filter((grant) => grant.revoked_at === null)).toHaveLength(2);

    const left = await ok(fleet.device.yes("room", "leave", fleet.roomId));
    const bytes = JSON.parse(shownBytes(fleet.device));
    expect(bytes.act).toBe("room.leave");
    expect(bytes.leave.map((item: any) => [item.request, item.body_bytes])).toEqual(
      memberGrants(fleet).map(() => [`POST ${MISSIONS}/${fleet.seasonId}/leave`, 0]));
    expect(openDocument(bytes.notice.summary)).toMatchObject({ kind: "leave", body: { identity_id: deskOf(fleet.device).identity_id } });
    const leaves = hosted.seen.filter((request) => request.method === "POST" && request.path === `${MISSIONS}/${fleet.seasonId}/leave`);
    expect(leaves).toHaveLength(2);
    for (const request of leaves) {
      expect(request.body).toBe("");
      expect(request.authorization).toMatch(/^Bearer atcm_/);
    }
    expect(memberGrants(fleet).every((grant) => grant.revoked_at !== null && grant.left === true)).toBe(true);
    expect(left.stdout.match(/left grant/g)).toHaveLength(2);
    // Nothing left to read with; a repeat has nothing to leave.
    expect((await fleet.device.run("room", "read", fleet.roomId)).stderr).toContain("no_seat");
    fleet.device.answers.push("yes");
    expect((await fleet.device.run("room", "leave", fleet.roomId)).stderr).toContain("not_seated");

    // The hub's sweep records the leave and posts a roster without the member.
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    const listing = await json(fleet.hub.run("hub", "members", fleet.roomId, "--json"));
    expect(listing.members[0].state).toBe("left");
    expect(latestRoster(fleet).members.map((member) => member.role)).toEqual(["host"]);
  });

  test("the host desk does not leave its own room", async () => {
    const fleet = await seatedFleet();
    fleet.hub.answers.push("yes");
    const refused = await fleet.hub.run("room", "leave", fleet.roomId);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("host_cannot_leave");
  });
});

describe("the hub kicks and blocks", () => {
  test("kick revokes the member's grants with zero body bytes and posts a roster without them", async () => {
    const fleet = await seatedFleet();
    const hosted = fleet.world.hosted;
    const member = deskOf(fleet.device).identity_id;
    const kicked = await ok(fleet.hub.yes("hub", "kick", fleet.roomId, member));
    const bytes = JSON.parse(shownBytes(fleet.hub));
    expect(bytes).toMatchObject({ act: "hub.kick", identity_id: member, block: false, member_state_before: "active" });
    const grant = memberGrants(fleet)[0]!;
    expect(bytes.revocations).toEqual([{ mission_id: fleet.seasonId, grant_id: grant.grant_id, request: `POST ${MISSIONS}/${fleet.seasonId}/grants/${grant.grant_id}/revoke`, body_bytes: 0 }]);
    const revoke = hosted.seen.filter((request) => request.path.endsWith("/revoke"));
    expect(revoke.map((request) => [request.method, request.body, request.authorization])).toEqual([["POST", "", `Bearer ${FAKE_BEARER}`]]);
    expect(grant.revoked_at).not.toBeNull();
    expect(kicked.stdout).toContain(`revoked grant ${grant.grant_id}`);
    expect(latestRoster(fleet).members.map((item) => item.identity_id)).toEqual([deskOf(fleet.hub).identity_id]);
    // The member's next read is refused by the service.
    const read = await fleet.device.run("room", "read", fleet.roomId);
    expect(read.code).toBe(1);
    expect(read.stderr).toContain("hosted_refused");
    // Kicked members are not renewed.
    const listing = await json(fleet.hub.run("hub", "members", fleet.roomId, "--json"));
    expect(listing.members[0].state).toBe("kicked");
    // A replayed older roster never restores the kicked member's pin.
    const store = LobbyStore.open(fleet.hub.home);
    const hubSeason = store.fleet.currentDeskGrant(fleet.seasonId, fleet.world.clock.now)!;
    store.close();
    const first = hosted.summaries(fleet.seasonId).find((summary) => summary.includes('"roster_seq":1'))!;
    hosted.injectEvent(fleet.seasonId, hubSeason.grant_id, first);
    await ok(fleet.hub.run("room", "sync", fleet.roomId));
    const roster = await json(fleet.hub.run("room", "roster", fleet.roomId, "--json"));
    expect(roster.roster.roster_seq).toBe(2);
    expect(roster.roster.members.map((item: any) => item.role)).toEqual(["host"]);
    // The hub desk cannot kick itself.
    fleet.hub.answers.push("yes");
    expect((await fleet.hub.run("hub", "kick", fleet.roomId, deskOf(fleet.hub).identity_id)).stderr).toContain("cannot_remove_host");
  });

  test("block also refuses the member's future knocks on this room; unblock lifts only that", async () => {
    const fleet = await seatedFleet();
    const member = deskOf(fleet.device).identity_id;
    await ok(fleet.hub.yes("hub", "block", fleet.roomId, member));
    expect(JSON.parse(shownBytes(fleet.hub))).toMatchObject({ act: "hub.block", block: true });
    expect(memberGrants(fleet).every((grant) => grant.revoked_at !== null)).toBe(true);
    // The device knocks again: the hub sees it as invalid (blocked) and cannot admit it.
    const knocked = await ok(fleet.device.yes("knock", fleet.roomId, "--tier", "player"));
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
    const knocks = (await json(fleet.hub.run("hub", "knocks", "--json"))).knocks;
    expect(knocks.find((knock: any) => knock.knock_id === knockId)).toMatchObject({ status: "invalid", reason: "blocked" });
    fleet.hub.answers.push("yes");
    expect((await fleet.hub.run("hub", "admit", knockId)).stderr).toContain("knock_invalid");
    // A second block of a blocked identity holding nothing is refused as a no-op.
    fleet.hub.answers.length = 0;
    fleet.hub.answers.push("yes");
    expect((await fleet.hub.run("hub", "block", fleet.roomId, member)).stderr).toContain("already_blocked");
    fleet.hub.answers.length = 0;
    await ok(fleet.hub.yes("hub", "unblock", fleet.roomId, member));
    const after = (await json(fleet.hub.run("hub", "knocks", "--json"))).knocks.find((knock: any) => knock.knock_id === knockId);
    expect(after.status).toBe("pending");
    await ok(fleet.hub.yes("hub", "admit", knockId));
    expect((await json(fleet.hub.run("hub", "members", fleet.roomId, "--json"))).members[0].state).toBe("active");
  });

  test("an uncertain revocation is reported and settled by running the same command again", async () => {
    const fleet = await seatedFleet();
    const member = deskOf(fleet.device).identity_id;
    fleet.world.hosted.loseResponse = (request) => request.path.endsWith("/revoke");
    const first = await fleet.hub.yes("hub", "kick", fleet.roomId, member);
    expect(first.code).toBe(1);
    expect(first.stderr).toContain("revocation uncertain");
    // Kicked locally already; the second run revokes again (idempotent) and confirms.
    const second = await ok(fleet.hub.yes("hub", "kick", fleet.roomId, member));
    expect(second.stdout).toContain("revoked grant");
  });

  test("without a terminal, kick reads no Keychain item and sends nothing", async () => {
    const fleet = await seatedFleet();
    const headless = fleet.world.desk("hub-headless", { noTerminal: true, of: fleet.hub });
    let reads = 0;
    const original = headless.keychain.read.bind(headless.keychain);
    headless.keychain.read = async (ref) => {
      reads += 1;
      return original(ref);
    };
    const seen = fleet.world.hosted.seen.length;
    expect((await headless.run("hub", "kick", fleet.roomId, deskOf(fleet.device).identity_id)).code).toBe(3);
    expect((await headless.run("hub", "stop")).code).toBe(3);
    expect(reads).toBe(0);
    expect(fleet.world.hosted.seen).toHaveLength(seen);
    expect(memberGrants(fleet).every((grant) => grant.revoked_at === null)).toBe(true);
  });
});

describe("the emergency stop", () => {
  test("revokes every lobby grant and created mission, prints the manual rotation step, and issues nothing more", async () => {
    const fleet = await seatedFleet();
    const hosted = fleet.world.hosted;
    // A season made by hand and adopted: left alone unless --include-adopted.
    const descriptor: MissionDescriptor = {
      format: "agenttool-collaboration-mission/v1", purpose: "Zerone season 1 by hand", resources: [],
      acceptance_criteria: ["Exchange one hello"], principalities: [],
    };
    const adoptedId = crypto.randomUUID();
    await hosted.fetch("https://api.agenttool.dev/v1/collaboration/missions", {
      method: "POST", redirect: "error", headers: { Authorization: `Bearer ${FAKE_BEARER}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mission_id: adoptedId, descriptor, expires_at: new Date(fleet.world.clock.now.getTime() + 10 * 24 * HOUR).toISOString() }),
    });
    const room = (await json(fleet.hub.run("room", "add", "--title", "Adopted", "--json"))).card.room_id;
    await ok(fleet.hub.yes("room", "promote", room, "--residency", "fleet", "--hostable", "true"));
    await ok(fleet.hub.yes("hub", "season", "adopt", room, "--mission", adoptedId, "--digest", missionDigest(descriptor)));

    const stopped = await ok(fleet.hub.yes("hub", "stop"));
    const bytes = JSON.parse(shownBytes(fleet.hub));
    expect(bytes.act).toBe("hub.stop");
    expect(bytes.missions.map((mission: any) => [mission.kind, mission.mission_id, mission.body_bytes]).sort()).toEqual([
      ["directory", fleet.directoryId, 0], ["season", fleet.seasonId, 0],
    ].sort());
    expect(hosted.missions.get(fleet.seasonId)!.revoked_at).not.toBeNull();
    expect(hosted.missions.get(fleet.directoryId)!.revoked_at).not.toBeNull();
    expect(hosted.missions.get(adoptedId)!.revoked_at).toBeNull();
    // Every grant the hub issued, on every mission, adopted ones included.
    const live = [...hosted.grants.values()].filter((grant) => grant.revoked_at === null && Date.parse(grant.expires_at) > fleet.world.clock.now.getTime());
    expect(live).toEqual([]);
    for (const request of hosted.seen.filter((item) => item.path.endsWith("/revoke"))) expect(request.body).toBe("");
    // The manual step, never performed: the desk never calls /v1/keys.
    expect(stopped.stdout).toContain("MANUAL STEP FOR THE OWNER");
    expect(stopped.stdout).toContain("agenttool-lobby.hub-bearer");
    // It names the revoke path that exists, and the 409 a single-key project meets.
    expect(stopped.stdout).toContain("DELETE answers 409");
    expect(stopped.stdout).toContain("POST /v1/keys/rotate");
    expect(stopped.stdout).not.toContain("dashboard");
    expect(hosted.seen.some((request) => request.path.startsWith("/v1/keys"))).toBe(false);
    expectNoSecretIn(stopped.stdout + stopped.stderr);

    // Nothing more is issued, published, admitted or renewed.
    for (const argv of [["room", "publish", fleet.roomId], ["hub", "seat", "directory"], ["hub", "renew-sweep"], ["hub", "roster", "post", fleet.roomId]]) {
      fleet.hub.answers.length = 0;
      fleet.hub.answers.push("yes");
      const refused = await fleet.hub.run(...argv);
      expect({ argv, code: refused.code, stopped: refused.stderr.includes("hub_stopped") }).toEqual({ argv, code: 1, stopped: true });
    }
    // A second stop with --include-adopted revokes the hand-made season too.
    fleet.hub.answers.length = 0;
    await ok(fleet.hub.yes("hub", "stop", "--include-adopted"));
    expect(hosted.missions.get(adoptedId)!.revoked_at).not.toBeNull();
  });
});

describe("audit and the weekly access digest", () => {
  test("every act is audited without secrets; the digest is a local 0600 report that posts nothing", async () => {
    const fleet = await seatedFleet({ termDays: 3 });
    const member = deskOf(fleet.device).identity_id;
    await ok(fleet.device.yes("room", "say", fleet.roomId, "--text", "hello"));
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    await ok(fleet.device.yes("room", "renew", "accept", fleet.roomId));
    await ok(fleet.hub.yes("hub", "member", "pause", fleet.roomId, member));
    await ok(fleet.hub.yes("hub", "kick", fleet.roomId, member));

    const hubActs = (await json(fleet.hub.run("audit", "list", "--json"))).entries.map((entry: any) => entry.act);
    expect(hubActs).toEqual(expect.arrayContaining(["hub.admit", "hub.renew.sweep", "hub.renew.sweep.outcome", "hub.member.pause", "hub.kick", "hub.kick.outcome"]));
    const deviceActs = (await json(fleet.device.run("audit", "list", "--json"))).entries.map((entry: any) => entry.act);
    expect(deviceActs).toEqual(expect.arrayContaining(["room.say", "room.renew.request", "room.renew.accept"]));
    for (const desk of [fleet.hub, fleet.device]) {
      expect((await desk.run("audit", "verify")).stdout).toMatch(/^audit chain intact/);
      for (const entry of (await json(desk.run("audit", "list", "--json"))).entries) expectNoSecretIn(entry.bytes);
    }

    // The digest: headless is fine (no Keychain, no network), nothing is sent.
    const headless = fleet.world.desk("hub-headless", { noTerminal: true, of: fleet.hub });
    const seen = fleet.world.hosted.seen.length;
    const written = await ok(headless.run("hub", "digest"));
    expect(fleet.world.hosted.seen).toHaveLength(seen);
    const path = /to (\/.+\.md)$/m.exec(written.stdout)![1]!;
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    const report = readFileSync(path, "utf8");
    expect(report).toContain("# 大廳 Lobby access digest");
    expect(report).toContain(`did:at:${member}`);
    expect(report).toContain("| kicked |");
    expect(report).toMatch(/since 20\d\d-/); // the pause
    expect(report).toContain("admitted");
    expect(report).toContain("hub.kick");
    expect(report).toContain("renewed");
    expect(report).toContain("Audit chain: intact");
    expectNoSecretIn(report);
    expect(report).not.toMatch(/[0-9a-f]{64}/); // not even token hashes
    // Reports are never overwritten.
    const again = await headless.run("hub", "digest", "--out", path);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("report_exists");
  });
});
