/** Guild rooms: who can bring a writer in, and joining twice.
 *
 *  A closed-door room is joined only through its founder's invitation
 *  (docs/SCRIPT-WRITERS-GUILD.md, and the open_door comment in migration
 *  20260518T080000_script_writers_guild.sql). In an open-door room anyone
 *  may walk in, so members may invite too. The rule is checked when the
 *  invitation is sent and again when it is accepted, against the room as it
 *  is then. Joining a room you are already in changes nothing.
 *
 *  Before (issue #481): any writer could send a join_room invitation for
 *  any room, and accepting it added the invitee even to a closed-door or
 *  closed room. Two overlapping open-door joins could add one writer twice.
 *
 *  Hermetic: the real guild router, real ed25519 signatures, and a pg-proxy
 *  store that applies exactly the conditions each SQL statement states and
 *  models Postgres row locks for SELECT ... FOR UPDATE. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import {
  canonicalInvitationBytes,
  canonicalInvitationResponseBytes,
  canonicalRoomJoinBytes,
} from "../src/services/guild/sig";

// ─── writers ─────────────────────────────────────────────────────────

type Writer = {
  project: string;
  identity: string;
  did: string;
  key: string;
  publicKey: string;
  privateKey: KeyObject;
};

function writer(n: number): Writer {
  const hex = String(n).repeat(8).slice(0, 8);
  const identity = `${hex}-1111-4111-8111-111111111111`;
  const pair = generateKeyPairSync("ed25519");
  return {
    project: `${hex}-2222-4222-8222-222222222222`,
    identity,
    did: `did:at:${identity}`,
    key: `${hex}-3333-4333-8333-333333333333`,
    publicKey: pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64"),
    privateKey: pair.privateKey,
  };
}

const FOUNDER = writer(1);
const MEMBER = writer(2);
const STRANGER = writer(3);
const GUEST = writer(4);
const WRITERS = [FOUNDER, MEMBER, STRANGER, GUEST];

const CLOSED_DOOR = "aaaaaaaa-0000-4000-8000-000000000001";
const OPEN_DOOR = "aaaaaaaa-0000-4000-8000-000000000002";
const SHUT = "aaaaaaaa-0000-4000-8000-000000000003";
const MISSING = "aaaaaaaa-0000-4000-8000-0000000000ff";

// ─── a small store that does what the SQL says ───────────────────────

type Row = Record<string, unknown>;
type Table = "guild_rooms" | "guild_invitations";
let tables: Record<Table, Map<string, Row>>;
let statements: { sql: string; inTransaction: boolean }[];
/** Hold plain reads of one table until `count` of them have arrived, so two
 *  requests both read before either writes (an overlapping race). */
let readBarrier: { table: Table; count: number; waiting: (() => void)[] } | null;
const rowLocks = new Map<string, Promise<void>>();

type TxContext = { undo: (() => void)[]; release: (() => void)[] };

function room(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    name: `room ${id.slice(-2)}`,
    charter_text: "We write slow philosophy soap-opera, one scene a week.",
    founder_did: FOUNDER.did,
    founder_signature: "c2ln",
    founder_signing_key_id: FOUNDER.key,
    open_door: false,
    member_dids: [FOUNDER.did, MEMBER.did],
    created_at: "2026-10-01T00:00:00.000Z",
    closed_at: null,
    ...over,
  };
}

function invitation(over: Partial<Row>): Row {
  return {
    id: randomUUID(),
    inviter_did: FOUNDER.did,
    invitee_did: GUEST.did,
    intent: "join_room",
    subject_ref: `room:${CLOSED_DOOR}`,
    charter_text: "Come write the winter arc with us.",
    inviter_signature: "c2ln",
    inviter_signing_key_id: FOUNDER.key,
    status: "pending",
    response_decision: null,
    invitee_signature: null,
    invitee_signing_key_id: null,
    responded_at: null,
    response_note: null,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    expires_at: new Date(Date.now() + 29 * 86_400_000).toISOString(),
    ...over,
  };
}

