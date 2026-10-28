/** Room seat leases end to end, hermetically: `room lease` confirmed once at
 * a scripted terminal, `room say --lease` with no terminal at all, every
 * closed refusal and void, idempotent replay, a lost response, a race on the
 * last budget slot, the STOP file, the hub's stop, kick and block, and the
 * egress gate on every lease send (CJK, Kana, Hangul and Thai neighbours of a
 * device term included), leases beside directory renewal (a renewed
 * directory grant never carries a lease on) and beside directory rollover (a
 * move to the successor ends a lease). Fake service, file-backed
 * Keychain stand-in for the hub's own terminal acts, and a Keychain spy that
 * fails if a lease path ever touches it. Contract: packages/lobby/README.md#room-seat-leases. */
import { Database } from "bun:sqlite";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/cli.js";
import { LobbyError } from "../src/errors.js";
import { DATABASE_FILE } from "../src/home.js";
import type { SecretStore } from "../src/keychain.js";
import { sendUnderLease, type LeaseSendResult } from "../src/lease.js";
import type { FleetContext } from "../src/ops.js";
import { defaultSeatRef } from "../src/seat-ref.js";
import { LobbyStore } from "../src/store.js";
import { confirmOnTty, showOnTty } from "../src/tty.js";
import {
  DEVICE_TERMS,
  deskOf,
  enrollThroughHub,
  json,
  ok,
  relayArgs,
  runWhilePromptOpen,
  seatedFleet,
  shownBytes,
  type Desk,
  type Fleet,
  type World,
} from "./fleet-helpers.js";
import { cleanupTempHomes, fakeTerminal, packageRoot } from "./helpers.js";

afterEach(cleanupTempHomes);

const SESSION_A = "AAAAAAAA-1111-4111-8111-111111111111";
const SESSION_B = "bbbbbbbb-2222-4222-8222-222222222222";
const SEAT_A = `claude-code:${SESSION_A.toLowerCase()}`;
const LEASE_ID = /lease (lease_[0-9a-f]{32})/;

interface Spy {
  store: SecretStore;
  calls: string[];
}

/** A Keychain that records and refuses every touch: a lease path must never reach it. */
function keychainSpy(): Spy {
  const calls: string[] = [];
  const touch = (what: string) => async () => {
    calls.push(what);
    throw new Error("the Keychain was touched");
  };
  return { calls, store: { kind: "file", has: touch("has"), read: touch("read"), add: touch("add") } };
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI on a desk's home with no terminal (by default), a chosen
 * environment and a Keychain spy, as an agent's shell tool would. */
async function headless(w: World, desk: Desk, argv: string[], options: { env?: Record<string, string>; spy?: Spy } = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const spy = options.spy ?? keychainSpy();
  const code = await runCli(argv, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env: { AGENTTOOL_LOBBY_HOME: desk.home, ...(options.env ?? {}) },
    confirm: (request) => confirmOnTty(request, { openTty: () => null }),
    showOnTty: (text) => showOnTty(text, { openTty: () => null }),
    hasTerminal: () => false,
    now: () => new Date(w.clock.now),
    sleep: async (ms) => {
      w.clock.now = new Date(w.clock.now.getTime() + ms);
    },
    fetchImpl: w.hosted.fetch,
    keychain: spy.store,
    deviceTerms: DEVICE_TERMS,
  });
  expect(spy.calls).toEqual([]);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

/** Make a lease at the desk's own scripted terminal (answers yes). */
async function lease(desk: Desk, roomId: string, ...flags: string[]): Promise<string> {
  const made = await ok(desk.yes("room", "lease", roomId, ...(flags.some((flag) => flag === "--seat-ref" || flag === "--any-seat") ? [] : ["--any-seat"]), ...flags));
  return LEASE_ID.exec(made.stdout)![1]!;
}

let keys = 0;
function say(fleet: Fleet, desk: Desk, leaseId: string, text: string, ...flags: string[]): Promise<Run> {
  keys += 1;
  return headless(fleet.world, desk, ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", `key-${keys}-${crypto.randomUUID()}`,
    "--text", text, "--json", ...flags], { env: { CLAUDE_CODE_SESSION_ID: SESSION_A } });
}

function chatPosts(fleet: Fleet): number {
  return fleet.world.hosted.seen.filter((request) => request.method === "POST" && request.path === `/v1/collaboration/missions/${fleet.seasonId}/events`).length;
}

async function auditOf(desk: Desk): Promise<Array<{ seq: number; act: string; subject: string; bytes: string; bytes_sha256: string }>> {
  return (await json(desk.run("audit", "list", "--json"))).entries;
}

async function leaseOf(desk: Desk, leaseId: string): Promise<any> {
  return (await json(desk.run("room", "lease", "show", leaseId, "--json"))).lease;
}

function sql(desk: Desk, statement: string, params: Record<string, string> = {}): void {
  const raw = new Database(join(desk.home, DATABASE_FILE));
  raw.query(statement).run(params);
  raw.close();
}

/** Call sendUnderLease directly, with no terminal, running `meanwhile` after
 * every check outside the reservation and just before the reservation's
 * transaction: the window another process could act in. */
async function sendRacing(fleet: Fleet, desk: Desk, leaseId: string, key: string, text: string,
  meanwhile: (ctx: FleetContext) => void): Promise<{ result?: LeaseSendResult; error?: LobbyError }> {
  const store = LobbyStore.open(desk.home);
  const now = () => new Date(fleet.world.clock.now);
  const ctx: FleetContext = {
    store, home: desk.home, now, keychain: null, hasTerminal: () => false, sleep: async () => {}, seatRef: null,
    hosted: { fetchImpl: fleet.world.hosted.fetch, now, deviceTerms: DEVICE_TERMS },
  };
  const reserve = store.recordActWith.bind(store);
  store.recordActWith = ((plan, run) => {
    if (plan.act === "room.say.lease") meanwhile(ctx);
    return reserve(plan, run);
  }) as typeof store.recordActWith;
  try {
    return { result: await sendUnderLease(ctx, { room_id: fleet.roomId, lease_id: leaseId, idempotency_key: key, text }) };
  } catch (error) {
    if (error instanceof LobbyError) return { error };
    throw error;
  } finally {
    store.close();
  }
}

