/** Executable subject model and SQL-boundary checks; no live database. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { Hono } from "hono";

const P = "11111111-2222-4333-8444-555555555555";
const Q = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const I = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const J = "99999999-7777-4888-8999-aaaaaaaaaaaa";
const own = { id: I, projectId: P, status: "active", did: `did:at:${I}` };
let rows: typeof own[] = [];
let predicates: ReturnType<PgDialect["sqlToQuery"]>[] = [];
let locks: string[] = [];
const dialect = new PgDialect();
const database = {
  select: () => ({ from: () => ({ where: (predicate: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    predicates.push(dialect.sqlToQuery(predicate));
    const result = { limit: async () => rows, for: (mode: string) => {
      locks.push(mode);
      return { limit: async () => rows };
    } };
    return result;
  } }) }),
};
mock.module("../src/db/client", () => ({ db: database }));
const { canonicalIdentityId, requireActiveProjectIdentity, resolveProjectSubject, IdentityPartitionError } =
  await import("../src/services/identity/partition");

beforeEach(() => { rows = [own]; predicates = []; locks = []; });

describe("identity locator equivalence classes", () => {
  test("UUID case and application-DID aliases select one canonical element", () => {
    for (const id of [I, J]) {
      const aliases = [id, id.toUpperCase(), `did:at:${id}`, `did:at:${id.toUpperCase()}`];
      expect(new Set(aliases.map(canonicalIdentityId))).toEqual(new Set([id]));
    }
    expect(canonicalIdentityId(I)).not.toBe(canonicalIdentityId(J));
  });
  test("labels, malformed identifiers and other DID methods have no canonical authority", () => {
    for (const value of [null, {}, "", "agent-a", "did:key:zabc", ` ${I}`, `${I}\n`, `did:at:${I}/child`]) {
      expect(canonicalIdentityId(value)).toBeNull();
    }
  });
});

describe("project fibres and lifecycle", () => {
  test("SQL binds canonical id AND project AND active status", async () => {
    expect(await requireActiveProjectIdentity(P, `did:at:${I.toUpperCase()}`)).toEqual(own);
    expect(predicates).toHaveLength(1);
    expect(predicates[0].params).toEqual([I, P, "active"]);
    expect(predicates[0].sql).toContain('"identities"."id" =');
    expect(predicates[0].sql).toContain('"identities"."project_id" =');
    expect(predicates[0].sql).toContain('"identities"."status" =');
    expect(predicates[0].sql.match(/ and /g)).toHaveLength(2);
  });
  test("foreign, inactive, mismatched and missing adapter rows cannot establish a binding", async () => {
    for (const candidates of [[], [{ ...own, projectId: Q }], [{ ...own, id: J }], [{ ...own, status: "revoked" }]]) {
      rows = candidates;
      await expect(requireActiveProjectIdentity(P, I)).rejects.toBeInstanceOf(IdentityPartitionError);
    }
  });
  test("a subject accepted for P is refused for Q, including all locator aliases", async () => {
    for (const alias of [I, I.toUpperCase(), `did:at:${I}`]) {
      await expect(requireActiveProjectIdentity(P, alias)).resolves.toEqual(own);
      await expect(requireActiveProjectIdentity(Q, alias)).rejects.toBeInstanceOf(IdentityPartitionError);
    }
  });
  test("write callers can hold active identity rows in their own transaction", async () => {
    await requireActiveProjectIdentity(P, I, { database: database as never, lock: true });
    expect(locks).toEqual(["share"]);
  });
});

describe("binding is distinct from labels and proof", () => {
  test("legacy labels remain annotations without triggering identity lookup", async () => {
    expect(await resolveProjectSubject(P, { agent_id: "local-session" })).toEqual({ identityId: null, agentId: "local-session" });
    expect(await resolveProjectSubject(P, {})).toEqual({ identityId: null, agentId: null });
    expect(predicates).toHaveLength(0);
  });
  test("a recognised alias binds an active owned identity while preserving signed bytes", async () => {
    const alias = `did:at:${I.toUpperCase()}`;
    expect(await resolveProjectSubject(P, { agent_id: alias })).toEqual({ identityId: I, agentId: alias });
    expect(await resolveProjectSubject(P, { identity_id: I, agent_id: "local-session" })).toEqual({ identityId: I, agentId: "local-session" });
  });
  test("conflicting selectors and explicit unbound plus alias are refused before lookup", async () => {
    for (const selectors of [
      { identity_id: I, agent_id: J },
      { identity_id: null, agent_id: `did:at:${I}` },
      { identity_id: "unknown", agent_id: "local-session" },
      { agent_id: "did:at:not-an-id" },
    ]) {
      await expect(resolveProjectSubject(P, selectors)).rejects.toBeInstanceOf(IdentityPartitionError);
    }
    expect(predicates).toHaveLength(0);
  });
  test("an unowned alias never falls back to an unbound label", async () => {
    rows = [];
    await expect(resolveProjectSubject(P, { agent_id: `did:at:${I}` })).rejects.toBeInstanceOf(IdentityPartitionError);
  });
  test("HTTP callers receive bounded errors without foreign identity details", async () => {
    rows = [{ ...own, projectId: Q }];
    const app = new Hono().get("/", async (c) => c.json(await requireActiveProjectIdentity(P, I)));
    const response = await app.request("/");
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).not.toContain(Q);
    expect(text).not.toContain(own.did);
  });
});
