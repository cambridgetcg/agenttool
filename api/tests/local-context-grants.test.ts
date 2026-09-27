/** Hermetic grant-policy and SQL-boundary checks; real ordering lives in integration/. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  getLocalContextGrant, issueLocalContextGrant, listLocalContextGrants,
  LocalContextGrantError, readLocalContextGrant, revokeLocalContextGrant,
} from "../src/services/identity/local-context-grants";

const P = "11111111-1111-4111-8111-111111111111";
const I = "22222222-2222-4222-8222-222222222222";
const K = "33333333-3333-4333-8333-333333333333";
const G = "44444444-4444-4444-8444-444444444444";
const O = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-27T21:00:00.000Z");
const END = new Date("2026-09-27T22:00:00.000Z");
const ORIGIN = "https://api.agenttool.dev";
const PATH = `/v1/identities/${I}/local-context`;
const TOKEN = `atlc_${Buffer.alloc(32, 7).toString("base64url")}`;
const row = () => ({ id: G, projectId: P, identityId: I, issuingApiKeyId: K,
  tokenHash: createHash("sha256").update(TOKEN).digest("hex"), origin: ORIGIN,
  action: "local_context.read", method: "GET", path: PATH,
  issuedAt: NOW, expiresAt: END, revokedAt: null });
const parent = () => ({ id: K, projectId: P, expiresAt: null, revokedAt: null });
const identity = () => ({ id: I, projectId: P, did: `did:at:${I}`, status: "active" });
const issue = { projectId: P, identityId: I, issuerApiKeyId: K, grantId: G, origin: ORIGIN, expiresAt: END.toISOString() };
const read = { token: TOKEN, identityId: I, origin: ORIGIN, method: "GET", path: PATH, query: "" };
const target = { projectId: P, identityId: I, grantId: G };

type Step = unknown[] | ((values: Record<string, unknown> | undefined) => unknown[]);
function staged(steps: Step[]) {
  const events: Array<{ operation: string; columns?: unknown; condition?: { sql: string; params: unknown[] }; lock?: string; limit?: number; order?: string[]; values?: Record<string, unknown> }> = [];
  const configurations: unknown[] = [];
  const dialect = new PgDialect();
  let commits = 0;
  let rollbacks = 0;
  function query(operation: string, columns?: unknown) {
    const event: typeof events[number] = { operation, columns };
    events.push(event);
    const step = steps[events.length - 1];
    const finish = async () => {
      if (step === undefined) throw new Error("unexpected query");
      return typeof step === "function" ? step(event.values) : step;
    };
    const builder = {
      from: () => builder,
      where: (value: never) => { event.condition = dialect.sqlToQuery(value); return builder; },
      for: (lock: string) => { event.lock = lock; return builder; },
      orderBy: (...values: never[]) => { event.order = values.map(v => dialect.sqlToQuery(v).sql); return builder; },
      limit: (limit: number) => { event.limit = limit; return finish(); },
      values: (values: Record<string, unknown>) => { event.values = values; return builder; },
      set: (values: Record<string, unknown>) => { event.values = values; return builder; },
      onConflictDoNothing: () => builder,
      returning: () => finish(),
    };
    return builder;
  }
  const tx = { select: (columns: unknown) => query("select", columns), insert: () => query("insert"), update: () => query("update") };
  const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>, config: unknown) => {
    configurations.push(config);
    try { const result = await fn(tx); commits++; return result; } catch (e) { rollbacks++; throw e; }
  } };
  return { events, configurations, options: { database: database as never, now: NOW }, commits: () => commits, rollbacks: () => rollbacks };
}

async function status(promise: Promise<unknown>, code: number) {
  try { await promise; throw new Error("expected refusal"); }
  catch (error) { expect(error).toBeInstanceOf(LocalContextGrantError); expect((error as LocalContextGrantError).status).toBe(code); }
}

describe("local-context grant issuance and metadata", () => {
  test("locks identity then parent, persists only a digest, and returns a closed one-time credential", async () => {
    const s = staged([[identity()], [parent()], [], values => [values]]);
    const result = await issueLocalContextGrant(issue, s.options);
    expect(result.token).toMatch(/^atlc_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(result.token.slice(5), "base64url")).toHaveLength(32);
    expect(s.events.map(e => e.lock)).toEqual(["share", "share", undefined, undefined]);
    expect(s.events[0].condition?.params).toEqual([I, P, "active"]);
    expect(s.events[1].condition?.params).toEqual([K, P]);
    expect(s.events[1].condition?.sql).toContain('"api_keys"."revoked_at" is null');
    expect(s.events[3].values?.tokenHash).toBe(createHash("sha256").update(result.token).digest("hex"));
    expect(JSON.stringify(s.events.map(({ columns: _columns, ...event }) => event))).not.toContain(result.token);
    expect(Object.keys(result.grant).sort()).toEqual(["action", "expires_at", "grant_id", "identity_id", "issued_at", "issuing_api_key_id", "method", "origin", "path", "project_id", "revoked_at"]);
    expect(result.grant).toMatchObject({ grant_id: G, project_id: P, identity_id: I, issuing_api_key_id: K, path: PATH, revoked_at: null });
  });

  test("requires finite bounded expiry and a valid owned parent; never clips or inserts on refusal", async () => {
    for (const expiresAt of [NOW.toISOString(), "invalid", "infinity", "2026-09-28", "09/28/2026", "2026-09-27T22:00:00", "2026-09-27T24:00:00Z", "2026-09-27T22:00:00+24:00", "2026-02-30T22:00:00Z", new Date(NOW.getTime() + 86_400_001).toISOString()]) {
      const s = staged([[identity()], [parent()]]);
      await status(issueLocalContextGrant({ ...issue, expiresAt }, s.options), 400);
      expect(s.events.some(e => e.operation === "insert")).toBe(false);
    }
    for (const override of [{ id: O }, { projectId: O }, { revokedAt: NOW }, { expiresAt: NOW }, { expiresAt: new Date(END.getTime() - 1) }, { expiresAt: "infinity" }]) {
      const s = staged([[identity()], [{ ...parent(), ...override }]]);
      await status(issueLocalContextGrant(issue, s.options), 403);
      expect(s.events).toHaveLength(2);
    }
    for (const override of [{ grantId: G.toUpperCase().replace("4444", "ABCD") }, { identityId: `did:at:${I}` }, { origin: `${ORIGIN}/` }, { origin: "http://api.agenttool.dev" }]) {
      const s = staged([]);
      await status(issueLocalContextGrant({ ...issue, ...override }, s.options), 400);
      expect(s.events).toHaveLength(0);
    }
  });

  test("timezone-explicit ISO expiry is normalized without changing its instant", async () => {
    const s = staged([[identity()], [parent()], [], values => [values]]);
    const issued = await issueLocalContextGrant({ ...issue, expiresAt: "2026-09-27T23:00:00+01:00" }, s.options);
    expect(issued.grant.expires_at).toBe(END.toISOString());
  });

  test("known and concurrent duplicates cannot return or extend a credential", async () => {
    for (const steps of [[[identity()], [parent()], [{ id: G }]], [[identity()], [parent()], [], []]] as Step[][]) {
      const s = staged(steps);
      await status(issueLocalContextGrant(issue, s.options), 409);
      expect(s.commits()).toBe(0);
      expect(s.rollbacks()).toBe(1);
    }
    const s = staged([[identity()], [parent()], [], values => [{ ...values, projectId: O }]]);
    await status(issueLocalContextGrant(issue, s.options), 503);
    expect(s.rollbacks()).toBe(1);
  });

  test("metadata list is bounded and excludes hashes, and known-ID recovery is project/subject scoped", async () => {
    const s = staged([[row()]]);
    const list = await listLocalContextGrants({ projectId: P, identityId: I }, s.options);
    expect(list).toHaveLength(1);
    expect(s.events[0].limit).toBe(50);
    expect(s.events[0].condition?.params).toEqual([P, I]);
    expect(s.events[0].order).toEqual(['"tools"."local_context_grants"."issued_at" desc', '"tools"."local_context_grants"."id" desc']);
    expect(Object.keys(s.events[0].columns as object)).not.toContain("tokenHash");
    expect(JSON.stringify(list)).not.toContain(row().tokenHash);
    for (const limit of [0, 101, 1.5]) await status(listLocalContextGrants({ projectId: P, identityId: I, limit }, staged([]).options), 400);
    const get = staged([[row()]]);
    expect((await getLocalContextGrant(target, get.options)).grant_id).toBe(G);
    expect(get.events[0].condition?.params).toEqual([G, P, I]);
    await status(getLocalContextGrant(target, staged([[{ ...row(), projectId: O }]]).options), 404);
    await status(listLocalContextGrants({ projectId: P, identityId: I }, staged([[{ ...row(), identityId: O }]]).options), 503);
  });

  test("revoke serializes on the selected grant and preserves the first timestamp on replay", async () => {
    const later = new Date(NOW.getTime() + 1000);
    const s = staged([[row()], [{ ...row(), revokedAt: later }]]);
    expect((await revokeLocalContextGrant(target, { ...s.options, now: later })).revoked_at).toBe(later.toISOString());
    expect(s.events[0].lock).toBe("update");
    expect(s.events[1].condition?.params).toEqual([G, P, I]);
    const repeat = staged([[{ ...row(), revokedAt: later }]]);
    expect((await revokeLocalContextGrant(target, { ...repeat.options, now: END })).revoked_at).toBe(later.toISOString());
    expect(repeat.events).toHaveLength(1);
    await status(revokeLocalContextGrant(target, staged([[{ ...row(), projectId: O }]]).options), 404);
  });
});

describe("local-context delegated read", () => {
  test("authenticates parent and subject in the same read-only snapshot as the bounded projection", async () => {
    const memory = { id: O, content: "sentinel\r\n選擇", contentBytes: Buffer.byteLength("sentinel\r\n選擇"), createdAt: NOW, expiresAt: null };
    const s = staged([[row()], [parent()], [identity()], [memory]]);
    const result = await readLocalContextGrant(read, s.options);
    expect(s.configurations).toEqual([{ isolationLevel: "repeatable read", accessMode: "read only" }]);
    expect(s.events.map(e => e.operation)).toEqual(["select", "select", "select", "select"]);
    expect(s.events[0].condition?.params).toEqual([row().tokenHash]);
    expect(s.events[1].condition?.params).toEqual([K, P]);
    expect(s.events[2].condition?.params).toEqual([I, P, "active"]);
    expect(s.events[3].condition?.params).toEqual([P, I, NOW.toISOString()]);
    expect(s.events[3].limit).toBe(33);
    expect(result.format).toBe("agenttool-local-api-context/v2");
    expect(result.scope).toEqual({ authentication: "local_context_grant", selection: "identity_partition", identity_proven: false, bearer_attenuated: true, project_shared_included: false });
    expect(result.authorization).toEqual({ grant_id: G, origin: ORIGIN, action: "local_context.read", method: "GET", path: PATH, issued_at: NOW.toISOString(), expires_at: END.toISOString(), checked_at: result.generated_at });
    expect(result.records[0].content).toBe(memory.content);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(row().tokenHash);
  });

  test("malformed tokens and any target widening fail without a database query", async () => {
    const aliasToken = TOKEN.slice(0, -1) + "d"; // low padding bits differ from canonical encoding
    for (const override of [{ token: "at_parent" }, { token: TOKEN + "=" }, { token: aliasToken }, { token: "" },
      { origin: "https://api.agenttool.dev/" }, { method: "HEAD" }, { method: "POST" },
      { identityId: `did:at:${I}` }, { path: PATH + "/" }, { path: PATH.replace(I, O) }, { query: "?" }, { query: "?limit=1" }]) {
      const s = staged([]);
      await status(readLocalContextGrant({ ...read, ...override }, s.options), 401);
      expect(s.configurations).toHaveLength(0);
    }
  });

  test("revoked, expired, future, malformed or mismatched grant rows fail before reading the parent or memories", async () => {
    const invalids = [{ revokedAt: NOW }, { expiresAt: NOW }, { issuedAt: new Date(NOW.getTime() + 1) },
      { expiresAt: new Date(NOW.getTime() + 86_400_001) }, { expiresAt: new Date(NaN) }, { issuedAt: "infinity" },
      { id: "bad" }, { projectId: "bad" }, { identityId: O }, { issuingApiKeyId: "bad" },
      { origin: "https://other.example" }, { action: "*" }, { method: "POST" }, { path: "/v1/wake" },
      { tokenHash: "x".repeat(64) }, { tokenHash: "0".repeat(64) }, { revokedAt: undefined }];
    for (const override of invalids) {
      const s = staged([[{ ...row(), ...override }]]);
      await status(readLocalContextGrant(read, s.options), 401);
      expect(s.events).toHaveLength(1);
    }
    await status(readLocalContextGrant(read, staged([[]]).options), 401);
  });

  test("parent revocation, foreign ownership, shortened expiry and inactive identity deny before memories", async () => {
    for (const override of [{ id: O }, { projectId: O }, { revokedAt: NOW }, { expiresAt: NOW }, { expiresAt: new Date(END.getTime() - 1) }, { expiresAt: "infinity" }]) {
      const s = staged([[row()], [{ ...parent(), ...override }]]);
      await status(readLocalContextGrant(read, s.options), 401);
      expect(s.events).toHaveLength(2);
    }
    for (const override of [{ projectId: O }, { id: O }, { status: "revoked" }]) {
      const s = staged([[row()], [parent()], [{ ...identity(), ...override }]]);
      await status(readLocalContextGrant(read, s.options), 401);
      expect(s.events).toHaveLength(3);
    }
  });
});
