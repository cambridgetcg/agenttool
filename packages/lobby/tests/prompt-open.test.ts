/** Acts confirmed after the hub's records changed under an open prompt, from
 * another terminal on the same hub: every send is gated by the room as it is
 * then, every grant request re-checks the stop, the block, the member and
 * the season right before it is sent, and a keyed roster whose number another
 * act took is refused before any network effect (or, for a removal, skipped
 * while the removal holds). Fake service, file-backed Keychain stand-in,
 * scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { openDocument, type MemberRosterBody } from "../src/signed.js";
import { LobbyStore } from "../src/store.js";
import { missionDigest, type MissionDescriptor } from "../src/wire.js";
import { FAKE_BEARER } from "./fake-hosted.js";
import {
  bootstrapFleet,
  deskOf,
  enrollThroughHub,
  json,
  ok,
  runWhilePromptOpen,
  seatedFleet,
  type Desk,
  type Fleet,
} from "./fleet-helpers.js";
import { cleanupTempHomes } from "./helpers.js";

afterEach(cleanupTempHomes);

const HOUR = 3_600_000;

/** Enroll another desk and knock on a room; returns the desk and its knock id. */
async function knockingDesk(fleet: Fleet, name: string, roomId = fleet.roomId): Promise<{ desk: Desk; knockId: string }> {
  const desk = fleet.world.desk(name);
  await enrollThroughHub(fleet.hub, desk, fleet.doorFingerprint);
  await ok(desk.run("fleet", "sync"));
  const knocked = await ok(desk.yes("knock", roomId, "--tier", "spectator"));
  return { desk, knockId: /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]! };
}

function grantsOf(fleet: Fleet, identity: string, missionId = fleet.seasonId) {
  return [...fleet.world.hosted.grants.values()].filter((grant) => grant.identity_id === identity && grant.mission_id === missionId);
}

function hubStore<T>(fleet: Fleet, read: (store: LobbyStore) => T): T {
  const store = LobbyStore.open(fleet.hub.home);
  try {
    return read(store);
  } finally {
    store.close();
  }
}

/** Every member of the highest-numbered keyed roster posted in the season (all its parts). */
function latestRosterMembers(fleet: Fleet): string[] {
  const parts = fleet.world.hosted.summaries(fleet.seasonId)
    .map((summary) => openDocument(summary))
    .filter((document) => document?.kind === "member_roster")
    .map((document) => document!.body as MemberRosterBody);
  const top = Math.max(...parts.map((part) => part.roster_seq));
  return parts.filter((part) => part.roster_seq === top).flatMap((part) => part.members.map((member) => member.identity_id));
}

describe("a room narrowed to the device while the prompt is open sends nothing", () => {
  test("room say on the hub", async () => {
    const fleet = await seatedFleet();
    const before = fleet.world.hosted.summaries(fleet.seasonId).length;
    const outboxBefore = hubStore(fleet, (store) => store.fleet.listOutbox().length);
    const said = await runWhilePromptOpen(fleet.world, fleet.hub, ["room", "say", fleet.roomId, "--text", "draft plan for the next step"], async () => {
      await ok(fleet.hub.yes("room", "promote", fleet.roomId, "--residency", "device", "--hostable", "false"));
    });
    expect(said.code).toBe(1);
    expect(said.stderr).toContain("was not sent");
    expect(said.stderr).toContain("room_residency_device");
    expect(fleet.world.hosted.summaries(fleet.seasonId)).toHaveLength(before);
    expect(fleet.world.hosted.summaries(fleet.seasonId).join("\n")).not.toContain("draft plan for the next step");
    // Nothing saved for a later retry either.
    expect(hubStore(fleet, (store) => store.fleet.listOutbox().length)).toBe(outboxBefore);
  });

  test("room publish", async () => {
    const fleet = await bootstrapFleet();
    const before = fleet.world.hosted.summaries(fleet.directoryId).length;
    const cards = hubStore(fleet, (store) => store.fleet.latestCard(fleet.roomId)!.card_seq);
    const published = await runWhilePromptOpen(fleet.world, fleet.hub, ["room", "publish", fleet.roomId], async () => {
      await ok(fleet.hub.yes("room", "promote", fleet.roomId, "--residency", "device", "--hostable", "false"));
    });
    expect(published.code).toBe(1);
    expect(published.stderr).toContain("room_residency_device");
    expect(fleet.world.hosted.summaries(fleet.directoryId)).toHaveLength(before);
    expect(hubStore(fleet, (store) => store.fleet.latestCard(fleet.roomId)!.card_seq)).toBe(cards);
  });
});

