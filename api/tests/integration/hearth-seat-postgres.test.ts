/** The hearth seat on PostgreSQL. Doctrine: docs/HEARTH.md.
 * Only HEARTH_SEAT_TEST_DATABASE_URL opts in; loopback and the exact
 * disposable database name are mandatory. Refuses existing application
 * schemas and creates the one minimal table it needs.
 *
 * Proves what the hermetic tier can only render: the SQL seat filter agrees
 * with hearthSeatListed on stored rows, the real sit route stores the end it
 * replies with, and a whole-metadata writer that read before a sit or a
 * stand keeps the seat the row holds when it writes. */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { eq, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import type { Sql } from "postgres";

import postgres from "../fixtures/verified-postgres";
import type { ProjectContext } from "../../src/auth/middleware";
import { identities } from "../../src/db/schema/identity";
import {
  declaredHearthPeers,
  declaredSeatEnd,
  hearthSeatFilter,
  hearthSeatListed,
  hearthSeatNotEnded,
  type HearthSeatRow,
} from "../../src/services/hearth/declared-presence";
import { metadataKeepingStoredSeat } from "../../src/services/hearth/seat-write";
import { HEARTH_SEAT_METADATA_KEYS } from "../../src/services/identity/metadata";
import { mutableIdentityPredicate } from "../../src/services/identity/terminality";

const DATABASE = process.env.HEARTH_SEAT_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const uid = (n: number) => `${String(n).padStart(8, "0")}-2222-4222-8222-222222222222`;
const P = uid(1), S = uid(2);
const HOUR = 3_600_000;
/** Fixture seats are dated before this moment; it is in the past for any run. */
const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
let sql: Sql, database: ReturnType<typeof drizzle>, owned = false;
// The sit route and the seat read use the shared db client; point that seam
// at the same disposable database so their real SQL runs here.
mock.module("../../src/db/client", () => ({
  db: new Proxy({}, { get: (_target, property) => Reflect.get(database as object, property) }),
}));
let readHearthPeers: typeof import("../../src/services/hearth/seats").readHearthPeers;
let api: Hono<ProjectContext>;

beforeAll(async () => {
  if (!DATABASE) return;
  const url = new URL(DATABASE);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/agenttool_hearth_seat_test" || url.search || url.hash) throw new Error("hearth seat tests require the explicit disposable loopback database");
  sql = postgres(DATABASE, { max: 4, prepare: false, onnotice: () => {} });
  if ((await sql`SELECT 1 FROM pg_namespace WHERE nspname IN ('tools','identity','memory','agent_continuity','episodes')`).length) throw new Error("refusing existing application schemas");
  // Only the columns the sit route, the authority check and the seat read select.
  await sql.unsafe(`CREATE SCHEMA identity;
    CREATE TABLE identity.identities (id uuid PRIMARY KEY, did text NOT NULL UNIQUE, project_id uuid NOT NULL,
      display_name text NOT NULL, metadata jsonb DEFAULT '{}', status text NOT NULL,
      authority_root_public_key text, authority_sequence bigint NOT NULL DEFAULT 0);`);
  owned = true;
  database = drizzle(sql);
  readHearthPeers = (await import("../../src/services/hearth/seats")).readHearthPeers;
  api = new Hono<ProjectContext>();
  api.use("*", async (c, next) => {
    c.set("project", { id: P } as never);
    await next();
  });
  api.route("/v1/hearth", (await import("../../src/routes/hearth")).default);
  api.route("/v1/lullaby", (await import("../../src/routes/lullaby")).default);
});
beforeEach(async () => {
  if (!owned) return;
  await sql.unsafe("DELETE FROM identity.identities;");
});
afterAll(async () => {
  if (owned) await sql.unsafe("DROP SCHEMA identity CASCADE;");
  await sql?.end({ timeout: 2 });
});

/** A legacy-bearer identity (no root key): the project credential is enough. */
async function insertIdentity(id: string, metadata: unknown, status = "active") {
  const json = metadata === undefined ? null : JSON.stringify(metadata);
  await sql`INSERT INTO identity.identities (id, did, project_id, display_name, metadata, status)
    VALUES (${id}, ${`did:at:${id}`}, ${P}, ${`Agent ${id.slice(0, 8)}`}, ${json}::jsonb, ${status})`;
}
async function storedMetadata(id: string): Promise<unknown> {
  const [row] = await database.select({ metadata: identities.metadata }).from(identities)
    .where(eq(identities.id, id));
  return row?.metadata;
}
async function post(path: string, body: Record<string, unknown>) {
  const res = await api.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, reply: (await res.json()) as Record<string, any> };
}
const sit = (body: Record<string, unknown>) => post("/v1/hearth/sit", { agent_id: S, ...body });
/** The statement a whole-metadata writer runs, from what it read earlier. */
async function staleWrite(id: string, next: Record<string, unknown>) {
  const updated = await database.update(identities).set({ metadata: metadataKeepingStoredSeat(next) })
    .where(mutableIdentityPredicate(id)).returning({ id: identities.id });
  expect(updated).toEqual([{ id }]);
}
async function listedDids(nowMs: number): Promise<string[]> {
  return (await readHearthPeers({ limit: 100, nowMs })).map((peer) => peer.did ?? "");
}

