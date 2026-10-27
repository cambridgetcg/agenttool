/** Directory renewal inside the Lobby, hermetically: a desk's signed
 * directory_renew request (a grant id and token hash it chose), the hub's
 * renew-sweep (first poster for hashes and grant ids, pause, the hub desk's
 * own seats, the seats-only sweep), and the desk's pickup by an invitation
 * read alone, after its old grant lapsed. Fake service, file-backed Keychain
 * stand-in, scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { readFleetEvents } from "../src/fleet.js";
import { DIRECTORY_GATE_ROOM } from "../src/hosted.js";
import { DeskSecrets } from "../src/secrets.js";
import { openDocument, sealDocument, type DirectoryRenewalBody, type DirectoryRenewBody } from "../src/signed.js";
import { LobbyStore } from "../src/store.js";
import { checkEgress } from "../src/egress.js";
import { newUuid } from "../src/wire.js";
import {
  bootstrapFleet,
  deskOf,
  DEVICE_TERMS,
  enrollThroughHub,
  expectNoSecretIn,
  json,
  ok,
  postAs,
  runWhilePromptOpen,
  seatedFleet,
  shownBytes,
  type Desk,
  type Fleet,
} from "./fleet-helpers.js";
import { cleanupTempHomes } from "./helpers.js";

afterEach(cleanupTempHomes);

const MINUTE = 60_000;
const HOUR = 3_600_000;
const FALLBACK = "enroll-device here, hub relay on the hub, fleet join here";

function directoryNotices(fleet: Fleet): DirectoryRenewalBody[] {
  return fleet.world.hosted.summaries(fleet.directoryId)
    .map((summary) => openDocument(summary))
    .filter((document) => document?.kind === "directory_renewal")
    .map((document) => document!.body as DirectoryRenewalBody);
}

function directoryDigest(fleet: Fleet): string {
  return fleet.world.hosted.missions.get(fleet.directoryId)!.digest;
}

async function auditActs(desk: Desk): Promise<string[]> {
  return (await json(desk.run("audit", "list", "--json"))).entries.map((entry: any) => entry.act);
}

/** A directory_renew request signed by `signer`'s own desk key, naming `as`. */
function handRequest(fleet: Fleet, signer: Desk, overrides: Partial<DirectoryRenewBody> = {}): string {
  const now = fleet.world.clock.now;
  const desk = deskOf(signer);
  const secrets = DeskSecrets.open(signer.home);
  const body: DirectoryRenewBody = {
    mission_id: fleet.directoryId,
    grant_id: newUuid(),
    identity_id: desk.identity_id,
    signing_key_id: desk.signing_key_id,
    token_sha256: secrets.newToken(now).token_sha256,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + HOUR).toISOString(),
    ...overrides,
  };
  return sealDocument("directory_renew", body, { privateKey: secrets.deskKey(), fingerprint: desk.fingerprint }).summary;
}

