/** The lobby desk's fleet hall against the API's own mission gateway and
 * enrollment router, in process. Only persistence is replaced: an in-memory
 * service built from the API's own contract helpers (operation routing,
 * strict bodies, exact-request proof verification, digests, event paging) and
 * the API's own enrollment signing bytes (bin/tests/lobby-gateway-fixture.ts).
 * Synthetic project, bearer and keys; no live service, no real Keychain,
 * scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { canonicalMissionRequestBytes, missionSha256, verifyMissionProof } from "../../api/src/services/collaboration/proof";
import { correspondenceCanonicalJson } from "../../api/src/services/correspondence/canonical";
import { canonicalIdentityEnrollmentBytes } from "../../api/src/services/identity/enrollment";
import { ParticipantClient } from "../../packages/lobby/src/hosted";
import { DeskSecrets } from "../../packages/lobby/src/secrets";
import { openDocument } from "../../packages/lobby/src/signed";
import {
  deviceCode, enrollmentDigest, generateKeyPair, LOBBY_ORIGIN, missionDigest, publicKeyBase64, requestDigest, signBytes, validateMissionDescriptor,
} from "../../packages/lobby/src/wire";
import { apiApp, BEARER, lobbyDesk, memoryService, ORIGIN, PROJECT } from "./lobby-gateway-fixture";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** The device code enroll-device showed on stderr, read as a person reads it. */
const codeShown = (stderr: string) => /device code ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})\n/.exec(stderr)![1]!;

