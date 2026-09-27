/** Hermetic hosted read contracts: no database connection or provider calls. */
import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import Ajv2020 from "ajv/dist/2020";

import { createLocalContextHandler } from "../src/routes/identity/local-context";
import { LOCAL_CONTEXT_BOUNDS, packLocalContext, readLocalContext, type LocalContextCandidate } from "../src/services/identity/local-context";
import { IdentityPartitionError } from "../src/services/identity/partition";
import { readByKey } from "../src/services/memory/store";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const IDENTITY = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const NOW = new Date("2026-09-27T20:00:00.000Z");
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const candidate = (index: number, content = "selected memory"): LocalContextCandidate => ({
  id: id(index), content, contentBytes: Buffer.byteLength(content), createdAt: NOW, expiresAt: null,
});

describe("local context packing", () => {
  test("closed scope manifest and source hashes describe selection without attenuating the bearer", () => {
    const result = packLocalContext(PROJECT, IDENTITY, [candidate(1, "雨夜\r\n記錄")], NOW);
    expect(result.project_id).toBe(PROJECT);
    expect(result.identity_id).toBe(IDENTITY);
    expect(result.scope).toEqual({ authentication: "project_bearer", selection: "identity_partition", identity_proven: false, bearer_attenuated: false, project_shared_included: false });
    expect(result.records[0].content).toBe("雨夜\r\n記錄");
    expect(result.records[0].content_bytes).toBe(Buffer.byteLength("雨夜\r\n記錄"));
    expect(result.records[0].sha256).toBe(new Bun.CryptoHasher("sha256").update("雨夜\r\n記錄").digest("hex"));
    expect(Object.keys(result.records[0]).sort()).toEqual(["content", "content_bytes", "created_at", "expires_at", "id", "sha256"]);
    expect(result.has_more).toBe(false);
  });

  test("whole records are omitted for individual and aggregate byte budgets", () => {
    const rows = [candidate(1, "a".repeat(4096)), candidate(2, "b".repeat(4096)), candidate(3, "next"), { ...candidate(4), content: null, contentBytes: 100_000 }, candidate(5, "bad\u0000text")];
    const result = packLocalContext(PROJECT, IDENTITY, rows, NOW);
    expect(result.records.map(row => row.id)).toEqual([id(1), id(2)]);
    expect(result.used_content_bytes).toBe(8192);
    expect(result.omissions).toEqual([{ id: id(3), reason: "content_budget" }, { id: id(4), reason: "record_too_large" }, { id: id(5), reason: "invalid_content" }]);
  });

  test("item/candidate windows and encoded JSON remain independently bounded", () => {
    const result = packLocalContext(PROJECT, IDENTITY, Array.from({ length: 33 }, (_, i) => candidate(i + 1, '"\\\t\n'.repeat(128))), NOW);
    expect(result.records).toHaveLength(8);
    expect(result.omissions).toHaveLength(24);
    expect(result.has_more).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32768);
    expect(result.omissions.every(row => row.reason === "item_limit")).toBe(true);
    const malformed = packLocalContext(PROJECT, IDENTITY, [{ ...candidate(1), contentBytes: 1 }, candidate(2, "\ud800")], NOW);
    expect(malformed.records).toEqual([]);
    expect(malformed.omissions.every(row => row.reason === "invalid_content")).toBe(true);
  });
});

function stagedDatabase(subject = { id: IDENTITY, projectId: PROJECT, did: `did:at:${IDENTITY}`, status: "active" }) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const orders: string[] = [];
  const limits: number[] = [];
  let selections = 0;
  let transactionOptions: unknown;
  const dialect = new PgDialect();
  const tx = {
    select: (_columns?: unknown) => {
      const index = selections++;
      const builder = {
        from: () => builder,
        where: (condition: never) => { statements.push(dialect.sqlToQuery(condition)); return builder; },
        orderBy: (...clauses: never[]) => { orders.push(...clauses.map(clause => dialect.sqlToQuery(clause).sql)); return builder; },
        limit: (limit: number) => { limits.push(limit); return Promise.resolve(index === 0 ? [subject] : [candidate(1)]); },
      };
      return builder;
    },
  };
  const database = { transaction: async (fn: (input: typeof tx) => Promise<unknown>, options: unknown) => { transactionOptions = options; return fn(tx); } };
  return { database, statements, orders, limits, selections: () => selections, transactionOptions: () => transactionOptions };
}

describe("partitioned read service", () => {
  test("binds active subject and project before querying a deterministic, unexpired window in one read-only snapshot", async () => {
    const staged = stagedDatabase();
    const result = await readLocalContext(PROJECT, IDENTITY.toUpperCase(), { database: staged.database as never, now: NOW });
    expect(result.identity_id).toBe(IDENTITY);
    expect(staged.transactionOptions()).toEqual({ isolationLevel: "repeatable read", accessMode: "read only" });
    expect(staged.statements[0].params).toEqual([IDENTITY, PROJECT, "active"]);
    expect(staged.statements[1].sql).toContain('"memories"."project_id" =');
    expect(staged.statements[1].sql).toContain('"memories"."identity_id" =');
    expect(staged.statements[1].sql).toContain('"memories"."expires_at" is null');
    expect(staged.statements[1].sql).toContain('"memories"."expires_at" >');
    expect(staged.statements[1].params).toEqual([PROJECT, IDENTITY, NOW.toISOString()]);
    expect(staged.orders).toEqual(['"memory"."memories"."created_at" desc', '"memory"."memories"."id" desc']);
    expect(staged.limits).toEqual([1, LOCAL_CONTEXT_BOUNDS.max_candidates + 1]);
  });

  test("foreign, wrong, and inactive subjects fail before any memory read", async () => {
    for (const override of [{ projectId: OTHER }, { id: OTHER }, { status: "revoked" }]) {
      const staged = stagedDatabase({ id: IDENTITY, projectId: PROJECT, did: `did:at:${IDENTITY}`, status: "active", ...override });
      await expect(readLocalContext(PROJECT, IDENTITY, { database: staged.database as never, now: NOW })).rejects.toBeInstanceOf(IdentityPartitionError);
      expect(staged.selections()).toBe(1);
    }
  });
});

