/** Fleet-hall hardening from review: the gate reads the text a person typed
 * (not its JSON form), outbox retry uses the room as it is now, no plan runs
 * without a terminal, a knock id belongs to the desk that used it first, the
 * hub enforces its own door and status, a body that breaks off is uncertain,
 * an ambiguous season create resumes instead of doubling, the bearer's
 * project is checked, and fleet join restores a removed door pin. Hermetic:
 * fake service, file-backed Keychain stand-in, scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { LobbyError } from "../src/errors.js";
import { AdminClient, ParticipantClient, parseMissionView, prepareObservation, type GateRoom } from "../src/hosted.js";
import type { KeychainRef } from "../src/keychain.js";
import { seatOf } from "../src/ops.js";
import { DeskSecrets } from "../src/secrets.js";
import { sealDocument, type KnockBody } from "../src/signed.js";
import { LobbyStore } from "../src/store.js";
import { missionDigest, type MissionDescriptor } from "../src/wire.js";
import { FAKE_BEARER, FAKE_PROJECT, FakeHosted, type SeenRequest } from "./fake-hosted.js";
import { bootstrapFleet, enrollThroughHub, ok, shownBytes, world, type Desk, type Fleet } from "./fleet-helpers.js";
import { cleanupTempHomes } from "./helpers.js";

afterEach(cleanupTempHomes);

const HOUR = 3_600_000;
const OTHER_PROJECT = "66666666-6666-4666-8666-666666666667";
const MISSIONS = "/v1/collaboration/missions";

function eventPosts(fleet: Fleet): SeenRequest[] {
  return fleet.world.hosted.seen.filter((request) => request.method === "POST" && request.path.endsWith("/events"));
}

async function addFleetRoom(fleet: Fleet, ...args: string[]): Promise<string> {
  const added = await ok(fleet.hub.run("room", "add", "--json", ...args));
  const roomId = JSON.parse(added.stdout).card.room_id as string;
  await ok(fleet.hub.yes("room", "promote", roomId, "--residency", "fleet", "--hostable", "true"));
  return roomId;
}

async function knock(fleet: Fleet, ...extra: string[]): Promise<string> {
  const result = await ok(fleet.device.yes("knock", fleet.roomId, "--tier", "player", ...extra));
  return /knock ([0-9a-f-]{36})/.exec(result.stdout)![1]!;
}

async function hubKnocks(fleet: Fleet): Promise<any[]> {
  return JSON.parse((await ok(fleet.hub.run("hub", "knocks", "--json"))).stdout).knocks;
}

/** Sign a knock with a desk's own key and post it straight to the directory
 * with the desk's own seat: what a desk that skips its own CLI checks can do. */
