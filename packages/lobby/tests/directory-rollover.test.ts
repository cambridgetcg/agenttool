/** Directory rollover, hermetically: `hub directory successor` (create,
 * resume, finish, the notice and the reposted cards), the move of desks on
 * their next `fleet renew` pickups, the refusals (wrong signer, wrong
 * predecessor, another door, replayed and conflicting notices), the overlap
 * while both directories live, the fallback join into the successor, and the
 * stop revoking every directory. Fake service, file-backed Keychain
 * stand-in, scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { directoryDescriptor } from "../src/hub.js";
import { readDoorKey } from "../src/keychain.js";
import { DIRECTORY_REF_FORMAT, predecessorResource } from "../src/packets.js";
import { generateKeyPair, missionDigest, newUuid, publicKeyBase64, publicKeyFingerprint, type MissionDescriptor } from "../src/wire.js";
import { openDocument, sealDocument, type DirectorySuccessorBody, type FleetCard } from "../src/signed.js";
import { LobbyStore } from "../src/store.js";
import { FAKE_BEARER } from "./fake-hosted.js";
import {
  bootstrapFleet,
  deskOf,
  enrollThroughHub,
  json,
  ok,
  postAs,
  runWhilePromptOpen,
  shownBytes,
  type Desk,
  type Fleet,
} from "./fleet-helpers.js";
import { cleanupTempHomes } from "./helpers.js";

afterEach(cleanupTempHomes);

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DOOR_REF = { service: "agenttool-lobby.door-key", account: "agenttool-lobby" };

type Rolled = Fleet & { second: Desk; successorId: string; successorDigest: string };

function summariesOf(fleet: Fleet, missionId: string): string[] {
  return fleet.world.hosted.summaries(missionId);
}

function kindsIn(fleet: Fleet, missionId: string): string[] {
  return summariesOf(fleet, missionId).map((summary) => openDocument(summary)?.kind ?? "text");
}

async function auditActs(desk: Desk): Promise<string[]> {
  return (await json(desk.run("audit", "list", "--json"))).entries.map((entry: any) => entry.act);
}

async function status(desk: Desk): Promise<any> {
  return (await json(desk.run("fleet", "status", "--json"))).directory;
}

/** Two joined desks, an hour on, then the hub announces a 30-day successor. */
async function rolledOver(): Promise<Rolled> {
  const fleet = await bootstrapFleet();
  const second = fleet.world.desk("second");
  await enrollThroughHub(fleet.hub, second, fleet.doorFingerprint);
  fleet.world.advance(HOUR);
  const announced = await ok(fleet.hub.yes("hub", "directory", "successor", "--days", "30"));
  const [, successorId, successorDigest] = /announced successor directory ([0-9a-f-]{36}) digest (sha256:[0-9a-f]{64})/.exec(announced.stdout)!;
  return { ...fleet, second, successorId: successorId!, successorDigest: successorDigest! };
}

/** One full renewal round for `desks`: each fleet renew, then one sweep. */
async function renewRound(fleet: Fleet, desks: Desk[]): Promise<void> {
  for (const desk of desks) await ok(desk.yes("fleet", "renew"));
  await ok(fleet.hub.yes("hub", "renew-sweep"));
}

/** A notice signed with the hub's door key, as only the door could. */
async function doorSigned(fleet: Fleet, body: DirectorySuccessorBody): Promise<string> {
  const door = await readDoorKey(fleet.hub.keychain, DOOR_REF);
  return sealDocument("directory_successor", body, { privateKey: door, fingerprint: fleet.doorFingerprint }).summary;
}

/** A mission created with the project bearer straight on the service (as a
 * holder of the bearer could), with the given charter. */
async function createMission(fleet: Fleet, descriptor: MissionDescriptor, expiresAt: string): Promise<{ mission_id: string; mission_digest: string }> {
  const missionId = newUuid();
  const response = await fleet.world.hosted.fetch("https://api.agenttool.dev/v1/collaboration/missions", {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${FAKE_BEARER}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mission_id: missionId, descriptor, expires_at: expiresAt }),
  });
  expect(response.status).toBe(201);
  return { mission_id: missionId, mission_digest: missionDigest(descriptor) };
}

/** Issue `desk`'s open directory request straight into `missionId` (as a
 * holder of the bearer could), bypassing the hub's sweep. */
