/** Directory renewal inside the Lobby, hermetically: a desk's signed
 * directory_renew request (a grant id and token hash it chose), the hub's
 * renew-sweep (first poster for hashes and grant ids, pause, the hub desk's
 * own seats, the seats-only sweep), and the desk's pickup by an invitation
 * read alone, after its old grant lapsed. Fake service, file-backed Keychain
 * stand-in, scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { readFleetEvents } from "../src/fleet.js";
import { readDoorKey } from "../src/keychain.js";
import { DIRECTORY_GATE_ROOM } from "../src/hosted.js";
import { DeskSecrets } from "../src/secrets.js";
import { openDocument, sealDocument, type DirectoryRenewalBody, type DirectoryRenewBody } from "../src/signed.js";
import { LobbyStore } from "../src/store.js";
import { checkEgress } from "../src/egress.js";
import { missionDigest, newUuid } from "../src/wire.js";
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

/** Answer invitation reads of `grantId` with a view `change` rewrote, as a
 * misbehaving service would; every other request is untouched. */
function rewriteInvitation(fleet: Fleet, grantId: string, change: (view: { mission: any; grant: any }) => void): void {
  const hosted = fleet.world.hosted;
  hosted.intercept = (request, process) => {
    const response = process();
    if (request.method !== "GET" || request.path !== `/v1/collaboration/missions/${fleet.directoryId}/invitation` || response.status !== 200) return response;
    const view = { mission: hosted.missionView(hosted.missions.get(fleet.directoryId)!), grant: hosted.grantView(hosted.grants.get(grantId)!) };
    change(view);
    return new Response(JSON.stringify(view), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

function acceptsOf(fleet: Fleet): number {
  return fleet.world.hosted.seen.filter((seen) => seen.method === "POST" && seen.path === `/v1/collaboration/missions/${fleet.directoryId}/accept`).length;
}

function grantsWithToken(fleet: Fleet, tokenSha256: string): string[] {
  return [...fleet.world.hosted.grants.values()].filter((grant) => grant.token_sha256 === tokenSha256).map((grant) => grant.grant_id);
}

/** The hub's issued directory grant for a desk (from its relay). */
function hubDirectoryGrant(fleet: Fleet, desk: Desk) {
  const store = LobbyStore.open(fleet.hub.home);
  try {
    return store.fleet.listHubGrants().find((grant) => grant.identity_id === deskOf(desk).identity_id && grant.purpose === "directory")!;
  } finally {
    store.close();
  }
}

/** The desk posts a request with fleet renew, and one sweep renews it. */
async function renewedOnce(fleet: Fleet): Promise<{ grant_id: string; token_sha256: string; event_id: string }> {
  await ok(fleet.device.yes("fleet", "renew"));
  const request = JSON.parse(shownBytes(fleet.device)).request;
  await ok(fleet.hub.yes("hub", "renew-sweep"));
  expect(fleet.world.hosted.grants.has(request.grant_id)).toBe(true);
  return request;
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

describe("a pickup accepts exactly the directory this desk joined", () => {
  const NOW = () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const cases: Array<[string, string, (view: { mission: any; grant: any }) => void]> = [
    ["another digest", "digest_changed", (view) => {
      view.mission.descriptor = { ...view.mission.descriptor, purpose: `${view.mission.descriptor.purpose} (changed)` };
      view.mission.mission_digest = missionDigest(view.mission.descriptor);
    }],
    ["a revoked grant", "directory_closed", (view) => {
      view.grant.revoked_at = NOW();
    }],
    ["a revoked directory", "directory_closed", (view) => {
      view.mission.revoked_at = NOW();
    }],
    ["the wrong actions", "grant_mismatch", (view) => {
      view.grant.actions = ["mission.read"];
    }],
    ["an expiry past the directory", "grant_mismatch", (view) => {
      view.grant.expires_at = new Date(Date.parse(view.mission.expires_at) + MINUTE).toISOString();
    }],
  ];
  for (const [what, code, change] of cases) {
    test(`${what}: ${code}, before any prompt, and no accept is sent`, async () => {
      const fleet = await bootstrapFleet();
      const request = await renewedOnce(fleet);
      rewriteInvitation(fleet, request.grant_id, change);
      const accepts = acceptsOf(fleet);
      const opened = fleet.device.terminal.opened;
      const refused = await fleet.device.run("fleet", "renew");
      fleet.world.hosted.intercept = null;
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain(code);
      expect(acceptsOf(fleet)).toBe(accepts);
      expect(fleet.device.terminal.opened).toBe(opened);
      expect(fleet.world.hosted.grants.get(request.grant_id)!.accepted_at).toBeNull();
      // The service answering truthfully again, the same grant is picked up.
      expect((await ok(fleet.device.yes("fleet", "renew"))).stdout).toContain(`picked up directory grant ${request.grant_id}`);
    });
  }

  test("a door-signed directory_renewal naming another grant for the same token: conflicting_renewal, no accept", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device, world } = fleet;
    const request = await renewedOnce(fleet);
    const genuine = directoryNotices(fleet);
    expect(genuine.map((notice) => notice.invitation.grant_id)).toEqual([request.grant_id]);
    const door = await readDoorKey(hub.keychain, { service: "agenttool-lobby.door-key", account: "agenttool-lobby" });
    const forged: DirectoryRenewalBody = { ...genuine[0]!, invitation: { ...genuine[0]!.invitation, grant_id: newUuid() } };
    await postAs(world, hub, fleet.directoryId, sealDocument("directory_renewal", forged, { privateKey: door, fingerprint: fleet.doorFingerprint }).summary);
    const accepts = acceptsOf(fleet);
    const refused = await device.run("fleet", "renew");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("conflicting_renewal");
    expect(acceptsOf(fleet)).toBe(accepts);
    expect(world.hosted.grants.get(request.grant_id)!.accepted_at).toBeNull();
  });
});

describe("the sweep renews only a live, joined, unbound request", () => {
  test("a request naming another mission: directory_not_live", async () => {
    const fleet = await bootstrapFleet();
    const summary = handRequest(fleet, fleet.device, { mission_id: fleet.seasonId });
    await postAs(fleet.world, fleet.device, fleet.directoryId, summary);
    const swept = await ok(fleet.hub.run("hub", "renew-sweep"));
    expect(swept.stdout).toContain(`did:at:${deskOf(fleet.device).identity_id}: directory_not_live`);
    expect(fleet.world.hosted.grants.has((openDocument(summary)!.body as DirectoryRenewBody).grant_id)).toBe(false);
  });

  test("a device the hub never issued a directory grant: never_joined", async () => {
    const fleet = await bootstrapFleet();
    await ok(fleet.device.yes("fleet", "renew"));
    const request = JSON.parse(shownBytes(fleet.device)).request;
    // Stand in for a device enrolled here whose directory grant the hub never recorded.
    const db = new Database(join(fleet.hub.home, "lobby.sqlite"));
    db.run("DELETE FROM hub_grants WHERE identity_id = ? AND purpose = 'directory'", [deskOf(fleet.device).identity_id]);
    db.close();
    const swept = await ok(fleet.hub.run("hub", "renew-sweep"));
    expect(swept.stdout).toContain(`did:at:${deskOf(fleet.device).identity_id}: never_joined`);
    expect(fleet.world.hosted.grants.has(request.grant_id)).toBe(false);
  });

  test("a request signed by the hub's own desk: hub_desk (the sweep's seat part renews that desk)", async () => {
    const fleet = await bootstrapFleet();
    const summary = handRequest(fleet, fleet.hub);
    await postAs(fleet.world, fleet.hub, fleet.directoryId, summary);
    const swept = await ok(fleet.hub.run("hub", "renew-sweep"));
    expect(swept.stdout).toContain(`did:at:${deskOf(fleet.hub).identity_id}: hub_desk`);
    expect(fleet.world.hosted.grants.has((openDocument(summary)!.body as DirectoryRenewBody).grant_id)).toBe(false);
  });

  test("an expired request is counted and never renewed", async () => {
    const fleet = await bootstrapFleet();
    const summary = handRequest(fleet, fleet.device, { expires_at: new Date(fleet.world.clock.now.getTime() + MINUTE).toISOString() });
    await postAs(fleet.world, fleet.device, fleet.directoryId, summary);
    fleet.world.advance(2 * MINUTE);
    const swept = await ok(fleet.hub.run("hub", "renew-sweep"));
    expect(swept.stdout).toContain("nothing to renew");
    expect(swept.stdout).toContain("1 expired request(s) ignored");
    expect(fleet.world.hosted.grants.has((openDocument(summary)!.body as DirectoryRenewBody).grant_id)).toBe(false);
  });

  test("a grant id the hub already bound: grant_id_taken", async () => {
    const fleet = await bootstrapFleet();
    const taken = hubDirectoryGrant(fleet, fleet.device).grant_id;
    const summary = handRequest(fleet, fleet.device, { grant_id: taken });
    await postAs(fleet.world, fleet.device, fleet.directoryId, summary);
    const swept = await ok(fleet.hub.run("hub", "renew-sweep"));
    expect(swept.stdout).toContain(`did:at:${deskOf(fleet.device).identity_id}: grant_id_taken`);
    expect(grantsWithToken(fleet, (openDocument(summary)!.body as DirectoryRenewBody).token_sha256)).toEqual([]);
  });

  test("one token hash in a room renew and a directory renew: both skipped as token_hash_collision", async () => {
    const fleet = await seatedFleet();
    const requested = await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    const token = /token sha256 ([0-9a-f]{64})/.exec(requested.stdout)![1]!;
    await postAs(fleet.world, fleet.device, fleet.directoryId, handRequest(fleet, fleet.device, { token_sha256: token }));
    const swept = await ok(fleet.hub.run("hub", "renew-sweep"));
    expect(swept.stdout).toContain("nothing to renew");
    expect(swept.stdout.match(/token_hash_collision/g)).toHaveLength(2);
    expect(grantsWithToken(fleet, token)).toEqual([]);
  });

  test("a token, a grant id or the directory changed while the sweep's prompt is open withdraws the renewal", async () => {
    const changes: Array<[string, (fleet: Fleet, request: { grant_id: string; token_sha256: string }) => Promise<void>]> = [
      // Another terminal's sweep renews the same request first.
      ["renewed", async (fleet) => {
        await ok(fleet.world.desk("hub-other-terminal", { of: fleet.hub }).yes("hub", "renew-sweep"));
      }],
      // Another terminal binds the desk's grant id to some other grant.
      ["grant_id_taken", async (fleet, request) => {
        const store = LobbyStore.open(fleet.hub.home);
        const desk = deskOf(fleet.device);
        try {
          store.fleet.addHubGrant({
            grant_id: request.grant_id, mission_id: fleet.directoryId, identity_id: desk.identity_id, signing_key_id: desk.signing_key_id,
            actions: ["mission.observe", "mission.read"], token_sha256: "f".repeat(64), expires_at: new Date(fleet.world.clock.now.getTime() + HOUR).toISOString(),
            purpose: "directory", room_id: null, state: "issued", requested_at: fleet.world.clock.now.toISOString(),
          });
        } finally {
          store.close();
        }
      }],
      // The hub's records name another directory.
      ["directory_changed", async (fleet) => {
        const db = new Database(join(fleet.hub.home, "lobby.sqlite"));
        db.run("UPDATE hub SET directory_mission_id = ?", [newUuid()]);
        db.close();
      }],
    ];
    for (const [reason, change] of changes) {
      const fleet = await bootstrapFleet();
      const { hub, device, world } = fleet;
      await ok(device.yes("fleet", "renew"));
      const request = JSON.parse(shownBytes(device)).request;
      const result = await runWhilePromptOpen(world, hub, ["hub", "renew-sweep"], () => change(fleet, request));
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`no directory renewal for did:at:${deskOf(device).identity_id}`);
      expect(result.stderr).toContain(reason);
      const outcome = (await json(hub.run("audit", "list", "--json"))).entries.filter((entry: any) => entry.act === "hub.renew.sweep.outcome").at(-1);
      expect(JSON.parse(outcome.bytes).directory_renewals[0]).toMatchObject({ status: "withdrawn" });
      // At most the other terminal's one grant request reached the service.
      const posted = world.hosted.seen.filter((seen) => seen.method === "POST" && seen.path.endsWith("/grants") && JSON.parse(seen.body).grant_id === request.grant_id);
      expect(posted).toHaveLength(reason === "renewed" ? 1 : 0);
    }
  });
});

describe("near the directory's end", () => {
  test("requests and grants stop at the directory's end; in its last hour the sweep issues none and a desk still picks up", async () => {
    const fleet = await bootstrapFleet({ initArgs: ["--days", "1"] });
    const { hub, device, world } = fleet;
    const ends = world.hosted.missions.get(fleet.directoryId)!.expires_at;
    world.advance(12 * HOUR);
    await ok(device.yes("fleet", "renew"));
    const request = JSON.parse(shownBytes(device)).request;
    expect(request.expires_at).toBe(ends);
    await ok(hub.yes("hub", "renew-sweep"));
    const issued = JSON.parse(shownBytes(hub)).directory_renewals;
    expect(issued.map((item: any) => [item.grant.grant_id, item.grant.expires_at])).toEqual([[request.grant_id, ends]]);

    // The last hour: a fresh request is skipped as directory_ending.
    world.advance(Date.parse(ends) - 30 * MINUTE - world.clock.now.getTime());
    const late = handRequest(fleet, device, { expires_at: ends });
    await postAs(world, device, fleet.directoryId, late);
    const swept = await hub.yes("hub", "renew-sweep");
    expect(swept.code).toBe(0);
    expect(swept.stdout + hub.terminal.written.join("")).toContain(`did:at:${deskOf(device).identity_id}: directory_ending`);
    expect(world.hosted.grants.has((openDocument(late)!.body as DirectoryRenewBody).grant_id)).toBe(false);

    // The grant the hub issued earlier is still picked up; no next request is posted.
    const events = world.hosted.missions.get(fleet.directoryId)!.events.length;
    const picked = await ok(device.yes("fleet", "renew"));
    const bytes = JSON.parse(shownBytes(device));
    expect(bytes.pickup).toMatchObject({ grant_id: request.grant_id });
    expect(bytes.request).toBeNull();
    expect(bytes.no_request).toContain("within the hour");
    expect(picked.stdout).toContain(`picked up directory grant ${request.grant_id}`);
    expect(picked.stdout).toContain("no next directory renew request");
    expect(world.hosted.grants.get(request.grant_id)!.accepted_at).not.toBeNull();
    expect(world.hosted.missions.get(fleet.directoryId)!.events.length).toBe(events);
  });

  test("a grant picked up with under five minutes left is accepted but posts no request", async () => {
    const fleet = await bootstrapFleet();
    const { hub, device, world } = fleet;
    await ok(device.yes("fleet", "renew"));
    const request = JSON.parse(shownBytes(device)).request;
    world.advance(HOUR);
    await ok(hub.yes("hub", "renew-sweep"));
    const grantEnds = world.hosted.grants.get(request.grant_id)!.expires_at;
    world.advance(Date.parse(grantEnds) - 4 * MINUTE - world.clock.now.getTime());
    const events = world.hosted.missions.get(fleet.directoryId)!.events.length;
    const picked = await ok(device.yes("fleet", "renew"));
    const bytes = JSON.parse(shownBytes(device));
    expect(bytes.pickup).toMatchObject({ grant_id: request.grant_id });
    expect(bytes.request).toBeNull();
    expect(bytes.no_request).toContain("five minutes");
    expect(bytes.no_request).toContain(FALLBACK);
    expect(picked.stdout).toContain(`picked up directory grant ${request.grant_id}`);
    expect(world.hosted.missions.get(fleet.directoryId)!.events.length).toBe(events);
  });
});