async function postKnockDirectly(fleet: Fleet, desk: Desk, fields: Partial<KnockBody> & { knock_id: string; room_id: string }): Promise<string> {
  const store = LobbyStore.open(desk.home);
  const row = store.fleet.desk()!;
  const grant = store.fleet.currentDeskGrant(fleet.directoryId, fleet.world.clock.now)!;
  store.close();
  const secrets = DeskSecrets.open(desk.home);
  const now = fleet.world.clock.now;
  const body: KnockBody = {
    charter_digest: fleet.seasonDigest,
    tier: "spectator",
    token_sha256: secrets.newToken(now).token_sha256,
    note: "",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + HOUR).toISOString(),
    ...fields,
  };
  const summary = sealDocument("knock", body, { privateKey: secrets.deskKey(), fingerprint: row.fingerprint }).summary;
  const gate: GateRoom = { residency: "fleet", hostable: true };
  const post = prepareObservation(summary, gate, []);
  await new ParticipantClient(secrets, { fetchImpl: fleet.world.hosted.fetch, now: () => new Date(fleet.world.clock.now), deviceTerms: [] })
    .observe(seatOf(row, grant), post.raw_body, gate);
  return row.fingerprint;
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("the gate reads the text a person typed, not its JSON form", () => {
  test("knock notes and deny reasons split by a newline or tab are refused before the terminal and never posted", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const directory = hosted.summaries(fleet.directoryId).length;
    const deviceOpened = fleet.device.terminal.opened;
    for (const [note, reason] of [
      ["Bet\nAngel ladder tonight", "device_only_term"],
      ["see the Bet\tfair notes", "device_only_term"],
      ["on the Mac\nmini", "device_name"],
      ["from example\nlab desk", "local_device_name"],
    ] as const) {
      const refused = await fleet.device.run("knock", fleet.roomId, "--tier", "spectator", `--note=${note}`);
      expect({ note, code: refused.code }).toEqual({ note, code: 1 });
      expect(refused.stderr).toContain("egress_refused");
      expect(refused.stderr).toContain(reason);
    }
    expect(fleet.device.terminal.opened).toBe(deviceOpened);
    expect(hosted.summaries(fleet.directoryId)).toHaveLength(directory);

    const knockId = await knock(fleet);
    const hubOpened = fleet.hub.terminal.opened;
    for (const [text, reason] of [["see the Bet\nfair notes", "device_only_term"], ["sent from the Mac\tmini", "device_name"]] as const) {
      const refused = await fleet.hub.run("hub", "deny", knockId, `--reason=${text}`);
      expect({ text, code: refused.code }).toEqual({ text, code: 1 });
      expect(refused.stderr).toContain("egress_refused");
      expect(refused.stderr).toContain(reason);
    }
    expect(fleet.hub.terminal.opened).toBe(hubOpened);
    for (const summary of hosted.summaries(fleet.directoryId)) {
      expect(summary).not.toMatch(/bet\\[nt](angel|fair)|mac\\[nt]mini|example\\nlab/i);
    }
    expect((await hubKnocks(fleet)).find((entry) => entry.knock_id === knockId).status).toBe("pending");
  });

  test("a room purpose or house rules split by a newline or tab are refused in the season charter", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    for (const [args, reason] of [
      [["--title", "Notes", "--purpose", "notes from the Mac\nmini"], "device_name"],
      [["--title", "Notes", "--house-rules", "ask example\tlab desk first"], "local_device_name"],
    ] as const) {
      const roomId = await addFleetRoom(fleet, ...args);
      const missions = hosted.missions.size;
      const opened = fleet.hub.terminal.opened;
      const refused = await fleet.hub.run("hub", "season", "open", roomId);
      expect({ args, code: refused.code }).toEqual({ args, code: 1 });
      expect(refused.stderr).toContain("egress_refused");
      expect(refused.stderr).toContain(reason);
      expect(hosted.missions.size).toBe(missions);
      expect(fleet.hub.terminal.opened).toBe(opened);
    }
  });
});

describe("outbox retry uses the room as it is now", () => {
  async function pendingCard(fleet: Fleet): Promise<string> {
    await ok(fleet.hub.run("room", "set-status", fleet.roomId, "resting"));
    fleet.world.hosted.failNext = (request) => request.method === "POST" && request.path.endsWith("/events");
    const dropped = await fleet.hub.yes("room", "publish", fleet.roomId);
    expect(dropped.stderr).toContain("saved in the outbox");
    const listed = JSON.parse((await ok(fleet.hub.run("outbox", "list", "--json"))).stdout).outbox;
    return listed.find((row: any) => row.state === "pending" && row.kind === "card").event_id;
  }

  for (const [change, reason] of [
    [["--residency", "device"], "room_residency_device"],
    [["--hostable", "false"], "room_not_fleet"],
  ] as const) {
    test(`a saved card of a room since promoted with ${change.join(" ")} is never resent`, async () => {
      const fleet = await bootstrapFleet();
      const eventId = await pendingCard(fleet);
      await ok(fleet.hub.yes("room", "promote", fleet.roomId, ...change));
      const posts = eventPosts(fleet).length;
      const opened = fleet.hub.terminal.opened;
      const retried = await fleet.hub.yes("outbox", "retry", eventId);
      expect({ code: retried.code, stdout: retried.stdout }).toEqual({ code: 1, stdout: "" });
      expect(retried.stderr).toContain(reason);
      expect(eventPosts(fleet)).toHaveLength(posts);
      expect(fleet.hub.terminal.opened).toBe(opened);
      fleet.hub.answers.length = 0;
    });
  }

  test("a device's saved knock is resent under the gate of its current door-verified card", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    hosted.failNext = (request) => request.method === "POST" && request.path.endsWith("/events");
    const dropped = await fleet.device.yes("knock", fleet.roomId, "--tier", "spectator");
    expect(dropped.code).toBe(1);
    const knockId = /knock ([0-9a-f-]{36})/.exec(dropped.stdout)![1]!;
    const eventId = JSON.parse((await ok(fleet.device.run("outbox", "list", "--json"))).stdout).outbox
      .find((row: any) => row.kind === "knock").event_id;
    expect(await hubKnocks(fleet)).toEqual([]);
    await ok(fleet.device.yes("outbox", "retry", eventId));
    expect((await hubKnocks(fleet)).map((entry) => [entry.knock_id, entry.status])).toEqual([[knockId, "pending"]]);
  });
});