describe("making a lease at the terminal", () => {
  test("shows the exact record once, records room.lease, and binds this season's grant", async () => {
    const fleet = await seatedFleet();
    const hubId = deskOf(fleet.hub).identity_id;
    const made = await ok(fleet.device.yes("room", "lease", fleet.roomId, "--seat-ref", SEAT_A, "--messages", "5"));
    const leaseId = LEASE_ID.exec(made.stdout)![1]!;
    const shown = JSON.parse(shownBytes(fleet.device));
    expect(shown).toMatchObject({ act: "room.lease", schema: "agenttool-lobby-act/v1" });
    expect(shown.lease).toMatchObject({
      format: "agenttool-lobby-lease/v1", lease_id: leaseId, room_id: fleet.roomId, mission_id: fleet.seasonId, mission_digest: fleet.seasonDigest,
      tier: "player", acts: ["room.say"], kinds: ["message", "read_ack"], conversation: "table",
      max_messages: 5, max_chars_per_message: 1000, max_total_chars: 10000, min_interval_seconds: 30,
      seat_ref: SEAT_A, ends_by: "minutes", identity_id: deskOf(fleet.device).identity_id,
    });
    expect(shown.lease.recipients).toEqual([{ identity_id: hubId, fingerprint: deskOf(fleet.hub).fingerprint }]);
    expect(shown.lease.directory_grant_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(shown.lease.expires_at) - Date.parse(shown.lease.issued_at)).toBe(480 * 60_000);
    const prompt = fleet.device.terminal.written.join("");
    expect(prompt).toContain("agents on this desk may send up to 5 messages");
    expect(prompt).toContain("renewal, leave and every other act still need you here");
    const audit = await auditOf(fleet.device);
    expect(audit.at(-1)).toMatchObject({ act: "room.lease", subject: leaseId, bytes: shownBytes(fleet.device) });
    const view = await leaseOf(fleet.device, leaseId);
    expect(view).toMatchObject({ state: "active", sent_messages: 0, max_messages: 5, seat_ref: SEAT_A });
    expect((await json(fleet.device.run("room", "lease", "list", "--json"))).leases.map((item: any) => item.lease_id)).toEqual([leaseId]);
  });

  test("without a terminal nothing is read or written, and the command for a person is printed", async () => {
    const fleet = await seatedFleet();
    const seen = fleet.world.hosted.seen.length;
    const before = (await auditOf(fleet.device)).length;
    const asked = await headless(fleet.world, fleet.device, ["room", "lease", fleet.roomId, "--messages", "3"], { env: { CLAUDE_CODE_SESSION_ID: SESSION_A } });
    expect(asked.code).toBe(3);
    expect(asked.stderr).toContain("tty_unavailable");
    expect(asked.stderr).toContain(`agenttool-lobby room lease ${fleet.roomId} --messages 3 --seat-ref ${SEAT_A}`);
    expect(fleet.world.hosted.seen).toHaveLength(seen);
    expect(await auditOf(fleet.device)).toHaveLength(before);
    // The command names the bounds it was given only; nothing else is filled in.
    const anySeat = await headless(fleet.world, fleet.device, ["room", "lease", fleet.roomId, "--any-seat"]);
    expect(anySeat.stderr).toContain(`agenttool-lobby room lease ${fleet.roomId} --any-seat\n`);
  });

  test("a spectator gets no lease", async () => {
    const fleet = await seatedFleet({ tier: "spectator" });
    fleet.device.answers.push("yes");
    const refused = await fleet.device.run("room", "lease", fleet.roomId, "--any-seat");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("lease_not_player");
  });

  test("bounds past Yu's caps, or no seat binding, are usage errors", async () => {
    const fleet = await seatedFleet();
    for (const flags of [["--minutes", "481"], ["--minutes", "0"], ["--messages", "101"], ["--chars", "50001"], ["--interval-seconds", "4"],
      ["--interval-seconds", "3601"], ["--to", "not-a-uuid"], ["--conversation", "\u001b[2Jside"]]) {
      const refused = await fleet.device.run("room", "lease", fleet.roomId, "--any-seat", ...flags);
      expect({ flags, code: refused.code }).toEqual({ flags, code: 2 });
    }
    expect((await fleet.device.run("room", "lease", fleet.roomId)).code).toBe(2);
    expect((await fleet.device.run("room", "lease", fleet.roomId, "--any-seat", "--seat-ref", SEAT_A)).code).toBe(2);
    expect((await fleet.device.run("room", "lease", fleet.roomId, "--seat-ref", "-bad")).code).toBe(2);
    // At the caps exactly, the lease is made.
    await lease(fleet.device, fleet.roomId, "--minutes", "480", "--messages", "100", "--chars", "50000", "--interval-seconds", "5");
  });

  test("the lease ends at the earliest of its minutes, the grants, the term and the season", async () => {
    const fleet = await seatedFleet();
    const status = await json(fleet.device.run("fleet", "status", "--json"));
    const season = status.grants.find((grant: any) => grant.purpose === "season");
    const directory = status.grants.find((grant: any) => grant.purpose === "directory");
    const grantEnd = Math.min(Date.parse(season.expires_at), Date.parse(directory.expires_at)) - 60_000;
    // 20 hours later, 8 hours would pass the first grant to end: the lease ends with it.
    fleet.world.advance(20 * 3_600_000);
    const leaseId = await lease(fleet.device, fleet.roomId);
    const view = await leaseOf(fleet.device, leaseId);
    expect(Date.parse(view.expires_at)).toBe(grantEnd);
    // In a fresh fleet the two grants end together and the season grant,
    // listed first, names the end; the directory grant's own bound is pinned
    // in "leases beside directory renewal".
    expect(Date.parse(season.expires_at)).toBeLessThanOrEqual(Date.parse(directory.expires_at));
    expect(view.ends_by).toBe("season_grant");
    await ok(fleet.device.run("room", "lease", "revoke", leaseId));
    // Within five minutes of that end, no lease is made.
    fleet.world.clock.now = new Date(grantEnd - 4 * 60_000);
    fleet.device.answers.push("yes");
    const short = await fleet.device.run("room", "lease", fleet.roomId, "--any-seat");
    expect(short.code).toBe(1);
    expect(short.stderr).toContain("lease_too_short");
    fleet.device.answers.length = 0;
  });

  test("one lease per seat binding, and at most three active per room", async () => {
    const fleet = await seatedFleet();
    await lease(fleet.device, fleet.roomId, "--seat-ref", SEAT_A);
    fleet.device.answers.push("yes");
    expect((await fleet.device.run("room", "lease", fleet.roomId, "--seat-ref", SEAT_A)).stderr).toContain("lease_active_exists");
    fleet.device.answers.length = 0;
    await lease(fleet.device, fleet.roomId, "--seat-ref", "codex:cccccccc-3333-4333-8333-333333333333");
    await lease(fleet.device, fleet.roomId, "--any-seat");
    fleet.device.answers.push("yes");
    const fourth = await fleet.device.run("room", "lease", fleet.roomId, "--seat-ref", `claude-code:${SESSION_B}`);
    expect(fourth.stderr).toContain("lease_active_exists");
    expect(fourth.stderr).toContain("at most 3");
    fleet.device.answers.length = 0;
  });
});