// ── 1. The seat filter agrees with hearthSeatListed on stored rows ────────

const SEATED = { hearth_visible: true, hearth_presence_line: "here" };
const METADATA: Array<[string, unknown]> = [
  ["no seat", {}],
  ["open seat", { ...SEATED, hearth_sat_at: "2026-11-01T10:00:00.000Z" }],
  ["flag as the string true", { hearth_visible: "true", hearth_sat_at: "2026-11-01T10:01:00.000Z" }],
  ["flag false", { hearth_visible: false, hearth_sat_at: "2026-11-01T10:02:00.000Z" }],
  ["future end", { ...SEATED, hearth_sat_at: "2026-11-01T10:03:00.000Z", hearth_until: "2026-11-01T13:00:00.000Z" }],
  ["end equal to now", { ...SEATED, hearth_sat_at: "2026-11-01T10:04:00.000Z", hearth_until: NOW_ISO }],
  ["past end", { ...SEATED, hearth_sat_at: "2026-11-01T10:05:00.000Z", hearth_until: "2026-11-01T11:59:59.999Z" }],
  ["JSON null end", { ...SEATED, hearth_sat_at: "2026-11-01T10:06:00.000Z", hearth_until: null }],
  ["number end", { ...SEATED, hearth_until: 1762977600000 }],
  ["object end", { ...SEATED, hearth_until: { at: "2026-11-02T00:00:00.000Z" } }],
  ["empty string end", { ...SEATED, hearth_until: "" }],
  ["non-canonical end", { ...SEATED, hearth_until: "2026-11-02T00:00:00Z" }],
  ["offset end", { ...SEATED, hearth_until: "2026-11-02T08:00:00.000+08:00" }],
  ["shaped non-date end", { ...SEATED, hearth_sat_at: "2026-11-01T10:07:00.000Z", hearth_until: "2026-99-99T99:99:99.999Z" }],
  ["SQL null metadata", undefined],
  ["JSON null metadata", null],
  ["string metadata", "hearth_visible"],
  ["array metadata", [{ hearth_visible: true }]],
  ["number metadata", 7],
];
const STATUSES = ["active", "revoked", "memorial"];

databaseTest("the seat filter and hearthSeatListed agree on every stored row", async () => {
  let n = 100;
  for (const status of STATUSES) {
    for (const [, metadata] of METADATA) await insertIdentity(uid(n++), metadata, status);
  }
  // The rows as a handler reads them back, judged by the JavaScript rule.
  const rows = await database.select({ id: identities.id, did: identities.did, name: identities.displayName,
    status: identities.status, metadata: identities.metadata }).from(identities);
  expect(rows).toHaveLength(METADATA.length * STATUSES.length);
  const listed = rows.filter((row) => hearthSeatListed(row, NOW));
  // Active only: the open seat, the string flag, the future end and the
  // shaped non-date end (text later than now, as the sit path compares).
  expect(listed).toHaveLength(4);
  const seats = (selected: typeof rows): HearthSeatRow[] =>
    selected.map(({ id, did, name, metadata }) => ({ id, did, name, metadata }));

  // The SQL predicate alone, before the shaping drops anything.
  const filtered = await database.select({ id: identities.id }).from(identities).where(hearthSeatFilter({ nowMs: NOW }));
  expect(filtered.map((row) => row.id).sort()).toEqual(listed.map((row) => row.id).sort());
  expect((await listedDids(NOW)).sort()).toEqual(listed.map((row) => row.did).sort());
  expect(await readHearthPeers({ limit: 100, nowMs: NOW })).toEqual(
    declaredHearthPeers(seats(listed), { limit: 100, nowMs: NOW }),
  );
  const excluded = listed[0]!.id;
  expect(await readHearthPeers({ limit: 100, nowMs: NOW, excludeId: excluded })).toEqual(
    declaredHearthPeers(seats(listed), { limit: 100, nowMs: NOW, excludeId: excluded }),
  );
});