describe("no consequential act plans without a person at the terminal", () => {
  test("headless hub acts read no Keychain item, use no bearer and send nothing", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const touched: string[] = [];
    const keychain = fleet.hub.keychain;
    const read = keychain.read.bind(keychain);
    const has = keychain.has.bind(keychain);
    keychain.read = async (ref: KeychainRef) => {
      touched.push(`read ${ref.service}`);
      return read(ref);
    };
    keychain.has = async (ref: KeychainRef) => {
      touched.push(`has ${ref.service}`);
      return has(ref);
    };
    const knockId = await knock(fleet);
    const second = await addFleetRoom(fleet, "--title", "Second room");
    const third = fleet.world.desk("third");
    const packet = third.file("packet.json", (await ok(third.run("enroll-device", "--project", FAKE_PROJECT))).stdout);
    const headless = fleet.world.desk("headless-hub", { of: fleet.hub, noTerminal: true });
    const seen = hosted.seen.length;
    const audit = (await ok(fleet.hub.run("audit", "list", "--json"))).stdout;
    for (const argv of [
      ["room", "publish", fleet.roomId],
      ["hub", "admit", knockId],
      ["hub", "deny", knockId],
      ["hub", "season", "open", second],
      ["hub", "season", "adopt", second, "--mission", fleet.seasonId, "--digest", fleet.seasonDigest],
      ["hub", "seat", "directory"],
      ["hub", "relay", "--packet-file", packet],
      ["outbox", "retry", crypto.randomUUID()],
    ]) {
      const refused = await headless.run(...argv);
      expect({ argv, code: refused.code }).toEqual({ argv, code: 3 });
      expect(refused.stderr).toContain("tty_unavailable");
    }
    expect(touched).toEqual([]);
    expect(hosted.seen).toHaveLength(seen);
    expect((await ok(fleet.hub.run("audit", "list", "--json"))).stdout).toBe(audit);
    expect((await hubKnocks(fleet)).find((entry) => entry.knock_id === knockId).status).toBe("pending");
  });

  test("a headless hub init touches neither the Keychain nor the service", async () => {
    const w = world();
    const hub = w.desk("hub", { noTerminal: true });
    await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, FAKE_BEARER);
    const touched: string[] = [];
    const read = hub.keychain.read.bind(hub.keychain);
    const has = hub.keychain.has.bind(hub.keychain);
    hub.keychain.read = async (ref: KeychainRef) => {
      touched.push(`read ${ref.service}`);
      return read(ref);
    };
    hub.keychain.has = async (ref: KeychainRef) => {
      touched.push(`has ${ref.service}`);
      return has(ref);
    };
    const refused = await hub.run("hub", "init", "--project", FAKE_PROJECT);
    expect(refused.code).toBe(3);
    expect(touched).toEqual([]);
    expect(w.hosted.seen).toEqual([]);
    expect(await has({ service: "agenttool-lobby.door-key", account: "agenttool-lobby" })).toBe(false);
  });

  test("headless device acts use no token and send nothing", async () => {
    const fleet = await bootstrapFleet();
    const knockId = await knock(fleet);
    const headless = fleet.world.desk("headless-device", { of: fleet.device, noTerminal: true });
    const seen = fleet.world.hosted.seen.length;
    for (const argv of [
      ["knock", fleet.roomId, "--tier", "spectator"],
      ["ready", knockId],
      ["fleet", "join", "--packet-file", "/nonexistent/join.json", "--door-fingerprint", fleet.doorFingerprint],
    ]) {
      const refused = await headless.run(...argv);
      expect({ argv, code: refused.code }).toEqual({ argv, code: 3 });
    }
    expect(fleet.world.hosted.seen).toHaveLength(seen);
  });
});

