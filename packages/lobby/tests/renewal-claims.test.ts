/** Renewal edge cases, hermetically: a token hash belongs to the desk that
 * posted it first (a copy in another desk's signed note or knock is never
 * granted, and never burns the original), one hash binds one grant per
 * sweep, the newest request per member wins across sweeps, the renewal
 * notice reaches a member whose room grant has lapsed, and a grant the
 * service definitely refused is forgotten so kick and stop settle. Fake
 * service, file-backed Keychain stand-in, scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { checkEgress } from "../src/egress.js";
import { DeskSecrets } from "../src/secrets.js";
import { openDocument, sealDocument, type KnockBody, type RenewalBody, type RenewBody } from "../src/signed.js";
import { LobbyStore } from "../src/store.js";
import { DEVICE_TERMS, deskOf, enrollThroughHub, json, ok, postAs, seatedFleet, shownBytes, type Desk, type Fleet } from "./fleet-helpers.js";
import { cleanupTempHomes } from "./helpers.js";

afterEach(cleanupTempHomes);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Enroll another desk, knock on the fleet's room, admit it and get ready. */
async function admitAnother(fleet: Fleet, name: string, tier: "player" | "spectator"): Promise<Desk> {
  const desk = fleet.world.desk(name);
  await enrollThroughHub(fleet.hub, desk, fleet.doorFingerprint);
  await ok(desk.run("fleet", "sync"));
  const knocked = await ok(desk.yes("knock", fleet.roomId, "--tier", tier));
  const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
  await ok(fleet.hub.yes("hub", "admit", knockId, "--tier", tier));
  await ok(desk.yes("ready", knockId));
  return desk;
}

/** A renew note signed by `signer` with its own key, naming itself, carrying `token`. */
function renewNote(fleet: Fleet, signer: Desk, roomId: string, missionId: string, token: string): string {
  const me = deskOf(signer);
  const now = fleet.world.clock.now;
  const body: RenewBody = {
    room_id: roomId, mission_id: missionId, identity_id: me.identity_id, signing_key_id: me.signing_key_id,
    token_sha256: token, issued_at: now.toISOString(), expires_at: new Date(now.getTime() + HOUR).toISOString(),
  };
  return sealDocument("renew", body, { privateKey: DeskSecrets.open(signer.home).deskKey(), fingerprint: me.fingerprint }).summary;
}

function tokenOfShown(desk: Desk): string {
  return (openDocument(JSON.parse(shownBytes(desk)).summary)!.body as { token_sha256: string }).token_sha256;
}

function seasonGrantsFor(fleet: Fleet, identity: string, missionId = fleet.seasonId) {
  return [...fleet.world.hosted.grants.values()].filter((grant) => grant.identity_id === identity && grant.mission_id === missionId);
}

function renewalNotices(fleet: Fleet, missionId: string): RenewalBody[] {
  return fleet.world.hosted.summaries(missionId)
    .map((summary) => openDocument(summary))
    .filter((document) => document?.kind === "renewal")
    .map((document) => document!.body as RenewalBody);
}

function auditActs(desk: Desk): string[] {
  const store = LobbyStore.open(desk.home);
  try {
    return store.listAudit().map((entry) => entry.act);
  } finally {
    store.close();
  }
}