describe("sending under a lease with no terminal", () => {
  test("a member desk sends the participant client's envelope, audited before the POST, under the bound grant", async () => {
    const fleet = await seatedFleet();
    const hubId = deskOf(fleet.hub).identity_id;
    const leaseId = await lease(fleet.device, fleet.roomId, "--seat-ref", SEAT_A);
    const status = await json(fleet.device.run("fleet", "status", "--json"));
    const grantId = status.grants.find((grant: any) => grant.purpose === "season").grant_id;
    // When the POST arrives, the audit entry and the outbox row already exist.
    const hosted = fleet.world.hosted;
    let auditAtPost = null as string | null;
    hosted.intercept = (request, process) => {
      if (request.method === "POST" && request.path.endsWith("/events")) {
        const reader = LobbyStore.openReadOnly(fleet.device.home)!;
        const last = reader.listAudit().at(-1)!;
        auditAtPost = `${last.act} ${JSON.parse(last.bytes).event_id} ${reader.fleet.outbox(JSON.parse(request.body).event_id)?.state}`;
        reader.close();
      }
      return process();
    };
    const sent = await headless(fleet.world, fleet.device, ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", "hello-0001",
      "--text", "hello from an agent under a lease", "--json"], { env: { CLAUDE_CODE_SESSION_ID: SESSION_A } });
    hosted.intercept = null;
    expect(sent.code).toBe(0);
    const out = JSON.parse(sent.stdout);
    expect(out).toMatchObject({ ok: true, status: "stored", replayed: false, mission_id: fleet.seasonId, grant_id: grantId,
      lease: { lease_id: leaseId, sent_messages: 1, max_messages: 20, sent_chars: 33 } });
    expect(auditAtPost).toBe(`room.say.lease ${out.event_id} pending`);
    // The summary is byte for byte what room say at a terminal sends.
    const posted = hosted.missions.get(fleet.seasonId)!.events.find((event) => event.event_id === out.event_id)!;
    expect((posted.observation as { summary: string }).summary).toBe(JSON.stringify({
      format: "agenttool-mission-chat/v1", conversation: "table", to_identity: hubId, kind: "message", text: "hello from an agent under a lease",
    }));
    expect(posted.grant_id).toBe(grantId);
    const entry = (await auditOf(fleet.device)).find((item) => item.act === "room.say.lease")!;
    const bytes = JSON.parse(entry.bytes);
    expect(bytes).toMatchObject({ act: "room.say.lease", lease_id: leaseId, n: 1, seat_ref: SEAT_A, idempotency_key: "hello-0001",
      room_id: fleet.roomId, mission_id: fleet.seasonId, grant_id: grantId, event_id: out.event_id, to_identity: hubId });
    expect(JSON.parse(bytes.raw_body).summary).toBe((posted.observation as { summary: string }).summary);
    expect(out.audit_sha256).toBe(entry.bytes_sha256);
    // The hub reads it, verified like any other message.
    const read = await json(fleet.hub.run("room", "read", fleet.roomId, "--json"));
    expect(read.messages.map((message: any) => [message.text, message.from.basis])).toEqual([["hello from an agent under a lease", "door_roster_pin"]]);
    // The send row records the grant it used.
    const shown = await json(fleet.device.run("room", "lease", "show", leaseId, "--json"));
    expect(shown.sends).toMatchObject([{ n: 1, grant_id: grantId, seat_ref: SEAT_A, state: "stored", kind: "message" }]);
    expect((await fleet.device.run("audit", "verify")).stdout).toMatch(/^audit chain intact/);
  });

  test("after the season grant is renewed, a lease still posts under its bound grant, never the successor", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    const bound = (await leaseOf(fleet.device, leaseId)).grant_id;
    // Hours later, so the renewed grant ends later than the bound one and
    // currentDeskGrant would pick the successor.
    fleet.world.advance(4 * 3_600_000);
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    await ok(fleet.device.yes("room", "renew", "accept", fleet.roomId));
    const status = await json(fleet.device.run("fleet", "status", "--json"));
    const successor = status.grants.find((grant: any) => grant.purpose === "season" && grant.grant_id !== bound)?.grant_id;
    expect(successor).toBeString();
    const sent = await say(fleet, fleet.device, leaseId, "after the renewal");
    expect(sent.code).toBe(0);
    const out = JSON.parse(sent.stdout);
    const posted = fleet.world.hosted.missions.get(fleet.seasonId)!.events.find((event) => event.event_id === out.event_id)!;
    const sends = (await json(fleet.device.run("room", "lease", "show", leaseId, "--json"))).sends;
    expect([posted.grant_id, out.grant_id, sends[0].grant_id]).toEqual([bound, bound, bound]);
    expect(bound).not.toBe(successor);
  });

  test("the host desk sends under a lease too, and neither desk's Keychain is touched", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.hub, fleet.roomId);
    const view = await leaseOf(fleet.hub, leaseId);
    expect(view.directory_grant_id).toBeNull();
    const spy = keychainSpy();
    const sent = await headless(fleet.world, fleet.hub, ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", "host-0001",
      "--text", "welcome, from the host's agent", "--json"], { spy });
    expect(sent.code).toBe(0);
    expect(spy.calls).toEqual([]);
    const read = await json(fleet.device.run("room", "read", fleet.roomId, "--json"));
    expect(read.messages.map((message: any) => [message.text, message.from.role])).toEqual([["welcome, from the host's agent", "host"]]);
  });

  test("an answer and a read_ack under a lease", async () => {
    const fleet = await seatedFleet();
    await ok(fleet.hub.yes("room", "say", fleet.roomId, "--text", "please confirm you read the charter"));
    const read = await json(fleet.device.run("room", "read", fleet.roomId, "--json"));
    const leaseId = await lease(fleet.device, fleet.roomId, "--interval-seconds", "5");
    expect((await say(fleet, fleet.device, leaseId, "read it", "--in-reply-to", read.messages[0].event_id)).code).toBe(0);
    fleet.world.advance(5_000);
    expect((await say(fleet, fleet.device, leaseId, "read", "--kind", "read_ack", "--in-reply-to", read.messages[0].event_id)).code).toBe(0);
    const after = await json(fleet.hub.run("room", "read", fleet.roomId, "--after", read.next_cursor, "--json"));
    expect(after.messages.map((message: any) => [message.kind, message.in_reply_to])).toEqual([
      ["message", read.messages[0].event_id], ["read_ack", read.messages[0].event_id],
    ]);
  });
});