describe("a knock id belongs to the desk that used it first", () => {
  test("another enrolled desk reusing a pending knock's id cannot make it undecidable", async () => {
    const fleet = await bootstrapFleet();
    const knockId = await knock(fleet);
    const other = fleet.world.desk("other");
    await enrollThroughHub(fleet.hub, other, fleet.doorFingerprint);
    const impostor = await postKnockDirectly(fleet, other, { knock_id: knockId, room_id: fleet.roomId });
    const listed = (await hubKnocks(fleet)).filter((entry) => entry.knock_id === knockId);
    expect(listed.map((entry) => [entry.requester.fingerprint === impostor, entry.status, entry.reason]).sort())
      .toEqual([[false, "pending", null], [true, "invalid", "knock_id_taken"]]);
    await ok(fleet.hub.yes("hub", "admit", knockId));
    const ready = await ok(fleet.device.yes("ready", knockId));
    expect(ready.stdout).toContain(`accepted season ${fleet.seasonId}`);
    // The impostor's copy stays invalid after the decision; it never reads as the admitted knock.
    const after = (await hubKnocks(fleet)).filter((entry) => entry.knock_id === knockId);
    expect(after.map((entry) => [entry.requester.fingerprint === impostor, entry.status]).sort())
      .toEqual([[false, "admitted"], [true, "invalid"]]);
  });

  test("a desk that posts two different knocks under one id still voids only its own", async () => {
    const fleet = await bootstrapFleet();
    const knockId = crypto.randomUUID();
    await postKnockDirectly(fleet, fleet.device, { knock_id: knockId, room_id: fleet.roomId, note: "first" });
    await postKnockDirectly(fleet, fleet.device, { knock_id: knockId, room_id: fleet.roomId, note: "second" });
    const listed = (await hubKnocks(fleet)).filter((entry) => entry.knock_id === knockId);
    expect(listed.map((entry) => entry.reason)).toEqual(["duplicate_knock_id", "duplicate_knock_id"]);
    expect((await fleet.hub.yes("hub", "admit", knockId)).stderr).toContain("knock_invalid");
    fleet.hub.answers.length = 0;
  });
});

describe("the hub enforces its own door and status", () => {
  test("a knock on a closed room is invalid at the hub however it was posted", async () => {
    const fleet = await bootstrapFleet();
    await ok(fleet.hub.run("room", "set-status", fleet.roomId, "closed"));
    await ok(fleet.hub.yes("room", "publish", fleet.roomId));
    await ok(fleet.device.run("fleet", "sync"));
    expect((await fleet.device.yes("knock", fleet.roomId, "--tier", "player")).stderr).toContain("room_closed");
    fleet.device.answers.length = 0;
    const knockId = crypto.randomUUID();
    await postKnockDirectly(fleet, fleet.device, { knock_id: knockId, room_id: fleet.roomId });
    const listed = (await hubKnocks(fleet)).find((entry) => entry.knock_id === knockId);
    expect([listed.status, listed.reason]).toEqual(["invalid", "room_closed"]);
    const grants = fleet.world.hosted.grants.size;
    const admit = await fleet.hub.yes("hub", "admit", knockId);
    expect(admit.code).toBe(1);
    expect(admit.stderr).toContain("room_closed");
    expect(fleet.world.hosted.grants.size).toBe(grants);
    fleet.hub.answers.length = 0;
  });

  test("a knock on an invite-only room is invalid at the hub however it was posted", async () => {
    const fleet = await bootstrapFleet();
    const roomId = await addFleetRoom(fleet, "--title", "Invite only", "--door", "invite");
    const season = await ok(fleet.hub.yes("hub", "season", "open", roomId));
    const digest = /digest (sha256:[0-9a-f]{64})/.exec(season.stdout)![1]!;
    await ok(fleet.hub.yes("room", "publish", roomId));
    await ok(fleet.device.run("fleet", "sync"));
    expect((await fleet.device.yes("knock", roomId, "--tier", "spectator")).stderr).toContain("door_invite_only");
    fleet.device.answers.length = 0;
    const knockId = crypto.randomUUID();
    await postKnockDirectly(fleet, fleet.device, { knock_id: knockId, room_id: roomId, charter_digest: digest });
    const listed = (await hubKnocks(fleet)).find((entry) => entry.knock_id === knockId);
    expect([listed.status, listed.reason]).toEqual(["invalid", "door_invite_only"]);
    expect((await fleet.hub.yes("hub", "admit", knockId)).stderr).toContain("door_invite_only");
    fleet.hub.answers.length = 0;
  });

  test("the admit prompt shows the room's status and door", async () => {
    const fleet = await bootstrapFleet();
    const knockId = await knock(fleet);
    await ok(fleet.hub.yes("hub", "admit", knockId));
    expect(fleet.hub.terminal.written.join("")).toContain("room status recruiting, door knock");
    expect(shownBytes(fleet.hub)).toContain(`"room":{"door":"knock","room_id":"${fleet.roomId}","status":"recruiting"}`);
  });
});

