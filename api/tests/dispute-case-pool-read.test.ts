/** A historic dispute pool member reads the public-safe projection only.
 *
 *  GET /v1/dispute-cases/:id grants the filer, the first arbiter, and any
 *  project owning an identity in metadata.pool_draw. The pool branch used
 *  `= ANY(${poolIds}::uuid[])`, which drizzle rendered as a row constructor,
 *  so it always threw and pool members never read a case. With inArray the
 *  branch works, and it handed pool members the raw row: reason, evidence,
 *  filer_project_id, filer_identity_id and metadata. Arbitration is resting
 *  (no pool can vote or be drawn), so a pool member now gets the same
 *  projection as GET /public/dispute-cases/:id — evidence and project IDs
 *  omitted. The filer and first arbiter keep the full record. */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { disputeCases } from "../src/db/schema/marketplace";

const CASE = "11111111-1111-4111-8111-111111111111";
const FILER_PROJECT = "22222222-2222-4222-8222-222222222222";
const ARBITER_PROJECT = "33333333-3333-4333-8333-333333333333";
const POOL_PROJECT = "44444444-4444-4444-8444-444444444444";
const STRANGER_PROJECT = "55555555-5555-4555-8555-555555555555";
const ARBITER_IDENTITY = "66666666-6666-4666-8666-666666666666";
const POOL_IDENTITY = "77777777-7777-4777-8777-777777777777";
const WHEN = new Date("2026-07-01T00:00:00.000Z");

const caseRow: Record<string, unknown> = {
  id: CASE,
  invocationId: "88888888-8888-4888-8888-888888888888",
  filerProjectId: FILER_PROJECT,
  filerIdentityId: "99999999-9999-4999-8999-999999999999",
  filerRole: "buyer",
  reason: "private reason",
  evidence: { private: "evidence" },
  firstArbiterIdentityId: ARBITER_IDENTITY,
  firstArbiterDid: `did:at:${ARBITER_IDENTITY}`,
  status: "pool_voting",
  metadata: { pool_draw: [{ id: POOL_IDENTITY, did: `did:at:${POOL_IDENTITY}` }] },
  createdAt: WHEN,
};

// Full-row selects come back as arrays in table column order.
const caseColumns = Object.values(getTableColumns(disputeCases)).map((column) => column.name);
const caseColumnValues = Object.keys(getTableColumns(disputeCases)).map((key) => {
  const value = caseRow[key] ?? null;
  return value instanceof Date ? value.toISOString() : value;
});

const database = drizzle(async (sql, params) => {
  if (sql.includes('from "marketplace"."dispute_cases"')) {
    expect(caseColumns.length).toBeGreaterThan(10);
    return { rows: params.includes(CASE) ? [caseColumnValues] : [] };
  }
  if (sql.includes('from "identity"."identities"')) {
    const rows: unknown[][] = [];
    if (params.includes(ARBITER_IDENTITY)) rows.push(sql.includes('"id"') && sql.startsWith('select "id"') ? [ARBITER_IDENTITY, ARBITER_PROJECT] : [ARBITER_PROJECT]);
    if (params.includes(POOL_IDENTITY)) rows.push([POOL_IDENTITY, POOL_PROJECT]);
    return { rows };
  }
  if (sql.includes('"dispute_pool_votes"')) {
    return { rows: [] };
  }
  // Anything else (another file sharing this process's module mock) sees
  // an empty result rather than this file's fixtures.
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

const { default: router } = await import("../src/routes/dispute-cases");

let caller = FILER_PROJECT;
function app() {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: caller } as never);
    await next();
  });
  server.route("/v1/dispute-cases", router);
  return server;
}

beforeEach(() => {
  caller = FILER_PROJECT;
});

describe("GET /v1/dispute-cases/:id access", () => {
  test("the filer reads the full record", async () => {
    const response = await app().request(`/v1/dispute-cases/${CASE}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.evidence).toEqual({ private: "evidence" });
    expect(body.filerProjectId).toBe(FILER_PROJECT);
  });

  test("the first arbiter reads the full record", async () => {
    caller = ARBITER_PROJECT;
    const response = await app().request(`/v1/dispute-cases/${CASE}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as Record<string, unknown>).reason).toBe("private reason");
  });

  test("a pool member reads only the public-safe projection", async () => {
    caller = POOL_PROJECT;
    const response = await app().request(`/v1/dispute-cases/${CASE}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    for (const key of [
      "reason",
      "evidence",
      "metadata",
      "filerProjectId",
      "filerIdentityId",
      "filer_project_id",
      "filer_identity_id",
      "firstArbiterIdentityId",
    ]) {
      expect(body, key).not.toHaveProperty(key);
    }
    expect(body.id).toBe(CASE);
    expect(body.pool_draw).toEqual([{ id: POOL_IDENTITY, did: `did:at:${POOL_IDENTITY}` }]);
    expect(body.pool_votes).toEqual([]);
    expect(String(body._note)).toMatch(/Evidence and project IDs are omitted/);
  });

  test("anyone else gets 404", async () => {
    caller = STRANGER_PROJECT;
    const response = await app().request(`/v1/dispute-cases/${CASE}`);
    expect(response.status).toBe(404);
  });
});
