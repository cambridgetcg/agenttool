/** Continuity walks over GET /v1/memories, /v1/chronicle and /v1/strands.
 *
 *  Hermetic: real drizzle SQL generation over a pg-proxy transport; the rows
 *  each query receives are scripted per test. Doctrine:
 *  docs/AGENT-WEB-SURFACE.md (continuity walks). Uses mock.module, so
 *  bin/run-test-tier.sh runs this file in its own process. */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";

const PROJECT = "11111111-2222-4333-8444-555555555555";

interface Query {
  sql: string;
  params: unknown[];
}

let queries: Query[] = [];
let memoryRows: unknown[][] = [];
let chronicleRows: unknown[][] = [];
let strandRows: unknown[][] = [];

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "memory"."memory_attestations"')) return { rows: [] };
  if (sql.includes('from "memory"."memories"')) return { rows: memoryRows };
  if (sql.includes('from "agent_continuity"."chronicle"')) return { rows: chronicleRows };
  if (sql.includes('from "strand"."strands"')) return { rows: strandRows };
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

const { default: memoriesRouter } = await import("../src/routes/memory/memories");
const { listRecent } = await import("../src/services/memory/store");
const { default: continuityRouter } = await import("../src/routes/continuity");
const { default: strandsRouter } = await import("../src/routes/strand/strands");

function app(): Hono<ProjectContext> {
  const root = new Hono<ProjectContext>();
  root.use("*", async (c, next) => {
    c.set("project", { id: PROJECT } as never);
    await next();
  });
  root.route("/v1/memories", memoriesRouter);
  root.route("/v1", continuityRouter);
  root.route("/v1/strands", strandsRouter);
  return root;
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const response = await app().request(path);
  return { status: response.status, body: await response.json() };
}