describe("closed refusals under a lease (nothing sent, the lease stays)", () => {
  test("conversation, recipients, budgets and spacing", async () => {
    const fleet = await seatedFleet();
    const other = fleet.world.desk("other");
    await enrollThroughHub(fleet.hub, other, fleet.doorFingerprint);
    await ok(other.run("fleet", "sync"));
    const knocked = await ok(other.yes("knock", fleet.roomId, "--tier", "player"));
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
    await ok(fleet.hub.yes("hub", "admit", knockId));
    await ok(other.yes("ready", knockId));
    const hubId = deskOf(fleet.hub).identity_id;
    const otherId = deskOf(other).identity_id;
    const leaseId = await lease(fleet.device, fleet.roomId, "--to", hubId, "--messages", "2", "--chars", "40");
    const posts = chatPosts(fleet);
    const refusals: Array<[string[], string, string]> = [
      [["--to", otherId], "not named", "lease_recipient_not_covered"],
      [["--to", hubId, "--conversation", "side"], "elsewhere", "lease_conversation_not_covered"],
      [["--to", hubId], "x".repeat(1001), "lease_message_too_long"],
      [["--to", hubId], "y".repeat(41), "lease_chars_exhausted"],
    ];
    for (const [flags, text, code] of refusals) {
      const refused = await say(fleet, fleet.device, leaseId, text, ...flags);
      expect({ code, exit: refused.code, stderr: refused.stderr.includes(code) }).toEqual({ code, exit: 1, stderr: true });
      expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, error: code });
    }
    expect((await say(fleet, fleet.device, leaseId, "first", "--to", hubId)).code).toBe(0);
    const soon = await say(fleet, fleet.device, leaseId, "second", "--to", hubId);
    expect(soon.stderr).toContain("lease_too_soon");
    fleet.world.advance(30_000);
    expect((await say(fleet, fleet.device, leaseId, "second", "--to", hubId)).code).toBe(0);
    fleet.world.advance(30_000);
    expect((await say(fleet, fleet.device, leaseId, "third", "--to", hubId)).stderr).toContain("lease_budget_exhausted");
    expect(chatPosts(fleet)).toBe(posts + 2);
    expect(await leaseOf(fleet.device, leaseId)).toMatchObject({ state: "active", sent_messages: 2, sent_chars: 11 });
  });

  test("a recipient who left the newest roster is refused, not voided", async () => {
    const fleet = await seatedFleet();
    const other = fleet.world.desk("other");
    await enrollThroughHub(fleet.hub, other, fleet.doorFingerprint);
    await ok(other.run("fleet", "sync"));
    const knockId = /knock ([0-9a-f-]{36})/.exec((await ok(other.yes("knock", fleet.roomId, "--tier", "player"))).stdout)![1]!;
    await ok(fleet.hub.yes("hub", "admit", knockId));
    await ok(other.yes("ready", knockId));
    const otherId = deskOf(other).identity_id;
    const leaseId = await lease(fleet.device, fleet.roomId);
    expect((await leaseOf(fleet.device, leaseId)).recipients).toHaveLength(2);
    await ok(fleet.hub.yes("hub", "kick", fleet.roomId, otherId));
    const refused = await say(fleet, fleet.device, leaseId, "are you still there", "--to", otherId);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("to_not_member");
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("active");
  });

  test("a recipient whose key differs from the one the lease snapshotted is refused", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    // Stand in for a re-keyed recipient: the snapshot names the hub with
    // another key than the newest roster pins. (The bounds trigger is
    // dropped on this test file only; real desks keep it.)
    const raw = new Database(join(fleet.device.home, DATABASE_FILE));
    raw.exec("DROP TRIGGER desk_leases_bounds_are_fixed");
    const record = JSON.parse((raw.query("SELECT record FROM desk_leases WHERE lease_id = $id").get({ $id: leaseId }) as { record: string }).record);
    raw.close();
    record.recipients = record.recipients.map((recipient: { identity_id: string; fingerprint: string }) => ({ ...recipient, fingerprint: `${recipient.fingerprint.slice(0, -4)}0000` }));
    sql(fleet.device, "UPDATE desk_leases SET record = $record WHERE lease_id = $id", { $record: JSON.stringify(record), $id: leaseId });
    const posts = chatPosts(fleet);
    const refused = await say(fleet, fleet.device, leaseId, "is this still you");
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, error: "lease_recipient_not_covered" });
    expect(chatPosts(fleet)).toBe(posts);
    expect(await leaseOf(fleet.device, leaseId)).toMatchObject({ state: "active", sent_messages: 0 });
  });

  test("a lease bound to a seat refuses another seat or none; --any-seat takes any", async () => {
    const fleet = await seatedFleet();
    const bound = await lease(fleet.device, fleet.roomId, "--seat-ref", SEAT_A, "--interval-seconds", "5");
    const args = (leaseId: string, key: string) => ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", key, "--text", "hi"];
    const other = await headless(fleet.world, fleet.device, args(bound, "seat-0001"), { env: { CLAUDE_CODE_SESSION_ID: SESSION_B } });
    expect(other.stderr).toContain("lease_seat_mismatch");
    const none = await headless(fleet.world, fleet.device, args(bound, "seat-0002"));
    expect(none.stderr).toContain("lease_seat_mismatch");
    const codex = await headless(fleet.world, fleet.device, args(bound, "seat-0003"), { env: { CODEX_THREAD_ID: SESSION_A } });
    expect(codex.stderr).toContain("lease_seat_mismatch");
    // Upper-case session ids are lower-cased, as #491 derives them.
    expect((await headless(fleet.world, fleet.device, args(bound, "seat-0004"), { env: { CLAUDE_CODE_SESSION_ID: SESSION_A } })).code).toBe(0);
    await ok(fleet.device.run("room", "lease", "revoke", bound));
    const any = await lease(fleet.device, fleet.roomId, "--any-seat", "--interval-seconds", "5");
    expect((await headless(fleet.world, fleet.device, args(any, "seat-0005"))).code).toBe(0);
    fleet.world.advance(5_000);
    expect((await headless(fleet.world, fleet.device, args(any, "seat-0006"), { env: { CODEX_THREAD_ID: SESSION_B } })).code).toBe(0);
    const sends = (await json(fleet.device.run("room", "lease", "show", any, "--json"))).sends.map((send: any) => send.seat_ref);
    expect(sends).toEqual([null, `codex:${SESSION_B}`]);
  });

  test("usage: --lease needs a key, --json needs a lease, and no other command takes --lease", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    const base = ["room", "say", fleet.roomId, "--text", "hi"];
    expect((await headless(fleet.world, fleet.device, [...base, "--lease", leaseId])).code).toBe(2);
    expect((await headless(fleet.world, fleet.device, [...base, "--idempotency-key", "abcdefgh"])).code).toBe(2);
    expect((await headless(fleet.world, fleet.device, [...base, "--json"])).code).toBe(2);
    expect((await headless(fleet.world, fleet.device, [...base, "--lease", "lease_x", "--idempotency-key", "abcdefgh"])).code).toBe(2);
    expect((await headless(fleet.world, fleet.device, [...base, "--lease", leaseId, "--idempotency-key", "short"])).code).toBe(2);
    // Renewal and leave are never covered by a lease.
    expect((await headless(fleet.world, fleet.device, ["room", "renew", "request", fleet.roomId, "--lease", leaseId])).code).toBe(2);
    expect((await headless(fleet.world, fleet.device, ["room", "leave", fleet.roomId, "--lease", leaseId])).code).toBe(2);
    expect((await headless(fleet.world, fleet.device, ["outbox", "retry", crypto.randomUUID(), "--lease", leaseId])).code).toBe(2);
    // room say without --lease is unchanged: headless, it exits 3 and sends nothing.
    const seen = fleet.world.hosted.seen.length;
    const plain = await headless(fleet.world, fleet.device, base);
    expect(plain.code).toBe(3);
    expect(plain.stderr).toContain("tty_unavailable");
    expect(fleet.world.hosted.seen).toHaveLength(seen);
  });

  test("a lease for another room, an unknown lease, and a revoked lease are refused", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    const elsewhere = await headless(fleet.world, fleet.device, ["room", "say", `room_${"a".repeat(32)}`, "--lease", leaseId, "--idempotency-key", "where-001", "--text", "hi"]);
    expect(elsewhere.stderr).toContain("lease_room_mismatch");
    expect((await say(fleet, fleet.device, `lease_${"0".repeat(32)}`, "hi")).stderr).toContain("lease_not_found");
    const revoked = await ok(headless(fleet.world, fleet.device, ["room", "lease", "revoke", leaseId]));
    expect(revoked.stdout).toContain(`revoked lease ${leaseId}`);
    expect((await say(fleet, fleet.device, leaseId, "hi")).stderr).toContain("lease_revoked");
    // Revoking again is harmless.
    expect((await ok(headless(fleet.world, fleet.device, ["room", "lease", "revoke", leaseId]))).stdout).toContain("had already ended");
    expect((await auditOf(fleet.device)).filter((entry) => entry.act === "room.lease.revoke")).toHaveLength(1);
  });

  test("the lease ends at its expiry", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId, "--minutes", "10");
    fleet.world.advance(10 * 60_000);
    expect((await say(fleet, fleet.device, leaseId, "late")).stderr).toContain("lease_expired");
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("expired");
    expect((await json(fleet.device.run("room", "lease", "list", "--json"))).leases).toEqual([]);
    expect((await json(fleet.device.run("room", "lease", "list", "--all", "--json"))).leases).toHaveLength(1);
  });
});