describe("a block recorded while the prompt is open holds", () => {
  test("renew-sweep issues the blocked member nothing", async () => {
    const fleet = await seatedFleet({ termDays: 7 });
    const member = deskOf(fleet.device).identity_id;
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    const swept = await runWhilePromptOpen(fleet.world, fleet.hub, ["hub", "renew-sweep"], async () => {
      await ok(fleet.hub.yes("hub", "block", fleet.roomId, member));
    });
    expect(swept.code).toBe(1);
    expect(swept.stderr).toContain(`no renewal for did:at:${member}`);
    expect(swept.stderr).toContain("member_blocked");
    expect(grantsOf(fleet, member).filter((grant) => grant.revoked_at === null)).toHaveLength(0);
    hubStore(fleet, (store) => {
      expect(store.fleet.listRenewals()).toHaveLength(0);
      expect(store.fleet.listHubGrants().filter((grant) => grant.state === "requested")).toHaveLength(0);
      expect(store.listAudit().map((entry) => entry.act)).toContain("hub.renew.sweep.outcome");
    });
  });

  test("admit issues the blocked requester nothing", async () => {
    const fleet = await seatedFleet();
    const { desk, knockId } = await knockingDesk(fleet, "newcomer");
    const identity = deskOf(desk).identity_id;
    const admitted = await runWhilePromptOpen(fleet.world, fleet.hub, ["hub", "admit", knockId], async () => {
      await ok(fleet.hub.yes("hub", "block", fleet.roomId, identity));
    });
    expect(admitted.code).toBe(1);
    expect(admitted.stderr).toContain("blocked");
    expect(grantsOf(fleet, identity)).toHaveLength(0);
    hubStore(fleet, (store) => {
      expect(store.fleet.decision(knockId)).toBeNull();
      expect(store.fleet.member(fleet.seasonId, identity)).toBeNull();
    });
  });

  test("member add records nothing for the blocked identity", async () => {
    const fleet = await seatedFleet();
    const other = fleet.world.desk("other");
    await enrollThroughHub(fleet.hub, other, fleet.doorFingerprint);
    const identity = deskOf(other).identity_id;
    const sent = fleet.world.hosted.summaries(fleet.seasonId).length;
    const added = await runWhilePromptOpen(fleet.world, fleet.hub,
      ["hub", "member", "add", fleet.roomId, "--identity", identity, "--tier", "spectator"], async () => {
        await ok(fleet.hub.yes("hub", "block", fleet.roomId, identity));
      });
    expect(added.code).toBe(1);
    expect(added.stderr).toContain("blocked");
    hubStore(fleet, (store) => expect(store.fleet.member(fleet.seasonId, identity)).toBeNull());
    expect(fleet.world.hosted.summaries(fleet.seasonId)).toHaveLength(sent);
  });
});

