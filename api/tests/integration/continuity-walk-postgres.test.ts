/** Opt-in disposable PostgreSQL proof of the continuity walks.
 * Doctrine: docs/AGENT-WEB-SURFACE.md (continuity walks).
 *
 * Only CONTINUITY_WALK_TEST_DATABASE_URL opts in; loopback and the exact
 * disposable database name are mandatory, and existing application schemas
 * are refused. Minimal synthetic tables stand in for the real ones; the real
 * route handlers run real SQL over them. Each walk follows next_cursor (or
 * next_after) with limit 1..3 and must visit every row exactly once, in order,
 * including rows from one transaction (identical now()) and rows inside one
 * millisecond. The walks run first without and then with the proposed Track
 * A' memories index, applied inline here because this PR ships no migration.
 * Not wired into CI (decision D8). */
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import type { Sql } from "postgres";

import type { ProjectContext } from "../../src/auth/middleware";
import postgres from "../fixtures/verified-postgres";

const DATABASE = process.env.CONTINUITY_WALK_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const DATABASE_NAME = "/agenttool_continuity_walk_test";
const P = "11111111-1111-4111-8111-111111111111";
const O = "99999999-9999-4999-8999-999999999999";
const AGENT = "22222222-2222-4222-8222-222222222222";
const SCHEMAS = ["memory", "agent_continuity", "strand", "correspondence"];
const PROPOSED_MEMORY_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_memories_project_created_id ON memory.memories (project_id, created_at DESC, id DESC)";

type Database = ReturnType<typeof drizzle>;
let admin: Sql;
let plain: Sql;
let indexed: Sql;
let plainDb: Database;
let indexedDb: Database;
let current: Database | null = null;
let owned = false;
const logged: Array<{ sql: string; params: unknown[] }> = [];

// Route modules import `db` once; this proxy lets the test switch between a
// default-planner client and one that forbids sequential scans.
const db = new Proxy({}, {
  get(_target, property) {
    if (!current) throw new Error("continuity walk database not selected");
    const value = (current as unknown as Record<PropertyKey, unknown>)[property];
    return typeof value === "function" ? value.bind(current) : value;
  },
});
mock.module("../../src/db/client", () => ({ db }));

const { default: memoriesRouter } = await import("../../src/routes/memory/memories");
const { default: continuityRouter } = await import("../../src/routes/continuity");
const { default: strandsRouter } = await import("../../src/routes/strand/strands");
const { default: correspondenceRouter } = await import("../../src/routes/correspondence");

function app(project = P): Hono<ProjectContext> {
  const root = new Hono<ProjectContext>();
  root.use("*", async (c, next) => {
    c.set("project", { id: project } as never);
    await next();
  });
  root.route("/v1/memories", memoriesRouter);
  root.route("/v1", continuityRouter);
  root.route("/v1/strands", strandsRouter);
  root.route("/v1/correspondence", correspondenceRouter);
  return root;
}

async function getJson(path: string): Promise<any> {
  const response = await app().request(path);
  const body = await response.json();
  expect(response.status, `${path} ${JSON.stringify(body)}`).toBe(200);
  return body;
}

/** Follow page.next_cursor to the end; returns ids in walk order. */
async function walk(
  path: string,
  field: "memories" | "entries" | "strands",
  limit: number,
  between?: (page: number) => Promise<void>,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 200; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const body = await getJson(
      `${path}${separator}limit=${limit}${cursor === null ? "" : `&cursor=${cursor}`}`,
    );
    expect(body.page.limit).toBe(limit);
    expect(body.page.cursor).toBe(cursor);
    expect(body.page.next_cursor === null).toBe(!body.page.has_more);
    expect(body[field].length).toBeLessThanOrEqual(limit);
    if (body.page.has_more) expect(body[field].length).toBe(limit);
    ids.push(...body[field].map((row: { id: string }) => row.id));
    cursor = body.page.next_cursor;
    if (cursor === null) return ids;
    await between?.(page);
  }
  throw new Error("walk did not terminate");
}