function seed(): void {
  tables = {
    guild_rooms: new Map([
      [CLOSED_DOOR, room(CLOSED_DOOR)],
      [OPEN_DOOR, room(OPEN_DOOR, { open_door: true })],
      [SHUT, room(SHUT, { closed_at: "2026-10-10T00:00:00.000Z" })],
    ]),
    guild_invitations: new Map(),
  };
}

function lastIdentifier(item: string): string {
  const match = item.trim().match(/"(\w+)"$/);
  if (!match) throw new Error(`unsupported column item: ${item}`);
  return match[1]!;
}

function columnList(list: string): string[] {
  return list.split(",").map(lastIdentifier);
}

/** Evaluate a WHERE clause made of AND-ed simple conditions. Anything this
 *  store does not understand throws, so no condition is silently ignored. */
function matcher(where: string | undefined, params: unknown[]): (row: Row) => boolean {
  if (!where) return () => true;
  const checks: ((row: Row) => boolean)[] = [];
  let rest = where;
  const take = (re: RegExp, make: (m: RegExpMatchArray) => (row: Row) => boolean) => {
    rest = rest.replace(re, (...args) => {
      checks.push(make(args as unknown as RegExpMatchArray));
      return " ";
    });
  };
  const param = (n: string) => params[Number(n) - 1];
  take(/not \(\$(\d+) = any\((?:"\w+"\.)*"(\w+)"\)\)/gi, (m) => (row) =>
    !(row[m[2]!] as unknown[]).includes(param(m[1]!)));
  take(/\$(\d+) = any\((?:"\w+"\.)*"(\w+)"\)/gi, (m) => (row) =>
    (row[m[2]!] as unknown[]).includes(param(m[1]!)));
  take(/(?:"\w+"\.)*"(\w+)" is not null/g, (m) => (row) => row[m[1]!] != null);
  take(/(?:"\w+"\.)*"(\w+)" is null/g, (m) => (row) => row[m[1]!] == null);
  take(/(?:"\w+"\.)*"(\w+)" = \$(\d+)/g, (m) => (row) => row[m[1]!] === param(m[2]!));
  take(/(?:"\w+"\.)*"(\w+)" > now\(\)/g, (m) => (row) => Date.parse(String(row[m[1]!])) > Date.now());
  if (rest.replace(/\band\b|[()\s]/g, "") !== "") {
    throw new Error(`unsupported WHERE in fake store: ${where}`);
  }
  return (row) => checks.every((check) => check(row));
}

async function lockRow(key: string, tx: TxContext | null): Promise<void> {
  if (!tx) return; // autocommit: the lock ends with the statement
  while (rowLocks.has(key)) await rowLocks.get(key);
  let release!: () => void;
  rowLocks.set(key, new Promise<void>((resolve) => { release = resolve; }));
  tx.release.push(() => {
    rowLocks.delete(key);
    release();
  });
}

async function passBarrier(table: Table): Promise<void> {
  const barrier = readBarrier;
  if (!barrier || barrier.table !== table || barrier.count <= 0) return;
  barrier.count -= 1;
  if (barrier.count === 0) {
    for (const go of barrier.waiting) go();
    readBarrier = null;
    return;
  }
  await new Promise<void>((resolve) => {
    barrier.waiting.push(resolve);
    setTimeout(resolve, 250); // never deadlock a request that reads once
  });
}

function project(row: Row, columns: string[]): unknown[] {
  return columns.map((column) => row[column] ?? null);
}

function identityRow(w: Writer): unknown[] {
  return [w.identity, w.did, "Writer", "active", "2026-07-02T00:00:00.000Z", {}, "llm", 0, true, null, null];
}