describe("lobby fleet hall through the API's mission gateway and enrollment router", () => {
  test("the desk's request and enrollment digests are the API's signing bytes", () => {
    const input = { origin: ORIGIN, method: "POST", requestTarget: "/v1/collaboration/missions/11111111-1111-4111-8111-111111111111/events",
      missionId: "11111111-1111-4111-8111-111111111111", bodyBytes: Buffer.from('{"event_id":"x","summary":"雨夜"}'),
      proof: { grantId: "22222222-2222-4222-8222-222222222222", identityId: "33333333-3333-4333-8333-333333333333",
        keyId: "44444444-4444-4444-8444-444444444444", timestamp: "2026-10-16T12:00:00.000Z", signature: "" } };
    const ours = requestDigest({ origin: input.origin, method: "POST", target: input.requestTarget, missionId: input.missionId,
      grantId: input.proof.grantId, identityId: input.proof.identityId, keyId: input.proof.keyId, body: input.bodyBytes, timestamp: input.proof.timestamp });
    expect(Buffer.from(ours)).toEqual(Buffer.from(canonicalMissionRequestBytes(input)));
    const key = generateKeyPair();
    const signature = signBytes(key, ours).toString("base64url");
    expect(verifyMissionProof({ ...input, token: "", proof: { ...input.proof, signature } } as any, publicKeyBase64(key), new Date("2026-10-16T12:01:00.000Z"))).toBe(true);
    const enrollment = { origin: ORIGIN, projectId: PROJECT, bodyBytes: Buffer.from("{}") };
    expect(Buffer.from(enrollmentDigest(enrollment))).toEqual(Buffer.from(canonicalIdentityEnrollmentBytes(enrollment)));
    const descriptor = { format: "agenttool-collaboration-mission/v1" as const, purpose: "大廳 🌞", resources: [], acceptance_criteria: ["c"], principalities: [] };
    expect(missionDigest(validateMissionDescriptor(descriptor))).toBe(`sha256:${missionSha256(correspondenceCanonicalJson(descriptor))}`);
    expect(LOBBY_ORIGIN).toBe(ORIGIN);
  });

  test("the device code is the identity-pairing enrollment fingerprint format (pinned vectors)", () => {
    // From PR #487's enrollmentFingerprint (api/src/services/identity/pairing.ts at b5884198) on
    // these exact keys. Once that function is on main, cross-check it on random keys instead.
    for (const [key, code] of [
      ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "CSM7-NBFR-CAYQ-EV4F"],
      ["//////////////////////////////////////////8=", "NYB1-6XGF-E9HN-ZFDM"],
      ["AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", "CC6W-TAB6-RGSP-D48J"],
      ["O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=", "2EF3-JG76-9DA9-2WH0"],
      ["6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=", "ZT0J-R4QK-ND6E-DB2X"],
    ]) expect(deviceCode(key!)).toBe(code!);
  });

  test("hub relay with a mismatched device code reaches neither the enrollment router nor the gateway", async () => {
    const now = () => new Date("2026-10-16T12:00:00.000Z");
    const memory = memoryService(now);
    let requests = 0;
    const app = apiApp(memory);
    const fetchImpl = async (url: string, init: RequestInit) => { requests += 1; return app(url, init); };
    const hub = lobbyDesk(fetchImpl, now, cleanups);
    const device = lobbyDesk(fetchImpl, now, cleanups);
    const other = lobbyDesk(fetchImpl, now, cleanups);
    await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, BEARER);
    await hub.yes("hub", "init", "--project", PROJECT);
    const sent = requests;
    const enrolled = await device.exec("enroll-device", "--project", PROJECT);
    const otherCode = codeShown((await other.exec("enroll-device", "--project", PROJECT)).stderr);
    const refused = await hub.exec("hub", "relay", "--packet-file", device.file("packet.json", enrolled.stdout), "--device-fingerprint", otherCode);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("device_fingerprint_mismatch");
    expect(requests).toBe(sent);
    expect(memory.operations.filter(operation => operation === "enroll")).toHaveLength(0);
    const missing = await hub.exec("hub", "relay", "--packet-file", device.file("packet.json", enrolled.stdout));
    expect(missing.code).toBe(2);
    expect(requests).toBe(sent);
  });

  test("hub init, enroll-device, relay, join, season, publish, knock, admit and ready pass the real gateway", async () => {
    let clock = Date.parse("2026-10-16T12:00:00.000Z");
    const now = () => new Date(clock);
    const memory = memoryService(now);
    const fetchImpl = apiApp(memory);
    const hub = lobbyDesk(fetchImpl, now, cleanups);
    const device = lobbyDesk(fetchImpl, now, cleanups);
    await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, BEARER);

    const init = await hub.yes("hub", "init", "--project", PROJECT);
    const door = /door fingerprint ([0-9a-f]{16})/.exec(init)![1]!;
    for (const who of [hub, device]) {
      // The person reads the device code on the device's own screen and types it at the hub.
      const enrolled = await who.exec("enroll-device", "--project", PROJECT);
      const code = codeShown(enrolled.stderr);
      expect(code).toBe(deviceCode(JSON.parse(enrolled.stdout).public_key));
      const join = await hub.yes("hub", "relay", "--packet-file", who.file("packet.json", enrolled.stdout), "--device-fingerprint", code);
      expect(hub.lastBytes().device.device_code).toBe(code);
      await who.yes("fleet", "join", "--packet-file", who.file("join.json", join), "--door-fingerprint", door);
    }
    const roomId = JSON.parse(await hub.run("room", "add", "--title", "Zerone season 1", "--door", "knock", "--tag", "zerone", "--json")).card.room_id;
    await hub.yes("room", "promote", roomId, "--residency", "fleet", "--hostable", "true");
    const season = await hub.yes("hub", "season", "open", roomId);
    const [, seasonId, seasonDigest] = /season ([0-9a-f-]{36}) digest (sha256:[0-9a-f]{64})/.exec(season)!;
    await hub.yes("room", "publish", roomId);

    clock += 60_000;
    await device.run("fleet", "sync");
    const browsed = JSON.parse(await device.run("fleet", "browse", "--json"));
    expect(browsed.rooms.map((room: any) => [room.fields.room_id.value, room.signed_by.door_fingerprint])).toEqual([[roomId, door]]);
    const knocked = await device.yes("knock", roomId, "--tier", "player", "--note", "hello from the second desk");
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked)![1]!;
    clock += 60_000;
    const knocks = JSON.parse(await hub.run("hub", "knocks", "--json")).knocks;
    expect(knocks).toEqual([expect.objectContaining({ knock_id: knockId, status: "pending" })]);
    await hub.yes("hub", "admit", knockId);
    clock += 60_000;
    const ready = await device.yes("ready", knockId);
    expect(ready).toContain(`accepted season ${seasonId} digest ${seasonDigest}`);

    // Every participant request passed the API's verifyMissionProof; the grant was bound to the device's own hash.
    expect(memory.operations.filter(operation => operation === "enroll")).toHaveLength(2);
    const seasonGrants = [...memory.grants.values()].filter(grant => grant.missionId === seasonId);
    expect(seasonGrants.every(grant => grant.acceptedAt !== null)).toBe(true);
    // The admission, then the keyed roster (the host and the new member fit one part).
    expect(memory.missions.get(seasonId!)!.events.map((event: any) => JSON.parse(event.observation.summary).kind)).toEqual(["admission", "member_roster"]);
  });

  test("directory renewal: a desk-chosen grant id and hash pass the gateway; invitation before issue is 401; accept is idempotent", async () => {
    let clock = Date.parse("2026-10-16T12:00:00.000Z");
    const now = () => new Date(clock);
    const memory = memoryService(now);
    const fetchImpl = apiApp(memory);
    const hub = lobbyDesk(fetchImpl, now, cleanups);
    const device = lobbyDesk(fetchImpl, now, cleanups);
    await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, BEARER);
    const init = await hub.yes("hub", "init", "--project", PROJECT);
    const door = /door fingerprint ([0-9a-f]{16})/.exec(init)![1]!;
    const directoryId = /directory ([0-9a-f-]{36})/.exec(init)![1]!;
    for (const who of [hub, device]) {
      const enrolled = await who.exec("enroll-device", "--project", PROJECT);
      const join = await hub.yes("hub", "relay", "--packet-file", who.file("packet.json", enrolled.stdout), "--device-fingerprint", codeShown(enrolled.stderr));
      await who.yes("fleet", "join", "--packet-file", who.file("join.json", join), "--door-fingerprint", door);
    }
    clock += 60_000;

    // The desk posts a signed directory_renew naming a grant id and token hash it chose.
    await device.yes("fleet", "renew");
    const request = device.lastBytes().request;
    const observed = memory.missions.get(directoryId)!.events.at(-1);
    expect(JSON.parse(observed.observation.summary)).toMatchObject({ kind: "directory_renew", body: { grant_id: request.grant_id, token_sha256: request.token_sha256 } });

    // Before the hub issues it, the gateway refuses the invitation (401) and the desk records nothing.
    const refused = await device.exec("fleet", "renew");
    expect(refused.code).toBe(0);
    expect(refused.stdout).toContain("nothing to do");
    expect(memory.requests.filter(item => item.operation === "invitation").length).toBeGreaterThan(0);

    // One sweep five hours on: the desk's grant with its own id and hash, and the hub desk's own seats.
    clock += 5 * 3_600_000;
    const swept = await hub.yes("hub", "renew-sweep");
    expect(swept).toContain(`renewed the directory grant of did:at:`);
    const issued = memory.grants.get(request.grant_id)!;
    expect(issued).toMatchObject({ missionId: directoryId, tokenHash: request.token_sha256, acceptedAt: null });
    expect(hub.lastBytes().hub_seats.map((seat: any) => seat.purpose)).toEqual(["directory"]);
    const notice = memory.missions.get(directoryId)!.events.map((event: any) => openDocument(event.observation.summary))
      .find((document: any) => document?.kind === "directory_renewal");
    expect(notice!.body).toMatchObject({ invitation: { grant_id: request.grant_id, token_sha256: request.token_sha256 } });

    // The relay grant lapses; fleet renew picks the grant up through the gateway and posts the next request with it.
    clock += 19 * 3_600_000;
    const picked = await device.yes("fleet", "renew");
    expect(picked).toContain(`picked up directory grant ${request.grant_id}`);
    const acceptedAt = memory.grants.get(request.grant_id)!.acceptedAt;
    expect(acceptedAt).not.toBeNull();
    expect(memory.missions.get(directoryId)!.events.at(-1).grant_id).toBe(request.grant_id);
    // A second accept of the same grant is answered with the same acceptance.
    const identity = JSON.parse(await device.run("fleet", "status", "--json")).desk;
    const client = new ParticipantClient(DeskSecrets.open(device.home), { fetchImpl, now });
    const seat = { mission_id: directoryId, grant_id: request.grant_id, identity_id: identity.identity_id, signing_key_id: identity.signing_key_id, token_sha256: request.token_sha256 };
    const again = await client.accept(seat, device.lastBytes().pickup.mission_digest);
    expect(again.grant.accepted_at).toBe(acceptedAt);
    await device.run("fleet", "sync");
  });
});
