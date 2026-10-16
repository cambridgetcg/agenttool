/** The lobby desk's table talk, renewal, leave, kick, block and emergency
 * stop through the API's own mission gateway, in process (persistence
 * replaced; see lobby-gateway-fixture.ts), and table talk checked against the
 * reviewed participant client's own chat code (bin/mission-chat.mjs): the
 * lobby's message bytes are exactly `message()`'s, and `verifyChatEvent()`
 * accepts a lobby-sent event when pinned from the lobby's door-signed roster.
 * Synthetic project, bearer and keys; no live service, no real Keychain. */
import { afterEach, describe, expect, test } from "bun:test";
import { message, validateConfig, verifyChatEvent } from "../mission-chat.mjs";
import { apiApp, BEARER, lobbyDesk, memoryService, ORIGIN, PROJECT } from "./lobby-gateway-fixture";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const MISSIONS = "/v1/collaboration/missions";

async function fleetThroughGateway() {
  let clock = Date.parse("2026-10-16T12:00:00.000Z");
  const now = () => new Date(clock);
  const advance = (ms: number) => { clock += ms; };
  const memory = memoryService(now);
  const seen: Array<{ method: string; path: string; body: string }> = [];
  const app = apiApp(memory);
  const fetchImpl = async (url: string, init: RequestInit) => {
    seen.push({ method: String(init.method), path: new URL(url).pathname, body: typeof init.body === "string" ? init.body : init.body === undefined ? "" : "<bytes>" });
    return app(url, init);
  };
  const hub = lobbyDesk(fetchImpl, now, cleanups, advance);
  const device = lobbyDesk(fetchImpl, now, cleanups, advance);
  const second = lobbyDesk(fetchImpl, now, cleanups, advance);
  await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, BEARER);
  const init = await hub.yes("hub", "init", "--project", PROJECT);
  const door = /door fingerprint ([0-9a-f]{16})/.exec(init)![1]!;
  for (const who of [hub, device, second]) {
    const packet = await who.run("enroll-device", "--project", PROJECT);
    const join = await hub.yes("hub", "relay", "--packet-file", who.file("packet.json", packet));
    await who.yes("fleet", "join", "--packet-file", who.file("join.json", join), "--door-fingerprint", door);
  }
  const roomId = JSON.parse(await hub.run("room", "add", "--title", "Zerone season 1", "--door", "knock", "--json")).card.room_id as string;
  await hub.yes("room", "promote", roomId, "--residency", "fleet", "--hostable", "true");
  const season = await hub.yes("hub", "season", "open", roomId);
  const [, seasonId, seasonDigest] = /season ([0-9a-f-]{36}) digest (sha256:[0-9a-f]{64})/.exec(season)!;
  await hub.yes("room", "publish", roomId);
  for (const who of [device, second]) {
    await who.run("fleet", "sync");
    const knockId = /knock ([0-9a-f-]{36})/.exec(await who.yes("knock", roomId, "--tier", "player"))![1]!;
    await hub.yes("hub", "admit", knockId);
    await who.yes("ready", knockId);
  }
  const status = async (who: typeof hub) => JSON.parse(await who.run("fleet", "status", "--json"));
  return { memory, seen, hub, device, second, roomId, seasonId: seasonId!, seasonDigest: seasonDigest!, status, advance, now, fetchImpl,
    directory: (await status(hub)).desk.directory_mission_id as string };
}

