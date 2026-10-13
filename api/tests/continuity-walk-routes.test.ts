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
    expect(read!.params.at(-1)).toBe(51);
    for (const path of ["/v1/chronicle?limit=-1", "/v1/chronicle?limit=0"]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(400);
      expect(body.error, path).toBe("limit_invalid");
    }
    queries = [];
    expect((await get("/v1/chronicle?limit=1000")).status).toBe(200);
    expect(reads('"agent_continuity"."chronicle"')[0]!.params.at(-1)).toBe(201);
  });

  test("an empty or whitespace limit reads each route's default, chronicle included", async () => {
    for (const [path, table, expected] of [
      ["/v1/chronicle?limit=", '"agent_continuity"."chronicle"', 51],
      ["/v1/chronicle?limit=%20%20", '"agent_continuity"."chronicle"', 51],
      ["/v1/memories?limit=", '"memory"."memories"', 21],
      ["/v1/memories?limit=%20", '"memory"."memories"', 21],
      ["/v1/strands?limit=", '"strand"."strands"', 51],
      ["/v1/strands?limit=%20", '"strand"."strands"', 51],
    ] as const) {
      queries = [];
      const { status, body } = await get(path);
      expect(status, path).toBe(200);
      expect(body.page.limit, path).toBe(expected - 1);
      expect(reads(table)[0]!.params.at(-1), path).toBe(expected);
    }
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
    expect(reads('"strand"."strands"')[0]!.params.at(-1)).toBe(51);
  });
});