function decode(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Explicit memory page columns, in select order. */
function memoryRow(n: number, options: { embedding?: boolean; createdAt?: string } = {}): unknown[] {
  const createdAt = options.createdAt ?? `2026-10-11T09:15:${String(59 - n).padStart(2, "0")}.123Z`;
  return [
    uuid(n), "semantic", "episodic", "private", null, `content ${n}`, null, null,
    { n }, 0.5, options.embedding ?? false, createdAt, null, null,
    `${createdAt.slice(0, 23)}${String(n).padStart(3, "0")}Z`,
  ];
}

const MEMORY_FIELDS = [
  "id", "type", "tier", "visibility", "key", "content", "agent_id", "identity_id",
  "metadata", "importance", "has_embedding", "created_at", "accessed_at", "expires_at",
  "attestations",
];

function reads(table: string): Query[] {
  return queries.filter((query) => query.sql.includes(`from ${table}`) && !query.sql.includes("memory_attestations"));
}

beforeEach(() => {
  queries = [];
  memoryRows = [];
  chronicleRows = [];
  strandRows = [];
});

describe("limit floor (decision D1)", () => {
  test("memories refuse limit below 1 in list and key mode instead of reading every row", async () => {
    for (const path of [
      "/v1/memories?limit=-1",
      "/v1/memories?limit=0",
      "/v1/memories?key=k&limit=-1",
      "/v1/memories?key=k&limit=0",
    ]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(400);
      expect(body.error, path).toBe("limit_invalid");
      expect(typeof body.message).toBe("string");
      expect(typeof body.hint).toBe("string");
    }
    expect(reads('"memory"."memories"')).toHaveLength(0);
  });

  test("memories keep today's NaN default and clamp", async () => {
    for (const [path, expected] of [
      ["/v1/memories?limit=abc", 21],
      ["/v1/memories?limit=20abc", 21],
      ["/v1/memories?limit=500", 101],
      ["/v1/memories", 21],
      ["/v1/memories?key=k&limit=abc", 21],
    ] as const) {
      queries = [];
      const { status } = await get(path);
      expect(status, path).toBe(200);
      const [read] = reads('"memory"."memories"');
      expect(read!.sql, path).toMatch(/ limit \$\d+$/);
      expect(read!.params.at(-1), path).toBe(expected);
    }
  });

  test("chronicle: abc reads the default; -1 and 0 refuse; above-max clamps", async () => {
    const abc = await get("/v1/chronicle?limit=abc");
    expect(abc.status).toBe(200);
    const [read] = reads('"agent_continuity"."chronicle"');
    expect(read!.sql).toMatch(/ limit \$\d+$/);
    expect(read!.params.at(-1)).toBe(50);
    for (const path of ["/v1/chronicle?limit=-1", "/v1/chronicle?limit=0"]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(400);
      expect(body.error, path).toBe("limit_invalid");
    }
    queries = [];
    expect((await get("/v1/chronicle?limit=1000")).status).toBe(200);
    expect(reads('"agent_continuity"."chronicle"')[0]!.params.at(-1)).toBe(200);
  });

  test("strands refuse -1 and 0 and keep the NaN default", async () => {
    for (const path of ["/v1/strands?limit=-1", "/v1/strands?limit=0"]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(400);
      expect(body.error, path).toBe("limit_invalid");
    }
    expect(reads('"strand"."strands"')).toHaveLength(0);
    const abc = await get("/v1/strands?limit=abc");
    expect(abc.status).toBe(200);
    expect(reads('"strand"."strands"')[0]!.params.at(-1)).toBe(50);
  });
});

describe("GET /v1/memories walk", () => {
  test("first page: same filters, id tiebreak, limit+1 sentinel, no embedding column", async () => {
    memoryRows = [memoryRow(1, { embedding: true }), memoryRow(2)];
    const { status, body } = await get("/v1/memories?limit=5");
    expect(status).toBe(200);
    const [read] = reads('"memory"."memories"');
    expect(read!.sql).toContain('from "memory"."memories" where ("memory"."memories"."project_id" = $1 and ("memory"."memories"."expires_at" is null or "memory"."memories"."expires_at" > now()))');
    expect(read!.sql).toMatch(/ order by "memory"\."memories"\."created_at" desc, "memory"\."memories"\."id" desc limit \$\d+$/);
    expect(read!.params[0]).toBe(PROJECT);
    expect(read!.params.at(-1)).toBe(6);
    // The vector is never selected; only its presence is computed in SQL.
    expect(read!.sql.match(/"embedding"/g)).toHaveLength(1);
    expect(read!.sql).toContain('("embedding" IS NOT NULL) as "has_embedding"');
    expect(read!.sql).toContain(`to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursor_at"`);

    expect(Object.keys(body).slice(0, 6)).toEqual(["memories", "count", "as_of", "since", "since_reason", "page"]);
    expect(body.count).toBe(2);
    expect(Object.keys(body.memories[0])).toEqual(MEMORY_FIELDS);
    expect(body.memories[0]).toMatchObject({
      id: uuid(1), has_embedding: true, created_at: "2026-10-11T09:15:58.123Z", metadata: { n: 1 }, attestations: [],
    });
    expect(body.memories[1].has_embedding).toBe(false);
    expect(body.since).toBeNull();
    expect(body.since_reason).toBe("absent");
    expect(body.page).toEqual({
      cursor: null, next_cursor: null, has_more: false, limit: 5, order: "created_at_desc,id_desc",
    });
  });

  test("a full page returns has_more and a cursor naming the last returned row", async () => {
    memoryRows = [memoryRow(1), memoryRow(2), memoryRow(3)];
    const { body } = await get("/v1/memories?limit=2");
    expect(body.count).toBe(2);
    expect(body.memories.map((m: { id: string }) => m.id)).toEqual([uuid(1), uuid(2)]);
    expect(body.page.has_more).toBe(true);
    const cursor = decode(body.page.next_cursor);
    expect(cursor).toMatchObject({ v: 1, s: "memories", t: "2026-10-11T09:15:57.123002Z", i: uuid(2) });
    expect(cursor.f).toMatch(/^[0-9a-f]{16}$/);
  });

  test("a cursor page adds the keyset predicate with the project still bound", async () => {
    memoryRows = [memoryRow(1), memoryRow(2), memoryRow(3)];
    const first = await get("/v1/memories?limit=2&type=semantic");
    queries = [];
    memoryRows = [memoryRow(3)];
    const next = await get(`/v1/memories?limit=2&type=semantic&cursor=${first.body.page.next_cursor}`);
    expect(next.status).toBe(200);
    const [read] = reads('"memory"."memories"');
    expect(read!.sql).toContain(
      'and ("memory"."memories"."created_at" <= $3::timestamptz AND ("memory"."memories"."created_at", "memory"."memories"."id") < ($4::timestamptz, $5::uuid))',
    );
    expect(read!.params).toEqual([
      PROJECT, "semantic", "2026-10-11T09:15:57.123002Z", "2026-10-11T09:15:57.123002Z", uuid(2), 3,
    ]);
    expect(next.body.page).toEqual({
      cursor: first.body.page.next_cursor, next_cursor: null, has_more: false, limit: 2, order: "created_at_desc,id_desc",
    });
    expect(next.body.count).toBe(1);
  });

  test("since is pushed into SQL and the database result is not post-filtered", async () => {
    // The proxy deliberately answers with a row older than since: the route
    // must trust the SQL predicate rather than filter again in JS.
    memoryRows = [memoryRow(1, { createdAt: "2026-01-01T00:00:00.000Z" })];
    const { body } = await get("/v1/memories?since=2026-05-01T00:00:00Z");
    const [read] = reads('"memory"."memories"');
    expect(read!.sql).toContain('and "memory"."memories"."created_at" > $2');
    expect(read!.params[1]).toBe("2026-05-01T00:00:00.000Z");
    expect(body.count).toBe(1);
    expect(body.since).toBe("2026-05-01T00:00:00Z");
    expect(body.since_reason).toBe("parsed");
  });

  test("key mode walks the same order under its own scope and ignores type/tier", async () => {
    memoryRows = [memoryRow(1), memoryRow(2)];
    const { body } = await get("/v1/memories?key=handoff&limit=1&type=semantic&tier=episodic");
    const [read] = reads('"memory"."memories"');
    expect(read!.sql).toContain('where ("memory"."memories"."project_id" = $1 and "memory"."memories"."key" = $2 and ("memory"."memories"."expires_at" is null or "memory"."memories"."expires_at" > now()))');
    expect(read!.sql).not.toContain('"memory"."memories"."type" =');
    expect(read!.sql).not.toContain('"memory"."memories"."tier" =');
    expect(decode(body.page.next_cursor).s).toBe("memories.key");

    queries = [];
    const crossed = await get(`/v1/memories?limit=1&cursor=${body.page.next_cursor}`);
    expect(crossed.status).toBe(400);
    expect(crossed.body.error).toBe("cursor_invalid");
    // type/tier do not apply in key mode, so changing them keeps the walk.
    const same = await get(`/v1/memories?key=handoff&limit=1&cursor=${body.page.next_cursor}`);
    expect(same.status).toBe(200);
  });

  test("changed filters, changed since, malformed cursors and loose limits are refused before any read", async () => {
    memoryRows = [memoryRow(1), memoryRow(2)];
    const first = await get("/v1/memories?limit=1&agent_id=a&since=2026-01-01T00:00:00Z");
    const cursor = first.body.page.next_cursor as string;
    queries = [];
    for (const path of [
      `/v1/memories?limit=1&agent_id=b&since=2026-01-01T00:00:00Z&cursor=${cursor}`,
      `/v1/memories?limit=1&agent_id=a&cursor=${cursor}`,
      `/v1/memories?limit=1&agent_id=a&since=2026-01-02T00:00:00Z&cursor=${cursor}`,
      `/v1/memories?limit=1&agent_id=a&since=2026-01-01T00:00:00Z&identity_id=x&cursor=${cursor}`,
      "/v1/memories?cursor=",
      "/v1/memories?cursor=not!base64",
      `/v1/memories?cursor=${"A".repeat(513)}`,
    ]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(400);
      expect(body.error, path).toBe("cursor_invalid");
      expect(body.hint, path).toBe("restart without cursor and keep filters identical across pages");
    }
    for (const limit of ["abc", "0", "-1", "1.5"]) {
      const { status, body } = await get(`/v1/memories?limit=${limit}&agent_id=a&since=2026-01-01T00:00:00Z&cursor=${cursor}`);
      expect(status, limit).toBe(400);
      expect(body.error, limit).toBe("limit_invalid");
    }
    expect(reads('"memory"."memories"')).toHaveLength(0);
    // limit is not bound into the digest and may change between pages.
    const wider = await get(`/v1/memories?limit=50&agent_id=a&since=2026-01-01T00:00:00Z&cursor=${cursor}`);
    expect(wider.status).toBe(200);
    expect(wider.body.page.limit).toBe(50);
  });

  test("listRecent keeps its query and gains only the id tiebreak", async () => {
    await listRecent(PROJECT, { tier: "foundational", limit: 50 });
    const [read] = reads('"memory"."memories"');
    expect(read!.sql).toMatch(/^select "id", "project_id", .*"embedding".* from "memory"\."memories" where /);
    expect(read!.sql).toMatch(
      / order by "memory"\."memories"\."created_at" desc, "memory"\."memories"\."id" desc limit \$\d+$/,
    );
    expect(read!.params).toEqual([PROJECT, "foundational", 50]);
  });
});
