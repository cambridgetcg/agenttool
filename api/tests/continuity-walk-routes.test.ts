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
      ["/v1/memories?limit=abc", 20],
      ["/v1/memories?limit=20abc", 20],
      ["/v1/memories?limit=500", 100],
      ["/v1/memories", 20],
      ["/v1/memories?key=k&limit=abc", 20],
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