async function expectedIds(query: Promise<Array<{ id: string }>>): Promise<string[]> {
  return (await query).map((row) => row.id);
}

beforeAll(async () => {
  if (!DATABASE) return;
  const url = new URL(DATABASE);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== DATABASE_NAME || url.search || url.hash) {
    throw new Error("continuity walks require an explicit loopback disposable database");
  }
  admin = postgres(DATABASE, {
    max: 2,
    prepare: false,
    onnotice: () => {},
    connection: { application_name: "continuity-walk-admin-test" },
  });
  const exists = await admin`SELECT nspname FROM pg_namespace WHERE nspname IN ${admin(SCHEMAS)}`;
  if (exists.length) throw new Error("refusing an existing application schema");
  await admin.begin(async (tx) => {
    await tx.unsafe(`
      CREATE SCHEMA memory; CREATE SCHEMA agent_continuity; CREATE SCHEMA strand; CREATE SCHEMA correspondence;
      CREATE TABLE memory.memories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, agent_id text, identity_id text,
        type text NOT NULL, key text, content text NOT NULL, embedding real[], metadata jsonb DEFAULT '{}',
        importance double precision NOT NULL DEFAULT 0.5, tier text NOT NULL DEFAULT 'episodic',
        visibility text NOT NULL DEFAULT 'private', accessed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz);
      CREATE TABLE memory.memory_attestations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), memory_id uuid NOT NULL, attester_did text NOT NULL,
        signing_key_id uuid NOT NULL, signature text NOT NULL, signature_context text, signed_payload text,
        source_grant_id uuid, attested_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE agent_continuity.chronicle (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, agent_id uuid, type text NOT NULL,
        title text NOT NULL, body text, metadata jsonb DEFAULT '{}',
        occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX idx_chronicle_project_time ON agent_continuity.chronicle (project_id, occurred_at);
      CREATE TABLE strand.strands (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, agent_id text, identity_id uuid,
        parent_strand_id uuid, topic text, topic_encrypted boolean NOT NULL DEFAULT false, mood text,
        mood_encrypted boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'active', importance double precision,
        visibility text NOT NULL DEFAULT 'private', last_thought_at timestamptz, last_thought_seq integer NOT NULL DEFAULT 0,
        next_revisit_at timestamptz, state_ciphertext text, state_nonce text, metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE correspondence.events (
        project_id uuid NOT NULL, event_id text NOT NULL, received_seq bigint NOT NULL, repository_id text NOT NULL,
        CONSTRAINT correspondence_events_pk PRIMARY KEY (project_id, event_id),
        CONSTRAINT correspondence_events_project_seq_unique UNIQUE (project_id, received_seq));
      CREATE INDEX correspondence_events_project_repo_seq_idx ON correspondence.events (project_id, repository_id, received_seq);
    `);
  });
  owned = true;

  // Memories: one transaction shares now(); three rows share a millisecond;
  // an expired row and another project's rows must never appear.
  await admin.begin(async (tx) => {
    for (const n of [1, 2, 3]) {
      await tx`INSERT INTO memory.memories (project_id, type, content) VALUES (${P}, 'episodic', ${`same transaction ${n}`})`;
    }
  });
  await admin.unsafe(`
    INSERT INTO memory.memories (project_id, type, key, content, created_at, embedding, expires_at) VALUES
      ('${P}', 'semantic', NULL, 'sub-ms 999', '2026-10-11T09:15:02.123999Z', ARRAY[0.5]::real[], NULL),
      ('${P}', 'semantic', NULL, 'sub-ms 456', '2026-10-11T09:15:02.123456Z', NULL, NULL),
      ('${P}', 'semantic', NULL, 'sub-ms 001', '2026-10-11T09:15:02.123001Z', NULL, NULL),
      ('${P}', 'procedural', 'handoff', 'handoff new', '2026-10-10T00:00:00.000002Z', NULL, NULL),
      ('${P}', 'procedural', 'handoff', 'handoff old', '2026-10-10T00:00:00.000001Z', NULL, NULL),
      ('${P}', 'procedural', 'handoff', 'handoff tie a', '2026-09-01T00:00:00Z', NULL, NULL),
      ('${P}', 'procedural', 'handoff', 'handoff tie b', '2026-09-01T00:00:00Z', NULL, NULL),
      ('${P}', 'episodic', NULL, 'old', '2026-01-01T00:00:00Z', NULL, NULL),
      ('${P}', 'working', NULL, 'expired', '2026-10-11T09:15:02.124Z', NULL, now() - interval '1 day'),
      ('${O}', 'episodic', NULL, 'foreign one', '2026-10-11T09:15:02.123500Z', NULL, NULL),
      ('${O}', 'procedural', 'handoff', 'foreign handoff', '2026-10-10T00:00:00.000003Z', NULL, NULL);
  `);

  // Chronicle walks occurred_at (caller-set), with sub-ms and tied rows.
  await admin.begin(async (tx) => {
    for (const n of [1, 2]) {
      await tx`INSERT INTO agent_continuity.chronicle (project_id, type, title) VALUES (${P}, 'note', ${`same transaction ${n}`})`;
    }
  });
  await admin.unsafe(`
    INSERT INTO agent_continuity.chronicle (project_id, agent_id, type, title, occurred_at) VALUES
      ('${P}', '${AGENT}', 'vow', 'sub-ms 900', '2026-10-11T08:00:00.000900Z'),
      ('${P}', '${AGENT}', 'note', 'sub-ms 100', '2026-10-11T08:00:00.000100Z'),
      ('${P}', NULL, 'note', 'tie a', '2026-07-01T00:00:00Z'),
      ('${P}', NULL, 'note', 'tie b', '2026-07-01T00:00:00Z'),
      ('${P}', NULL, 'seal', 'tie c', '2026-07-01T00:00:00Z'),
      ('${P}', '${AGENT}', 'note', 'ancient', '2001-01-01T00:00:00Z'),
      ('${O}', '${AGENT}', 'note', 'foreign', '2026-10-11T08:00:00.000500Z');
  `);

  // Strands walk created_at; last_thought_at would reorder the recent window.
  await admin.begin(async (tx) => {
    for (const n of [1, 2]) {
      await tx`INSERT INTO strand.strands (project_id, topic) VALUES (${P}, ${`same transaction ${n}`})`;
    }
  });
  await admin.unsafe(`
    INSERT INTO strand.strands (project_id, agent_id, topic, status, created_at, last_thought_at) VALUES
      ('${P}', 'agent-a', 'sub-ms 750', 'active', '2026-10-01T00:00:00.000750Z', '2026-10-11T00:00:00Z'),
      ('${P}', 'agent-a', 'sub-ms 250', 'dormant', '2026-10-01T00:00:00.000250Z', NULL),
      ('${P}', 'agent-b', 'tie a', 'active', '2026-06-01T00:00:00Z', NULL),
      ('${P}', 'agent-b', 'tie b', 'active', '2026-06-01T00:00:00Z', '2026-10-10T00:00:00Z'),
      ('${O}', 'agent-a', 'foreign', 'active', '2026-10-01T00:00:00.000500Z', NULL);
  `);

  await admin.unsafe(`
    INSERT INTO correspondence.events (project_id, event_id, received_seq, repository_id) VALUES
      ('${P}', 'e1', 1, 'repo-b'), ('${P}', 'e2', 2, 'repo-a'), ('${P}', 'e3', 3, 'repo-b'),
      ('${P}', 'e4', 4, 'Repo-Z'), ('${P}', 'e5', 5, 'repo-c'), ('${P}', 'e6', 6, 'repo-a'),
      ('${P}', 'e7', 7, 'github.com/x/y'),
      ('${O}', 'e1', 1, 'repo-foreign'), ('${O}', 'e2', 2, 'repo-a');
  `);

  const logger = { logQuery: (query: string, params: unknown[]) => logged.push({ sql: query, params }) };
  plain = postgres(DATABASE, { max: 2, prepare: false, connection: { application_name: "continuity-walk-plain-test" } });
  // One connection, so the session setting below governs every query on it.
  indexed = postgres(DATABASE, { max: 1, prepare: false, connection: { application_name: "continuity-walk-indexed-test" } });
  await indexed`SET enable_seqscan = off`;
  plainDb = drizzle(plain, { logger });
  indexedDb = drizzle(indexed, { logger });
  current = plainDb;
});