describe("GET /v1/memories walk", () => {
  test("first page: same filters, id tiebreak, limit+1 sentinel, no embedding column", async () => {
    memoryRows = [memoryRow(1, { embedding: true }), memoryRow(2)];
    const { status, body } = await get("/v1/memories?limit=5");
    expect(status).toBe(200);
    const [read] = reads('"memory"."memories"');
    expect(read!.sql).toContain('from "memory"."memories" where ("memory"."memories"."project_id" = $1 and ("memory"."memories"."expires_at" is null or "memory"."memories"."expires_at" > now()) and "memory"."memories"."content_purged_at" is null)');
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
    expect(read!.sql).toContain('where ("memory"."memories"."project_id" = $1 and "memory"."memories"."key" = $2 and ("memory"."memories"."expires_at" is null or "memory"."memories"."expires_at" > now()) and "memory"."memories"."content_purged_at" is null)');
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

/** Chronicle page columns, in select order. */
function chronicleRow(n: number, occurredAt = `2026-10-11T08:00:${String(59 - n).padStart(2, "0")}.500Z`): unknown[] {
  return [
    uuid(100 + n), "note", `title ${n}`, null, null, occurredAt, "2026-10-11T09:00:00.000Z", { n },
    `${occurredAt.slice(0, 23)}${String(n).padStart(3, "0")}Z`,
  ];
}

describe("GET /v1/chronicle walk", () => {
  test("first page keeps today's order with an id tiebreak and adds count and page", async () => {
    chronicleRows = [chronicleRow(1), chronicleRow(2)];
    const { status, body } = await get("/v1/chronicle");
    expect(status).toBe(200);
    const [read] = reads('"agent_continuity"."chronicle"');
    expect(read!.sql).toContain('where "agent_continuity"."chronicle"."project_id" = $1 order by');
    expect(read!.sql).toMatch(
      / order by "agent_continuity"\."chronicle"\."occurred_at" desc, "agent_continuity"\."chronicle"\."id" desc limit \$2$/,
    );
    expect(read!.sql).toContain(`to_char("occurred_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursor_at"`);
    expect(read!.params).toEqual([PROJECT, 51]);
    expect(Object.keys(body).slice(0, 6)).toEqual(["entries", "count", "as_of", "since", "since_reason", "page"]);
    expect(body.count).toBe(2);
    expect(Object.keys(body.entries[0])).toEqual([
      "id", "type", "title", "body", "agent_id", "occurred_at", "created_at", "metadata",
    ]);
    expect(body.entries[0]).toEqual({
      id: uuid(101), type: "note", title: "title 1", body: null, agent_id: null,
      occurred_at: "2026-10-11T08:00:58.500Z", created_at: "2026-10-11T09:00:00.000Z", metadata: { n: 1 },
    });
    expect(body.page).toEqual({
      cursor: null, next_cursor: null, has_more: false, limit: 50, order: "occurred_at_desc,id_desc",
    });
  });

  test("filters and since keep their SQL; a cursor walks below the last returned row", async () => {
    chronicleRows = [chronicleRow(1), chronicleRow(2), chronicleRow(3)];
    const agent = uuid(7);
    const first = await get(`/v1/chronicle?limit=2&type=note&agent_id=${agent}&since=2026-10-01T00:00:00Z`);
    const [firstRead] = reads('"agent_continuity"."chronicle"');
    expect(firstRead!.sql).toContain(
      'where ("agent_continuity"."chronicle"."project_id" = $1 and "agent_continuity"."chronicle"."agent_id" = $2 and "agent_continuity"."chronicle"."type" = $3 and "agent_continuity"."chronicle"."occurred_at" > $4)',
    );
    expect(firstRead!.params).toEqual([PROJECT, agent, "note", "2026-10-01T00:00:00.000Z", 3]);
    expect(first.body.page.has_more).toBe(true);
    expect(decode(first.body.page.next_cursor)).toMatchObject({
      v: 1, s: "chronicle", t: "2026-10-11T08:00:57.500002Z", i: uuid(102),
    });

    queries = [];
    chronicleRows = [chronicleRow(3)];
    const next = await get(
      `/v1/chronicle?limit=2&type=note&agent_id=${agent}&since=2026-10-01T00:00:00Z&cursor=${first.body.page.next_cursor}`,
    );
    expect(next.status).toBe(200);
    const [read] = reads('"agent_continuity"."chronicle"');
    expect(read!.sql).toContain(
      'and ("agent_continuity"."chronicle"."occurred_at" <= $5::timestamptz AND ("agent_continuity"."chronicle"."occurred_at", "agent_continuity"."chronicle"."id") < ($6::timestamptz, $7::uuid))',
    );
    expect(read!.params).toEqual([
      PROJECT, agent, "note", "2026-10-01T00:00:00.000Z",
      "2026-10-11T08:00:57.500002Z", "2026-10-11T08:00:57.500002Z", uuid(102), 3,
    ]);
    expect(next.body.count).toBe(1);
    expect(next.body.page.next_cursor).toBeNull();
    expect(next.body.page.has_more).toBe(false);

    for (const path of [
      `/v1/chronicle?limit=2&type=vow&agent_id=${agent}&since=2026-10-01T00:00:00Z&cursor=${first.body.page.next_cursor}`,
      `/v1/chronicle?limit=2&type=note&since=2026-10-01T00:00:00Z&cursor=${first.body.page.next_cursor}`,
      `/v1/chronicle?limit=2&type=note&agent_id=${agent}&cursor=${first.body.page.next_cursor}`,
    ]) {
      const refused = await get(path);
      expect(refused.status, path).toBe(400);
      expect(refused.body.error, path).toBe("cursor_invalid");
    }
  });

  test("a cursor from another store or a loose limit is refused before any read", async () => {
    memoryRows = [memoryRow(1), memoryRow(2)];
    const memoryCursor = (await get("/v1/memories?limit=1")).body.page.next_cursor;
    queries = [];
    const crossed = await get(`/v1/chronicle?cursor=${memoryCursor}`);
    expect(crossed.status).toBe(400);
    expect(crossed.body.error).toBe("cursor_invalid");

    chronicleRows = [chronicleRow(1), chronicleRow(2)];
    const cursor = (await get("/v1/chronicle?limit=1")).body.page.next_cursor;
    queries = [];
    const loose = await get(`/v1/chronicle?limit=abc&cursor=${cursor}`);
    expect(loose.status).toBe(400);
    expect(loose.body.error).toBe("limit_invalid");
    expect(reads('"agent_continuity"."chronicle"')).toHaveLength(0);
  });

  test("a non-UUID agent_id is a 400 before any read, never a uuid cast failure", async () => {
    chronicleRows = [chronicleRow(1), chronicleRow(2)];
    const cursor = (await get("/v1/chronicle?limit=1")).body.page.next_cursor;
    queries = [];
    for (const path of [
      "/v1/chronicle?agent_id=not-a-uuid",
      "/v1/chronicle?agent_id=did:at:00000000-0000-4000-8000-000000000007",
      `/v1/chronicle?agent_id=${uuid(7)}x`,
      `/v1/chronicle?agent_id=not-a-uuid&limit=1&cursor=${cursor}`,
    ]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(400);
      expect(body.error, path).toBe("agent_id_invalid");
      expect(typeof body.message, path).toBe("string");
      expect(typeof body.hint, path).toBe("string");
    }
    expect(reads('"agent_continuity"."chronicle"')).toHaveLength(0);

    // Empty stays "no filter"; an uppercase UUID is still a UUID.
    for (const [path, params] of [
      ["/v1/chronicle?agent_id=", [PROJECT, 51]],
      [`/v1/chronicle?agent_id=${uuid(7).toUpperCase()}`, [PROJECT, uuid(7).toUpperCase(), 51]],
    ] as const) {
      queries = [];
      expect((await get(path)).status, path).toBe(200);
      expect(reads('"agent_continuity"."chronicle"')[0]!.params, path).toEqual([...params]);
    }
  });
});

/** All strand columns in table order, plus cursor_at when withCursor. */
function strandRow(n: number, withCursor: boolean): unknown[] {
  const createdAt = `2026-10-10T12:00:${String(59 - n).padStart(2, "0")}.250Z`;
  const row = [
    uuid(200 + n), PROJECT, null, null, null, `topic ${n}`, false, null, false, "active", null, "private",
    null, 0, null, null, null, { n }, createdAt, "2026-10-11T00:00:00.000Z",
  ];
  return withCursor ? [...row, `${createdAt.slice(0, 23)}${String(n).padStart(3, "0")}Z`] : row;
}

describe("GET /v1/strands walk", () => {
  test("order=recent (default) is a truthful window: has_more without a cursor, plus a hint", async () => {
    strandRows = [strandRow(1, false), strandRow(2, false), strandRow(3, false)];
    const { status, body } = await get("/v1/strands?limit=2&status=active");
    expect(status).toBe(200);
    const [read] = reads('"strand"."strands"');
    expect(read!.sql).toMatch(/^select "id", "project_id", .* "updated_at" from "strand"\."strands" where/);
    expect(read!.sql).not.toContain("to_char");
    expect(read!.sql).toMatch(
      / order by "strand"\."strands"\."last_thought_at" desc, "strand"\."strands"\."created_at" desc, "strand"\."strands"\."id" desc limit \$3$/,
    );
    expect(read!.params).toEqual([PROJECT, "active", 3]);
    expect(Object.keys(body)).toEqual(["strands", "count", "page"]);
    expect(body.count).toBe(2);
    expect(body.strands[0]).toMatchObject({ id: uuid(201), topic: "topic 1", created_at: "2026-10-10T12:00:58.250Z" });
    expect(body.page).toMatchObject({
      cursor: null, next_cursor: null, has_more: true, limit: 2, order: "last_thought_at_desc,created_at_desc,id_desc",
    });
    expect(body.page.hint).toMatch(/order=created/);

    const explicit = await get("/v1/strands?order=recent");
    expect(explicit.status).toBe(200);
    expect(explicit.body.page.next_cursor).toBeNull();
  });

  test("a cursor with order=recent, an unknown order, or an empty order is refused", async () => {
    strandRows = [strandRow(1, true), strandRow(2, true)];
    const cursor = (await get("/v1/strands?order=created&limit=1")).body.page.next_cursor;
    queries = [];
    for (const path of [`/v1/strands?cursor=${cursor}`, `/v1/strands?order=recent&cursor=${cursor}`]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(400);
      expect(body.error, path).toBe("cursor_invalid");
      expect(body.hint, path).toMatch(/order=created/);
    }
    for (const path of ["/v1/strands?order=updated", "/v1/strands?order="]) {
      const { status, body } = await get(path);
      expect(status, path).toBe(400);
      expect(body.error, path).toBe("order_invalid");
    }
    expect(reads('"strand"."strands"')).toHaveLength(0);
  });

  test("order=created walks created_at DESC, id DESC with the filters bound", async () => {
    strandRows = [strandRow(1, true), strandRow(2, true), strandRow(3, true)];
    const first = await get("/v1/strands?order=created&limit=2&agent_id=agent-a");
    const [firstRead] = reads('"strand"."strands"');
    expect(firstRead!.sql).toContain(`to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursor_at"`);
    expect(firstRead!.sql).toMatch(/ order by "strand"\."strands"\."created_at" desc, "strand"\."strands"\."id" desc limit \$3$/);
    expect(firstRead!.params).toEqual([PROJECT, "agent-a", 3]);
    expect(first.body.count).toBe(2);
    expect(first.body.strands[1]).not.toHaveProperty("cursorAt");
    expect(first.body.page).toMatchObject({ has_more: true, limit: 2, order: "created_at_desc,id_desc" });
    expect(first.body.page).not.toHaveProperty("hint");
    expect(decode(first.body.page.next_cursor)).toMatchObject({
      v: 1, s: "strands.created", t: "2026-10-10T12:00:57.250002Z", i: uuid(202),
    });

    queries = [];
    strandRows = [strandRow(3, true)];
    const next = await get(`/v1/strands?order=created&limit=2&agent_id=agent-a&cursor=${first.body.page.next_cursor}`);
    expect(next.status).toBe(200);
    const [read] = reads('"strand"."strands"');
    expect(read!.sql).toContain(
      'and ("strand"."strands"."created_at" <= $3::timestamptz AND ("strand"."strands"."created_at", "strand"."strands"."id") < ($4::timestamptz, $5::uuid))',
    );
    expect(read!.params).toEqual([
      PROJECT, "agent-a", "2026-10-10T12:00:57.250002Z", "2026-10-10T12:00:57.250002Z", uuid(202), 3,
    ]);
    expect(next.body.page).toEqual({
      cursor: first.body.page.next_cursor, next_cursor: null, has_more: false, limit: 2, order: "created_at_desc,id_desc",
    });

    const changed = await get(`/v1/strands?order=created&limit=2&agent_id=agent-b&cursor=${first.body.page.next_cursor}`);
    expect(changed.status).toBe(400);
    expect(changed.body.error).toBe("cursor_invalid");
    const statusChanged = await get(`/v1/strands?order=created&status=active&agent_id=agent-a&cursor=${first.body.page.next_cursor}`);
    expect(statusChanged.status).toBe(400);
  });
});