async function issueOpenRequest(fleet: Fleet, desk: Desk, missionId: string): Promise<string> {
  const store = LobbyStore.open(desk.home);
  const row = store.fleet.deskDirectoryRenewals()[0]!;
  store.close();
  const identity = deskOf(desk);
  const response = await fleet.world.hosted.fetch(`https://api.agenttool.dev/v1/collaboration/missions/${missionId}/grants`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${FAKE_BEARER}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_id: row.grant_id, identity_id: identity.identity_id, signing_key_id: identity.signing_key_id,
      actions: ["mission.observe", "mission.read"], expires_at: new Date(fleet.world.clock.now.getTime() + 20 * HOUR).toISOString(),
      token_sha256: row.token_sha256,
    }),
  });
  expect(response.status).toBe(201);
  return row.grant_id;
}

describe("hub directory successor", () => {
  test("creates the successor, takes the hub's seat, posts the door-signed notice and reposts the cards byte for byte", async () => {
    const fleet = await rolledOver();
    const { hub, world } = fleet;
    const bytes = JSON.parse(shownBytes(hub));
    expect(bytes).toMatchObject({
      act: "hub.directory.successor",
      mode: "create",
      from: { mission_id: fleet.directoryId },
      successor: { mission_id: fleet.successorId, mission_digest: fleet.successorDigest },
      hub_seat: { mission_id: fleet.successorId },
      notice: { mission_id: fleet.directoryId },
    });
    // The charter names the same door and its predecessor; nothing else changes.
    const mission = world.hosted.missions.get(fleet.successorId)!;
    const d1 = world.hosted.missions.get(fleet.directoryId)!;
    expect(mission.descriptor.resources).toEqual([d1.descriptor.resources[0]!, predecessorResource({ mission_id: d1.mission_id, mission_digest: d1.digest })]);
    expect(mission.descriptor.resources[1]!.format).toBe(DIRECTORY_REF_FORMAT);
    expect(mission.descriptor.purpose).toBe(d1.descriptor.purpose);
    expect(mission.digest).not.toBe(d1.digest);
    expect(Date.parse(mission.expires_at)).toBeGreaterThan(Date.parse(d1.expires_at));
    // The notice, signed by the door, in the old directory.
    const notice = openDocument(bytes.notice.summary)!;
    expect(notice).toMatchObject({
      kind: "directory_successor",
      signer: fleet.doorFingerprint,
      body: { from_mission_id: fleet.directoryId, from_mission_digest: d1.digest, to_mission_id: fleet.successorId, to_mission_digest: mission.digest,
        to_expires_at: mission.expires_at },
    });
    expect(summariesOf(fleet, fleet.directoryId)).toContain(bytes.notice.summary);
    // The room's latest card, the exact recorded bytes, in the successor.
    const card = summariesOf(fleet, fleet.directoryId).find((summary) => openDocument(summary)?.kind === "card")!;
    expect(bytes.cards).toEqual([expect.objectContaining({ room_id: fleet.roomId, card_seq: 1, mission_id: fleet.successorId, summary: card })]);
    expect(summariesOf(fleet, fleet.successorId)).toEqual([card]);
    // The hub points at the successor, keeps the old one as previous, and its own desk moved.
    const shown = await json(hub.run("hub", "show", "--json"));
    expect(shown.directory).toMatchObject({ mission_id: fleet.successorId, mission_digest: fleet.successorDigest });
    expect(shown.directories.map((row: any) => [row.mission_id, row.state])).toEqual([[fleet.directoryId, "previous"], [fleet.successorId, "current"]]);
    expect((await json(hub.run("fleet", "status", "--json"))).desk.directory_mission_id).toBe(fleet.successorId);
    expect(await auditActs(hub)).toEqual(expect.arrayContaining(["hub.directory.successor", "hub.directory.successor.outcome"]));
    // A relay now issues into the successor only; a second successor waits for the overlap to end.
    const again = await hub.yes("hub", "directory", "successor");
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("overlap_open");
  });

  test("refuses a successor that would not outlast the directory, or one in its last hour; no prompt, nothing sent", async () => {
    const fleet = await bootstrapFleet({ initArgs: ["--days", "10"] });
    const seen = fleet.world.hosted.seen.length;
    const short = await fleet.hub.yes("hub", "directory", "successor", "--days", "5");
    expect(short.code).toBe(1);
    expect(short.stderr).toContain("successor_too_short");
    fleet.world.advance(10 * DAY - 30 * MINUTE);
    const late = await fleet.hub.yes("hub", "directory", "successor");
    expect(late.code).toBe(1);
    expect(late.stderr).toContain("directory_ending");
    expect(fleet.world.hosted.seen.filter((item) => item.method === "POST")).toHaveLength(
      fleet.world.hosted.seen.slice(0, seen).filter((item) => item.method === "POST").length);
    const headless = fleet.world.desk("hub-headless", { noTerminal: true, of: fleet.hub });
    expect((await headless.run("hub", "directory", "successor")).code).toBe(3);
  });

  test("an uncertain create is never retried and resumes with the same id and bytes; --days is refused meanwhile", async () => {
    const fleet = await bootstrapFleet();
    const { hub, world } = fleet;
    world.advance(HOUR);
    world.hosted.loseResponse = (seen) => seen.method === "POST" && seen.path === "/v1/collaboration/missions";
    const lost = await hub.yes("hub", "directory", "successor");
    expect(lost.code).toBe(1);
    expect(lost.stderr).toContain("successor_uncertain");
    const first = JSON.parse(shownBytes(hub)).successor;
    expect(world.hosted.missions.has(first.mission_id)).toBe(true);
    expect(summariesOf(fleet, fleet.directoryId).map((summary) => openDocument(summary)?.kind)).not.toContain("directory_successor");
    expect((await hub.yes("hub", "directory", "successor", "--days", "20")).stderr).toContain("successor_resume_only");
    const resumed = await ok(hub.yes("hub", "directory", "successor"));
    expect(JSON.parse(shownBytes(hub))).toMatchObject({ mode: "resume", successor: first });
    expect(resumed.stdout).toContain(`announced successor directory ${first.mission_id}`);
    const creates = world.hosted.seen.filter((seen) => seen.method === "POST" && seen.path === "/v1/collaboration/missions"
      && JSON.parse(seen.body).mission_id === first.mission_id);
    expect(creates).toHaveLength(2);
    // The same id, charter (as recorded, so its digest) and end.
    expect(JSON.parse(creates[1]!.body)).toEqual(JSON.parse(creates[0]!.body));
  });

  test("a failed seat leaves the successor created and unannounced; the next run finishes it", async () => {
    const fleet = await bootstrapFleet();
    const { hub, world } = fleet;
    world.advance(HOUR);
    world.hosted.failNext = (seen) => seen.method === "POST" && /\/missions\/[0-9a-f-]{36}\/grants$/.test(seen.path);
    const failed = await hub.yes("hub", "directory", "successor");
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("run hub directory successor again to finish");
    const successor = JSON.parse(shownBytes(hub)).successor;
    expect(world.hosted.missions.has(successor.mission_id)).toBe(true);
    expect(kindsIn(fleet, fleet.directoryId)).not.toContain("directory_successor");
    expect((await json(hub.run("hub", "show", "--json"))).directory.mission_id).toBe(fleet.directoryId);
    expect((await hub.yes("hub", "directory", "successor", "--days", "30")).stderr).toContain("successor_exists");
    await ok(hub.yes("hub", "directory", "successor"));
    expect(JSON.parse(shownBytes(hub))).toMatchObject({ mode: "finish", successor: { mission_id: successor.mission_id } });
    expect(kindsIn(fleet, fleet.directoryId)).toContain("directory_successor");
    expect((await json(hub.run("hub", "show", "--json"))).directory.mission_id).toBe(successor.mission_id);
  });

  test("an unsent notice stays in the outbox and is never re-signed", async () => {
    const fleet = await bootstrapFleet();
    const { hub, world } = fleet;
    world.advance(HOUR);
    world.hosted.loseResponse = (seen) => seen.method === "POST" && seen.path === `/v1/collaboration/missions/${fleet.directoryId}/events`;
    const sent = await hub.yes("hub", "directory", "successor");
    expect(sent.code).toBe(1);
    const notice = JSON.parse(shownBytes(hub)).notice;
    expect(sent.stderr).toContain(`outbox retry ${notice.event_id}`);
    // Announced (the pointer moved), and a second run does not sign another notice.
    const again = await hub.yes("hub", "directory", "successor");
    expect(again.stderr).toContain("overlap_open");
    await ok(hub.yes("outbox", "retry", notice.event_id));
    expect(summariesOf(fleet, fleet.directoryId).filter((summary) => openDocument(summary)?.kind === "directory_successor")).toEqual([notice.summary]);
  });
});