describe("a response that breaks off is uncertain, and later posts are still saved", () => {
  test("a body that fails mid-read is hosted_uncertain, not a raw transport error", async () => {
    const fetchImpl = async () => FakeHosted.brokenBody(200);
    const admin = new AdminClient(FAKE_BEARER, { fetchImpl, now: () => new Date(), deviceTerms: [] });
    let caught: unknown;
    try {
      await admin.getMission(crypto.randomUUID());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LobbyError);
    expect((caught as LobbyError).code).toBe("hosted_uncertain");
  });

  test("admit whose first receipt breaks off saves and sends every other post", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const knockId = await knock(fleet);
    const before = new Set(JSON.parse((await ok(fleet.hub.run("outbox", "list", "--json"))).stdout).outbox.map((row: any) => row.event_id));
    let broken = false;
    hosted.intercept = (request, process) => {
      const response = process();
      if (broken || request.method !== "POST" || !request.path.endsWith("/events")) return response;
      broken = true;
      return FakeHosted.brokenBody();
    };
    const admit = await fleet.hub.yes("hub", "admit", knockId);
    hosted.intercept = null;
    expect(admit.code).toBe(1);
    expect(admit.stderr).toContain("hosted_uncertain");
    expect(admit.stderr).not.toContain("internal_error");
    const rows = JSON.parse((await ok(fleet.hub.run("outbox", "list", "--json"))).stdout).outbox
      .filter((row: any) => !before.has(row.event_id));
    expect(rows.map((row: any) => `${row.kind} ${row.state}`).sort()).toEqual(["admission pending", "admission stored", "roster stored"]);
    expect(hosted.summaries(fleet.seasonId).length).toBeGreaterThanOrEqual(2);
    const pending = rows.find((row: any) => row.state === "pending");
    const directory = hosted.summaries(fleet.directoryId).length;
    await ok(fleet.hub.yes("outbox", "retry", pending.event_id));
    // The first send was stored; the retry got its receipt rather than a second event.
    expect(hosted.summaries(fleet.directoryId)).toHaveLength(directory);
    await ok(fleet.device.yes("ready", knockId));
  });
});