describe("lobby table talk and access through the API's mission gateway", () => {
  test("say and read in the participant client's exact chat format, verified by its own code", async () => {
    const fleet = await fleetThroughGateway();
    const hubStatus = await fleet.status(fleet.hub);
    const hubId = hubStatus.desk.identity_id as string;
    await fleet.device.yes("room", "say", fleet.roomId, "--to", hubId, "--text", "hello from the second desk");

    // The hub's chat configuration, pinned from the door-signed roster, is a valid participant-client config.
    const config = JSON.parse(await fleet.hub.run("room", "roster", fleet.roomId, "--chat-config"));
    expect(validateConfig(config)).toEqual(config);
    expect(config.peers).toHaveLength(2);
    expect(config.mission_digest).toBe(fleet.seasonDigest);

    const event = fleet.memory.missions.get(fleet.seasonId)!.events.find((item: any) => item.observation.summary.includes("agenttool-mission-chat/v1"));
    // Byte for byte the participant client's own envelope.
    expect(event.observation.summary).toBe(JSON.stringify(message(config, hubId, "message", "hello from the second desk")));
    // And the participant client's own verifier accepts the lobby-sent event.
    const hubSeason = hubStatus.grants.find((grant: any) => grant.purpose === "season");
    const p = { origin: ORIGIN, mission_id: fleet.seasonId, identity_id: hubId, signing_key_id: hubStatus.desk.signing_key_id, grant_id: hubSeason.grant_id };
    const item = verifyChatEvent(event, p, config);
    expect(item?.message).toEqual({ format: "agenttool-mission-chat/v1", conversation: "table", to_identity: hubId, kind: "message", text: "hello from the second desk" });

    // The lobby reads it back verified; a read_ack answers it.
    const read = JSON.parse(await fleet.hub.run("room", "read", fleet.roomId, "--json"));
    expect(read.messages.map((entry: any) => [entry.text, entry.to_me, entry.from.basis])).toEqual([["hello from the second desk", true, "door_roster_pin"]]);
    await fleet.hub.yes("room", "say", fleet.roomId, "--text", "read", "--kind", "read_ack", "--in-reply-to", read.messages[0].event_id);
    const waited = JSON.parse(await fleet.device.run("room", "wait", fleet.roomId, "--after", read.next_cursor, "--seconds", "5", "--json"));
    expect(waited.messages.map((entry: any) => [entry.kind, entry.in_reply_to])).toEqual([["read_ack", read.messages[0].event_id]]);
    // Every participant request the gateway saw was a closed operation with a verified proof.
    expect(new Set(fleet.memory.requests.map((request) => request.operation))).toEqual(new Set(["invitation", "accept", "observe", "list"]));
  });

  test("renewal, leave with zero body bytes, kick, block and the emergency stop", async () => {
    const fleet = await fleetThroughGateway();
    const { memory, hub, device, second } = fleet;

    // Renewal inside the term: request in the room, sweep, accept the same digest.
    fleet.advance(20 * 3_600_000);
    await device.yes("room", "renew", "request", fleet.roomId);
    const swept = await hub.yes("hub", "renew-sweep");
    expect(swept).toContain("renewed did:at:");
    const accepted = await device.yes("room", "renew", "accept", fleet.roomId);
    expect(accepted).toContain(`accepted digest ${fleet.seasonDigest} again`);
    const deviceId = (await fleet.status(device)).desk.identity_id;
    expect([...memory.grants.values()].filter((grant) => grant.identityId === deviceId && grant.missionId === fleet.seasonId && grant.acceptedAt !== null)).toHaveLength(2);

    // Leave: one POST .../leave per live grant, each with zero body bytes through the real gateway.
    await device.yes("room", "leave", fleet.roomId);
    const leaves = memory.requests.filter((request) => request.operation === "leave");
    expect(leaves).toEqual([{ operation: "leave", bodyBytes: 0, missionId: fleet.seasonId }, { operation: "leave", bodyBytes: 0, missionId: fleet.seasonId }]);
    expect([...memory.grants.values()].filter((grant) => grant.identityId === deviceId && grant.missionId === fleet.seasonId).every((grant) => grant.left)).toBe(true);

    // Kick the second member: the administrator revoke route, zero body bytes.
    const secondId = (await fleet.status(second)).desk.identity_id;
    await hub.yes("hub", "block", fleet.roomId, secondId);
    const revokes = fleet.seen.filter((request) => request.path.endsWith("/revoke"));
    expect(revokes.map((request) => [request.method, request.body])).toEqual([["POST", ""]]);
    expect(memory.operations).toContain("revoke_grant");
    const refused = await second.exec("room", "read", fleet.roomId);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("HTTP 401");

    // The emergency stop: missions and grants revoked through the real routes; the manual step printed.
    const stopped = await hub.yes("hub", "stop");
    expect(stopped).toContain("MANUAL STEP FOR THE OWNER");
    expect(memory.missions.get(fleet.seasonId)!.row.revokedAt).not.toBeNull();
    expect(memory.missions.get(fleet.directory)!.row.revokedAt).not.toBeNull();
    expect(fleet.seen.filter((request) => request.path.endsWith("/revoke")).every((request) => request.body === "")).toBe(true);
    expect(fleet.seen.some((request) => request.path.startsWith("/v1/keys"))).toBe(false);
    expect(fleet.seen.filter((request) => request.path === `${MISSIONS}/${fleet.seasonId}/revoke`)).toHaveLength(1);
  });

  test("a renewal grant the gateway refuses (409: the hash is bound elsewhere) is forgotten, so kick and stop settle", async () => {
    const fleet = await fleetThroughGateway();
    const { memory, hub, device } = fleet;
    const requested = await device.yes("room", "renew", "request", fleet.roomId);
    const token = /token sha256 ([0-9a-f]{64})/.exec(requested)![1]!;
    const desk = (await fleet.status(device)).desk;
    // The same hash is bound on the service first, by hand, outside this hub's records.
    const bound = await fleet.fetchImpl(`${ORIGIN}${MISSIONS}/${fleet.seasonId}/grants`, {
      method: "POST", redirect: "error", headers: { Authorization: `Bearer ${BEARER}`, "Content-Type": "application/json" },
      body: JSON.stringify({ grant_id: crypto.randomUUID(), identity_id: desk.identity_id, signing_key_id: desk.signing_key_id, actions: ["mission.read"],
        expires_at: new Date(fleet.now().getTime() + 3_600_000).toISOString(), token_sha256: token }),
    });
    expect(bound.ok).toBe(true);
    const swept = await hub.yes("hub", "renew-sweep").then(() => "exit 0", (error: Error) => error.message);
    expect(swept).toContain("exited 1");
    expect(swept).toContain("HTTP 409");
    // Nothing of that request stays recorded, so each removal settles in one run (no phantom grant answering 404).
    await hub.yes("hub", "kick", fleet.roomId, desk.identity_id);
    await hub.yes("hub", "stop");
    expect([...memory.grants.values()].filter((grant) => grant.identityId === desk.identity_id && grant.missionId === fleet.seasonId && grant.tokenHash !== token)
      .every((grant) => grant.revokedAt !== null || grant.left)).toBe(true);
    expect(swept).toContain("created nothing");
  });
});