describe("voids: the lease ends for good before the next send", () => {
  test("a STOP file voids every lease on the desk, and removing it brings none back", async () => {
    const fleet = await seatedFleet();
    const first = await lease(fleet.device, fleet.roomId, "--seat-ref", SEAT_A);
    const second = await lease(fleet.device, fleet.roomId);
    const posts = chatPosts(fleet);
    writeFileSync(join(fleet.device.home, "STOP"), "");
    const stopped = await say(fleet, fleet.device, first, "anyone?");
    expect(stopped.code).toBe(1);
    expect(stopped.stderr).toContain("lease_void");
    expect(stopped.stderr).toContain("stop_file");
    rmSync(join(fleet.device.home, "STOP"));
    expect((await say(fleet, fleet.device, first, "anyone?")).stderr).toContain("stop_file");
    expect((await say(fleet, fleet.device, second, "anyone?")).stderr).toContain("stop_file");
    expect(chatPosts(fleet)).toBe(posts);
    for (const id of [first, second]) expect((await leaseOf(fleet.device, id)).state).toBe("void: stop_file");
    const voids = (await auditOf(fleet.device)).filter((entry) => entry.act === "room.lease.void");
    expect(voids.map((entry) => [entry.subject, JSON.parse(entry.bytes).reason]).sort()).toEqual([[first, "stop_file"], [second, "stop_file"]].sort());
    // No lease is made while STOP is there.
    writeFileSync(join(fleet.device.home, "STOP"), "");
    fleet.device.answers.push("yes");
    expect((await fleet.device.run("room", "lease", fleet.roomId, "--any-seat")).stderr).toContain("lease_stopped");
    fleet.device.answers.length = 0;
  });

  test("any CLI command that runs while STOP exists records the voids", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    writeFileSync(join(fleet.device.home, "STOP"), "");
    expect((await json(fleet.device.run("room", "lease", "list", "--all", "--json"))).leases[0].state).toBe("void: stop_file");
    rmSync(join(fleet.device.home, "STOP"));
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("void: stop_file");
  });

  test("the hub's emergency stop voids the host desk's leases", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.hub, fleet.roomId);
    await fleet.hub.yes("hub", "stop");
    const refused = await headless(fleet.world, fleet.hub, ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", "after-stop", "--text", "hello?"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("hub_stopped");
    expect((await leaseOf(fleet.hub, leaseId)).state).toBe("void: hub_stopped");
  });

  for (const removal of ["kick", "block"] as const) {
    test(`a ${removal} voids the member's lease on its first read, with no POST`, async () => {
      const fleet = await seatedFleet();
      const leaseId = await lease(fleet.device, fleet.roomId);
      await ok(fleet.hub.yes("hub", removal, fleet.roomId, deskOf(fleet.device).identity_id));
      const posts = chatPosts(fleet);
      const refused = await say(fleet, fleet.device, leaseId, "let me back in");
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("grant_refused");
      expect(chatPosts(fleet)).toBe(posts);
      expect((await leaseOf(fleet.device, leaseId)).state).toBe("void: grant_refused");
    });
  }

  test("a newer roster listing this desk as a spectator voids the lease", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    sql(fleet.hub, "UPDATE hub_members SET tier = 'spectator' WHERE identity_id = $id", { $id: deskOf(fleet.device).identity_id });
    await ok(fleet.hub.yes("hub", "roster", "post", fleet.roomId));
    const refused = await say(fleet, fleet.device, leaseId, "still a player?");
    expect(refused.stderr).toContain("tier_narrowed");
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("void: tier_narrowed");
  });

  test("a roster without this desk voids the lease", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    sql(fleet.hub, "UPDATE hub_members SET state = 'left' WHERE identity_id = $id", { $id: deskOf(fleet.device).identity_id });
    await ok(fleet.hub.yes("hub", "roster", "post", fleet.roomId));
    expect((await say(fleet, fleet.device, leaseId, "hello")).stderr).toContain("not_on_roster");
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("void: not_on_roster");
  });

  test("a closed card voids the member's lease", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    const hostLease = await lease(fleet.hub, fleet.roomId);
    await ok(fleet.hub.run("room", "set-status", fleet.roomId, "closed"));
    await ok(fleet.hub.yes("room", "publish", fleet.roomId));
    expect((await say(fleet, fleet.device, leaseId, "closing time")).stderr).toContain("room_closed");
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("void: room_closed");
    // The host's own lease voids on its local room's status.
    expect((await headless(fleet.world, fleet.hub, ["room", "say", fleet.roomId, "--lease", hostLease, "--idempotency-key", "closed-01", "--text", "hi"])).stderr)
      .toContain("room_closed");
  });

  test("a new season voids the member's lease", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    await ok(fleet.hub.yes("hub", "season", "open", fleet.roomId));
    await ok(fleet.hub.yes("room", "publish", fleet.roomId));
    expect((await say(fleet, fleet.device, leaseId, "new season?")).stderr).toContain("season_changed");
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("void: season_changed");
  });

  test("a room narrowed to the device voids the host's lease", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.hub, fleet.roomId);
    await ok(fleet.hub.yes("room", "promote", fleet.roomId, "--residency", "device", "--hostable", "false"));
    const refused = await headless(fleet.world, fleet.hub, ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", "narrow-01", "--text", "still here"]);
    expect(refused.stderr).toContain("room_narrowed");
    expect((await leaseOf(fleet.hub, leaseId)).state).toBe("void: room_narrowed");
  });

  test("this desk leaving the grant voids the lease", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    await ok(fleet.device.yes("room", "leave", fleet.roomId));
    expect((await say(fleet, fleet.device, leaseId, "bye")).stderr).toContain("grant_left");
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("void: grant_left");
  });
});

describe("the egress gate on every lease send", () => {
  const LEAKS: Array<[string, string]> = [
    ["this machine's name inside Chinese", "我在example-lab-desk上"],
    ["this machine's name before Japanese", "example-lab-deskで作業中"],
    ["this machine's name before Korean", "example-lab-desk에서 보냄"],
    ["this machine's name inside Thai", "ส่งจากexample-lab-deskครับ"],
    ["a device model inside Chinese", "我在Mac mini上"],
    ["a LAN address", "the dashboard is at 192.168.50.20"],
    ["a home path", "notes are in /Users/example/notes.md"],
    ["a mission token", `token atcm_${"A1b2".repeat(10)}abc`],
    ["device-only work", "the Bet Angel results look good"],
  ];
  for (const [label, text] of LEAKS) {
    test(`naming ${label} is refused, saved nowhere and counted`, async () => {
      const fleet = await seatedFleet();
      const leaseId = await lease(fleet.device, fleet.roomId);
      const posts = chatPosts(fleet);
      const audit = (await auditOf(fleet.device)).length;
      const refused = await say(fleet, fleet.device, leaseId, text);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("egress_refused");
      expect(chatPosts(fleet)).toBe(posts);
      expect(await auditOf(fleet.device)).toHaveLength(audit);
      expect((await json(fleet.device.run("outbox", "list", "--json"))).outbox.filter((row: any) => row.kind === "chat")).toEqual([]);
      expect(await leaseOf(fleet.device, leaseId)).toMatchObject({ state: "active", gate_refusals: 1, sent_messages: 0 });
    });
  }

  test("five refusals void the lease", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    for (let attempt = 1; attempt <= 4; attempt += 1) expect((await say(fleet, fleet.device, leaseId, "我在example-lab-desk上")).stderr).toContain("egress_refused");
    const fifth = await say(fleet, fleet.device, leaseId, "example-lab-desk에서");
    expect(fifth.stderr).toContain("gate_refusals");
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("void: gate_refusals");
    expect((await say(fleet, fleet.device, leaseId, "harmless now")).stderr).toContain("lease_void");
  });
});