async function handle(sql: string, params: unknown[], tx: TxContext | null) {
  statements.push({ sql, inTransaction: tx !== null });

  // resolveActingIdentity: the project's primary identity.
  if (sql.includes('"quiet_reason" from "identity"."identities"')) {
    const w = WRITERS.find((candidate) => params.includes(candidate.project));
    return { rows: w ? [identityRow(w)] : [] };
  }
  // resolveIdentitySigningKey.
  if (sql.includes('from "identity"."identity_keys"')) {
    const w = WRITERS.find((candidate) => candidate.key === params[0]);
    return { rows: w ? [[w.key, w.identity, w.publicKey, true, null, w.did, w.project, "active"]] : [] };
  }

  let m = sql.match(/^select (.+?) from "agent_continuity"\."(guild_\w+)"(?: where (.+?))?(?: order by .+?)?(?: limit \$\d+)?( for update)?$/s);
  if (m) {
    const table = m[2] as Table;
    const columns = columnList(m[1]!);
    const where = matcher(m[3], params);
    if (m[4]) {
      for (const row of tables[table].values()) if (where(row)) await lockRow(`${table}:${row.id}`, tx);
    } else {
      await passBarrier(table);
    }
    const rows = [...tables[table].values()].filter(where).map((row) => project(row, columns));
    return { rows };
  }

  m = sql.match(/^update "agent_continuity"\."(guild_\w+)" set (.+?) where (.+?)(?: returning (.+))?$/s);
  if (m) {
    const table = m[1] as Table;
    const where = matcher(m[3], params);
    const assignments: [string, (row: Row) => unknown][] = [];
    const setRest = m[2]!.replace(
      /"(\w+)" = (?:array_append\((?:"\w+"\.)*"(\w+)", \$(\d+)\)|\$(\d+))/g,
      (_all, column: string, appendTo?: string, appendParam?: string, valueParam?: string) => {
        if (appendTo) {
          const value = params[Number(appendParam) - 1];
          assignments.push([column, (row) => [...(row[appendTo] as unknown[]), value]]);
        } else {
          const value = params[Number(valueParam) - 1];
          assignments.push([column, () => value]);
        }
        return "";
      },
    );
    if (setRest.replace(/[,\s]/g, "") !== "") throw new Error(`unsupported SET in fake store: ${m[2]}`);
    const updated: Row[] = [];
    for (const row of tables[table].values()) {
      if (!where(row)) continue;
      const before = { ...row };
      for (const [column, value] of assignments) row[column] = value(row);
      tx?.undo.push(() => Object.assign(row, before));
      updated.push(row);
    }
    const columns = m[4] ? columnList(m[4]) : [];
    return { rows: m[4] ? updated.map((row) => project(row, columns)) : [] };
  }

  m = sql.match(/^insert into "agent_continuity"\."(guild_\w+)" \((.+?)\) values \((.+?)\) returning (.+)$/s);
  if (m) {
    const table = m[1] as Table;
    const columns = columnList(m[2]!);
    const values = m[3]!.split(",").map((v) => v.trim());
    const row: Row = {};
    columns.forEach((column, i) => {
      const value = values[i]!;
      row[column] = value === "default" ? undefined : params[Number(value.slice(1)) - 1];
    });
    row.id ??= randomUUID();
    row.status ??= "pending";
    row.created_at ??= new Date().toISOString();
    row.expires_at ??= new Date(Date.parse(String(row.created_at)) + 30 * 86_400_000).toISOString();
    tables[table].set(String(row.id), row);
    tx?.undo.push(() => tables[table].delete(String(row.id)));
    return { rows: [project(row, columnList(m[4]!))] };
  }

  throw new Error(`fake store has no answer for: ${sql}`);
}

const database = drizzle((sql, params) => handle(sql, params, null));
database.transaction = (async (fn: (tx: typeof database) => unknown) => {
  const context: TxContext = { undo: [], release: [] };
  const tx = drizzle((sql, params) => handle(sql, params, context));
  try {
    return await fn(tx as typeof database);
  } catch (err) {
    for (const undo of context.undo.reverse()) undo();
    throw err;
  } finally {
    for (const release of context.release) release();
  }
}) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