afterAll(async () => {
  current = null;
  await plain?.end({ timeout: 2 });
  await indexed?.end({ timeout: 2 });
  if (owned) {
    await admin.unsafe("DROP SCHEMA correspondence CASCADE; DROP SCHEMA strand CASCADE; DROP SCHEMA agent_continuity CASCADE; DROP SCHEMA memory CASCADE;");
  }
  await admin?.end({ timeout: 2 });
});

const liveMemories = (where = "") => admin.unsafe<Array<{ id: string }>>(
  `SELECT id FROM memory.memories WHERE project_id = '${P}' AND (expires_at IS NULL OR expires_at > now()) ${where}
   ORDER BY created_at DESC, id DESC`,
);

async function proveMemoryWalks(): Promise<void> {
  const all = await expectedIds(liveMemories());
  expect(all).toHaveLength(11);
  const handoff = await expectedIds(liveMemories("AND key = 'handoff'"));
  const recent = await expectedIds(liveMemories("AND created_at > '2026-09-15T00:00:00Z'"));
  for (const limit of [1, 2, 3]) {
    const walked = await walk("/v1/memories", "memories", limit);
    expect(walked).toEqual(all);
    expect(new Set(walked).size).toBe(walked.length);
    expect(await walk("/v1/memories?key=handoff", "memories", limit)).toEqual(handoff);
    expect(await walk("/v1/memories?since=2026-09-15T00:00:00Z", "memories", limit)).toEqual(recent);
  }
  const contents = (await getJson("/v1/memories?limit=100")).memories.map((m: { content: string }) => m.content);
  const subMs = contents.filter((content: string) => content.startsWith("sub-ms"));
  expect(subMs).toEqual(["sub-ms 999", "sub-ms 456", "sub-ms 001"]);
  expect(contents).not.toContain("expired");
  expect(contents.some((content: string) => content.startsWith("foreign"))).toBe(false);
  const first = (await getJson("/v1/memories?limit=100")).memories;
  expect(first.find((m: { content: string }) => m.content === "sub-ms 999").has_embedding).toBe(true);
  expect(first.find((m: { content: string }) => m.content === "sub-ms 456").has_embedding).toBe(false);
}