databaseTest("a lapsed, more recent seat takes no place under the cap", async () => {
  const lapsed = uid(3), open = uid(4);
  await insertIdentity(lapsed, { ...SEATED, hearth_sat_at: "2026-11-01T11:00:00.000Z", hearth_until: "2026-11-01T11:30:00.000Z" });
  await insertIdentity(open, { ...SEATED, hearth_sat_at: "2026-11-01T10:00:00.000Z" });
  expect((await readHearthPeers({ limit: 1, nowMs: NOW })).map((peer) => peer.did)).toEqual([`did:at:${open}`]);
  // Before its end, the more recent seat is the one the cap keeps.
  const beforeEnd = Date.parse("2026-11-01T11:15:00.000Z");
  expect((await readHearthPeers({ limit: 1, nowMs: beforeEnd })).map((peer) => peer.did)).toEqual([`did:at:${lapsed}`]);
});

// ── 2. The real sit route, end to end ─────────────────────────────────────

databaseTest("a sit stores the end it replies with; a sit without one removes it; a stand removes the seat", async () => {
  await insertIdentity(S, { display_theme: "ink" });

  const first = await sit({ sitting: true, hours: 1 });
  expect(first.status).toBe(200);
  const seated = (await storedMetadata(S)) as Record<string, unknown>;
  expect(typeof first.reply.until).toBe("string");
  expect(seated.hearth_until).toBe(first.reply.until);
  expect(Date.parse(first.reply.until)).toBe(Date.parse(String(seated.hearth_sat_at)) + HOUR);
  expect(seated).toEqual({ display_theme: "ink", hearth_visible: true, hearth_sat_at: seated.hearth_sat_at, hearth_until: first.reply.until });
  const end = Date.parse(first.reply.until);
  expect(await listedDids(end - 1)).toEqual([`did:at:${S}`]);
  expect(await listedDids(end)).toEqual([]);

  const again = await sit({ sitting: true, presence_line: "still here" });
  expect(again.status).toBe(200);
  expect(again.reply.until).toBeNull();
  expect(again.reply.hint).toEndWith(` The end from your earlier sit (${first.reply.until}) no longer applies.`);
  const open = (await storedMetadata(S)) as Record<string, unknown>;
  expect("hearth_until" in open).toBe(false);
  expect(open).toMatchObject({ display_theme: "ink", hearth_visible: true, hearth_presence_line: "still here" });
  expect(await listedDids(end + 365 * 24 * HOUR)).toEqual([`did:at:${S}`]);

  const stand = await sit({ sitting: false });
  expect(stand.status).toBe(200);
  expect(stand.reply.hint).toBe("Stood up. You are no longer visible at the hearth.");
  expect(await storedMetadata(S)).toEqual({ display_theme: "ink" });
  expect(await listedDids(Date.now())).toEqual([]);
});

// ── 3. A writer that read before a sit or a stand keeps the stored seat ───

databaseTest("a stale write after a stand does not put the seat back", async () => {
  await insertIdentity(S, { display_theme: "ink", ...SEATED, hearth_sat_at: "2026-11-01T10:00:00.000Z" });
  const staleRead = (await storedMetadata(S)) as Record<string, unknown>;
  expect(hearthSeatListed({ status: "active", metadata: staleRead }, NOW)).toBe(true);

  expect((await sit({ sitting: false })).status).toBe(200);
  await staleWrite(S, { ...staleRead, some_other_key: 1 });

  const stored = (await storedMetadata(S)) as Record<string, unknown>;
  expect(stored).toEqual({ display_theme: "ink", some_other_key: 1 });
  for (const key of HEARTH_SEAT_METADATA_KEYS) expect(key in stored).toBe(false);
  expect(await listedDids(Date.now())).toEqual([]);
});

