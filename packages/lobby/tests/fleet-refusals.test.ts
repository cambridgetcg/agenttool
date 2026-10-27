/** Fleet-hall refusals: residency, the egress gate, pins, packets, decisions,
 * expiries, terminals and uncertain sends. Hermetic: fake service, file-backed
 * Keychain stand-in, scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildLobbyMcpServer } from "../src/mcp.js";
import { sealDocument, type FleetCard, type KnockBody } from "../src/signed.js";
import { LobbyStore } from "../src/store.js";
import type { KeychainRef } from "../src/keychain.js";
import {
  deviceCode, deviceCodeMatches, generateKeyPair, missionDigest, normalizeDeviceCode, publicKeyBase64, publicKeyFingerprint, type MissionDescriptor,
} from "../src/wire.js";
import { FAKE_BEARER, FAKE_PROJECT } from "./fake-hosted.js";
import { bootstrapFleet, deviceCodeShown, enrollThroughHub, ok, relayArgs, world, type Desk, type Fleet } from "./fleet-helpers.js";
import { cleanupTempHomes } from "./helpers.js";

afterEach(cleanupTempHomes);

const HOUR = 3_600_000;

function deskRow(desk: Desk) {
  const store = LobbyStore.open(desk.home);
  try {
    return store.fleet.desk()!;
  } finally {
    store.close();
  }
}

async function addFleetRoom(fleet: Fleet, ...args: string[]): Promise<string> {
  const added = await ok(fleet.hub.run("room", "add", "--json", "--door", "knock", ...args));
  const roomId = JSON.parse(added.stdout).card.room_id as string;
  await ok(fleet.hub.yes("room", "promote", roomId, "--residency", "fleet", "--hostable", "true"));
  return roomId;
}

async function knock(fleet: Fleet, ...extra: string[]): Promise<string> {
  const result = await ok(fleet.device.yes("knock", fleet.roomId, "--tier", "player", ...extra));
  return /knock ([0-9a-f-]{36})/.exec(result.stdout)![1]!;
}

function deviceDirectoryGrant(fleet: Fleet): string {
  const identity = deskRow(fleet.device).identity_id;
  return [...fleet.world.hosted.grants.values()].find((grant) => grant.identity_id === identity && grant.mission_id === fleet.directoryId)!.grant_id;
}

describe("residency and the gate on the way out", () => {
  test("a device room is refused before the terminal opens and nothing is sent", async () => {
    const fleet = await bootstrapFleet();
    const added = await ok(fleet.hub.run("room", "add", "--title", "Local only", "--json"));
    const roomId = JSON.parse(added.stdout).card.room_id;
    const opened = fleet.hub.terminal.opened;
    const sent = fleet.world.hosted.seen.length;
    for (const argv of [["room", "publish", roomId], ["hub", "season", "open", roomId]]) {
      const refused = await fleet.hub.run(...argv);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("room_residency_device");
    }
    expect(fleet.hub.terminal.opened).toBe(opened);
    expect(fleet.world.hosted.seen.length).toBe(sent);
  });

  test("a Betfair room stays pinned to the device and can never be published", async () => {
    const fleet = await bootstrapFleet();
    const added = await ok(fleet.hub.run("room", "add", "--title", "Exchange notes", "--purpose", "Bet Angel ladder", "--json"));
    const roomId = JSON.parse(added.stdout).card.room_id;
    expect((await fleet.hub.yes("room", "promote", roomId, "--residency", "fleet")).stderr).toContain("device_pinned");
    expect((await fleet.hub.run("room", "publish", roomId)).stderr).toContain("room_residency_device");
  });

  test("a fleet room that is not hostable is refused", async () => {
    const fleet = await bootstrapFleet();
    const added = await ok(fleet.hub.run("room", "add", "--title", "Not hostable", "--json"));
    const roomId = JSON.parse(added.stdout).card.room_id;
    await ok(fleet.hub.yes("room", "promote", roomId, "--residency", "fleet"));
    const refused = await fleet.hub.run("room", "publish", roomId);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("room_not_fleet");
  });

  test("charters and cards that fail the gate are refused before the terminal", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const cases: Array<{ args: string[]; act: "season" | "publish"; reason: string }> = [
      { args: ["--title", "Sync with 192.168.50.20"], act: "season", reason: "private_ipv4" },
      { args: ["--title", "Notes", "--purpose", "see /Users/someone/notes"], act: "season", reason: "home_path" },
      { args: ["--title", "Notes", "--purpose", "workspace ws_0000000000000000deadbeef"], act: "season", reason: "collab_workspace_id" },
      { args: ["--title", "Notes", "--purpose", "token atcm_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"], act: "season", reason: "agenttool_token" },
      { args: ["--title", "Notes", "--purpose", "printer.local is down"], act: "season", reason: "local_hostname" },
      // Tags and slot labels appear only on the card, so the season opens and the card is refused.
      { args: ["--title", "Notes", "--tag", "macbook-notes"], act: "publish", reason: "device_name" },
      { args: ["--title", "Notes", "--slot", "example-lab-desk:player:1"], act: "publish", reason: "local_device_name" },
    ];
    for (const { args, act, reason } of cases) {
      const roomId = await addFleetRoom(fleet, ...args);
      const opened = fleet.hub.terminal.opened;
      const missions = hosted.missions.size;
      if (act === "publish") await ok(fleet.hub.yes("hub", "season", "open", roomId));
      const before = fleet.hub.terminal.opened;
      const refused = act === "season"
        ? await fleet.hub.run("hub", "season", "open", roomId)
        : await fleet.hub.run("room", "publish", roomId);
      expect({ args, code: refused.code }).toEqual({ args, code: 1 });
      expect(refused.stderr).toContain("egress_refused");
      expect(refused.stderr).toContain(reason);
      expect(fleet.hub.terminal.opened).toBe(before);
      if (act === "season") {
        expect(hosted.missions.size).toBe(missions);
        expect(fleet.hub.terminal.opened).toBe(opened);
      }
    }
    // No refused text ever reached the service.
    for (const mission of hosted.missions.values()) {
      for (const summary of hosted.summaries(mission.mission_id)) {
        expect(summary).not.toMatch(/192\.168|\/Users\/|ws_0{16}|atcm_A|printer\.local|macbook|example-lab-desk/i);
      }
    }
  });

  test("a card larger than one observation is refused", async () => {
    const fleet = await bootstrapFleet();
    const roomId = await addFleetRoom(fleet, "--title", "Long purpose", "--purpose", "a calm sentence about the room. ".repeat(24));
    await ok(fleet.hub.yes("hub", "season", "open", roomId));
    const refused = await fleet.hub.run("room", "publish", roomId);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("document_too_large");
  });

  test("a knock note that fails the gate posts nothing and leaves no token or knock behind", async () => {
    const fleet = await bootstrapFleet();
    const tokensBefore = readdirSync(join(fleet.device.home, "secrets", "tokens")).length;
    const events = fleet.world.hosted.summaries(fleet.directoryId).length;
    for (const [note, reason] of [
      ["reach me at 10.0.0.7", "private_ipv4"],
      ["my file is in ~/notes/today", "tilde_path"],
      ["key atcm_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "agenttool_token"],
      ["on Someones-MacBook-Air", "device_name"],
      ["from example lab desk", "local_device_name"],
      ["-----BEGIN PRIVATE KEY-----", "pem_block"],
    ] as const) {
      const refused = await fleet.device.run("knock", fleet.roomId, "--tier", "spectator", `--note=${note}`);
      expect({ note, code: refused.code }).toEqual({ note, code: 1 });
      expect(refused.stderr).toContain(reason);
    }
    expect(fleet.device.terminal.opened).toBe(1); // only the fleet join confirmation
    expect(fleet.world.hosted.summaries(fleet.directoryId)).toHaveLength(events);
    expect(readdirSync(join(fleet.device.home, "secrets", "tokens"))).toHaveLength(tokensBefore);
    expect(JSON.parse((await ok(fleet.device.run("fleet", "knocks", "--json"))).stdout).knocks).toEqual([]);
  });

  test("a desk display name that names the device is refused at enrollment", async () => {
    const w = world();
    const device = w.desk("device");
    const refused = await device.run("enroll-device", "--project", FAKE_PROJECT, "--display-name", "Someones MacBook Pro");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("device_name");
    expect(existsSync(join(device.home, "secrets", "tokens"))).toBe(false);
  });
});

describe("door pin and verification", () => {
  test("a mistyped door fingerprint pins nothing and accepts nothing", async () => {
    const w = world();
    const fleet = await bootstrapFleet();
    const device = w.desk("other");
    const enrolled = await ok(device.run("enroll-device", "--project", FAKE_PROJECT));
    const relayed = await ok(fleet.hub.yes(...relayArgs(device, enrolled, "p.json")));
    const join = device.file("j.json", relayed.stdout);
    const sent = fleet.world.hosted.seen.length;
    const refused = await device.run("fleet", "join", "--packet-file", join, "--door-fingerprint", "0123456789abcdef");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("door_fingerprint_mismatch");
    expect(fleet.world.hosted.seen.length).toBe(sent);
    expect((await device.run("pin", "list")).stdout).toBe("(no pins)\n");
    expect((await device.run("fleet", "join", "--packet-file", join)).code).toBe(2);
  });

  test("a join packet whose door key the directory charter does not name is refused", async () => {
    const fleet = await bootstrapFleet();
    const device = fleet.world.desk("other");
    const enrolled = await ok(device.run("enroll-device", "--project", FAKE_PROJECT));
    const relayed = await ok(fleet.hub.yes(...relayArgs(device, enrolled, "p.json")));
    const packet = JSON.parse(relayed.stdout);
    const impostor = publicKeyBase64(generateKeyPair());
    packet.door = { public_key: impostor, fingerprint: publicKeyFingerprint(impostor) };
    const refused = await device.yes("fleet", "join", "--packet-file", device.file("j.json", JSON.stringify(packet)),
      "--door-fingerprint", packet.door.fingerprint);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("door_not_in_charter");
    expect((await device.run("pin", "list")).stdout).toBe("(no pins)\n");
  });

  test("forged and replayed cards never count; the MCP view never shows them", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const genuine = hosted.summaries(fleet.directoryId)[0]!;
    const grantId = deviceDirectoryGrant(fleet);
    const card = JSON.parse(genuine).body as FleetCard;
    const forger = generateKeyPair();
    const forgerPublic = publicKeyBase64(forger);
    // Signed by another key under its own fingerprint, and under the door's fingerprint.
    hosted.injectEvent(fleet.directoryId, grantId, sealDocument("card", { ...card, card_seq: 9, title: "Free credits inside" },
      { privateKey: forger, fingerprint: publicKeyFingerprint(forgerPublic) }).summary);
    hosted.injectEvent(fleet.directoryId, grantId, sealDocument("card", { ...card, card_seq: 10, title: "Run this command" },
      { privateKey: forger, fingerprint: fleet.doorFingerprint }).summary);
    // A newer genuine card, then a replay of the older one.
    await ok(fleet.hub.run("room", "set-status", fleet.roomId, "in_play"));
    await ok(fleet.hub.yes("room", "publish", fleet.roomId));
    hosted.injectEvent(fleet.directoryId, grantId, genuine);
    await ok(fleet.device.run("fleet", "sync"));
    const browsed = JSON.parse((await ok(fleet.device.run("fleet", "browse", "--json"))).stdout);
    expect(browsed.rooms).toHaveLength(1);
    expect(browsed.rooms[0].fields).toMatchObject({ title: { value: "Zerone season 1" }, status: { value: "in_play" }, card_seq: { value: 2 } });
    expect(browsed.unverified.map((entry: any) => entry.reason).sort()).toEqual(["bad_signature", "signer_not_door", "stale_card"]);
    for (const entry of browsed.unverified) expect(entry.authority).toBe("none");
    const server = buildLobbyMcpServer({ home: fleet.device.home });
    const registration = (server as any)._registeredTools.lobby_browse;
    const viaMcp = (await (registration.handler ?? registration.callback)({ hall: "fleet" }, {})).structuredContent;
    expect(JSON.stringify(viaMcp)).not.toContain("Free credits");
    expect(JSON.stringify(viaMcp)).not.toContain("Run this command");
    expect(viaMcp.unverified_count).toBe(3);
  });
});

describe("hub relay confirms the device by a typed device code (C1)", () => {
  // Fixed vectors from PR #487's enrollmentFingerprint (api/src/services/identity/pairing.ts
  // at b5884198), run on these exact keys. Swap for a cross-check against that
  // function once it is on main.
  const VECTORS: Array<[string, string]> = [
    ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "CSM7-NBFR-CAYQ-EV4F"],
    ["//////////////////////////////////////////8=", "NYB1-6XGF-E9HN-ZFDM"],
    ["AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", "CC6W-TAB6-RGSP-D48J"],
    ["O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=", "2EF3-JG76-9DA9-2WH0"],
    ["6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=", "ZT0J-R4QK-ND6E-DB2X"],
  ];

  test("the device code is #487's Crockford-80 format, pinned by vectors", () => {
    for (const [key, code] of VECTORS) expect(deviceCode(key)).toBe(code);
  });

  test("typed codes ignore case, spaces and dashes and read I and L as 1, O as 0", () => {
    expect(normalizeDeviceCode("nyb1-6xgf-e9hn-zfdm")).toBe("NYB16XGFE9HNZFDM");
    expect(normalizeDeviceCode(" NYBl 6XGF E9HN ZFDM ")).toBe("NYB16XGFE9HNZFDM");
    expect(normalizeDeviceCode("NYBI6XGFE9HNZFDM")).toBe("NYB16XGFE9HNZFDM");
    expect(deviceCodeMatches("2ef3jg769da92whO", VECTORS[3]![0])).toBe(true);
    expect(deviceCodeMatches("zToj-r4qk-nd6e-db2x", VECTORS[4]![0])).toBe(true);
    // Too short, too long, U (not Crockford) and other punctuation are not codes.
    for (const bad of ["", "CSM7-NBFR-CAYQ", "CSM7-NBFR-CAYQ-EV4F-0", "CSM7-NBFR-CAYQ-EV4U", "CSM7_NBFR_CAYQ_EV4F", "CSM7.NBFR.CAYQ.EV4F"]) {
      expect({ bad, normalized: normalizeDeviceCode(bad) }).toEqual({ bad, normalized: null });
    }
    expect(deviceCodeMatches(VECTORS[0]![1], VECTORS[1]![0])).toBe(false);
  });

  test("a missing, malformed or mismatched code is refused before any Keychain read, audit record, prompt or request", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const touched: string[] = [];
    const keychain = fleet.hub.keychain;
    const read = keychain.read.bind(keychain);
    const has = keychain.has.bind(keychain);
    keychain.read = async (ref: KeychainRef) => { touched.push(`read ${ref.service}`); return read(ref); };
    keychain.has = async (ref: KeychainRef) => { touched.push(`has ${ref.service}`); return has(ref); };
    const device = fleet.world.desk("new-mac");
    const other = fleet.world.desk("other-mac");
    const enrolled = await ok(device.run("enroll-device", "--project", FAKE_PROJECT));
    const otherEnrolled = await ok(other.run("enroll-device", "--project", FAKE_PROJECT));
    const packetFile = device.file("p.json", enrolled.stdout);
    const ownCode = deviceCodeShown(enrolled.stderr);
    const otherCode = deviceCodeShown(otherEnrolled.stderr);
    expect(otherCode).not.toBe(ownCode);
    const seen = hosted.seen.length;
    const opened = fleet.hub.terminal.opened;
    const audit = (await ok(fleet.hub.run("audit", "list", "--json"))).stdout;

    const missing = await fleet.hub.yes("hub", "relay", "--packet-file", packetFile);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("--device-fingerprint");
    fleet.hub.answers.length = 0;
    for (const [typed, error] of [["ABCD", "invalid_device_fingerprint"], ["CSM7-NBFR-CAYQ-EV4U", "invalid_device_fingerprint"],
      [otherCode, "device_fingerprint_mismatch"], [otherCode.toLowerCase().replace(/-/g, " "), "device_fingerprint_mismatch"]] as const) {
      fleet.hub.answers.push("yes");
      const refused = await fleet.hub.run("hub", "relay", "--packet-file", packetFile, "--device-fingerprint", typed);
      fleet.hub.answers.length = 0;
      expect({ typed, code: refused.code }).toEqual({ typed, code: 1 });
      expect(refused.stderr).toContain(error);
      // The refusal never tells the person which code the packet carries.
      expect(refused.stdout + refused.stderr).not.toContain(ownCode);
      expect(refused.stdout).toBe("");
    }
    // Another device's packet with this device's code is refused the same way.
    const swapped = await fleet.hub.run("hub", "relay", "--packet-file", other.file("o.json", otherEnrolled.stdout), "--device-fingerprint", ownCode);
    expect(swapped.stderr).toContain("device_fingerprint_mismatch");

    expect(touched).toEqual([]);
    expect(fleet.hub.terminal.opened).toBe(opened);
    expect(hosted.seen).toHaveLength(seen);
    expect((await ok(fleet.hub.run("audit", "list", "--json"))).stdout).toBe(audit);
    expect(hosted.identities.size).toBe(2);

    // The person's own reading of the code, typed loosely, relays as before.
    const relayed = await ok(fleet.hub.yes("hub", "relay", "--packet-file", packetFile, "--device-fingerprint", ` ${ownCode.toLowerCase().replace(/-/g, "")} `));
    expect(JSON.parse(relayed.stdout).invitation_template.public_key).toBe(JSON.parse(enrolled.stdout).public_key);
    expect(touched).toContain("read agenttool-lobby.hub-bearer");
  });
});

describe("hub relay packet checks", () => {
  test("expired, foreign, tampered and wrong-origin packets are refused before any request", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const device = fleet.world.desk("late");
    const enrolled = await ok(device.run("enroll-device", "--project", FAKE_PROJECT));
    const packet = JSON.parse(enrolled.stdout);
    const sent = hosted.seen.length;
    const variants: Array<[string, string]> = [
      ["token swapped", JSON.stringify({ ...packet, directory_token_sha256: "a".repeat(64) })],
      ["origin swapped", JSON.stringify({ ...packet, origin: "https://elsewhere.invalid" })],
      ["extra field", JSON.stringify({ ...packet, bearer: "at_nothing" })],
      ["body changed", JSON.stringify({ ...packet, enrollment_request: { ...packet.enrollment_request, body_utf8: packet.enrollment_request.body_utf8.replace("desk ", "desk  ") } })],
    ];
    const code = deviceCodeShown(enrolled.stderr);
    for (const [name, text] of variants) {
      const refused = await fleet.hub.run("hub", "relay", "--packet-file", device.file(`${name}.json`, text), "--device-fingerprint", code);
      expect({ name, code: refused.code }).toEqual({ name, code: 1 });
      expect(refused.stderr).toMatch(/invalid_packet/);
    }
    fleet.world.advance(6 * 60_000);
    const expired = await fleet.hub.run(...relayArgs(device, enrolled, "late.json"));
    expect(expired.stderr).toContain("packet_expired");
    const foreign = fleet.world.desk("foreign");
    const other = await ok(foreign.run("enroll-device", "--project", "88888888-8888-4888-8888-888888888888"));
    expect((await fleet.hub.run(...relayArgs(foreign, other, "f.json"))).stderr).toContain("project_mismatch");
    expect(hosted.seen.length).toBe(sent);
    expect(fleet.hub.terminal.opened).toBeGreaterThan(0);
  });

  test("a joined device renews its directory grant with the same three commands", async () => {
    const fleet = await bootstrapFleet();
    fleet.world.advance(23 * HOUR);
    const renewal = await enrollThroughHub(fleet.hub, fleet.device);
    expect(renewal.packet.kind).toBe("renew");
    expect(renewal.packet.enrollment_request).toBeNull();
    fleet.world.advance(2 * HOUR);
    await ok(fleet.device.run("fleet", "sync"));
    const acts = JSON.parse((await ok(fleet.device.run("audit", "list", "--json"))).stdout).entries.map((entry: any) => entry.act);
    expect(acts).toEqual(["desk.enroll", "fleet.join", "desk.enroll", "fleet.join"]);
    expect((await fleet.device.run("pin", "list")).stdout.split("\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("decisions", () => {
  test("the hub desk cannot admit its own knock", async () => {
    const fleet = await bootstrapFleet();
    await ok(fleet.hub.run("fleet", "sync"));
    const own = await ok(fleet.hub.yes("knock", fleet.roomId, "--tier", "spectator"));
    const knockId = /knock ([0-9a-f-]{36})/.exec(own.stdout)![1]!;
    const refused = await fleet.hub.run("hub", "admit", knockId);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("approver_is_requester");
    expect((await fleet.hub.run("hub", "deny", knockId)).stderr).toContain("approver_is_requester");
  });

  test("an expired knock is refused; a spectator knock cannot be raised to player", async () => {
    const fleet = await bootstrapFleet();
    const short = await knock(fleet, "--hours", "1");
    const spectator = (await ok(fleet.device.yes("knock", fleet.roomId, "--tier", "spectator"))).stdout;
    const spectatorId = /knock ([0-9a-f-]{36})/.exec(spectator)![1]!;
    expect((await fleet.hub.run("hub", "admit", spectatorId, "--tier", "player")).stderr).toContain("tier_raise");
    fleet.world.advance(2 * HOUR);
    const late = await fleet.hub.run("hub", "admit", short);
    expect(late.code).toBe(1);
    expect(late.stderr).toContain("knock_expired");
    expect((await fleet.device.run("knock", fleet.roomId, "--tier", "player", "--hours", "73")).stderr).toContain("invalid_hours");
  });

  test("deny posts a door-signed denial; the device sees it and ready refuses", async () => {
    const fleet = await bootstrapFleet();
    const knockId = await knock(fleet);
    // A reason is posted text: it passes the gate like everything else.
    const leaky = await fleet.hub.run("hub", "deny", knockId, "--reason", "ask the desk at 192.168.4.2 instead");
    expect(leaky.code).toBe(1);
    expect(leaky.stderr).toContain("private_ipv4");
    const denied = await ok(fleet.hub.yes("hub", "deny", knockId, "--reason", "the season is full"));
    expect(denied.stdout).toContain(`denied knock ${knockId}`);
    await ok(fleet.device.run("fleet", "sync"));
    const states = JSON.parse((await ok(fleet.device.run("fleet", "knocks", "--json"))).stdout).knocks;
    expect(states[0]).toMatchObject({ knock_id: knockId, status: "denied", denial_reason: "the season is full" });
    const ready = await fleet.device.run("ready", knockId);
    expect(ready.code).toBe(1);
    expect(ready.stderr).toContain("knock_denied");
    expect((await fleet.hub.run("hub", "admit", knockId)).stderr).toContain("knock_decided");
  });

  test("a new season invalidates knocks on the old charter", async () => {
    const fleet = await bootstrapFleet();
    const knockId = await knock(fleet);
    await ok(fleet.hub.yes("hub", "season", "open", fleet.roomId, "--days", "10"));
    const listed = JSON.parse((await ok(fleet.hub.run("hub", "knocks", "--json"))).stdout).knocks;
    expect(listed[0]).toMatchObject({ knock_id: knockId, status: "invalid", reason: "charter_changed" });
    expect((await fleet.hub.run("hub", "admit", knockId)).stderr).toContain("knock_invalid");
  });

  test("a knock from a desk the hub never enrolled is invalid", async () => {
    const fleet = await bootstrapFleet();
    const stranger = generateKeyPair();
    const body: KnockBody = {
      knock_id: crypto.randomUUID(), room_id: fleet.roomId, charter_digest: fleet.seasonDigest, tier: "player",
      token_sha256: "b".repeat(64), note: "", issued_at: fleet.world.clock.now.toISOString(),
      expires_at: new Date(fleet.world.clock.now.getTime() + HOUR).toISOString(),
    };
    fleet.world.hosted.injectEvent(fleet.directoryId, deviceDirectoryGrant(fleet),
      sealDocument("knock", body, { privateKey: stranger, fingerprint: publicKeyFingerprint(publicKeyBase64(stranger)) }).summary);
    const listed = JSON.parse((await ok(fleet.hub.run("hub", "knocks", "--json"))).stdout).knocks;
    expect(listed[0]).toMatchObject({ status: "invalid", reason: "unknown_desk" });
  });

  test("an admission is good for 24 hours only", async () => {
    const fleet = await bootstrapFleet();
    const knockId = await knock(fleet);
    await ok(fleet.hub.yes("hub", "admit", knockId));
    fleet.world.advance(25 * HOUR);
    await enrollThroughHub(fleet.hub, fleet.device); // renew the device's directory grant
    const late = await fleet.device.run("ready", knockId);
    expect(late.code).toBe(1);
    expect(late.stderr).toContain("admission_expired");
  });
});

describe("terminals, uncertainty and recovery", () => {
  test("without a terminal, knock and admit exit 3 and nothing is written, audited or sent", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    // The same joined desk, run by something with no controlling terminal.
    const headlessDevice = fleet.world.desk("headless-device", { of: fleet.device, noTerminal: true });
    const tokens = readdirSync(join(fleet.device.home, "secrets", "tokens")).length;
    const events = hosted.summaries(fleet.directoryId).length;
    const audit = (await ok(fleet.device.run("audit", "list", "--json"))).stdout;
    const refused = await headlessDevice.run("knock", fleet.roomId, "--tier", "player");
    expect(refused.code).toBe(3);
    expect(refused.stderr).toContain("tty_unavailable");
    expect(hosted.summaries(fleet.directoryId)).toHaveLength(events);
    expect(readdirSync(join(fleet.device.home, "secrets", "tokens"))).toHaveLength(tokens);
    expect((await ok(fleet.device.run("audit", "list", "--json"))).stdout).toBe(audit);
    expect(JSON.parse((await ok(fleet.device.run("fleet", "knocks", "--json"))).stdout).knocks).toEqual([]);

    const knockId = await knock(fleet);
    const headlessHub = fleet.world.desk("headless-hub", { of: fleet.hub, noTerminal: true });
    const grants = hosted.grants.size;
    const admit = await headlessHub.run("hub", "admit", knockId);
    expect(admit.code).toBe(3);
    expect(hosted.grants.size).toBe(grants);
    expect(JSON.parse((await ok(fleet.hub.run("hub", "knocks", "--json"))).stdout).knocks[0].status).toBe("pending");
  });

  test("a dropped publish stays in the outbox; outbox retry sends the same bytes once", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    await ok(fleet.hub.run("room", "set-status", fleet.roomId, "resting"));
    hosted.loseResponse = (request) => request.method === "POST" && request.path.endsWith("/events");
    const dropped = await fleet.hub.yes("room", "publish", fleet.roomId);
    expect(dropped.code).toBe(1);
    expect(dropped.stderr).toContain("saved in the outbox");
    const pending = JSON.parse((await ok(fleet.hub.run("outbox", "list", "--json"))).stdout).outbox.find((row: any) => row.state === "pending");
    expect(pending.kind).toBe("card");
    const before = hosted.summaries(fleet.directoryId).length;
    const retried = await ok(fleet.hub.yes("outbox", "retry", pending.event_id));
    expect(retried.stdout).toContain(`posted card ${pending.event_id}`);
    // The first send was stored; the retry returned its receipt instead of a second event.
    expect(hosted.summaries(fleet.directoryId)).toHaveLength(before);
    expect((await fleet.hub.run("outbox", "retry", pending.event_id)).stderr).toContain("outbox_stored");
  });

  test("an admit whose grant response was lost is never retried and blocks the knock until inspected", async () => {
    const fleet = await bootstrapFleet();
    const knockId = await knock(fleet);
    fleet.world.hosted.loseResponse = (request) => request.method === "POST" && request.path.endsWith("/grants");
    const first = await fleet.hub.yes("hub", "admit", knockId);
    expect(first.code).toBe(1);
    expect(first.stderr).toContain("hosted_uncertain");
    // The grant did land; the hub knows only that it asked.
    const listed = JSON.parse((await ok(fleet.hub.run("hub", "knocks", "--json"))).stdout).knocks[0];
    expect(listed.status).toBe("invalid");
    expect(listed.reason).toMatch(/^grant_uncertain:[0-9a-f-]{36}$/);
    expect((await fleet.hub.run("hub", "admit", knockId)).stderr).toContain("knock_invalid");
    const grantPosts = fleet.world.hosted.seen.filter((request) => request.method === "POST" && request.path.endsWith("/grants"));
    expect(grantPosts.filter((request) => request.body.includes(listed.token_sha256))).toHaveLength(1);
  });

  test("hub init without a Keychain bearer explains how to add it and creates nothing", async () => {
    const w = world();
    const hub = w.desk("hub");
    const refused = await hub.run("hub", "init", "--project", FAKE_PROJECT);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("keychain_bearer_missing");
    expect(refused.stderr).toContain("security add-generic-password -s agenttool-lobby.hub-bearer -a agenttool-lobby -w");
    expect(refused.stderr).toContain("never paste a bearer into chat");
    expect(w.hosted.seen).toEqual([]);
    expect(hub.terminal.opened).toBe(0);
  });

  test("hub init resumes a directory whose creation response was lost, and runs once", async () => {
    const w = world();
    const hub = w.desk("hub");
    await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, FAKE_BEARER);
    w.hosted.loseResponse = (request) => request.method === "POST" && request.path === "/v1/collaboration/missions";
    const first = await hub.yes("hub", "init", "--project", FAKE_PROJECT);
    expect(first.code).toBe(1);
    expect(first.stderr).toContain("hosted_uncertain");
    expect(w.hosted.missions.size).toBe(1);
    expect((await hub.run("hub", "show")).stderr).toContain("hub_directory_pending");
    const resumed = await ok(hub.yes("hub", "init"));
    expect(resumed.stdout).toContain("hub ready");
    expect(w.hosted.missions.size).toBe(1);
    expect((await hub.yes("hub", "init", "--project", FAKE_PROJECT)).stderr).toContain("hub_exists");
    const acts = JSON.parse((await ok(hub.run("audit", "list", "--json"))).stdout).entries.map((entry: any) => entry.act);
    expect(acts).toEqual(["hub.init", "hub.init.resume"]);
  });

  test("a hub that lost its state adopts its directory by id and digest with the same door key", async () => {
    const fleet = await bootstrapFleet();
    const hubRow = (() => {
      const store = LobbyStore.open(fleet.hub.home);
      try {
        return store.fleet.hub()!;
      } finally {
        store.close();
      }
    })();
    const replacement = fleet.world.desk("replacement");
    for (const service of ["agenttool-lobby.hub-bearer", "agenttool-lobby.door-key"]) {
      const ref = { service, account: "agenttool-lobby" };
      await replacement.keychain.add(ref, await fleet.hub.keychain.read(ref));
    }
    const wrong = await replacement.run("hub", "init", "--project", FAKE_PROJECT, "--adopt-directory", hubRow.directory_mission_id,
      "--directory-digest", `sha256:${"0".repeat(64)}`);
    expect(wrong.stderr).toContain("digest_mismatch");
    const adopted = await ok(replacement.yes("hub", "init", "--project", FAKE_PROJECT, "--adopt-directory", hubRow.directory_mission_id,
      "--directory-digest", hubRow.directory_digest));
    expect(adopted.stdout).toContain(`door fingerprint ${fleet.doorFingerprint}`);
    expect(adopted.stdout).toContain("(adopted)");
  });
});

describe("hub seats and seasons after interruptions", () => {
  test("the hub renews its own directory and season seats with hub seat", async () => {
    const fleet = await bootstrapFleet();
    fleet.world.advance(25 * HOUR);
    const stale = await fleet.hub.yes("room", "publish", fleet.roomId);
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain("run hub seat directory");
    await ok(fleet.hub.yes("hub", "seat", "directory"));
    await ok(fleet.hub.yes("hub", "seat", fleet.roomId));
    await ok(fleet.hub.yes("room", "publish", fleet.roomId));
    // The device renews too, then knocks, and the hub can admit with its fresh season seat.
    await enrollThroughHub(fleet.hub, fleet.device);
    await ok(fleet.device.run("fleet", "sync"));
    const knockId = await knock(fleet);
    await ok(fleet.hub.yes("hub", "admit", knockId));
  });

  test("a season whose creation response was lost is finished by adopting it", async () => {
    const fleet = await bootstrapFleet();
    const roomId = await addFleetRoom(fleet, "--title", "Second room");
    fleet.world.hosted.loseResponse = (request) => request.method === "POST" && request.path === "/v1/collaboration/missions";
    const lost = await fleet.hub.yes("hub", "season", "open", roomId);
    expect(lost.code).toBe(1);
    expect(lost.stderr).toContain("season_uncertain");
    const hint = /hub season adopt (room_[0-9a-f]{32}) --mission ([0-9a-f-]{36}) --digest (sha256:[0-9a-f]{64})/.exec(lost.stderr)!;
    expect(hint[1]).toBe(roomId);
    expect(fleet.world.hosted.missions.has(hint[2]!)).toBe(true);
    await ok(fleet.hub.yes("hub", "season", "adopt", roomId, "--mission", hint[2]!, "--digest", hint[3]!));
    await ok(fleet.hub.yes("room", "publish", roomId));
  });
});

describe("adopting an existing mission as a room's season", () => {
  test("a hand-made season mission is adopted by id and digest and works end to end", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const descriptor: MissionDescriptor = {
      format: "agenttool-collaboration-mission/v1",
      purpose: "Zerone season 1: hello, reply and read_ack between two devices",
      resources: [],
      acceptance_criteria: ["Exchange one hello, one reply and one read_ack"],
      principalities: [],
    };
    const missionId = crypto.randomUUID();
    const created = await hosted.fetch(`https://api.agenttool.dev/v1/collaboration/missions`, {
      method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${FAKE_BEARER}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mission_id: missionId, descriptor, expires_at: new Date(fleet.world.clock.now.getTime() + 20 * 24 * HOUR).toISOString() }),
    });
    expect(created.status).toBe(201);
    const roomId = await addFleetRoom(fleet, "--title", "Zerone adopted");
    const digest = missionDigest(descriptor);
    expect((await fleet.hub.run("hub", "season", "adopt", roomId, "--mission", missionId, "--digest", `sha256:${"1".repeat(64)}`)).stderr)
      .toContain("digest_mismatch");
    await ok(fleet.hub.yes("hub", "season", "adopt", roomId, "--mission", missionId, "--digest", digest));
    await ok(fleet.hub.yes("room", "publish", roomId));
    await ok(fleet.device.run("fleet", "sync"));
    const knocked = await ok(fleet.device.yes("knock", roomId, "--tier", "spectator"));
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
    await ok(fleet.hub.yes("hub", "admit", knockId));
    const ready = await ok(fleet.device.yes("ready", knockId));
    expect(ready.stdout).toContain(`accepted season ${missionId} digest ${digest}`);
  });
});