databaseTest("memories: every live row exactly once, in order, at limits 1..3 without the proposed index", async () => {
  current = plainDb;
  await proveMemoryWalks();
});

databaseTest("memories: rows written during a walk never duplicate or hide an original row", async () => {
  current = plainDb;
  const original = await expectedIds(liveMemories());
  const inserted: string[] = [];
  const walked = await walk("/v1/memories", "memories", 2, async (page) => {
    if (page !== 1) return;
    // Newer than the cursor: above the walk, so not seen by this walk.
    const [newer] = await admin`INSERT INTO memory.memories (project_id, type, content) VALUES (${P}, 'episodic', 'written during walk') RETURNING id`;
    // Backdated below the cursor: committed before its page is read, so seen.
    const [older] = await admin`INSERT INTO memory.memories (project_id, type, content, created_at) VALUES (${P}, 'episodic', 'backdated during walk', '2000-01-01T00:00:00Z') RETURNING id`;
    inserted.push(newer!.id, older!.id);
  });
  try {
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked.filter((id) => original.includes(id))).toEqual(original);
    expect(walked).not.toContain(inserted[0]);
    expect(walked.at(-1)).toBe(inserted[1]);
  } finally {
    await admin`DELETE FROM memory.memories WHERE id IN ${admin(inserted)}`;
  }
});