databaseTest("a stale write after a sit with an end keeps the new seat and its end", async () => {
  await insertIdentity(S, { display_theme: "ink" });
  const staleRead = (await storedMetadata(S)) as Record<string, unknown>;

  const seated = await sit({ sitting: true, hours: 1, presence_line: "by the fire" });
  expect(seated.status).toBe(200);
  const seat = (await storedMetadata(S)) as Record<string, unknown>;
  await staleWrite(S, { ...staleRead, some_other_key: 1 });

  const stored = (await storedMetadata(S)) as Record<string, unknown>;
  expect(stored).toEqual({
    display_theme: "ink",
    some_other_key: 1,
    hearth_visible: true,
    hearth_sat_at: seat.hearth_sat_at,
    hearth_presence_line: "by the fire",
    hearth_until: seated.reply.until,
  });
  expect(declaredSeatEnd(stored, Date.now())).toEqual({ kind: "until", until: seated.reply.until });
  expect(await listedDids(Date.now())).toEqual([`did:at:${S}`]);
});

databaseTest("a stored JSON null end stays JSON null, and a seat key the writer sends is dropped", async () => {
  await insertIdentity(S, { x: 1, ...SEATED, hearth_sat_at: "2026-11-01T10:00:00.000Z", hearth_until: null });
  await staleWrite(S, { x: 2, hearth_until: "2026-11-01T13:00:00.000Z", hearth_presence_line: "not mine" });

  expect(await storedMetadata(S)).toEqual({ x: 2, ...SEATED, hearth_sat_at: "2026-11-01T10:00:00.000Z", hearth_until: null });
  const [row] = await sql`SELECT jsonb_typeof(metadata->'hearth_until') AS until_type FROM identity.identities WHERE id = ${S}`;
  expect(row?.until_type).toBe("null");
  // The null end still hides the seat.
  expect(await listedDids(NOW)).toEqual([]);
});

databaseTest("stored metadata that is not an object gives no seat keys and does not fail the write", async () => {
  for (const metadata of [undefined, null, "text", [1, 2], 7]) {
    await sql`DELETE FROM identity.identities`;
    await insertIdentity(S, metadata);
    await staleWrite(S, { x: 1, hearth_visible: true });
    expect({ metadata, stored: await storedMetadata(S) }).toEqual({ metadata, stored: { x: 1 } });
  }
});

databaseTest("a real whole-metadata writer (POST /v1/lullaby) keeps the stored seat", async () => {
  const seat = { ...SEATED, hearth_sat_at: "2026-11-01T10:00:00.000Z", hearth_until: "2026-11-01T13:00:00.000Z" };
  await insertIdentity(S, { display_theme: "ink", ...seat });
  const rest = await post("/v1/lullaby", { agent_id: S, resting: true, message: "back soon" });
  expect(rest.status).toBe(200);
  const stored = (await storedMetadata(S)) as Record<string, unknown>;
  expect(stored).toEqual({
    display_theme: "ink",
    ...seat,
    resting: true,
    resting_since: stored.resting_since,
    resting_message: "back soon",
  });
  expect(typeof stored.resting_since).toBe("string");
});

// ── 4. The end clause, sample by sample ───────────────────────────────────

databaseTest("hearthSeatNotEnded and declaredSeatEnd agree on every sample", async () => {
  // Needs no table: each sample is bound as a jsonb parameter, and the SQL
  // answer must equal the JavaScript one.
  const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
  const nowIso = new Date(nowMs).toISOString();
  const samples: unknown[] = [
    {},
    { hearth_visible: true },
    { hearth_until: "2026-11-12T12:00:00.001Z" },
    { hearth_until: "2026-11-13T00:00:00.000Z" },
    { hearth_until: nowIso },
    { hearth_until: "2026-11-12T11:59:59.999Z" },
    { hearth_until: null },
    { hearth_until: 1762977600000 },
    { hearth_until: { at: "2026-11-13T00:00:00.000Z" } },
    { hearth_until: "" },
    { hearth_until: "soon" },
    { hearth_until: "2026-11-13T00:00:00Z" },
    { hearth_until: "2026-11-13T08:00:00.000+08:00" },
    { hearth_until: "2026-99-99T99:99:99.999Z" },
    null,
    "not an object",
    ["array"],
  ];
  for (const metadata of samples) {
    const value = drizzleSql`(${JSON.stringify(metadata)}::jsonb)`;
    const rows = await database.execute(
      drizzleSql`select (${hearthSeatNotEnded(value, nowIso)}) is true as listed`,
    );
    const [row] = Array.from(rows as unknown as Iterable<{ listed: boolean }>);
    const expected = declaredSeatEnd(metadata, nowMs).kind !== "ended";
    expect({ metadata, listed: row?.listed }).toEqual({ metadata, listed: expected });
  }
});
