/** /v1/dashboard opens on the same default subject as /v1/wake: the
 * project's primary identity (earliest active, never an enrolled guest),
 * else the oldest non-revoked row. It once took the oldest non-revoked row
 * outright, so an older enrolled guest or a memorial founder became "you"
 * on the dashboard while the wake showed the active primary.
 *
 * Real SQL generation over a hermetic pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";

const P = "11111111-2222-4333-8444-555555555555";
let queries: { sql: string; params: unknown[] }[] = [];
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

beforeEach(() => { queries = []; });

async function get(path: string) {
  const { default: router } = await import("../src/routes/dashboard");
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => { c.set("project", { id: P } as never); await next(); });
  server.route("/v1/dashboard", router);
  return server.request(path);
}

describe("GET /v1/dashboard default subject", () => {
  test("ranks the primary identity first, then the oldest non-revoked row", async () => {
    const res = await get("/v1/dashboard");
    expect(res.status).toBe(404);
    const lookup = queries.find((q) => q.sql.includes('from "identity"."identities"'));
    expect(lookup).toBeDefined();
    expect(lookup!.params).toContain(P);
    expect(lookup!.params).toContain("revoked");
    expect(lookup!.sql).toContain(`-> 'admission' = '"enrollment"'::jsonb`);
    expect(lookup!.sql).toMatch(/order by \("identity"\."identities"\."status" = \$\d+ and not \(.*\)\) desc, "identity"\."identities"\."created_at" asc, "identity"\."identities"\."id" asc/);
  });

  test("a malformed identity_id never reaches the uuid column", async () => {
    const res = await get("/v1/dashboard?identity_id=not-a-uuid");
    expect(res.status).toBe(404);
    expect(queries.filter((q) => q.sql.includes('from "identity"."identities"'))).toEqual([]);
  });

  test("an explicit identity_id stays inside the caller's project", async () => {
    const id = "66666666-7777-4888-8999-aaaaaaaaaaaa";
    await get(`/v1/dashboard?identity_id=${id}`);
    const lookup = queries.find((q) => q.sql.includes('from "identity"."identities"'));
    expect(lookup!.params).toContain(P);
    expect(lookup!.params).toContain(id);
  });
});