describe("an ambiguous season create resumes and never makes a second mission", () => {
  for (const [label, answer] of [
    ["an HTML 504 from a gateway", () => new Response("<html>504 Gateway Time-out</html>", { status: 504 })],
    ["a JSON 502", () => json({ error: "bad_gateway" }, 502)],
    ["a body that breaks off", () => FakeHosted.brokenBody()],
  ] as const) {
    test(`after ${label}, hub season open resumes the same mission`, async () => {
      const fleet = await bootstrapFleet();
      const hosted = fleet.world.hosted;
      const roomId = await addFleetRoom(fleet, "--title", "Second room");
      const missions = hosted.missions.size;
      hosted.intercept = (request, process) => {
        const response = process();
        if (request.method !== "POST" || request.path !== MISSIONS) return response;
        hosted.intercept = null;
        return answer();
      };
      const first = await fleet.hub.yes("hub", "season", "open", roomId);
      expect(first.code).toBe(1);
      expect(first.stderr).toContain("season_uncertain");
      const hint = /hub season adopt (room_[0-9a-f]{32}) --mission ([0-9a-f-]{36}) --digest (sha256:[0-9a-f]{64})/.exec(first.stderr)!;
      expect(hint[1]).toBe(roomId);
      expect(first.stderr).toContain(`hub season open ${roomId} again`);
      expect(hosted.missions.size).toBe(missions + 1);
      // --days would make a different charter; while one may exist it is refused.
      const opened = fleet.hub.terminal.opened;
      expect((await fleet.hub.run("hub", "season", "open", roomId, "--days", "5")).stderr).toContain("season_resume_only");
      expect(fleet.hub.terminal.opened).toBe(opened);
      const resumed = await ok(fleet.hub.yes("hub", "season", "open", roomId));
      expect(resumed.stdout).toContain(`season ${hint[2]} digest ${hint[3]}`);
      expect(resumed.stdout).toContain("audit: recorded hub.season.resume");
      expect(hosted.missions.size).toBe(missions + 1);
      await ok(fleet.hub.yes("room", "publish", roomId));
    });
  }

  test("after a definite refusal the season is forgotten and a new one opens", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const roomId = await addFleetRoom(fleet, "--title", "Second room");
    const missions = hosted.missions.size;
    hosted.intercept = (request, process) => {
      if (request.method !== "POST" || request.path !== MISSIONS) return process();
      hosted.intercept = null;
      return json({ error: "invalid_mission_request" }, 400);
    };
    const refused = await fleet.hub.yes("hub", "season", "open", roomId);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("hosted_refused");
    expect(refused.stderr).not.toContain("season_uncertain");
    const opened = await ok(fleet.hub.yes("hub", "season", "open", roomId, "--days", "5"));
    expect(opened.stdout).toContain("audit: recorded hub.season.open");
    expect(hosted.missions.size).toBe(missions + 1);
  });
});

describe("the bearer's project is checked against the hub's", () => {
  test("hub init with another project activates nothing and can then adopt what it made", async () => {
    const w = world();
    const hub = w.desk("hub");
    await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, FAKE_BEARER);
    const wrong = await hub.yes("hub", "init", "--project", OTHER_PROJECT);
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain("project_mismatch");
    expect((await hub.run("hub", "show")).stderr).toContain("hub_not_initialised");
    const hint = /hub init --project ([0-9a-f-]{36}) --adopt-directory ([0-9a-f-]{36}) --directory-digest (sha256:[0-9a-f]{64})/.exec(wrong.stderr)!;
    expect(hint[1]).toBe(FAKE_PROJECT);
    expect(w.hosted.missions.has(hint[2]!)).toBe(true);
    // Adopting under the wrong project is refused before the terminal.
    const opened = hub.terminal.opened;
    const adoptWrong = await hub.run("hub", "init", "--project", OTHER_PROJECT, "--adopt-directory", hint[2]!, "--directory-digest", hint[3]!);
    expect(adoptWrong.stderr).toContain("project_mismatch");
    expect(hub.terminal.opened).toBe(opened);
    const adopted = await ok(hub.yes("hub", "init", "--project", hint[1]!, "--adopt-directory", hint[2]!, "--directory-digest", hint[3]!));
    expect(adopted.stdout).toContain(`directory ${hint[2]} (adopted)`);
    expect(w.hosted.missions.size).toBe(1);
  });

  test("a season mission of another project is not adopted", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const descriptor: MissionDescriptor = {
      format: "agenttool-collaboration-mission/v1",
      purpose: "A season made by hand",
      resources: [],
      acceptance_criteria: ["Say hello"],
      principalities: [],
    };
    const missionId = crypto.randomUUID();
    const created = await hosted.fetch(`https://api.agenttool.dev${MISSIONS}`, {
      method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${FAKE_BEARER}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mission_id: missionId, descriptor, expires_at: new Date(fleet.world.clock.now.getTime() + 20 * 24 * HOUR).toISOString() }),
    });
    expect(created.status).toBe(201);
    const roomId = await addFleetRoom(fleet, "--title", "Adopted elsewhere");
    // The service files the mission under another project than this hub's.
    hosted.intercept = (request, process) => {
      if (request.method !== "GET" || request.path !== `${MISSIONS}/${missionId}`) return process();
      const view = hosted.missions.get(missionId)!;
      return json({ mission: { mission_id: missionId, project_id: OTHER_PROJECT, descriptor: view.descriptor, mission_digest: view.digest,
        created_at: view.created_at, expires_at: view.expires_at, revoked_at: null } }, 200);
    };
    const opened = fleet.hub.terminal.opened;
    const refused = await fleet.hub.run("hub", "season", "adopt", roomId, "--mission", missionId, "--digest", missionDigest(descriptor));
    hosted.intercept = null;
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("project_mismatch");
    expect(fleet.hub.terminal.opened).toBe(opened);
  });

  test("a mission view without its project is not a valid view", () => {
    const descriptor: MissionDescriptor = {
      format: "agenttool-collaboration-mission/v1", purpose: "x", resources: [], acceptance_criteria: ["y"], principalities: [],
    };
    const view = {
      mission_id: crypto.randomUUID(), descriptor, mission_digest: missionDigest(descriptor),
      expires_at: "2026-10-20T00:00:00.000Z", revoked_at: null,
    };
    expect(() => parseMissionView(view)).toThrow("does not match its descriptor digest or contract");
    expect(parseMissionView({ ...view, project_id: FAKE_PROJECT }).project_id).toBe(FAKE_PROJECT);
  });
});