describe("desks move to the successor on their next fleet renew pickups", () => {
  test("two desks ask for the successor from the old directory, are renewed there, and move with the door pin unchanged", async () => {
    const fleet = await rolledOver();
    const { hub, device, second, world } = fleet;
    for (const desk of [device, second]) {
      // fleet status reads only the local cache: before a sync the notice is not there.
      expect((await status(desk)).successor).toBeNull();
      await ok(desk.run("fleet", "sync"));
      expect(await status(desk)).toMatchObject({ mission_id: fleet.directoryId, successor: { state: "announced", mission_id: fleet.successorId } });
    }
    // Each request names the successor and is posted in the old directory.
    for (const desk of [device, second]) {
      await ok(desk.yes("fleet", "renew"));
      expect(JSON.parse(shownBytes(desk)).request).toMatchObject({ mission_id: fleet.directoryId, target_mission_id: fleet.successorId });
      expect(desk.terminal.written.join("")).toContain(`door-signed successor directory ${fleet.successorId}`);
    }
    // One sweep issues both first grants in the successor; the notices go where the requests were posted.
    world.advance(HOUR);
    await ok(hub.yes("hub", "renew-sweep"));
    const sweep = JSON.parse(shownBytes(hub));
    expect(sweep.directory_renewals.map((item: any) => [item.grant.identity_id, item.grant.mission_id, item.notice.mission_id]).sort())
      .toEqual([deskOf(device).identity_id, deskOf(second).identity_id].sort().map((id) => [id, fleet.successorId, fleet.directoryId]));
    // The hub desk's seats are renewed in both directories when due; nothing is due an hour after the successor.
    for (const desk of [device, second]) {
      const moved = await ok(desk.yes("fleet", "renew"));
      const bytes = JSON.parse(shownBytes(desk));
      expect(bytes.pickup).toMatchObject({
        mission_id: fleet.successorId, mission_digest: fleet.successorDigest,
        move: { from_mission_id: fleet.directoryId, to_mission_id: fleet.successorId },
      });
      // The next request goes out in the successor, with the grant just picked up.
      expect(bytes.request).toMatchObject({ mission_id: fleet.successorId });
      expect(bytes.request.target_mission_id).toBeUndefined();
      expect(moved.stdout).toContain(`moved this desk to the door-signed successor directory ${fleet.successorId}`);
      expect(desk.terminal.written.join("")).toContain("the door pin is unchanged");
      const after = await json(desk.run("fleet", "status", "--json"));
      expect(after.desk).toMatchObject({ directory_mission_id: fleet.successorId, door_fingerprint: fleet.doorFingerprint });
      expect(after.directory).toMatchObject({ mission_id: fleet.successorId, previous_mission_id: fleet.directoryId, successor: null,
        ends_at: world.hosted.missions.get(fleet.successorId)!.expires_at });
      // The card the hub reposted is there, door-verified with the same pin.
      await ok(desk.run("fleet", "sync"));
      const browsed = await json(desk.run("fleet", "browse", "--json"));
      expect(browsed.rooms.map((room: any) => room.fields.room_id.value)).toEqual([fleet.roomId]);
      const pins = await json(desk.run("pin", "list", "--json"));
      expect(pins.pins.map((pin: any) => pin.fingerprint)).toEqual([fleet.doorFingerprint]);
    }
    // The next sweep renews both in the successor, from requests posted there.
    world.advance(HOUR);
    await ok(hub.yes("hub", "renew-sweep"));
    expect(JSON.parse(shownBytes(hub)).directory_renewals.map((item: any) => [item.grant.mission_id, item.notice.mission_id]))
      .toEqual([[fleet.successorId, fleet.successorId], [fleet.successorId, fleet.successorId]]);
    // The digest shows every device in the current directory.
    const digest = await ok(hub.run("hub", "digest"));
    const path = /to (\/\S+\.md)/.exec(digest.stdout)![1]!;
    const text = await Bun.file(path).text();
    expect(text).toContain(`previous directory ${fleet.directoryId}`);
    expect(text).toContain("every device's newest directory grant is in the current one");
  });

  test("a notice signed by a key other than the pinned door moves nobody", async () => {
    const fleet = await bootstrapFleet();
    const { device, second, world } = { ...fleet, second: fleet.world.desk("second") };
    await enrollThroughHub(fleet.hub, second, fleet.doorFingerprint);
    world.advance(HOUR);
    // The second desk signs a "successor" notice with its own key and posts it in the directory.
    const forgedTarget = await createMission(fleet, directoryDescriptor({ public_key: publicKeyBase64(generateKeyPair()), fingerprint: "0".repeat(16) }),
      new Date(world.clock.now.getTime() + 30 * DAY - MINUTE).toISOString());
    const d1 = world.hosted.missions.get(fleet.directoryId)!;
    const body: DirectorySuccessorBody = {
      from_mission_id: fleet.directoryId, from_mission_digest: d1.digest, from_expires_at: d1.expires_at,
      to_mission_id: forgedTarget.mission_id, to_mission_digest: forgedTarget.mission_digest,
      to_expires_at: new Date(world.clock.now.getTime() + 30 * DAY - MINUTE).toISOString(), issued_at: world.clock.now.toISOString(),
    };
    const { DeskSecrets } = await import("../src/secrets.js");
    const forged = sealDocument("directory_successor", body, { privateKey: DeskSecrets.open(second.home).deskKey(), fingerprint: deskOf(second).fingerprint }).summary;
    await postAs(world, second, fleet.directoryId, forged);
    await ok(device.yes("fleet", "renew"));
    const request = JSON.parse(shownBytes(device)).request;
    expect(request.mission_id).toBe(fleet.directoryId);
    expect(request.target_mission_id).toBeUndefined();
    expect((await status(device)).successor).toBeNull();
  });

  for (const [what, descriptorOf, reason] of [
    ["a successor charter naming another predecessor", (fleet: Fleet, door: { public_key: string; fingerprint: string }) =>
      directoryDescriptor(door, { mission_id: newUuid(), mission_digest: `sha256:${"b".repeat(64)}` }), "predecessor"],
    ["a successor charter naming another door", (fleet: Fleet) => {
      const other = generateKeyPair();
      const d1 = fleet.world.hosted.missions.get(fleet.directoryId)!;
      return directoryDescriptor({ public_key: publicKeyBase64(other), fingerprint: publicKeyFingerprint(publicKeyBase64(other)) },
        { mission_id: d1.mission_id, mission_digest: d1.digest });
    }, "pinned door"],
  ] as const) {
    test(`${what}: successor_mismatch at pickup, nothing accepted, the desk stays`, async () => {
      const fleet = await bootstrapFleet();
      const { device, hub, world } = fleet;
      world.advance(HOUR);
      const store = LobbyStore.open(hub.home);
      const row = store.fleet.hub()!;
      store.close();
      const d1 = world.hosted.missions.get(fleet.directoryId)!;
      const expiresAt = new Date(world.clock.now.getTime() + 30 * DAY - MINUTE).toISOString();
      // Someone holding the door key and the bearer makes a "successor" the hub never recorded.
      const target = await createMission(fleet, descriptorOf(fleet, { public_key: row.door_public_key, fingerprint: row.door_fingerprint }), expiresAt);
      await postAs(world, hub, fleet.directoryId, await doorSigned(fleet, {
        from_mission_id: fleet.directoryId, from_mission_digest: d1.digest, from_expires_at: d1.expires_at,
        to_mission_id: target.mission_id, to_mission_digest: target.mission_digest, to_expires_at: expiresAt, issued_at: world.clock.now.toISOString(),
      }));
      await ok(device.yes("fleet", "renew"));
      expect(JSON.parse(shownBytes(device)).request.target_mission_id).toBe(target.mission_id);
      // The hub's sweep never issues into a directory outside its chain.
      expect((await ok(hub.yes("hub", "renew-sweep"))).stdout).toContain("directory_not_live");
      const grantId = await issueOpenRequest(fleet, device, target.mission_id);
      const opened = device.terminal.opened;
      const refused = await device.yes("fleet", "renew");
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("successor_mismatch");
      expect(refused.stderr).toContain(reason);
      expect(device.terminal.opened).toBe(opened);
      expect(world.hosted.grants.get(grantId)!.accepted_at).toBeNull();
      expect((await json(device.run("fleet", "status", "--json"))).desk.directory_mission_id).toBe(fleet.directoryId);
    });
  }

  test("a replayed notice moves nobody back and is one successor, not two", async () => {
    const fleet = await rolledOver();
    const { hub, device, second, world } = fleet;
    const notice = summariesOf(fleet, fleet.directoryId).find((summary) => openDocument(summary)?.kind === "directory_successor")!;
    // The unmoved desk replays the notice into the old directory: still one successor.
    await postAs(world, second, fleet.directoryId, notice);
    await renewRound(fleet, [device, second]);
    for (const desk of [device, second]) await ok(desk.yes("fleet", "renew"));
    expect((await status(device)).mission_id).toBe(fleet.successorId);
    // A copy of the old notice in the successor names the old directory as `from`: ignored there.
    await postAs(world, hub, fleet.successorId, notice);
    world.advance(HOUR);
    await ok(device.run("fleet", "sync"));
    expect((await status(device)).successor).toBeNull();
    await ok(hub.yes("hub", "renew-sweep"));
    await ok(device.yes("fleet", "renew"));
    const bytes = JSON.parse(shownBytes(device));
    expect(bytes.pickup.mission_id).toBe(fleet.successorId);
    expect(bytes.pickup.move).toBeUndefined();
    expect(bytes.request).toMatchObject({ mission_id: fleet.successorId });
    expect(bytes.request.target_mission_id).toBeUndefined();
  });

  test("two different door-signed successors: conflicting_successors, the desk asks the hub and sends nothing", async () => {
    const fleet = await rolledOver();
    const { hub, device, world } = fleet;
    const d1 = world.hosted.missions.get(fleet.directoryId)!;
    const otherEnds = new Date(world.clock.now.getTime() + 30 * DAY - 2 * MINUTE).toISOString();
    const other = await createMission(fleet, directoryDescriptor({ public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", fingerprint: "0".repeat(16) }), otherEnds);
    await postAs(world, hub, fleet.directoryId, await doorSigned(fleet, {
      from_mission_id: fleet.directoryId, from_mission_digest: d1.digest, from_expires_at: d1.expires_at,
      to_mission_id: other.mission_id, to_mission_digest: other.mission_digest, to_expires_at: otherEnds,
      issued_at: world.clock.now.toISOString(),
    }));
    const events = summariesOf(fleet, fleet.directoryId).length;
    const refused = await device.yes("fleet", "renew");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("conflicting_successors");
    expect(summariesOf(fleet, fleet.directoryId)).toHaveLength(events);
    expect((await status(device)).successor).toEqual({ state: "conflicting" });
  });

  test("a desk whose grant lapsed after the announcement joins the successor through relay, by the same door-signed notice", async () => {
    const fleet = await rolledOver();
    const { hub, device, world } = fleet;
    // The device saw the notice (it synced), then lapsed.
    await ok(device.run("fleet", "sync"));
    world.advance(DAY);
    expect((await device.yes("fleet", "renew")).stderr).toContain("directory_lapsed");
    const enrolled = await ok(device.run("enroll-device"));
    const { relayArgs } = await import("./fleet-helpers.js");
    const relayed = await ok(hub.yes(...relayArgs(device, enrolled)));
    expect(JSON.parse(relayed.stdout).directory.mission_id).toBe(fleet.successorId);
    const joined = await ok(device.yes("fleet", "join", "--packet-file", device.file("join-successor.json", relayed.stdout), "--door-fingerprint", fleet.doorFingerprint));
    expect(joined.stdout).toContain("moved from directory");
    expect(JSON.parse(shownBytes(device)).move).toMatchObject({ from_mission_id: fleet.directoryId, to_mission_id: fleet.successorId });
    expect((await status(device))).toMatchObject({ mission_id: fleet.successorId, previous_mission_id: fleet.directoryId });

    // A desk that never saw the notice is refused: it moves only to a door-signed successor it can verify.
    const late = world.desk("late");
    await enrollThroughHub(hub, late, fleet.doorFingerprint);
    expect((await status(late)).mission_id).toBe(fleet.successorId);
  });

  test("a desk that never read the notice cannot be moved by a join packet", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device, world } = fleet;
    world.advance(HOUR);
    await ok(hub.yes("hub", "directory", "successor"));
    world.advance(DAY);
    // The device never synced after the announcement and its grant lapsed: no notice in its cache.
    const enrolled = await ok(device.run("enroll-device"));
    const { relayArgs } = await import("./fleet-helpers.js");
    const relayed = await ok(hub.yes(...relayArgs(device, enrolled)));
    const refused = await device.yes("fleet", "join", "--packet-file", device.file("join-other.json", relayed.stdout), "--door-fingerprint", fleet.doorFingerprint);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("directory_changed");
    expect(refused.stderr).toContain("door-signed successor");
  });
});

describe("while both directories live", () => {
  test("a knock in the old directory is listed, admitted there and readied after the knocking desk moved", async () => {
    const fleet = await rolledOver();
    const { hub, device, world } = fleet;
    await ok(device.run("fleet", "sync"));
    const knocked = await ok(device.yes("knock", fleet.roomId, "--tier", "player"));
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
    expect(JSON.parse(shownBytes(device)).mission_id).toBe(fleet.directoryId);
    // The desk moves before the hub decides.
    await renewRound(fleet, [device]);
    await ok(device.yes("fleet", "renew"));
    expect((await status(device)).mission_id).toBe(fleet.successorId);
    const knocks = await json(hub.run("hub", "knocks", "--json"));
    expect(knocks.knocks).toEqual([expect.objectContaining({ knock_id: knockId, status: "pending", directory_mission_id: fleet.directoryId })]);
    await ok(hub.yes("hub", "admit", knockId));
    expect(JSON.parse(shownBytes(hub)).posts[0]).toMatchObject({ kind: "admission", mission_id: fleet.directoryId });
    // Readied from the directory it moved from (it still holds a live grant there).
    world.advance(MINUTE);
    const ready = await ok(device.yes("ready", knockId));
    expect(ready.stdout).toContain(`accepted season ${fleet.seasonId}`);
    expect((await json(device.run("fleet", "knocks", "--json"))).knocks[0].status).toBe("ready");
  });

  test("room publish posts one card_seq to both; room renewal notices land in both", async () => {
    const fleet = await rolledOver();
    const { hub, device, world } = fleet;
    // Seat the device in the room first (knock in the old directory, admitted, ready).
    await ok(device.run("fleet", "sync"));
    const knockId = /knock ([0-9a-f-]{36})/.exec((await ok(device.yes("knock", fleet.roomId, "--tier", "player"))).stdout)![1]!;
    await ok(hub.yes("hub", "admit", knockId));
    await ok(device.yes("ready", knockId));
    await ok(hub.yes("room", "publish", fleet.roomId));
    const published = JSON.parse(shownBytes(hub));
    expect(published).toMatchObject({ card_seq: 2, mission_id: fleet.successorId, also: [{ mission_id: fleet.directoryId }] });
    const card = (missionId: string) => summariesOf(fleet, missionId).filter((summary) => openDocument(summary)?.kind === "card")
      .map((summary) => (openDocument(summary)!.body as FleetCard).card_seq);
    expect(card(fleet.directoryId)).toEqual([1, 2]);
    expect(card(fleet.successorId)).toEqual([1, 2]);
    expect(summariesOf(fleet, fleet.successorId).at(-1)).toBe(summariesOf(fleet, fleet.directoryId).at(-1));
    // A room renewal: the notice goes to the current directory, the previous one and the room.
    world.advance(HOUR);
    await ok(device.yes("room", "renew", "request", fleet.roomId));
    await ok(hub.yes("hub", "renew-sweep"));
    const sweep = JSON.parse(shownBytes(hub));
    expect(sweep.renewals[0].notices.map((notice: any) => notice.mission_id))
      .toEqual([fleet.successorId, fleet.directoryId, fleet.seasonId]);
    await ok(device.yes("room", "renew", "accept", fleet.roomId));
  });

  test("first-poster ownership spans both directories", async () => {
    const fleet = await rolledOver();
    const { hub, device, second, world } = fleet;
    // The second desk moves first and has nothing open afterwards.
    await renewRound(fleet, [second]);
    await ok(second.yes("fleet", "renew"));
    expect((await status(second)).mission_id).toBe(fleet.successorId);
    await ok(hub.yes("hub", "renew-sweep"));
    // The device (not moved) asks for its successor grant from the old directory.
    world.advance(MINUTE);
    await ok(device.yes("fleet", "renew"));
    const request = JSON.parse(shownBytes(device)).request;
    // The moved desk copies that token hash into its own newer request in the successor.
    world.advance(MINUTE);
    const { DeskSecrets } = await import("../src/secrets.js");
    const secondDesk = deskOf(second);
    const copy = sealDocument("directory_renew", {
      mission_id: fleet.successorId, grant_id: newUuid(), identity_id: secondDesk.identity_id, signing_key_id: secondDesk.signing_key_id,
      token_sha256: request.token_sha256, issued_at: world.clock.now.toISOString(), expires_at: new Date(world.clock.now.getTime() + HOUR).toISOString(),
    }, { privateKey: DeskSecrets.open(second.home).deskKey(), fingerprint: secondDesk.fingerprint }).summary;
    await postAs(world, second, fleet.successorId, copy);
    await ok(hub.yes("hub", "renew-sweep"));
    const sweep = JSON.parse(shownBytes(hub));
    expect(sweep.directory_renewals.map((item: any) => [item.grant.identity_id, item.grant.token_sha256]))
      .toEqual([[deskOf(device).identity_id, request.token_sha256]]);
    expect(sweep.skipped.map((item: any) => [item.identity_id, item.reason]))
      .toEqual(expect.arrayContaining([[secondDesk.identity_id, "token_claimed_by_another_desk"]]));
  });

  test("once the old directory ends it is ignored everywhere, and the next successor may be cut", async () => {
    // A two-day directory, so its 30-day successor outlives it by weeks.
    const fleet = await bootstrapFleet({ initArgs: ["--days", "2"] });
    const { hub, world } = fleet;
    world.advance(HOUR);
    const announced = await ok(hub.yes("hub", "directory", "successor"));
    const successorId = /announced successor directory ([0-9a-f-]{36})/.exec(announced.stdout)![1]!;
    const d1Ends = Date.parse(world.hosted.missions.get(fleet.directoryId)!.expires_at);
    world.advance(d1Ends - world.clock.now.getTime() + MINUTE);
    // The hub's seats lapsed with time: the seats-only sweep renews them in the current directory and the season only.
    await ok(hub.yes("hub", "renew-sweep"));
    const seats = JSON.parse(shownBytes(hub));
    expect(seats.mode).toBe("seats_only");
    expect(seats.hub_seats.map((seat: any) => seat.mission_id)).toEqual([successorId, fleet.seasonId]);
    expect((await ok(hub.yes("hub", "renew-sweep"))).stdout).toContain("nothing to renew");
    const reads = () => world.hosted.seen.filter((seen) => seen.path.startsWith(`/v1/collaboration/missions/${fleet.directoryId}/`)).length;
    const before = reads();
    await ok(hub.run("hub", "knocks"));
    await ok(hub.yes("room", "publish", fleet.roomId));
    expect(JSON.parse(shownBytes(hub))).toMatchObject({ mission_id: successorId });
    expect(JSON.parse(shownBytes(hub)).also).toBeUndefined();
    expect(reads()).toBe(before);
    const shown = await json(hub.run("hub", "show", "--json"));
    expect(shown.directories.map((row: any) => [row.mission_id, row.state])).toEqual([[fleet.directoryId, "previous"], [successorId, "current"]]);
    // No overlap any more: a further successor is planned again (and must outlast the current one).
    const next = await hub.yes("hub", "directory", "successor", "--days", "5");
    expect(next.stderr).toContain("successor_too_short");
  });
});

describe("the stop", () => {
  test("hub stop revokes every directory of the chain and every season", async () => {
    const fleet = await rolledOver();
    const { hub, world } = fleet;
    await ok(hub.yes("hub", "stop"));
    const bytes = JSON.parse(shownBytes(hub));
    expect(bytes.missions.filter((mission: any) => mission.kind === "directory").map((mission: any) => mission.mission_id).sort())
      .toEqual([fleet.directoryId, fleet.successorId].sort());
    for (const missionId of [fleet.directoryId, fleet.successorId, fleet.seasonId]) {
      expect(world.hosted.missions.get(missionId)!.revoked_at).not.toBeNull();
    }
    const shown = await json(hub.run("hub", "show", "--json"));
    expect(shown.directories.every((row: any) => row.revoked_at !== null)).toBe(true);
    expect((await hub.yes("hub", "directory", "successor")).stderr).toContain("hub_stopped");
  });

  test("a stop revokes a successor created but not announced; a stop while the prompt is open announces nothing", async () => {
    const fleet = await bootstrapFleet();
    const { hub, world } = fleet;
    world.advance(HOUR);
    world.hosted.failNext = (seen) => seen.method === "POST" && /\/missions\/[0-9a-f-]{36}\/grants$/.test(seen.path);
    expect((await hub.yes("hub", "directory", "successor")).code).toBe(1);
    const successor = JSON.parse(shownBytes(hub)).successor.mission_id;
    const other = world.desk("hub-other-terminal", { of: hub });
    const result = await runWhilePromptOpen(world, hub, ["hub", "directory", "successor"], async () => {
      // The stop also chases the seat grant whose outcome was lost; the service never made it (404).
      await other.yes("hub", "stop");
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("hub_stopped");
    expect(world.hosted.missions.get(successor)!.revoked_at).not.toBeNull();
    expect(kindsIn(fleet, fleet.directoryId)).not.toContain("directory_successor");
  });
});