async function proveChronicleWalks(): Promise<void> {
  const all = await expectedIds(admin.unsafe<Array<{ id: string }>>(
    `SELECT id FROM agent_continuity.chronicle WHERE project_id = '${P}' ORDER BY occurred_at DESC, id DESC`,
  ));
  expect(all).toHaveLength(8);
  const agentNotes = await expectedIds(admin.unsafe<Array<{ id: string }>>(
    `SELECT id FROM agent_continuity.chronicle WHERE project_id = '${P}' AND agent_id = '${AGENT}' AND type = 'note'
       AND occurred_at > '2002-01-01T00:00:00Z' ORDER BY occurred_at DESC, id DESC`,
  ));
  expect(agentNotes).toHaveLength(1);
  for (const limit of [1, 2, 3]) {
    const walked = await walk("/v1/chronicle", "entries", limit);
    expect(walked).toEqual(all);
    expect(new Set(walked).size).toBe(walked.length);
    expect(await walk(`/v1/chronicle?agent_id=${AGENT}&type=note&since=2002-01-01T00:00:00Z`, "entries", limit))
      .toEqual(agentNotes);
  }
  const titles = (await getJson("/v1/chronicle?limit=200")).entries.map((e: { title: string }) => e.title);
  expect(titles.filter((title: string) => title.startsWith("sub-ms"))).toEqual(["sub-ms 900", "sub-ms 100"]);
  expect(titles).not.toContain("foreign");
  // agent_id is a uuid column: a malformed value is refused before the
  // query instead of failing PostgreSQL's cast (22P02) as a 500.
  const malformed = await app().request("/v1/chronicle?agent_id=not-a-uuid");
  expect(malformed.status).toBe(400);
  expect((await malformed.json() as any).error).toBe("agent_id_invalid");
  // An empty limit reads the default page, as memories and strands do.
  const empty = await getJson("/v1/chronicle?limit=");
  expect(empty.page.limit).toBe(50);
  expect(empty.entries.map((e: { id: string }) => e.id)).toEqual(all);
}

async function proveStrandWalks(): Promise<void> {
  const all = await expectedIds(admin.unsafe<Array<{ id: string }>>(
    `SELECT id FROM strand.strands WHERE project_id = '${P}' ORDER BY created_at DESC, id DESC`,
  ));
  expect(all).toHaveLength(6);
  const agentA = await expectedIds(admin.unsafe<Array<{ id: string }>>(
    `SELECT id FROM strand.strands WHERE project_id = '${P}' AND agent_id = 'agent-a' ORDER BY created_at DESC, id DESC`,
  ));
  for (const limit of [1, 2, 3]) {
    const walked = await walk("/v1/strands?order=created", "strands", limit);
    expect(walked).toEqual(all);
    expect(new Set(walked).size).toBe(walked.length);
    expect(await walk("/v1/strands?order=created&agent_id=agent-a", "strands", limit)).toEqual(agentA);
  }
  // The default window keeps today's order, where PostgreSQL's DESC puts
  // never-thought (NULL last_thought_at) strands first.
  const windowIds = await expectedIds(admin.unsafe<Array<{ id: string }>>(
    `SELECT id FROM strand.strands WHERE project_id = '${P}'
      ORDER BY last_thought_at DESC, created_at DESC, id DESC LIMIT 2`,
  ));
  const window = await getJson("/v1/strands?limit=2");
  expect(window.page).toMatchObject({ has_more: true, next_cursor: null });
  expect(window.strands.map((s: { id: string }) => s.id)).toEqual(windowIds);
}