describe("fleet join restores a removed door pin", () => {
  test("a joined desk whose door pin was removed pins it again at the next join", async () => {
    const fleet = await bootstrapFleet();
    await ok(fleet.device.yes("pin", "remove", fleet.doorFingerprint));
    expect((await fleet.device.yes("knock", fleet.roomId, "--tier", "spectator")).stderr).toContain("door_not_pinned");
    fleet.device.answers.length = 0;
    const enrolled = await ok(fleet.device.run("enroll-device"));
    const relayed = await ok(fleet.hub.yes("hub", "relay", "--packet-file", fleet.device.file("renew.json", enrolled.stdout)));
    const joinFile = fleet.device.file("renew-join.json", relayed.stdout);
    // The typed fingerprint must still be the door this desk joined with.
    const wrong = await fleet.device.run("fleet", "join", "--packet-file", joinFile, "--door-fingerprint", "0".repeat(16));
    expect(wrong.stderr).toContain("door_fingerprint_mismatch");
    const joined = await ok(fleet.device.yes("fleet", "join", "--packet-file", joinFile, "--door-fingerprint", fleet.doorFingerprint));
    expect(joined.stdout).toContain(`door ${fleet.doorFingerprint} pinned`);
    expect(fleet.device.terminal.written.join("")).toContain("its pin was missing and is restored now");
    expect(shownBytes(fleet.device)).toContain('"pin":"restored"');
    expect((await ok(fleet.device.run("pin", "list"))).stdout).toContain(fleet.doorFingerprint);
    await ok(fleet.device.run("fleet", "sync"));
    await ok(fleet.device.yes("knock", fleet.roomId, "--tier", "spectator"));
  });

  test("a renewal with the door pin in place keeps it", async () => {
    const fleet = await bootstrapFleet();
    const enrolled = await ok(fleet.device.run("enroll-device"));
    const relayed = await ok(fleet.hub.yes("hub", "relay", "--packet-file", fleet.device.file("renew.json", enrolled.stdout)));
    const joined = await ok(fleet.device.yes("fleet", "join", "--packet-file", fleet.device.file("renew-join.json", relayed.stdout),
      "--door-fingerprint", fleet.doorFingerprint));
    expect(joined.stdout).not.toContain("pinned");
    expect(shownBytes(fleet.device)).toContain('"pin":"kept"');
  });
});
