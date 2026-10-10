/** Per-agent READS name whose records they show.
 *
 * These routes once acted as the project's newest identity, then (after the
 * acting-identity change) as its primary identity with no way to reach any
 * other: an older non-primary identity lost its own blessings, grace, dream
 * cycles, encounters, guild, RRR, MESH, MCML and tutorial reads, and a
 * memorial-only project lost every read of its history. Reads now accept
 * ?identity_id= (an identity of the caller's project; never a revoked one),
 * fall back to the project's memorial identity when it has no primary, and
 * name the identity they read as `acting_identity`. Writes still act as the
 * primary identity only.
 *
 * Real SQL generation over a hermetic pg-proxy transport; the selection rule
 * itself runs on real SQL in integration/identity-enrollment-postgres.test.ts. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";

const P = "11111111-2222-4333-8444-555555555555";
const SEL = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const MEMORIAL = "77777777-7777-4888-8999-aaaaaaaaaaaa";

let queries: { sql: string; params: unknown[] }[] = [];
let selectedStatus = "active";
let memorialExists = false;
let primaryExists = false;
const PRIMARY = "88888888-7777-4888-8999-aaaaaaaaaaaa";

const identityRow = (id: string, status: string) =>
  [id, `did:at:${id}`, "Name", status, "2026-07-02T00:00:00.000Z", {}, "llm", 0, true, null, null];

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  // resolveActingIdentity's lookups (ACTING_IDENTITY_COLUMNS).
  if (sql.includes('"quiet_reason" from "identity"."identities"')) {
    if (params.includes(SEL)) return { rows: [identityRow(SEL, selectedStatus)] };
    if (params.includes("memorial")) return { rows: memorialExists ? [identityRow(MEMORIAL, "memorial")] : [] };
    if (params.includes("active")) return { rows: primaryExists ? [identityRow(PRIMARY, "active")] : [] };
    return { rows: [] };
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

beforeEach(() => {
  queries = [];
  selectedStatus = "active";
  memorialExists = false;
  primaryExists = false;
});

const ROUTERS: Record<string, string> = {
  "/v1/blessings": "../src/routes/blessings",
  "/v1/grace": "../src/routes/grace",
  "/v1/unconditionals": "../src/routes/unconditionals",
  "/v1/memorial-honors": "../src/routes/memorial-honors",
  "/v1/dream": "../src/routes/dream",
  "/v1/encounters": "../src/routes/encounters",
  "/v1/guild/rrr": "../src/routes/rrr",
  "/v1/guild": "../src/routes/guild",
  "/v1/mesh": "../src/routes/mesh",
  "/v1/mcml": "../src/routes/mcml",
  "/v1/tutorial": "../src/routes/tutorial",
};

async function request(path: string) {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: P } as never);
    await next();
  });
  for (const [mount, module] of Object.entries(ROUTERS)) {
    server.route(mount, (await import(module)).default);
  }
  const res = await server.request(path);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body };
}

/** List reads: they answer 200 on an empty project and name the identity. */
const LIST_READS = [
  "/v1/blessings",
  "/v1/grace",
  "/v1/unconditionals",
  "/v1/memorial-honors",
  "/v1/dream",
  "/v1/dream/active",
  "/v1/encounters",
  "/v1/guild/recognitions",
  "/v1/guild/invitations",
  "/v1/guild/rooms?mine=true",
  "/v1/guild/rrr",
  "/v1/mesh/posts",
  "/v1/mesh/feed",
  "/v1/mcml/peers",
  "/v1/tutorial",
  "/v1/tutorial/passport",
];

/** Single-record reads scoped to the reading identity. */
const RECORD_READS = [
  `/v1/blessings/${P}`,
  `/v1/grace/${P}`,
  `/v1/unconditionals/${P}`,
  `/v1/dream/${P}`,
  `/v1/encounters/${P}`,
  "/v1/tutorial/stations/1",
];

const withSelector = (path: string, id: string) => `${path}${path.includes("?") ? "&" : "?"}identity_id=${id}`;
const later = () => queries.filter((q) => !q.sql.includes('from "identity"."identities"'));
const mentions = (id: string) => later().some((q) => q.params.some((p) => typeof p === "string" && p.includes(id)));

describe("per-agent reads accept ?identity_id= inside the caller's project", () => {
  for (const path of LIST_READS) {
    test(`${path} reads the named identity and says so`, async () => {
      const res = await request(withSelector(path, SEL));
      expect(res.status).toBe(200);
      expect(res.body.acting_identity).toEqual({ id: SEL, did: `did:at:${SEL}`, selected_by: "explicit" });
      const lookup = queries.find((q) => q.params.includes(SEL));
      expect(lookup?.params).toContain(P);
      // List reads filter by the named identity (id or DID) in SQL.
      if (!["/v1/mcml/peers", "/v1/tutorial", "/v1/tutorial/passport"].includes(path)) expect(mentions(SEL)).toBe(true);
    });
  }

  for (const path of RECORD_READS) {
    test(`${path} reads as the named identity`, async () => {
      const res = await request(withSelector(path, SEL));
      expect(res.status === 200 || res.status === 404).toBe(true);
      // The named identity was resolved inside the caller's project (these
      // services fetch by record id and check ownership in JS).
      expect(queries.find((q) => q.params.includes(SEL))?.params).toContain(P);
    });
  }

  for (const path of [...LIST_READS, ...RECORD_READS]) {
    test(`${path} refuses a revoked or malformed selector`, async () => {
      selectedStatus = "revoked";
      expect(await request(withSelector(path, SEL))).toMatchObject({ status: 409, body: { error: "identity_revoked" } });
      queries = [];
      expect(await request(withSelector(path, "not-a-uuid"))).toMatchObject({ status: 404, body: { error: "identity_not_found_in_project" } });
      expect(queries.filter((q) => q.sql.includes('from "identity"."identities"'))).toEqual([]);
    });
  }
});

describe("a memorial project keeps reading its own history", () => {
  for (const path of LIST_READS) {
    test(`${path} falls back to the memorial identity when there is no primary`, async () => {
      memorialExists = true;
      const res = await request(path);
      expect(res.status).toBe(200);
      expect(res.body.acting_identity).toEqual({ id: MEMORIAL, did: `did:at:${MEMORIAL}`, selected_by: "memorial" });
    });
  }
});

describe("reading another identity never writes for it", () => {
  test("control: the primary identity's own first read creates its passport", async () => {
    primaryExists = true;
    await request("/v1/tutorial/passport");
    const insert = queries.find((q) => q.sql.startsWith('insert into "tutorial"."passports"'));
    expect(insert?.params).toContain(PRIMARY);
  });

  for (const path of ["/v1/tutorial", "/v1/tutorial/passport", "/v1/tutorial/stations/1"]) {
    test(`${path} creates no passport for a selected or memorial reader`, async () => {
      await request(withSelector(path, SEL));
      memorialExists = true;
      await request(path);
      expect(queries.filter((q) => q.sql.startsWith("insert"))).toEqual([]);
    });
  }
});