describe("directory renewal inside the Lobby", () => {
  test("request, one sweep, then a pickup by invitation alone after the old grant lapsed", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device } = fleet;
    const hosted = fleet.world.hosted;
    const identity = deskOf(device).identity_id;
    fleet.world.advance(HOUR);

    // The desk posts a request naming a grant id and token hash it chose.
    await ok(device.yes("fleet", "renew"));
    const asked = JSON.parse(shownBytes(device));
    expect(asked).toMatchObject({ act: "fleet.renew", pickup: null, request: { mission_id: fleet.directoryId } });
    const request = asked.request;
    expect(openDocument(request.summary)).toMatchObject({
      kind: "directory_renew",
      body: { mission_id: fleet.directoryId, grant_id: request.grant_id, token_sha256: request.token_sha256, identity_id: identity },
    });
    expect(hosted.summaries(fleet.directoryId)).toContain(request.summary);
    // Only the hash leaves the desk; the token stays in its private secrets.
    expect(DeskSecrets.open(device.home).hasToken(request.token_sha256)).toBe(true);
    for (const seen of hosted.seen) expectNoSecretIn(seen.body);
    expect(device.terminal.written.join("")).toContain(`the hub must run hub renew-sweep before`);

    // Before the sweep: the invitation is refused (401), nothing is recorded and no prompt opens.
    const before = await auditActs(device);
    const waiting = await ok(device.run("fleet", "renew"));
    expect(waiting.stdout).toContain("nothing to do");
    expect(waiting.stdout).toContain(request.event_id);
    expect(await auditActs(device)).toEqual(before);
    const invitations = hosted.seen.filter((seen) => seen.method === "GET" && seen.path.endsWith("/invitation"));
    expect(invitations.length).toBeGreaterThan(0);

    // One sweep: the desk's grant, bound to its own id and hash, and the hub desk's own seats.
    fleet.world.advance(5 * HOUR);
    const swept = await ok(hub.yes("hub", "renew-sweep"));
    const sweep = JSON.parse(shownBytes(hub));
    expect(sweep.mode).toBe("full");
    expect(sweep.renewals).toEqual([]);
    expect(sweep.directory_renewals).toHaveLength(1);
    const renewal = sweep.directory_renewals[0];
    expect(renewal.grant).toMatchObject({
      mission_id: fleet.directoryId, grant_id: request.grant_id, token_sha256: request.token_sha256, identity_id: identity,
      actions: ["mission.observe", "mission.read"],
    });
    expect(Date.parse(renewal.grant.expires_at) - fleet.world.clock.now.getTime()).toBeLessThanOrEqual(24 * HOUR);
    expect(Date.parse(renewal.grant.expires_at)).toBeLessThanOrEqual(Date.parse(hosted.missions.get(fleet.directoryId)!.expires_at));
    expect(hosted.grants.get(request.grant_id)!.token_sha256).toBe(request.token_sha256);
    expect(sweep.hub_seats.map((seat: any) => [seat.purpose, seat.mission_id])).toEqual([["directory", fleet.directoryId], ["season", fleet.seasonId]]);
    // The prompt lists the three sets under separate headings, with counts.
    const prompt = hub.terminal.written.join("");
    expect(prompt).toContain("room renewals (0):");
    expect(prompt).toContain("directory renewals, one per device (1):");
    expect(prompt).toContain("hub desk seats (2):");
    expect(prompt).toContain(`device ${deskOf(device).fingerprint}`);
    expect(swept.stdout).toContain(`renewed the directory grant of did:at:${identity}: grant ${request.grant_id}`);
    // The door-signed notice is in the directory and verifies against the pinned door.
    const notices = directoryNotices(fleet);
    expect(notices.map((notice) => notice.invitation.grant_id)).toEqual([request.grant_id]);
    const hubStore = LobbyStore.open(hub.home);
    const hubRow = hubStore.fleet.hub()!;
    hubStore.close();
    const view = readFleetEvents(hosted.missions.get(fleet.directoryId)!.events as any,
      { fingerprint: hubRow.door_fingerprint, public_key: hubRow.door_public_key });
    expect(view.directoryRenewals).toHaveLength(1);
    for (const summary of hosted.summaries(fleet.directoryId)) {
      expect(checkEgress(summary, { room: { residency: "fleet" }, deviceTerms: DEVICE_TERMS }).ok).toBe(true);
    }
    expect(await auditActs(hub)).toEqual(expect.arrayContaining(["hub.renew.sweep", "hub.renew.sweep.outcome"]));
    // A second sweep straight away mints nothing: the request is processed and the seats are fresh.
    expect((await ok(hub.yes("hub", "renew-sweep"))).stdout).toContain("nothing to renew");

    // The desk's relay grant lapses; it can no longer read the directory.
    fleet.world.advance(19 * HOUR);
    expect((await device.run("fleet", "sync")).code).toBe(1);
    // fleet renew picks the grant up with the token it generated: no notice read, no live grant needed.
    const picked = await ok(device.yes("fleet", "renew"));
    const pickup = JSON.parse(shownBytes(device));
    expect(pickup.pickup).toMatchObject({
      grant_id: request.grant_id, token_sha256: request.token_sha256, mission_digest: directoryDigest(fleet), notice_sha256: null,
    });
    expect(pickup.request.grant_id).not.toBe(request.grant_id);
    expect(picked.stdout).toContain(`picked up directory grant ${request.grant_id}`);
    expect(hosted.grants.get(request.grant_id)!.accepted_at).not.toBeNull();
    // The next request went out with the grant just picked up.
    const next = [...hosted.missions.get(fleet.directoryId)!.events].at(-1)! as any;
    expect(next.grant_id).toBe(request.grant_id);
    await ok(device.run("fleet", "sync"));
    const status = await json(device.run("fleet", "status", "--json"));
    expect(status.directory).toMatchObject({
      mission_id: fleet.directoryId,
      ends_at: hosted.missions.get(fleet.directoryId)!.expires_at,
      grant_expires_at: renewal.grant.expires_at,
      open_request: { event_id: pickup.request.event_id, grant_id: pickup.request.grant_id, posted: true, expired: false },
      successor: null,
    });
    expect(await auditActs(device)).toEqual(expect.arrayContaining(["fleet.renew", "fleet.renew.outcome"]));
  });

  test("a sweep whose hub directory seat lapsed renews only the hub desk's seats, then reads on the next run", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device } = fleet;
    fleet.world.advance(23 * HOUR);
    await ok(device.yes("fleet", "renew"));
    fleet.world.advance(2 * HOUR); // the hub desk's seats (24 hours) have lapsed
    const reads = () => fleet.world.hosted.seen.filter((seen) => seen.method === "GET" && seen.path.includes("/events")).length;
    const readsBefore = reads();
    const seatsOnly = await ok(hub.yes("hub", "renew-sweep"));
    const bytes = JSON.parse(shownBytes(hub));
    expect(bytes).toMatchObject({ mode: "seats_only", renewals: [], directory_renewals: [] });
    expect(bytes.hub_seats.map((seat: any) => seat.purpose)).toEqual(["directory", "season"]);
    expect(reads()).toBe(readsBefore);
    expect(seatsOnly.stdout).toContain("run hub renew-sweep again to read requests");
    const full = await ok(hub.yes("hub", "renew-sweep"));
    expect(JSON.parse(shownBytes(hub))).toMatchObject({ mode: "full", hub_seats: [] });
    expect(JSON.parse(shownBytes(hub)).directory_renewals).toHaveLength(1);
    expect(full.stdout).toContain("renewed the directory grant of");
    // --rooms-only is the sweep as it was: no directory renewal and no seat.
    fleet.world.advance(21 * HOUR);
    await ok(device.yes("fleet", "renew"));
    const grants = fleet.world.hosted.grants.size;
    expect((await ok(hub.yes("hub", "renew-sweep", "--rooms-only"))).stdout).toContain("nothing to renew");
    expect(fleet.world.hosted.grants.size).toBe(grants);
  });

  test("a copied grant id or token hash is skipped and never burns the desk's own request", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device, world } = fleet;
    const copier = world.desk("copier");
    await enrollThroughHub(hub, copier);
    const hasher = world.desk("hasher");
    await enrollThroughHub(hub, hasher);
    await ok(device.yes("fleet", "renew"));
    const request = JSON.parse(shownBytes(device)).request;
    world.advance(MINUTE);
    // Each copier reads the directory and signs the copy with its own key.
    await postAs(world, copier, fleet.directoryId, handRequest(fleet, copier, { grant_id: request.grant_id }));
    await postAs(world, hasher, fleet.directoryId, handRequest(fleet, hasher, { token_sha256: request.token_sha256 }));
    await ok(hub.yes("hub", "renew-sweep"));
    const sweep = JSON.parse(shownBytes(hub));
    expect(sweep.directory_renewals.map((item: any) => [item.grant.identity_id, item.grant.grant_id, item.grant.token_sha256]))
      .toEqual([[deskOf(device).identity_id, request.grant_id, request.token_sha256]]);
    expect(sweep.skipped.map((item: any) => [item.identity_id, item.reason])).toEqual(expect.arrayContaining([
      [deskOf(copier).identity_id, "grant_id_claimed_by_another_desk"],
      [deskOf(hasher).identity_id, "token_claimed_by_another_desk"],
    ]));
    expect(fleet.world.hosted.grants.get(request.grant_id)!.identity_id).toBe(deskOf(device).identity_id);
  });

  test("two identities claiming one grant id at the same instant in different missions leave it to neither", async () => {
    const fleet = await seatedFleet();
    const { hub, device, world } = fleet;
    const other = world.desk("other");
    await enrollThroughHub(hub, other);
    const grantId = newUuid();
    // Same instant: the member posts in its season, the other desk in the directory.
    await postAs(world, device, fleet.seasonId, handRequest(fleet, device, { grant_id: grantId }));
    await postAs(world, other, fleet.directoryId, handRequest(fleet, other, { grant_id: grantId }));
    // Nothing to renew, so no prompt: the skipped requests are listed with their reasons.
    const swept = await ok(hub.yes("hub", "renew-sweep"));
    expect(swept.stdout).toContain("nothing to renew");
    expect(swept.stdout).toContain(`did:at:${deskOf(device).identity_id}: posted_elsewhere`);
    expect(swept.stdout).toContain(`did:at:${deskOf(other).identity_id}: grant_id_contested`);
    expect(world.hosted.grants.has(grantId)).toBe(false);
  });

  test("the newest request per device wins, and the one it superseded stays quiet in later sweeps", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device, world } = fleet;
    await ok(device.yes("fleet", "renew"));
    const older = JSON.parse(shownBytes(device)).request;
    world.advance(MINUTE);
    const newer = handRequest(fleet, device);
    await postAs(world, device, fleet.directoryId, newer);
    await ok(hub.yes("hub", "renew-sweep"));
    const sweep = JSON.parse(shownBytes(hub));
    expect(sweep.directory_renewals.map((item: any) => item.grant.grant_id)).toEqual([(openDocument(newer)!.body as DirectoryRenewBody).grant_id]);
    expect(sweep.skipped).toEqual([{ source: `event:${older.event_id}`, room_id: null, identity_id: deskOf(device).identity_id, reason: "superseded" }]);
    const again = await ok(hub.yes("hub", "renew-sweep"));
    expect(again.stdout).toContain("nothing to renew");
    expect(again.stdout).not.toContain("superseded");
    expect(fleet.world.hosted.grants.has(older.grant_id)).toBe(false);
  });

  test("hub device pause stops a device's directory renewal until resumed; the hub desk cannot be paused", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device } = fleet;
    const identity = deskOf(device).identity_id;
    await ok(hub.yes("hub", "device", "pause", identity));
    expect(JSON.parse(shownBytes(hub))).toMatchObject({ act: "hub.device.pause", identity_id: identity, paused: true });
    expect((await json(hub.run("hub", "show", "--json"))).devices.find((item: any) => item.identity_id === identity).directory_paused_at).not.toBeNull();
    await ok(device.yes("fleet", "renew"));
    const paused = await ok(hub.yes("hub", "renew-sweep"));
    expect(paused.stdout).toContain("nothing to renew");
    expect(paused.stdout).toContain("device_paused");
    expect((await hub.yes("hub", "device", "pause", identity)).stderr).toContain("already_paused");
    expect((await hub.yes("hub", "device", "pause", deskOf(hub).identity_id)).stderr).toContain("hub_desk");
    await ok(hub.yes("hub", "device", "resume", identity));
    expect((await ok(hub.yes("hub", "renew-sweep"))).stdout).toContain("renewed the directory grant of");
    expect(await auditActs(hub)).toEqual(expect.arrayContaining(["hub.device.pause", "hub.device.resume"]));
    // The digest lists the pause among the audited access acts.
    const digest = await ok(hub.run("hub", "digest"));
    expect(digest.stdout).toContain("access-digest-");
  });

  test("a pause or a stop recorded while the sweep's prompt is open withdraws the renewal: nothing is requested", async () => {
    for (const change of ["pause", "stop"] as const) {
      const fleet = await bootstrapFleet();
      const { hub, device, world } = fleet;
      const identity = deskOf(device).identity_id;
      await ok(device.yes("fleet", "renew"));
      const request = JSON.parse(shownBytes(device)).request;
      const other = world.desk("hub-other-terminal", { of: hub });
      const result = await runWhilePromptOpen(world, hub, ["hub", "renew-sweep"], async () => {
        if (change === "pause") await ok(other.yes("hub", "device", "pause", identity));
        else await ok(other.yes("hub", "stop"));
      });
      expect(result.code).toBe(1);
      expect(world.hosted.grants.has(request.grant_id)).toBe(false);
      if (change === "stop") {
        // The stop is checked again before anything else: the sweep issues nothing at all.
        expect(result.stderr).toContain("hub_stopped");
        continue;
      }
      expect(result.stderr).toContain(`no directory renewal for did:at:${identity}`);
      expect(result.stderr).toContain("device_paused");
      const outcome = (await json(hub.run("audit", "list", "--json"))).entries.filter((entry: any) => entry.act === "hub.renew.sweep.outcome").at(-1);
      expect(JSON.parse(outcome.bytes).directory_renewals[0]).toMatchObject({ identity_id: identity, status: "withdrawn" });
    }
  });

  test("an uncertain grant is never re-requested, and the desk can still pick it up", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device, world } = fleet;
    await ok(device.yes("fleet", "renew"));
    const request = JSON.parse(shownBytes(device)).request;
    world.hosted.loseResponse = (seen) => seen.method === "POST" && seen.path.endsWith("/grants");
    const lost = await hub.yes("hub", "renew-sweep");
    expect(lost.code).toBe(1);
    expect(lost.stderr).toContain("uncertain");
    const again = await ok(hub.yes("hub", "renew-sweep"));
    expect(again.stdout).toContain(`grant_uncertain:${request.grant_id}`);
    const posted = world.hosted.seen.filter((seen) => seen.method === "POST" && seen.path === `/v1/collaboration/missions/${fleet.directoryId}/grants`
      && JSON.parse(seen.body).grant_id === request.grant_id);
    expect(posted).toHaveLength(1);
    // The service did create it: the desk's pickup finds it.
    const picked = await ok(device.yes("fleet", "renew"));
    expect(picked.stdout).toContain(`picked up directory grant ${request.grant_id}`);
  });

  test("a desk with no live directory grant and nothing to pick up is told the fallback", async () => {
    const fleet = await bootstrapFleet();
    fleet.world.advance(25 * HOUR);
    const lapsed = await fleet.device.yes("fleet", "renew");
    expect(lapsed.code).toBe(1);
    expect(lapsed.stderr).toContain("directory_lapsed");
    expect(lapsed.stderr).toContain(FALLBACK);
    expect(await auditActs(fleet.device)).not.toContain("fleet.renew");
  });

  test("an unsent request is never resent by fleet renew; outbox retry sends it through the directory gate", async () => {
    const fleet = await bootstrapFleet();
    const { device, world } = fleet;
    world.hosted.loseResponse = (seen) => seen.method === "POST" && seen.path === `/v1/collaboration/missions/${fleet.directoryId}/events`;
    const first = await device.yes("fleet", "renew");
    expect(first.code).toBe(1);
    const request = JSON.parse(shownBytes(device)).request;
    expect(first.stderr).toContain(`outbox retry ${request.event_id}`);
    const store = LobbyStore.open(device.home);
    expect(JSON.parse(store.fleet.outbox(request.event_id)!.gate_room)).toEqual(DIRECTORY_GATE_ROOM);
    store.close();
    const refused = await device.yes("fleet", "renew");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("request_unsent");
    expect(refused.stderr).toContain(`outbox retry ${request.event_id}`);
    const retried = await ok(device.yes("outbox", "retry", request.event_id));
    expect(retried.stdout).toContain(`posted directory_renew ${request.event_id}`);
    expect((await ok(device.run("fleet", "renew"))).stdout).toContain("nothing to do");
  });

  test("without a terminal, fleet renew and hub device pause read nothing and send nothing", async () => {
    const fleet = await bootstrapFleet();
    const seen = fleet.world.hosted.seen.length;
    const deviceHeadless = fleet.world.desk("device-headless", { noTerminal: true, of: fleet.device });
    expect((await deviceHeadless.run("fleet", "renew")).code).toBe(3);
    const hubHeadless = fleet.world.desk("hub-headless", { noTerminal: true, of: fleet.hub });
    expect((await hubHeadless.run("hub", "device", "pause", deskOf(fleet.device).identity_id)).code).toBe(3);
    expect(fleet.world.hosted.seen).toHaveLength(seen);
  });

  test("the hub's own desk does not post directory requests: the sweep renews its seats", async () => {
    const fleet = await bootstrapFleet();
    const refused = await fleet.hub.yes("fleet", "renew");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("hub_desk");
  });
});