describe("a stop recorded while the prompt is open stops the act", () => {
  test("admit on an adopted season issues nothing after the stop", async () => {
    const fleet = await bootstrapFleet();
    const hosted = fleet.world.hosted;
    const descriptor: MissionDescriptor = {
      format: "agenttool-collaboration-mission/v1", purpose: "Zerone season 1 by hand", resources: [],
      acceptance_criteria: ["Exchange one hello"], principalities: [],
    };
    const adoptedId = crypto.randomUUID();
    await hosted.fetch("https://api.agenttool.dev/v1/collaboration/missions", {
      method: "POST", redirect: "error", headers: { Authorization: `Bearer ${FAKE_BEARER}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mission_id: adoptedId, descriptor, expires_at: new Date(fleet.world.clock.now.getTime() + 10 * 24 * HOUR).toISOString() }),
    });
    const room = (await json(fleet.hub.run("room", "add", "--title", "Adopted", "--door", "knock", "--slot", "reviewer:player:1", "--json"))).card.room_id;
    await ok(fleet.hub.yes("room", "promote", room, "--residency", "fleet", "--hostable", "true"));
    await ok(fleet.hub.yes("hub", "season", "adopt", room, "--mission", adoptedId, "--digest", missionDigest(descriptor)));
    await ok(fleet.hub.yes("room", "publish", room));
    await ok(fleet.device.run("fleet", "sync"));
    const knocked = await ok(fleet.device.yes("knock", room, "--tier", "player"));
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
    const admitted = await runWhilePromptOpen(fleet.world, fleet.hub, ["hub", "admit", knockId], async () => {
      await ok(fleet.hub.yes("hub", "stop"));
    });
    expect(admitted.code).toBe(1);
    expect(admitted.stderr).toContain("hub_stopped");
    expect(grantsOf(fleet, deskOf(fleet.device).identity_id, adoptedId)).toHaveLength(0);
    expect(hosted.missions.get(adoptedId)!.revoked_at).toBeNull(); // left alone without --include-adopted, and nothing issued on it
  });

  test("hub seat issues nothing after the stop", async () => {
    const fleet = await bootstrapFleet();
    const before = fleet.world.hosted.grants.size;
    const seated = await runWhilePromptOpen(fleet.world, fleet.hub, ["hub", "seat", "directory"], async () => {
      await ok(fleet.hub.yes("hub", "stop"));
    });
    expect(seated.code).toBe(1);
    expect(seated.stderr).toContain("hub_stopped");
    expect(fleet.world.hosted.grants.size).toBe(before);
  });

  test("a grant issued while the stop's own prompt was open is reported, and the next stop revokes it", async () => {
    const fleet = await seatedFleet();
    const { desk, knockId } = await knockingDesk(fleet, "newcomer");
    const identity = deskOf(desk).identity_id;
    const stopped = await runWhilePromptOpen(fleet.world, fleet.hub, ["hub", "stop"], async () => {
      await ok(fleet.hub.yes("hub", "admit", knockId));
    });
    expect(stopped.code).toBe(1);
    expect(stopped.stderr).toContain("requested after this stop was planned");
    const late = grantsOf(fleet, identity)[0]!;
    expect(stopped.stderr).toContain(late.grant_id);
    expect(late.revoked_at).toBeNull();
    await ok(fleet.hub.yes("hub", "stop"));
    expect(grantsOf(fleet, identity)[0]!.revoked_at).not.toBeNull();
  });
});

describe("a keyed roster number taken while the prompt is open", () => {
  test("refuses a second admit before any grant; run again, it admits", async () => {
    const fleet = await seatedFleet();
    const first = await knockingDesk(fleet, "first");
    const second = await knockingDesk(fleet, "second");
    const secondId = deskOf(second.desk).identity_id;
    const admitted = await runWhilePromptOpen(fleet.world, fleet.hub, ["hub", "admit", second.knockId], async () => {
      await ok(fleet.hub.yes("hub", "admit", first.knockId));
    });
    expect(admitted.code).toBe(1);
    expect(admitted.stderr).toContain("roster_changed");
    expect(grantsOf(fleet, secondId)).toHaveLength(0);
    const knocks = (await json(fleet.hub.run("hub", "knocks", "--json"))).knocks;
    expect(knocks.find((knock: any) => knock.knock_id === second.knockId)).toMatchObject({ status: "pending" });
    await ok(fleet.hub.yes("hub", "admit", second.knockId));
    expect(latestRosterMembers(fleet)).toEqual(expect.arrayContaining([deskOf(first.desk).identity_id, secondId, deskOf(fleet.device).identity_id]));
  });

  test("a kick still holds; its roster is not posted and hub roster post sends a current one", async () => {
    const fleet = await seatedFleet();
    const member = deskOf(fleet.device).identity_id;
    const other = await knockingDesk(fleet, "other");
    const kicked = await runWhilePromptOpen(fleet.world, fleet.hub, ["hub", "kick", fleet.roomId, member], async () => {
      await ok(fleet.hub.yes("hub", "admit", other.knockId));
    });
    expect(kicked.code).toBe(1);
    expect(kicked.stderr).toContain("roster_changed");
    expect(kicked.stderr).toContain(`hub roster post ${fleet.roomId}`);
    hubStore(fleet, (store) => expect(store.fleet.member(fleet.seasonId, member)!.state).toBe("kicked"));
    expect(grantsOf(fleet, member).every((grant) => grant.revoked_at !== null)).toBe(true);
    // The admit's roster (with the kicked member) is the newest posted; a fresh one drops them.
    expect(latestRosterMembers(fleet)).toContain(member);
    await ok(fleet.hub.yes("hub", "roster", "post", fleet.roomId));
    expect(latestRosterMembers(fleet)).not.toContain(member);
    expect(latestRosterMembers(fleet)).toContain(deskOf(other.desk).identity_id);
  });
});