async function proveRepositoryWalk(): Promise<void> {
  const expected = await admin.unsafe<Array<{ repository_id: string; last_received_seq: string }>>(
    `SELECT repository_id, max(received_seq)::text AS last_received_seq FROM correspondence.events
      WHERE project_id = '${P}' GROUP BY repository_id ORDER BY repository_id`,
  );
  expect(expected).toHaveLength(5);
  const lastId = expected.at(-1)!.repository_id;
  // 5 is exactly the repository count (one full final page); 10 is more.
  for (const limit of [1, 2, 3, 5, 10]) {
    const seen: Array<{ repository_id: string; last_received_seq: string }> = [];
    let after: string | null = null;
    let pages = 0;
    for (let page = 0; page < 20; page++) {
      const query = `limit=${limit}${after === null ? "" : `&after=${encodeURIComponent(after)}`}`;
      const response = await app().request(`/v1/correspondence/repositories?${query}`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      pages += 1;
      expect(body.page.after).toBe(after);
      // has_more comes from a sentinel row, so the walk never needs a
      // trailing empty page, and the page holding the last repository
      // says has_more false.
      expect(body.repositories.length, `limit=${limit} page ${page}`).toBeGreaterThan(0);
      const holdsLast = body.repositories.some((row: { repository_id: string }) => row.repository_id === lastId);
      expect(body.page.has_more, `limit=${limit} page ${page}`).toBe(!holdsLast);
      seen.push(...body.repositories);
      after = body.page.next_after;
      if (!body.page.has_more) break;
    }
    expect(seen).toEqual(expected.map((row) => ({ ...row })));
    expect(pages, `limit=${limit}`).toBe(Math.ceil(expected.length / limit));
  }
  const tail = await (await app().request(
    `/v1/correspondence/repositories?after=${encodeURIComponent(expected.at(-1)!.repository_id)}`,
  )).json() as any;
  expect(tail.repositories).toEqual([]);
  expect(tail.page).toEqual({ after: expected.at(-1)!.repository_id, next_after: expected.at(-1)!.repository_id, has_more: false });
}

databaseTest("chronicle, strands order=created and correspondence repositories walk completely", async () => {
  current = plainDb;
  await proveChronicleWalks();
  await proveStrandWalks();
  await proveRepositoryWalk();
});

async function explainLast(fragment: string): Promise<string> {
  const query = logged.filter((entry) => entry.sql.includes(fragment)).at(-1);
  expect(query, fragment).toBeDefined();
  const rows = await indexed.unsafe(`EXPLAIN ${query!.sql}`, query!.params as never[]);
  return rows.map((row) => Object.values(row)[0]).join("\n");
}

databaseTest("with the proposed memories index the same walks hold and every walk query can use an index", async () => {
  await admin.unsafe(PROPOSED_MEMORY_INDEX);
  current = indexedDb;
  await proveMemoryWalks();
  await proveChronicleWalks();
  await proveStrandWalks();
  await proveRepositoryWalk();

  // Sequential scans are disabled on this client, so these plans show the
  // walk predicates are index-usable. Tiny tables say nothing about which
  // plan production volumes would choose.
  logged.length = 0;
  const first = await getJson("/v1/memories?limit=2");
  await getJson(`/v1/memories?limit=2&cursor=${first.page.next_cursor}`);
  expect(await explainLast('from "memory"."memories" where')).toContain("idx_memories_project_created_id");
  const chronicle = await getJson("/v1/chronicle?limit=2");
  await getJson(`/v1/chronicle?limit=2&cursor=${chronicle.page.next_cursor}`);
  expect(await explainLast('from "agent_continuity"."chronicle"')).toContain("idx_chronicle_project_time");
  await getJson("/v1/correspondence/repositories?limit=2");
  expect(await explainLast("WITH RECURSIVE repositories")).toContain("correspondence_events_project_repo_seq_idx");
});