describe("idempotency, uncertainty and races", () => {
  test("the same key and message is reported again with no request; another message under the same key is refused", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    const argv = (text: string) => ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", "reply-0001", "--text", text, "--json"];
    const first = JSON.parse((await ok(headless(fleet.world, fleet.device, argv("once only")))).stdout);
    const seen = fleet.world.hosted.seen.length;
    const again = JSON.parse((await ok(headless(fleet.world, fleet.device, argv("once only")))).stdout);
    expect(fleet.world.hosted.seen).toHaveLength(seen);
    expect(again).toMatchObject({ status: "stored", replayed: true, event_id: first.event_id, received_seq: first.received_seq, lease: { sent_messages: 1 } });
    const reused = await headless(fleet.world, fleet.device, argv("something else"));
    expect(reused.code).toBe(1);
    expect(reused.stderr).toContain("idempotency_key_reused");
  });

  test("a lost response stays pending, counts, is never resent, and outbox retry at a terminal settles it", async () => {
    const fleet = await seatedFleet();
    const hosted = fleet.world.hosted;
    const leaseId = await lease(fleet.device, fleet.roomId, "--messages", "3");
    hosted.loseResponse = (request) => request.method === "POST" && request.path === `/v1/collaboration/missions/${fleet.seasonId}/events`;
    const argv = ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", "lost-0001", "--text", "did this arrive", "--json"];
    const lost = await headless(fleet.world, fleet.device, argv);
    expect(lost.code).toBe(1);
    const pending = JSON.parse(lost.stdout);
    expect(pending).toMatchObject({ ok: false, status: "pending", lease: { sent_messages: 1 } });
    expect(pending.next).toBe(`a person runs: agenttool-lobby outbox retry ${pending.event_id}`);
    const stored = hosted.summaries(fleet.seasonId).length;
    const posts = chatPosts(fleet);
    const rerun = await headless(fleet.world, fleet.device, argv);
    expect(rerun.code).toBe(1);
    expect(rerun.stderr).toContain("lease_send_uncertain");
    expect(chatPosts(fleet)).toBe(posts);
    // A person settles it; the service returns the original receipt.
    await ok(fleet.device.yes("outbox", "retry", pending.event_id));
    expect(hosted.summaries(fleet.seasonId)).toHaveLength(stored);
    const replay = JSON.parse((await ok(headless(fleet.world, fleet.device, argv))).stdout);
    expect(replay).toMatchObject({ status: "stored", replayed: true, event_id: pending.event_id });
    expect((await leaseOf(fleet.device, leaseId)).sent_messages).toBe(1);
  });

  test("a definite refusal of the POST voids the lease", async () => {
    const fleet = await seatedFleet();
    const hosted = fleet.world.hosted;
    const leaseId = await lease(fleet.device, fleet.roomId);
    hosted.intercept = (request, process) => {
      if (request.method !== "POST" || !request.path.endsWith("/events")) return process();
      hosted.intercept = null;
      return new Response(JSON.stringify({ error: "collaboration_mission_invalid_credential" }), { status: 401, headers: { "Content-Type": "application/json" } });
    };
    const refused = await say(fleet, fleet.device, leaseId, "refused at the door");
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({ status: "pending", voided: "grant_refused" });
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("void: grant_refused");
  });

  test("an uncertain re-check read uses no budget and voids nothing", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    fleet.world.hosted.failNext = (request) => request.method === "GET";
    const refused = await say(fleet, fleet.device, leaseId, "hello");
    expect(refused.stderr).toContain("lease_recheck_uncertain");
    expect(await leaseOf(fleet.device, leaseId)).toMatchObject({ state: "active", sent_messages: 0 });
  });

  test("a STOP file or the lease's end arriving just before the reservation sends nothing and spends nothing", async () => {
    const fleet = await seatedFleet();
    const posts = chatPosts(fleet);
    const stopped = await lease(fleet.device, fleet.roomId);
    const raced = await sendRacing(fleet, fleet.device, stopped, "race-stop-01", "just in time", () => writeFileSync(join(fleet.device.home, "STOP"), ""));
    expect(raced.error?.code).toBe("lease_stopped");
    expect(await leaseOf(fleet.device, stopped)).toMatchObject({ sent_messages: 0 });
    rmSync(join(fleet.device.home, "STOP"));
    // A fresh fleet, so the STOP above has voided nothing this half uses.
    const other = await seatedFleet();
    const ending = await lease(other.device, other.roomId, "--minutes", "60");
    const otherPosts = chatPosts(other);
    const late = await sendRacing(other, other.device, ending, "race-end-001", "just in time", () => other.world.advance(61 * 60_000));
    expect(late.error?.code).toBe("lease_expired");
    expect([chatPosts(fleet), chatPosts(other)]).toEqual([posts, otherPosts]);
    expect(await leaseOf(other.device, ending)).toMatchObject({ sent_messages: 0, sends: { stored: 0, pending: 0 } });
    expect((await auditOf(other.device)).some((entry) => entry.act === "room.say.lease")).toBe(false);
  });

  test("a room that narrows after the checks refuses at send time: nothing leaves, the lease is void, and a replay says refused", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.hub, fleet.roomId);
    const posts = chatPosts(fleet);
    const narrow = (ctx: FleetContext) => {
      ctx.store.applyPromotion(ctx.store.planPromotion(fleet.roomId, { residency: "device", hostable: false }, ctx.now()));
    };
    const refused = await sendRacing(fleet, fleet.hub, leaseId, "narrow-0001", "about to stay home", narrow);
    expect(refused.error).toMatchObject({ code: "lease_void", details: { reason: "room_narrowed" } });
    expect(chatPosts(fleet)).toBe(posts);
    expect((await leaseOf(fleet.hub, leaseId)).state).toBe("void: room_narrowed");
    const voids = (await auditOf(fleet.hub)).filter((entry) => entry.act === "room.lease.void").map((entry) => JSON.parse(entry.bytes));
    const reserved = (await auditOf(fleet.hub)).find((entry) => entry.act === "room.say.lease")!;
    expect(voids).toMatchObject([{ reason: "room_narrowed", refused_event_id: JSON.parse(reserved.bytes).event_id }]);
    // The same key again reports the refusal, not a send that may be stored.
    const replay = await headless(fleet.world, fleet.hub, ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", "narrow-0001",
      "--text", "about to stay home", "--json"]);
    expect(replay.code).toBe(1);
    expect(JSON.parse(replay.stdout)).toMatchObject({ ok: false, error: "lease_send_refused" });
    expect(replay.stderr).not.toContain("may already be stored");
    expect(chatPosts(fleet)).toBe(posts);
  });

  test("two sends racing for the last slot: exactly one is reserved and sent", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId, "--messages", "1");
    const posts = chatPosts(fleet);
    const results = await Promise.all([say(fleet, fleet.device, leaseId, "me first"), say(fleet, fleet.device, leaseId, "no, me")]);
    expect(results.map((result) => result.code).sort()).toEqual([0, 1]);
    const loser = results.find((result) => result.code === 1)!;
    expect(loser.stderr).toMatch(/lease_changed|lease_budget_exhausted/);
    expect(chatPosts(fleet)).toBe(posts + 1);
    expect(await leaseOf(fleet.device, leaseId)).toMatchObject({ sent_messages: 1, sends: { stored: 1, pending: 0 } });
  });
});

describe("what the hub's digest shows", () => {
  test("a Seat leases section and the lease acts, with sends counted rather than listed", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.hub, fleet.roomId, "--seat-ref", "codex:dddddddd-4444-4444-8444-444444444444");
    expect((await headless(fleet.world, fleet.hub, ["room", "say", fleet.roomId, "--lease", leaseId, "--idempotency-key", "digest-01", "--text", "hi"],
      { env: { CODEX_THREAD_ID: "dddddddd-4444-4444-8444-444444444444" } })).code).toBe(0);
    const out = join(fleet.hub.parent, "digest.md");
    await ok(fleet.hub.run("hub", "digest", "--out", out));
    const text = readFileSync(out, "utf8");
    expect(text).toContain("## Seat leases on this desk");
    expect(text).toContain("a desk's move to the successor directory ends it (`void: directory_moved`), never carrying it into the successor's grant");
    expect(text).toContain(`| ${leaseId} | ${fleet.roomId} | codex:dddddddd-4444-4444-8444-444444444444 |`);
    expect(text).toContain("| active |");
    expect(text).toMatch(/\| room\.lease \| lease_/);
    expect(text).toContain("1 send(s) under leases (room.say.lease)");
    expect(text).not.toMatch(/\| room\.say\.lease \|/);
  });
});