describe("a token hash belongs to the desk that posted it first", () => {
  test("another member's copy of a renew hash is skipped; the member is renewed and the sweep completes", async () => {
    const fleet = await seatedFleet({ termDays: 7 });
    const victim = deskOf(fleet.device);
    const copier = await admitAnother(fleet, "copier", "spectator");
    const theirs = deskOf(copier);

    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    const token = tokenOfShown(fleet.device);
    // The copier reads the room, then signs its own note with the member's hash
    // and posts it to the directory, which the sweep reads first.
    fleet.world.advance(MINUTE);
    await postAs(fleet.world, copier, fleet.directoryId, renewNote(fleet, copier, fleet.roomId, fleet.seasonId, token));

    const swept = await fleet.hub.yes("hub", "renew-sweep");
    expect(swept.stderr).not.toContain("internal_error");
    expect(swept.code).toBe(0);
    const planned = JSON.parse(shownBytes(fleet.hub));
    expect(planned.renewals.map((renewal: any) => [renewal.grant.identity_id, renewal.grant.token_sha256])).toEqual([[victim.identity_id, token]]);
    expect(planned.skipped).toContainEqual(expect.objectContaining({ identity_id: theirs.identity_id, reason: "token_claimed_by_another_desk" }));
    // The grant bound to the hash went to the member who made it, and to no one else.
    expect([...fleet.world.hosted.grants.values()].filter((grant) => grant.token_sha256 === token).map((grant) => grant.identity_id))
      .toEqual([victim.identity_id]);
    expect(auditActs(fleet.hub)).toContain("hub.renew.sweep.outcome");
    await ok(fleet.device.yes("room", "renew", "accept", fleet.roomId));
    // Processed: the member's request and the copy stay quiet afterwards.
    const again = await ok(fleet.hub.yes("hub", "renew-sweep"));
    expect(again.stdout).toContain("nothing to renew");
    expect(again.stdout).not.toContain(victim.identity_id);
  });

  test("a member's renew note carrying a pending knock's hash is skipped; the knock stays admissible", async () => {
    const fleet = await seatedFleet({ termDays: 7 });
    const member = deskOf(fleet.device);
    const newcomer = fleet.world.desk("newcomer");
    await enrollThroughHub(fleet.hub, newcomer, fleet.doorFingerprint);
    await ok(newcomer.run("fleet", "sync"));
    const knocked = await ok(newcomer.yes("knock", fleet.roomId, "--tier", "spectator"));
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
    const knockHash = tokenOfShown(newcomer);
    fleet.world.advance(MINUTE);
    await postAs(fleet.world, fleet.device, fleet.directoryId, renewNote(fleet, fleet.device, fleet.roomId, fleet.seasonId, knockHash));

    const swept = await ok(fleet.hub.yes("hub", "renew-sweep"));
    expect(swept.stdout).toContain("nothing to renew");
    expect(swept.stdout).toContain(`did:at:${member.identity_id}: token_claimed_by_another_desk`);
    expect(seasonGrantsFor(fleet, member.identity_id)).toHaveLength(1); // the admission's only
    const knocks = (await json(fleet.hub.run("hub", "knocks", "--json"))).knocks;
    expect(knocks.find((knock: any) => knock.knock_id === knockId)).toMatchObject({ status: "pending", reason: null });
    await ok(fleet.hub.yes("hub", "admit", knockId, "--tier", "spectator"));
    expect(seasonGrantsFor(fleet, deskOf(newcomer).identity_id).map((grant) => grant.token_sha256)).toEqual([knockHash]);
  });

  test("a knock carrying another desk's renew hash is invalid, and that desk is still renewed", async () => {
    const fleet = await seatedFleet({ tier: "spectator", termDays: 7 });
    const member = deskOf(fleet.device);
    // A spectator's request goes to the directory, where every fleet device reads it.
    expect((await ok(fleet.device.yes("room", "renew", "request", fleet.roomId))).stdout).toContain("posted to the directory");
    const token = tokenOfShown(fleet.device);
    const copier = fleet.world.desk("copier");
    await enrollThroughHub(fleet.hub, copier, fleet.doorFingerprint);
    await ok(copier.run("fleet", "sync"));
    fleet.world.advance(MINUTE);
    const me = deskOf(copier);
    const now = fleet.world.clock.now;
    const body: KnockBody = {
      knock_id: crypto.randomUUID(), room_id: fleet.roomId, charter_digest: fleet.seasonDigest, tier: "spectator",
      token_sha256: token, note: "", issued_at: now.toISOString(), expires_at: new Date(now.getTime() + HOUR).toISOString(),
    };
    const knock = sealDocument("knock", body, { privateKey: DeskSecrets.open(copier.home).deskKey(), fingerprint: me.fingerprint }).summary;
    await postAs(fleet.world, copier, fleet.directoryId, knock);

    const knocks = (await json(fleet.hub.run("hub", "knocks", "--json"))).knocks;
    expect(knocks.find((item: any) => item.knock_id === body.knock_id)).toMatchObject({ status: "invalid", reason: "token_claimed_by_another_desk" });
    fleet.hub.answers.push("yes");
    const admit = await fleet.hub.run("hub", "admit", body.knock_id, "--tier", "spectator");
    expect(admit.code).toBe(1);
    expect(admit.stderr).toContain("token_claimed_by_another_desk");
    fleet.hub.answers.length = 0;
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    expect(seasonGrantsFor(fleet, member.identity_id).filter((grant) => grant.token_sha256 === token)).toHaveLength(1);
    expect(seasonGrantsFor(fleet, me.identity_id)).toHaveLength(0);
  });

  test("one desk's requests in two rooms with one hash are both held back", async () => {
    const fleet = await seatedFleet({ termDays: 7 });
    const { hub, device } = fleet;
    // A second room with its own season; the same device becomes a member there too.
    const added = await json(hub.run("room", "add", "--title", "Second table", "--door", "knock", "--slot", "reviewer:player:1", "--json"));
    const second = added.card.room_id as string;
    await ok(hub.yes("room", "promote", second, "--residency", "fleet", "--hostable", "true"));
    const opened = await ok(hub.yes("hub", "season", "open", second));
    const secondSeason = /season ([0-9a-f-]{36}) digest/.exec(opened.stdout)![1]!;
    await ok(hub.yes("room", "publish", second));
    await ok(device.run("fleet", "sync"));
    const knocked = await ok(device.yes("knock", second, "--tier", "player"));
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
    await ok(hub.yes("hub", "admit", knockId));
    await ok(device.yes("ready", knockId));

    await ok(device.yes("room", "renew", "request", fleet.roomId));
    const token = tokenOfShown(device);
    fleet.world.advance(MINUTE);
    await postAs(fleet.world, device, fleet.directoryId, renewNote(fleet, device, second, secondSeason, token));
    const swept = await ok(hub.yes("hub", "renew-sweep"));
    expect(swept.stdout).toContain("nothing to renew");
    expect(swept.stdout.match(/token_hash_collision/g)).toHaveLength(2);
    expect([...fleet.world.hosted.grants.values()].filter((grant) => grant.token_sha256 === token)).toHaveLength(0);
  });
});