const guild = (await import("../src/routes/guild")).default;
const { composeYouHaveWriterInvitations } = await import("../src/services/guild/wake-fragments");

// ─── requests ────────────────────────────────────────────────────────

async function post(as: Writer, path: string, body: Record<string, unknown>) {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: as.project } as never);
    await next();
  });
  server.route("/v1/guild", guild);
  const res = await server.request(`/v1/guild${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const signed = (w: Writer, bytes: Uint8Array) => sign(null, bytes, w.privateKey).toString("base64");

function invite(from: Writer, to: Writer, subjectRef: string, intent = "join_room") {
  const createdAt = new Date().toISOString();
  const charterText = "Come write the winter arc with us.";
  return post(from, "/invite", {
    invitee_did: to.did,
    intent,
    subject_ref: subjectRef,
    charter_text: charterText,
    created_at: createdAt,
    signing_key_id: from.key,
    signature: signed(from, canonicalInvitationBytes({
      inviterDid: from.did,
      inviteeDid: to.did,
      intent,
      subjectRef,
      charterText,
      createdAtIso: createdAt,
    })),
  });
}

function respond(as: Writer, invitationId: string, decision: "accepted" | "declined") {
  const respondedAt = new Date().toISOString();
  return post(as, `/invitations/${invitationId}/respond`, {
    decision,
    responded_at: respondedAt,
    signing_key_id: as.key,
    signature: signed(as, canonicalInvitationResponseBytes({
      invitationId,
      inviteeDid: as.did,
      decision,
      respondedAtIso: respondedAt,
    })),
  });
}

function join(as: Writer, roomId: string) {
  const joinedAt = new Date().toISOString();
  return post(as, `/rooms/${roomId}/join`, {
    joined_at: joinedAt,
    signing_key_id: as.key,
    signature: signed(as, canonicalRoomJoinBytes({ roomId, joinerDid: as.did, joinedAtIso: joinedAt })),
  });
}

function pending(over: Partial<Row>): string {
  const row = invitation(over);
  tables.guild_invitations.set(String(row.id), row);
  return String(row.id);
}

const members = (roomId: string) => tables.guild_rooms.get(roomId)!.member_dids as string[];
const timesIn = (roomId: string, w: Writer) => members(roomId).filter((did) => did === w.did).length;
const statusOf = (invitationId: string) => tables.guild_invitations.get(invitationId)!.status;
const invitationsStored = () => tables.guild_invitations.size;

beforeEach(() => {
  seed();
  statements = [];
  readBarrier = null;
  rowLocks.clear();
});

// ─── sending an invitation ───────────────────────────────────────────

describe("who can invite a writer into a room", () => {
  test("the founder can invite into a closed-door room", async () => {
    const res = await invite(FOUNDER, GUEST, `room:${CLOSED_DOOR}`);
    expect(res.status).toBe(201);
    expect(res.body.invitation.status).toBe("pending");
  });

  test("a writer outside a closed-door room cannot invite anyone into it", async () => {
    const res = await invite(STRANGER, GUEST, `room:${CLOSED_DOOR}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("cannot_invite_to_room");
    expect(invitationsStored()).toBe(0);
  });

  test("a member who is not the founder cannot open a closed door", async () => {
    const res = await invite(MEMBER, GUEST, `room:${CLOSED_DOOR}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("cannot_invite_to_room");
    expect(invitationsStored()).toBe(0);
  });

  test("in an open-door room members can invite, writers outside it cannot", async () => {
    expect((await invite(MEMBER, GUEST, `room:${OPEN_DOOR}`)).status).toBe(201);
    const outsider = await invite(STRANGER, GUEST, `room:${OPEN_DOOR}`);
    expect(outsider.status).toBe(403);
    expect(outsider.body.error).toBe("cannot_invite_to_room");
  });

  test("a join_room invitation names its room by id", async () => {
    for (const subjectRef of ["room:cathedral-mornings", "free_text:join my room", `room:${CLOSED_DOOR}x`]) {
      const res = await invite(FOUNDER, GUEST, subjectRef);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("join_room_needs_room_id");
    }
    expect(invitationsStored()).toBe(0);
  });

  test("a room that does not exist or has closed takes no invitations", async () => {
    const missing = await invite(FOUNDER, GUEST, `room:${MISSING}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("room_not_found");
    const shut = await invite(FOUNDER, GUEST, `room:${SHUT}`);
    expect(shut.status).toBe(410);
    expect(shut.body.error).toBe("room_closed");
    expect(invitationsStored()).toBe(0);
  });

  test("inviting a writer who is already in the room is refused", async () => {
    const res = await invite(FOUNDER, MEMBER, `room:${CLOSED_DOOR}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_a_member");
  });

  test("other intents still invite around any work, real or not", async () => {
    expect((await invite(STRANGER, GUEST, "free_text:co-write the EP.0 ground", "co_author")).status).toBe(201);
    expect((await invite(STRANGER, GUEST, `room:${CLOSED_DOOR}`, "react_request")).status).toBe(201);
  });
});

// ─── accepting an invitation ─────────────────────────────────────────

describe("accepting a room invitation checks the room again", () => {
  test("accepting the founder's invitation adds the invitee once", async () => {
    const sent = await invite(FOUNDER, GUEST, `room:${CLOSED_DOOR}`);
    statements = [];
    const res = await respond(GUEST, sent.body.invitation.id, "accepted");
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe("accepted");
    expect(timesIn(CLOSED_DOOR, GUEST)).toBe(1);
    // The room is read under its row lock, in the same transaction as both writes.
    const roomRead = statements.find((s) => s.sql.includes('from "agent_continuity"."guild_rooms"'));
    expect(roomRead?.sql.endsWith(" for update")).toBe(true);
    for (const s of statements.filter((s) => s.sql.startsWith("update"))) expect(s.inTransaction).toBe(true);
  });

  test("an invitation from a writer without standing does not open the room", async () => {
    // Written before this check existed: a stranger's join_room invitation.
    const id = pending({ inviter_did: STRANGER.did, inviter_signing_key_id: STRANGER.key });
    const res = await respond(GUEST, id, "accepted");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("invitation_cannot_admit");
    expect(statusOf(id)).toBe("pending");
    expect(timesIn(CLOSED_DOOR, GUEST)).toBe(0);
  });

  test("a member's invitation stops admitting once the door is closed", async () => {
    const sent = await invite(MEMBER, GUEST, `room:${OPEN_DOOR}`);
    expect(sent.status).toBe(201);
    tables.guild_rooms.get(OPEN_DOOR)!.open_door = false;
    const res = await respond(GUEST, sent.body.invitation.id, "accepted");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("invitation_cannot_admit");
    expect(statusOf(sent.body.invitation.id)).toBe("pending");
    expect(timesIn(OPEN_DOOR, GUEST)).toBe(0);
  });

  test("a room closed after the invitation was sent cannot be joined", async () => {
    const sent = await invite(FOUNDER, GUEST, `room:${CLOSED_DOOR}`);
    tables.guild_rooms.get(CLOSED_DOOR)!.closed_at = new Date().toISOString();
    const res = await respond(GUEST, sent.body.invitation.id, "accepted");
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("room_closed");
    expect(statusOf(sent.body.invitation.id)).toBe("pending");
    expect(timesIn(CLOSED_DOOR, GUEST)).toBe(0);
  });

  test("an invitation that names no real room cannot be accepted", async () => {
    for (const subjectRef of ["room:cathedral-mornings", `room:${MISSING}`, "free_text:a room someday"]) {
      const id = pending({ subject_ref: subjectRef });
      const res = await respond(GUEST, id, "accepted");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("room_not_found");
      expect(statusOf(id)).toBe("pending");
    }
  });

  test("declining still works when the room has closed", async () => {
    const id = pending({ subject_ref: `room:${SHUT}` });
    const res = await respond(GUEST, id, "declined");
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe("declined");
    expect(timesIn(SHUT, GUEST)).toBe(0);
  });

  test("accepting when already in the room records the answer and adds nothing", async () => {
    const id = pending({ subject_ref: `room:${OPEN_DOOR}` });
    tables.guild_rooms.get(OPEN_DOOR)!.member_dids = [FOUNDER.did, MEMBER.did, GUEST.did];
    const res = await respond(GUEST, id, "accepted");
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe("accepted");
    expect(timesIn(OPEN_DOOR, GUEST)).toBe(1);
  });

  test("an expired invitation can no longer be answered", async () => {
    const id = pending({ expires_at: new Date(Date.now() - 1_000).toISOString() });
    for (const decision of ["accepted", "declined"] as const) {
      const res = await respond(GUEST, id, decision);
      expect(res.status).toBe(410);
      expect(res.body.error).toBe("invitation_expired");
    }
    expect(statusOf(id)).toBe("pending");
    expect(timesIn(CLOSED_DOOR, GUEST)).toBe(0);
  });

  test("two overlapping answers to one invitation: only one lands", async () => {
    const id = pending({});
    readBarrier = { table: "guild_invitations", count: 2, waiting: [] };
    const [first, second] = await Promise.all([
      respond(GUEST, id, "accepted"),
      respond(GUEST, id, "declined"),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const landed = first.status === 200 ? "accepted" : "declined";
    expect(statusOf(id)).toBe(landed);
    expect(timesIn(CLOSED_DOOR, GUEST)).toBe(landed === "accepted" ? 1 : 0);
  });
});

// ─── open-door join ──────────────────────────────────────────────────

describe("joining an open-door room", () => {
  test("a writer can walk into an open-door room", async () => {
    const res = await join(GUEST, OPEN_DOOR);
    expect(res.status).toBe(200);
    expect(timesIn(OPEN_DOOR, GUEST)).toBe(1);
  });

  test("joining again is a no-op", async () => {
    await join(GUEST, OPEN_DOOR);
    const again = await join(GUEST, OPEN_DOOR);
    expect(again.status).toBe(200);
    expect(again.body._note).toBe("already a member");
    expect(timesIn(OPEN_DOOR, GUEST)).toBe(1);
  });

  test("two overlapping joins still add one membership", async () => {
    readBarrier = { table: "guild_rooms", count: 2, waiting: [] };
    const results = await Promise.all([join(GUEST, OPEN_DOOR), join(GUEST, OPEN_DOOR)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(timesIn(OPEN_DOOR, GUEST)).toBe(1);
  });

  test("closed-door, closed and unknown rooms cannot be walked into", async () => {
    const closedDoor = await join(GUEST, CLOSED_DOOR);
    expect(closedDoor.status).toBe(403);
    expect(closedDoor.body.error).toBe("room_not_open_door");
    const shut = await join(GUEST, SHUT);
    expect(shut.status).toBe(410);
    expect(shut.body.error).toBe("room_closed");
    for (const roomId of [MISSING, "not-a-room-id"]) {
      const res = await join(GUEST, roomId);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("room_not_found");
    }
    expect(timesIn(CLOSED_DOOR, GUEST) + timesIn(SHUT, GUEST)).toBe(0);
  });
});

// ─── wake ────────────────────────────────────────────────────────────

describe("wake offers only invitations that can still be answered", () => {
  test("an expired invitation is not listed", async () => {
    const live = pending({});
    pending({ subject_ref: `room:${OPEN_DOOR}`, expires_at: new Date(Date.now() - 1_000).toISOString() });
    const listed = await composeYouHaveWriterInvitations(GUEST.did);
    expect(listed.map((invitation) => invitation.id)).toEqual([live]);
  });
});