function route(read: Parameters<typeof createLocalContextHandler>[0]) {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("project" as never, { id: PROJECT } as never); await next(); });
  app.get("/v1/identities/:id/local-context", createLocalContextHandler(read));
  return app;
}

describe("explicit hosted context route", () => {
  test("canonicalizes a UUID, returns private no-store data, and rejects aliases/query widening", async () => {
    const calls: string[][] = [];
    const app = route(async (project, identity) => { calls.push([project, identity]); return packLocalContext(project, identity, [], NOW); });
    const response = await app.request(`/v1/identities/${IDENTITY.toUpperCase()}/local-context`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([[PROJECT, IDENTITY]]);
    for (const suffix of ["me/local-context", `did:at:${IDENTITY}/local-context`, `${IDENTITY}/local-context?identity_id=${OTHER}`, `${IDENTITY}/local-context?limit=100`]) {
      expect((await app.request(`/v1/identities/${suffix}`)).status).toBe(400);
    }
    expect(calls).toHaveLength(1);
  });

  test("subject and storage failures disclose no rows or raw errors and never compose Wake", async () => {
    const refused = await route(async () => { throw new IdentityPartitionError(); }).request(`/v1/identities/${IDENTITY}/local-context`);
    expect(refused.status).toBe(404);
    const failed = await route(async () => { throw new Error("sentinel private database detail"); }).request(`/v1/identities/${IDENTITY}/local-context`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "local_context_unavailable" });
  });
});

test("key lookup preserves legacy filter while enforcing identity, expiry, stable order, and bounded limit", async () => {
  const dialect = new PgDialect();
  let predicate: ReturnType<PgDialect["sqlToQuery"]> | undefined;
  let orders: string[] = [];
  let limit = 0;
  const builder = {
    select: () => builder, from: () => builder,
    where: (where: never) => { predicate = dialect.sqlToQuery(where); return builder; },
    orderBy: (...clauses: never[]) => { orders = clauses.map(clause => dialect.sqlToQuery(clause).sql); return builder; },
    limit: async (value: number) => { limit = value; return []; },
  };
  expect(await readByKey(PROJECT, "handoff", "legacy-label", { identity_id: IDENTITY, limit: 200, database: builder as never })).toEqual([]);
  expect(predicate!.params).toEqual([PROJECT, "handoff", "legacy-label", IDENTITY]);
  expect(predicate!.sql).toContain('"memories"."identity_id" =');
  expect(predicate!.sql).toContain('"memories"."expires_at" > now()');
  expect(orders).toEqual(['"memory"."memories"."created_at" desc', '"memory"."memories"."id" desc']);
  expect(limit).toBe(100);
  await readByKey(PROJECT, "handoff", null, { limit: -3, database: builder as never });
  expect(limit).toBe(1);
});

test("the explicit companion accepts the actual API route envelope and preserves wire provenance", async () => {
  const { readHostedContext } = await import("../../packages/local-starter/src/connect.mjs");
  const staged = stagedDatabase();
  const app = route((project, identity) => readLocalContext(project, identity, { database: staged.database as never, now: NOW }));
  let requests = 0;
  const result = await readHostedContext({
    origin: "https://api.example.test", projectId: PROJECT, identityId: IDENTITY,
    now: () => NOW.getTime(),
    transport: { request: (url: string, init: RequestInit) => { requests++; return app.request(url, init); } },
  });
  expect(requests).toBe(1);
  expect(result.projection.records[0].content).toBe("selected memory");
  expect(result.projection.scope.project_shared_included).toBe(false);
  expect(result.projection.scope.bearer_attenuated).toBe(false);
  expect(result.path).toBe(`/v1/identities/${IDENTITY}/local-context`);
});

test("published OpenAPI describes the closed projection without upgrading its authority", async () => {
  const { default: openapi } = await import("../src/routes/openapi");
  const spec = await (await openapi.request("/")).json();
  const operation = spec.paths["/v1/identities/{id}/local-context"].get;
  const schema = operation.responses["200"].content["application/json"].schema;
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  const envelope = packLocalContext(PROJECT, IDENTITY, [candidate(1)], NOW);
  expect(validate(envelope)).toBe(true);
  for (const field of ["identity_proven", "bearer_attenuated", "project_shared_included"]) {
    expect(validate({ ...envelope, scope: { ...envelope.scope, [field]: true } })).toBe(false);
  }
  expect(validate({ ...envelope, extra: "unreviewed" })).toBe(false);
  expect(operation.parameters.every((parameter: { in: string }) => parameter.in === "path")).toBe(true);
});