describe("the newest request per member wins", () => {
  test("an older request superseded in one sweep is not renewed by the next", async () => {
    const fleet = await seatedFleet();
    const member = deskOf(fleet.device).identity_id;
    fleet.world.advance(20 * HOUR);
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    fleet.world.advance(MINUTE);
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    const newest = tokenOfShown(fleet.device);
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    const first = JSON.parse(shownBytes(fleet.hub));
    expect(first.renewals.map((renewal: any) => renewal.grant.token_sha256)).toEqual([newest]);
    expect(first.skipped.map((item: any) => item.reason)).toEqual(["superseded"]);
    const second = await ok(fleet.hub.yes("hub", "renew-sweep"));
    expect(second.stdout).toContain("nothing to renew");
    expect(second.stdout).not.toContain("superseded"); // processed and quiet
    expect(seasonGrantsFor(fleet, member)).toHaveLength(2); // the admission's and one renewal
    await ok(fleet.device.yes("room", "renew", "accept", fleet.roomId));
  });
});

describe("the renewal notice reaches a member whose room grant lapsed", () => {
  test("a request made in the room is answered in the directory as well", async () => {
    const fleet = await seatedFleet();
    const { hub, device } = fleet;
    fleet.world.advance(23 * HOUR + 50 * MINUTE); // nine minutes left on the room grant
    expect((await ok(device.yes("room", "renew", "request", fleet.roomId))).stdout).toContain("posted to the room");
    fleet.world.advance(15 * MINUTE); // the room grant (and the directory grant) have lapsed
    await ok(hub.yes("hub", "seat", "directory"));
    await ok(hub.yes("hub", "seat", fleet.roomId));
    expect((await ok(hub.yes("hub", "renew-sweep"))).stdout).toContain("renewed did:at:");
    expect(JSON.parse(shownBytes(hub)).renewals[0].notices.map((notice: any) => notice.mission_id)).toEqual([fleet.directoryId, fleet.seasonId]);
    expect(renewalNotices(fleet, fleet.directoryId)).toHaveLength(1);
    expect(renewalNotices(fleet, fleet.seasonId)).toHaveLength(1);
    // Every text the directory and the season hold, the new notices included, passes the gate with this device's terms.
    for (const summary of [...fleet.world.hosted.summaries(fleet.directoryId), ...fleet.world.hosted.summaries(fleet.seasonId)]) {
      expect(checkEgress(summary, { room: { residency: "fleet" }, deviceTerms: DEVICE_TERMS }).ok).toBe(true);
    }

    // With no live grant anywhere, the desk says what to do instead of "not renewed yet".
    device.answers.push("yes");
    const blind = await device.run("room", "renew", "accept", fleet.roomId);
    expect(blind.code).toBe(1);
    expect(blind.stderr).toContain("no_seat");
    expect(blind.stderr).toContain("renew the directory grant");
    device.answers.length = 0;
    // The documented directory renewal, then the pickup from the directory.
    await enrollThroughHub(hub, device);
    await ok(device.yes("room", "renew", "accept", fleet.roomId));
    await ok(device.yes("room", "say", fleet.roomId, "--text", "back after the renewal"));
  });
});

describe("a grant the service definitely refused is forgotten", () => {
  test("kick and stop settle after a refused renewal grant", async () => {
    const fleet = await seatedFleet();
    const member = deskOf(fleet.device).identity_id;
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    fleet.world.hosted.intercept = (request, process) =>
      request.method === "POST" && request.path === `/v1/collaboration/missions/${fleet.seasonId}/grants`
        ? new Response(JSON.stringify({ error: "token_hash_conflict" }), { status: 409, headers: { "Content-Type": "application/json" } })
        : process();
    const refused = await fleet.hub.yes("hub", "renew-sweep");
    expect(refused.code).toBe(1);
    fleet.world.hosted.intercept = null;
    const store = LobbyStore.open(fleet.hub.home);
    try {
      // Only the admission's season grant is recorded for the member; nothing is left as requested.
      expect(store.fleet.listHubGrants().filter((grant) => grant.state === "requested")).toEqual([]);
      expect(store.fleet.listHubGrants().filter((grant) => grant.identity_id === member && grant.mission_id === fleet.seasonId)
        .map((grant) => grant.state)).toEqual(["issued"]);
    } finally {
      store.close();
    }
    // Each removal settles in one run: there is no phantom grant to chase (it would answer 404).
    expect((await fleet.hub.yes("hub", "kick", fleet.roomId, member)).code).toBe(0);
    expect((await fleet.hub.yes("hub", "stop")).code).toBe(0);
    expect(refused.stderr).toContain("refused");
    expect(refused.stderr).toContain("created nothing");
  });
});
