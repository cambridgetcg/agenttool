/** The fleet hall end to end, hermetically: hub init, enroll-device, hub
 * relay, fleet join, season, room publish, browse, knock, admit, ready — two
 * desks around one fake hosted service, no network, no real Keychain. */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildLobbyMcpServer } from "../src/mcp.js";
import { LobbyStore } from "../src/store.js";
import { checkEgress } from "../src/egress.js";
import { FAKE_BEARER, FAKE_PROJECT } from "./fake-hosted.js";
import { bootstrapFleet, DEVICE_TERMS, expectNoSecretIn, ok, shownBytes } from "./fleet-helpers.js";
import { cleanupTempHomes } from "./helpers.js";

afterEach(cleanupTempHomes);

async function callTool(server: unknown, name: string, args: Record<string, unknown> = {}) {
  const registration = (server as { _registeredTools: Record<string, any> })._registeredTools[name];
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("fleet hall end to end", () => {
  test("bootstrap, browse, knock, admit and ready", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device, hosted } = { ...fleet, hosted: fleet.world.hosted };

    // The device sees the door-signed card, verified against the pinned door.
    const browsed = JSON.parse((await ok(device.run("fleet", "browse", "--json"))).stdout);
    expect(browsed.rooms).toHaveLength(1);
    const card = browsed.rooms[0];
    expect(card.untrusted_data).toBe(true);
    expect(card.signed_by).toEqual({ door_fingerprint: fleet.doorFingerprint, label: "verified", basis: "door_signature" });
    expect(card.fields.title).toEqual({ value: "Zerone season 1", label: "verified", basis: "door_signature" });
    expect(card.fields.season.value).toMatchObject({ mission_id: fleet.seasonId, mission_digest: fleet.seasonDigest });
    expect(card.delivery.posted_by_identity.label).toBe("self-declared");
    expect(card.delivery.received_at.basis).toBe("service_metadata");

    // The read-only MCP view reads the same cache and wraps it the same way.
    const server = buildLobbyMcpServer({ home: device.home });
    const halls = (await callTool(server, "lobby_halls")).structuredContent.halls;
    expect(halls[1]).toMatchObject({ hall: "fleet", status: "available", room_count: 1 });
    const mcpBrowse = (await callTool(server, "lobby_browse", { hall: "fleet", tag: "zerone" })).structuredContent;
    expect(mcpBrowse.rooms.map((room: any) => room.fields.room_id.value)).toEqual([fleet.roomId]);
    const mcpCard = (await callTool(server, "lobby_card", { room_id: fleet.roomId })).structuredContent;
    expect(mcpCard).toMatchObject({ hall: "fleet", card: { signed_by: { door_fingerprint: fleet.doorFingerprint } } });

    // Knock: signed by the device desk, posted to the directory through the gate.
    const knocked = await ok(device.yes("knock", fleet.roomId, "--tier", "player", "--note", "a quiet reviewer, here for season one"));
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
    const knockBytes = JSON.parse(shownBytes(device));
    expect(knockBytes).toMatchObject({ act: "fleet.knock", knock_id: knockId, room_id: fleet.roomId, mission_id: fleet.directoryId });
    expect(hosted.summaries(fleet.directoryId)).toContain(knockBytes.summary);

    // Hub: the knock is pending and verified against the enrolled device key.
    const listed = JSON.parse((await ok(hub.run("hub", "knocks", "--json"))).stdout);
    const pending = listed.knocks.find((knock: any) => knock.knock_id === knockId);
    expect(pending).toMatchObject({ status: "pending", tier: "player", room_id: fleet.roomId, reason: null });
    expect(pending.note).toBe("a quiet reviewer, here for season one");

    // Admit: grant bound to the knock's own token hash, admission + roster posted.
    const admitted = await ok(hub.yes("hub", "admit", knockId, "--term-days", "7"));
    expect(admitted.stdout).toContain(`admitted knock ${knockId}`);
    const admitBytes = JSON.parse(shownBytes(hub));
    expect(admitBytes.act).toBe("hub.admit");
    expect(admitBytes.approver_did).not.toBe(admitBytes.requester_did);
    expect(admitBytes.grant.token_sha256).toBe(pending.token_sha256);
    expect(admitBytes.grant.actions).toEqual(["mission.observe", "mission.read"]);
    expect(Date.parse(admitBytes.grant.expires_at) - Date.parse(fleet.world.clock.now.toISOString())).toBeLessThanOrEqual(24 * 3_600_000);
    expect(admitBytes.posts.map((post: any) => [post.mission_id, post.kind])).toEqual([
      [fleet.directoryId, "admission"], [fleet.seasonId, "admission"], [fleet.seasonId, "roster"],
    ]);
    const seasonSummaries = hosted.summaries(fleet.seasonId);
    expect(seasonSummaries.some((summary) => summary.includes('"kind":"roster"'))).toBe(true);
    expect(JSON.parse((await ok(hub.run("hub", "knocks", "--json"))).stdout).knocks[0].status).toBe("admitted");

    // Ready: re-read card and charter, digests agree, accept exactly that digest.
    expect(JSON.parse((await ok(device.run("fleet", "knocks", "--json"))).stdout).knocks[0].status).toBe("waiting");
    const ready = await ok(device.yes("ready", knockId));
    expect(ready.stdout).toContain(`accepted season ${fleet.seasonId} digest ${fleet.seasonDigest}`);
    const readyBytes = JSON.parse(shownBytes(device));
    expect(readyBytes).toMatchObject({ act: "fleet.ready", knock_id: knockId, season: { mission_id: fleet.seasonId, mission_digest: fleet.seasonDigest } });
    const grant = [...hosted.grants.values()].find((candidate) => candidate.grant_id === readyBytes.grant.grant_id)!;
    expect(grant.accepted_at).not.toBeNull();
    expect(JSON.parse((await ok(device.run("fleet", "knocks", "--json"))).stdout).knocks[0].status).toBe("ready");

    // Single use: the same admission cannot be used again.
    device.answers.push("yes");
    const again = await device.run("ready", knockId);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("admission_used");

    // Every act was audited on both desks, and both chains verify.
    for (const desk of [hub, device]) {
      expect((await desk.run("audit", "verify")).stdout).toMatch(/^audit chain intact/);
    }
    const hubActs = JSON.parse((await ok(hub.run("audit", "list", "--json"))).stdout).entries.map((entry: any) => entry.act);
    expect(hubActs).toEqual(["hub.init", "desk.enroll", "hub.relay", "fleet.join", "room.promote", "hub.season.open",
      "room.publish", "hub.relay", "hub.admit"]);
    const deviceActs = JSON.parse((await ok(device.run("audit", "list", "--json"))).stdout).entries.map((entry: any) => entry.act);
    expect(deviceActs).toEqual(["desk.enroll", "fleet.join", "fleet.knock", "fleet.ready"]);
  });

  test("custody: no bearer, token or key ever reaches a posted text, a request body, stdout or the MCP", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device } = fleet;
    const hosted = fleet.world.hosted;
    await ok(device.yes("knock", fleet.roomId, "--tier", "spectator"));
    const knockId = JSON.parse((await ok(device.run("fleet", "knocks", "--json"))).stdout).knocks[0].knock_id;
    await ok(hub.yes("hub", "admit", knockId));
    await ok(device.yes("ready", knockId));

    for (const request of hosted.seen) {
      // The bearer goes only to administrator routes; participant routes carry atcm_ tokens.
      const participant = /\/(?:invitation|accept|events)/.test(request.path);
      if (request.authorization?.includes(FAKE_BEARER)) expect(participant).toBe(false);
      if (participant) expect(request.authorization).toMatch(/^Bearer atcm_[A-Za-z0-9_-]{43}$/);
      // No request body carries a token, the bearer or a private key.
      expectNoSecretIn(request.body);
    }
    // Every posted summary and every descriptor passes the gate, with the device terms too.
    for (const mission of hosted.missions.values()) {
      expect(checkEgress(JSON.stringify(mission.descriptor), { room: { residency: "fleet" }, deviceTerms: DEVICE_TERMS }).ok).toBe(true);
      for (const summary of hosted.summaries(mission.mission_id)) {
        expect(checkEgress(summary, { room: { residency: "fleet" }, deviceTerms: DEVICE_TERMS })).toEqual({ ok: true, reasons: [] });
      }
    }
    // Secrets live in 0600 files under a 0700 secrets directory, never in lobby.sqlite.
    for (const desk of [hub, device]) {
      expect(statSync(join(desk.home, "secrets")).mode & 0o777).toBe(0o700);
      expect(statSync(join(desk.home, "secrets", "desk-key.pem")).mode & 0o777).toBe(0o600);
      const database = readFileSync(join(desk.home, "lobby.sqlite"));
      expectNoSecretIn(database.toString("latin1"));
      for (const result of [await desk.run("fleet", "status", "--json"), await desk.run("audit", "list", "--json"), await desk.run("outbox", "list", "--json")]) {
        expectNoSecretIn(result.stdout + result.stderr);
      }
      const server = buildLobbyMcpServer({ home: desk.home });
      for (const [tool, args] of [["lobby_halls", {}], ["lobby_browse", { hall: "fleet" }], ["lobby_card", { room_id: fleet.roomId, hall: "fleet" }]] as const) {
        expectNoSecretIn(JSON.stringify((await callTool(server, tool, args)).structuredContent));
      }
    }
    // The hub's Keychain stand-in holds the bearer and the door seed; the CLI never printed either.
    const doorSeed = await hub.keychain.read({ service: "agenttool-lobby.door-key", account: "agenttool-lobby" });
    for (const desk of [hub, device]) {
      const store = LobbyStore.open(desk.home);
      for (const entry of store.listAudit()) {
        expect(entry.bytes).not.toContain(doorSeed);
        expectNoSecretIn(entry.bytes);
      }
      store.close();
    }
    expect(hub.terminal.written.join("")).not.toContain(doorSeed);
    expect(FAKE_PROJECT).toMatch(/^[0-9a-f-]{36}$/);
  });
});