describe("leases beside directory renewal (schema 4, #535)", () => {
  const HOUR = 3_600_000;

  test("fleet renew and the sweep renew the directory grant; a member's lease keeps its bound grant and still sends", async () => {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    const before = await leaseOf(fleet.device, leaseId);
    const bound = before.directory_grant_id as string;
    expect(bound).toBeString();
    fleet.world.advance(HOUR);
    await ok(fleet.device.yes("fleet", "renew"));
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    await ok(fleet.device.yes("fleet", "renew"));
    const status = await json(fleet.device.run("fleet", "status", "--json"));
    const directories = status.grants.filter((grant: any) => grant.purpose === "directory").map((grant: any) => grant.grant_id);
    expect(directories).toHaveLength(2);
    expect(directories).toContain(bound);
    expect(Date.parse(status.directory.grant_expires_at)).toBeGreaterThan(Date.parse(before.expires_at));
    // The renewal neither moves nor extends the lease.
    const after = await leaseOf(fleet.device, leaseId);
    expect([after.directory_grant_id, after.expires_at, after.ends_by, after.state]).toEqual([bound, before.expires_at, before.ends_by, "active"]);
    const sent = await say(fleet, fleet.device, leaseId, "after the directory renewal");
    expect(sent.code).toBe(0);
    expect(JSON.parse(sent.stdout).grant_id).toBe(before.grant_id);
    // The renewal's own acts went through the terminal; the lease made none of them.
    const acts = (await auditOf(fleet.device)).map((entry) => entry.act);
    expect(acts.filter((act) => act === "fleet.renew")).toHaveLength(2);
    expect(acts.filter((act) => act.startsWith("room.say"))).toEqual(["room.say.lease"]);
  });

  test("a lease made late in a directory grant's day ends with that grant, and a renewal does not carry it on", async () => {
    const fleet = await seatedFleet();
    const status = await json(fleet.device.run("fleet", "status", "--json"));
    const directory = status.grants.find((grant: any) => grant.purpose === "directory");
    // Renew the season grant first, hours in, so the directory grant is the
    // first grant to end and its bound, not the season grant's, ends the lease.
    fleet.world.advance(4 * HOUR);
    await ok(fleet.device.yes("room", "renew", "request", fleet.roomId));
    await ok(fleet.hub.yes("hub", "renew-sweep", "--room", fleet.roomId));
    await ok(fleet.device.yes("room", "renew", "accept", fleet.roomId));
    const seasons = (await json(fleet.device.run("fleet", "status", "--json"))).grants.filter((grant: any) => grant.purpose === "season");
    expect(Math.max(...seasons.map((grant: any) => Date.parse(grant.expires_at)))).toBeGreaterThan(Date.parse(directory.expires_at));
    // Two hours before the directory grant ends, so it, not the 8 hours, ends the lease.
    fleet.world.advance(Date.parse(directory.expires_at) - fleet.world.clock.now.getTime() - 2 * HOUR);
    const leaseId = await lease(fleet.device, fleet.roomId);
    const made = await leaseOf(fleet.device, leaseId);
    expect(made.directory_grant_id).toBe(directory.grant_id);
    expect(made.ends_by).toBe("directory_grant");
    expect(Date.parse(made.expires_at)).toBe(Date.parse(directory.expires_at) - 60_000);
    await ok(fleet.device.yes("fleet", "renew"));
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    await ok(fleet.device.yes("fleet", "renew"));
    const renewed = (await json(fleet.device.run("fleet", "status", "--json"))).grants
      .filter((grant: any) => grant.purpose === "directory" && grant.grant_id !== directory.grant_id);
    expect(renewed).toHaveLength(1);
    expect(Date.parse(renewed[0].expires_at)).toBeGreaterThan(Date.parse(directory.expires_at));
    const after = await leaseOf(fleet.device, leaseId);
    expect([after.directory_grant_id, after.expires_at, after.ends_by]).toEqual([made.directory_grant_id, made.expires_at, made.ends_by]);
    expect((await say(fleet, fleet.device, leaseId, "still inside the old grant")).code).toBe(0);
    fleet.world.advance(Date.parse(made.expires_at) - fleet.world.clock.now.getTime());
    expect((await say(fleet, fleet.device, leaseId, "past the old grant")).stderr).toContain("lease_expired");
    expect((await leaseOf(fleet.device, leaseId)).state).toBe("expired");
  });

  test("a STOP file voids leases only: fleet renew and the sweep still run, and the hub's digest shows renewal, device and lease acts", async () => {
    const fleet = await seatedFleet();
    const hubLease = await lease(fleet.hub, fleet.roomId, "--seat-ref", "codex:eeeeeeee-5555-4555-8555-555555555555");
    const deviceLease = await lease(fleet.device, fleet.roomId);
    fleet.world.advance(HOUR);
    writeFileSync(join(fleet.device.home, "STOP"), "");
    await ok(fleet.device.yes("fleet", "renew"));
    expect((await leaseOf(fleet.device, deviceLease)).state).toBe("void: stop_file");
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    await ok(fleet.device.yes("fleet", "renew"));
    const directories = (await json(fleet.device.run("fleet", "status", "--json"))).grants.filter((grant: any) => grant.purpose === "directory");
    expect(directories).toHaveLength(2);
    // The device's STOP touches neither the hub's lease nor the device's renewal.
    expect((await leaseOf(fleet.hub, hubLease)).state).toBe("active");
    expect((await headless(fleet.world, fleet.hub, ["room", "say", fleet.roomId, "--lease", hubLease, "--idempotency-key", "beside-renew-01", "--text", "hi"],
      { env: { CODEX_THREAD_ID: "eeeeeeee-5555-4555-8555-555555555555" } })).code).toBe(0);
    // #535's device pause and resume are hub access acts the digest lists too.
    const identity = deskOf(fleet.device).identity_id;
    await ok(fleet.hub.yes("hub", "device", "pause", identity));
    await ok(fleet.hub.yes("hub", "device", "resume", identity));
    const out = join(fleet.hub.parent, "digest-both.md");
    await ok(fleet.hub.run("hub", "digest", "--out", out));
    const text = readFileSync(out, "utf8");
    expect(text).toContain(`renewed the directory grant of`);
    expect(text).toMatch(/\| hub\.renew\.sweep \|/);
    expect(text).toMatch(/\| hub\.device\.pause \|/);
    expect(text).toMatch(/\| hub\.device\.resume \|/);
    expect(text).toContain("## Seat leases on this desk");
    expect(text).toContain(`| ${hubLease} | ${fleet.roomId} | codex:eeeeeeee-5555-4555-8555-555555555555 |`);
    expect(text).toContain("1 send(s) under leases (room.say.lease)");
    expect(text).not.toContain(deviceLease);
  });
});

