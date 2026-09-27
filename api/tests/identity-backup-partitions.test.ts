/** Backup creation binds its UUID subject inside the insertion transaction. */
import { beforeEach, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";

const P = "11111111-2222-4333-8444-555555555555";
const Q = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const I = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const B = "99999999-7777-4888-8999-aaaaaaaaaaaa";
const WHEN = "2026-09-27T12:00:00.000Z";
let owner = P;
let status = "active";
let present = true;
let inTransaction = false;
let queries: { sql: string; params: unknown[] }[] = [];
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "identity"."identities"')) {
    expect(inTransaction).toBe(true);
    expect(sql).toContain("for share");
    expect(params).toEqual([I, P, "active", 1]);
    return { rows: present ? [[I, owner, `did:at:${I}`, status]] : [] };
  }
  if (sql.startsWith("insert")) {
    expect(inTransaction).toBe(true);
    return { rows: [[B, "primary", "argon2id-v1", WHEN]] };
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => {
  inTransaction = true;
  try { return await fn(database); } finally { inTransaction = false; }
}) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));
const { default: router } = await import("../src/routes/identity-backup");
function app() {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => { c.set("project", { id: P } as never); await next(); });
  server.route("/v1/identity/backup", router);
  return server;
}
function post() {
  return app().request("/v1/identity/backup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id: I, blob_base64: "opaque caller bytes" }),
  });
}
beforeEach(() => { owner = P; status = "active"; present = true; queries = []; inTransaction = false; });

test("an owned active identity is locked and stamped before storing a backup", async () => {
  const response = await post();
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.backup.id).toBe(B);
  expect(body.encryption_verified).toBe(false);
  const insert = queries.find((query) => query.sql.startsWith("insert"))!;
  expect(insert.params).toContain(P);
  expect(insert.params).toContain(I);
  expect(insert.params).toContain("opaque caller bytes");
});

test("missing, foreign and inactive UUID subjects never insert", async () => {
  for (const mode of ["missing", "foreign", "revoked", "at_rest"]) {
    queries = []; present = mode !== "missing"; owner = mode === "foreign" ? Q : P;
    status = ["revoked", "at_rest"].includes(mode) ? mode : "active";
    expect((await post()).status).toBe(404);
    expect(queries.some((query) => query.sql.startsWith("insert"))).toBe(false);
  }
});

test("existing list, blob read and revocation retain their project predicate", async () => {
  for (const [method, path] of [["GET", ""], ["GET", `/${B}`], ["DELETE", `/${B}`]]) {
    queries = [];
    await app().request(`/v1/identity/backup${path}`, { method });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('"identity_backups"."project_id" =');
    expect(queries[0].params).toContain(P);
  }
});