describe("leases beside directory rollover (schema 6, #541)", () => {
  const HOUR = 3_600_000;

  /** A seated member with a lease, then the hub's successor, announced and
   * asked for: the next `fleet renew` moves the desk. */
  async function rolledWithLease(): Promise<{ fleet: Fleet & { knockId: string }; leaseId: string; made: any; directoryId: string; successorId: string }> {
    const fleet = await seatedFleet();
    const leaseId = await lease(fleet.device, fleet.roomId);
    const made = await leaseOf(fleet.device, leaseId);
    const directoryId = (await json(fleet.device.run("fleet", "status", "--json"))).desk.directory_mission_id as string;
    fleet.world.advance(HOUR);
    await ok(fleet.hub.yes("hub", "directory", "successor", "--days", "30"));
    const successorId = (await json(fleet.hub.run("hub", "show", "--json"))).directory.mission_id as string;
    await ok(fleet.device.run("fleet", "sync"));
    await ok(fleet.device.yes("fleet", "renew"));
    await ok(fleet.hub.yes("hub", "renew-sweep"));
    return { fleet, leaseId, made, directoryId, successorId };
  }

  test("a move to the successor ends a member's lease: never carried into the successor's grant, and a new lease binds the new one", async () => {
    const { fleet, leaseId, made, directoryId, successorId } = await rolledWithLease();
    const { device } = fleet;
    // Before the move the lease still sends, under its bound grants.
    expect((await say(fleet, device, leaseId, "before the move")).code).toBe(0);
    expect((await leaseOf(device, leaseId)).state).toBe("active");
    const posts = chatPosts(fleet);
    await ok(device.yes("fleet", "renew"));
    expect(device.terminal.written.join("")).toContain(`the move ends 1 room seat lease(s) bound to this desk's directory grant in ${directoryId}`);
    const status = await json(device.run("fleet", "status", "--json"));
    expect(status.desk.directory_mission_id).toBe(successorId);
    // The lease keeps its record, binding and end, and is void: it ends with the move, before the grant it binds.
    const after = await leaseOf(device, leaseId);
    expect([after.directory_grant_id, after.expires_at, after.ends_by, after.state])
      .toEqual([made.directory_grant_id, made.expires_at, made.ends_by, "void: directory_moved"]);
    const bound = status.grants.find((grant: any) => grant.grant_id === made.directory_grant_id);
    expect(bound.mission_id).toBe(directoryId);
    expect(Date.parse(after.voided_at)).toBeLessThan(Date.parse(bound.expires_at));
    const acts = await auditOf(device);
    // The move's own act records the void, between its confirmation and its outcome.
    const names = acts.map((entry) => entry.act);
    const voids = acts.filter((entry) => entry.act === "room.lease.void");
    expect(voids.map((entry) => JSON.parse(entry.bytes))).toEqual([expect.objectContaining({ lease_id: leaseId, reason: "directory_moved" })]);
    expect(names.slice(names.lastIndexOf("fleet.renew"))).toEqual(["fleet.renew", "room.lease.void", "fleet.renew.outcome"]);
    const refused = await say(fleet, device, leaseId, "after the move");
    expect(refused.code).not.toBe(0);
    expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, error: "lease_void" });
    expect(refused.stderr).toContain("directory_moved");
    expect(chatPosts(fleet)).toBe(posts);
    // A person makes a new lease at the terminal: it binds the successor's grant.
    const next = await lease(device, fleet.roomId);
    const remade = await leaseOf(device, next);
    expect(status.grants.find((grant: any) => grant.grant_id === remade.directory_grant_id)?.mission_id).toBe(successorId);
    expect(remade.state).toBe("active");
    expect((await say(fleet, device, next, "under the new lease")).code).toBe(0);
  });

  test("a fallback join into the successor ends the lease in the join's own act", async () => {
    const fleet = await seatedFleet();
    const { hub, device, world } = fleet;
    const leaseId = await lease(device, fleet.roomId);
    const directoryId = (await json(device.run("fleet", "status", "--json"))).desk.directory_mission_id as string;
    world.advance(HOUR);
    await ok(hub.yes("hub", "directory", "successor", "--days", "30"));
    await ok(device.run("fleet", "sync"));
    const enrolled = await ok(device.run("enroll-device"));
    const relayed = await ok(hub.yes(...relayArgs(device, enrolled)));
    await ok(device.yes("fleet", "join", "--packet-file", device.file("join-moved.json", relayed.stdout), "--door-fingerprint", fleet.doorFingerprint));
    expect(device.terminal.written.join("")).toContain(`the move ends 1 room seat lease(s) bound to this desk's directory grant in ${directoryId}`);
    // Recorded by the join itself, before any other command runs.
    const store = LobbyStore.open(device.home);
    expect(store.fleet.desk()!.directory_mission_id).not.toBe(directoryId);
    expect(store.fleet.lease(leaseId)).toMatchObject({ void_reason: "directory_moved", revoked_at: null });
    store.close();
  });

  /** Point the desk at the successor by hand, as another process's move
   * would, without that move's own voids. */
  function moveByHand(fleet: Fleet, directoryId: string, successorId: string, store?: LobbyStore): void {
    const mission = fleet.world.hosted.missions.get(successorId)!;
    const own = store ?? LobbyStore.open(fleet.device.home);
    own.fleet.moveDeskDirectory({ mission_id: successorId, mission_digest: fleet.world.hosted.missionView(mission).mission_digest,
      expires_at: mission.expires_at, predecessor_mission_id: directoryId, how: "successor", at: fleet.world.clock.now.toISOString() });
    if (store === undefined) own.close();
  }

  test("sent after another process moved the desk: void (directory_moved) before any read, nothing sent", async () => {
    const { fleet, leaseId, directoryId, successorId } = await rolledWithLease();
    moveByHand(fleet, directoryId, successorId);
    const reads = fleet.world.hosted.seen.length;
    const raced = await sendRacing(fleet, fleet.device, leaseId, "moved-before-01", "after a move elsewhere", () => {});
    expect(raced.error?.code).toBe("lease_void");
    expect(raced.error?.details.reason).toBe("directory_moved");
    expect(fleet.world.hosted.seen.length).toBe(reads);
    expect(await leaseOf(fleet.device, leaseId)).toMatchObject({ state: "void: directory_moved", sent_messages: 0 });
  });

  test("a move between the checks and the reservation sends nothing and spends nothing", async () => {
    const { fleet, leaseId, directoryId, successorId } = await rolledWithLease();
    const posts = chatPosts(fleet);
    const raced = await sendRacing(fleet, fleet.device, leaseId, "moved-racing-01", "racing a move", (ctx) => {
      moveByHand(fleet, directoryId, successorId, ctx.store);
    });
    expect(raced.error?.code).toBe("directory_changed");
    expect(chatPosts(fleet)).toBe(posts);
    const after = await leaseOf(fleet.device, leaseId);
    expect([after.sent_messages, after.state]).toEqual([0, "void: directory_moved"]);
    expect((await auditOf(fleet.device)).map((entry) => entry.act)).not.toContain("room.say.lease");
  });

  test("a move while the lease prompt is open writes no lease (directory_changed)", async () => {
    const { fleet } = await rolledWithLease();
    const { device, world } = fleet;
    const other = world.desk("device-other", { of: device });
    const result = await runWhilePromptOpen(world, device, ["room", "lease", fleet.roomId, "--seat-ref", SEAT_A], async () => {
      await ok(other.yes("fleet", "renew"));
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("directory_changed");
    const leases = (await json(device.run("room", "lease", "list", "--all", "--json"))).leases;
    expect(leases.map((row: any) => [row.seat_ref, row.state])).toEqual([[null, "void: directory_moved"]]);
  });
});

describe("boundaries", () => {
  test("the seat ref is #491's default derivation, lower-cased, with no override variable", () => {
    expect(defaultSeatRef({ CLAUDE_CODE_SESSION_ID: SESSION_A, CODEX_THREAD_ID: SESSION_B })).toBe(SEAT_A);
    expect(defaultSeatRef({ CODEX_THREAD_ID: SESSION_B.toUpperCase() })).toBe(`codex:${SESSION_B}`);
    expect(defaultSeatRef({ CLAUDE_CODE_SESSION_ID: "not-a-uuid" })).toBeNull();
    expect(defaultSeatRef({ AGENTOOL_COLLAB_SEAT_REF: "claude-code:x", AGENTTOOL_COLLAB_SEAT_REF: "y" })).toBeNull();
    expect(defaultSeatRef({})).toBeNull();
  });

  test("the read-only MCP server's import graph does not reach the lease code", () => {
    const seen = new Set<string>();
    const pending = ["bin/agenttool-lobby-mcp.ts"];
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(join(packageRoot, file), "utf8");
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
        pending.push(join(file, "..", match[1]!.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.has("src/lease.ts")).toBe(false);
    expect(seen.has("src/seat-ref.ts")).toBe(false);
    expect(seen.has("src/mcp.ts")).toBe(true);
  });

  test("no lease path reads the Keychain or checks for a terminal", () => {
    const source = readFileSync(join(packageRoot, "src", "lease.ts"), "utf8");
    expect(source).not.toMatch(/requireKeychain|ctx\.keychain|hasTerminal|requireTerminal|confirmOnTty/);
  });
});
