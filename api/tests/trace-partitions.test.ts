/** Subject admission, signed-byte preservation and publication after commit. */
import { beforeEach, expect, mock, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";
import { canonicalTraceBytes, normalizeTraceCore, TRACE_SIGNATURE_CONTEXT, traceSigningCoreSha256Hex } from "../src/services/trace/sig";

const P = "11111111-2222-4333-8444-555555555555";
const Q = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const I = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const J = "77777777-7777-4888-8999-aaaaaaaaaaaa";
const K = "99999999-7777-4888-8999-aaaaaaaaaaaa";
const WHEN = "2026-09-27T12:00:00.000Z";
const pair = generateKeyPairSync("ed25519");
const pub = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
let owner = P, lifecycle = "active", keyIdentity = I, keyActive = true;
let failCommit = false, charged = 0, inTransaction = false;
let changeAtTransaction: (() => void) | undefined;
let inserted: Record<string, unknown>[] = [];
let events: unknown[] = [];
let queries: { sql: string; params: unknown[] }[] = [];
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "identity"."identities"')) return { rows: [[params[0], owner, `did:at:${params[0]}`, lifecycle]] };
  if (sql.startsWith('select "identity_id"')) return { rows: [[keyIdentity]] };
  if (sql.includes('from "identity"."identity_keys"')) return { rows: [[K, keyIdentity, pub, keyActive, null]] };
  if (sql.startsWith('insert into "trace"')) return { rows: [[J, "tr_123abc", WHEN]] };
  return { rows: [] };
});
const originalInsert = database.insert.bind(database);
database.insert = ((table: never) => {
  const builder = originalInsert(table);
  const values = builder.values.bind(builder);
  builder.values = ((value: never) => { inserted.push(value); return values(value); }) as typeof builder.values;
  return builder;
}) as typeof database.insert;
database.transaction = (async (fn: (tx: typeof database) => unknown) => {
  changeAtTransaction?.();
  inTransaction = true;
  try {
    const result = await fn(database);
    if (failCommit) throw new Error("commit failed");
    return result;
  } finally { inTransaction = false; }
}) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));
mock.module("../src/services/wake/push", () => ({ publishWakeEvent: async (event: unknown) => {
  expect(inTransaction).toBe(false); events.push(event);
} }));
mock.module("../src/billing/charge", () => ({ charge: async () => { charged += 1; } }));
const { createTrace } = await import("../src/services/trace/store");
const { default: router } = await import("../src/routes/trace/traces");
const input = { decision: { type: "choose", summary: "A small decision" }, reasoning: { conclusion: "Use the selected record" } };
function app() {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => { c.set("project", { id: P } as never); c.set("clientSource", "http"); await next(); });
  return server.route("/v1/traces", router);
}
const post = (path: string, body: unknown) => app().request(`/v1/traces${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { owner = P; lifecycle = "active"; keyIdentity = I; keyActive = true; failCommit = false; charged = 0; inserted = []; events = []; queries = []; changeAtTransaction = undefined; });

test("unsigned aliases establish canonical owned subject; labels remain unbound", async () => {
  await createTrace(P, { ...input, agent_id: `did:at:${I}` });
  expect(inserted[0].identityId).toBe(I);
  expect(inserted[0].agentId).toBe(`did:at:${I}`);
  expect(events).toHaveLength(1);
  expect(queries.some((q) => q.sql.includes("for share") && q.params.includes(P))).toBe(true);
  await createTrace(P, { ...input, agent_id: "session-label" });
  expect(inserted[1].identityId).toBeNull();
  expect(events).toHaveLength(1);
});

test("foreign, inactive, conflicting and foreign-parent writes stop before charging", async () => {
  owner = Q;
  expect((await post("", { ...input, identity_id: I })).status).toBe(404);
  owner = P; lifecycle = "revoked";
  expect((await post("", { ...input, identity_id: I })).status).toBe(404);
  lifecycle = "active";
  expect((await post("", { ...input, identity_id: I, agent_id: J })).status).toBe(400);
  expect((await post("", { ...input, parent_trace_id: "tr_999abc" })).status).toBe(404);
  const parentQuery = queries.find((query) => query.sql.includes('from "trace"."traces"'))!;
  expect(parentQuery.params).toContain(P);
  expect(parentQuery.sql).toContain('"traces"."project_id" =');
  expect(charged).toBe(0); expect(inserted).toHaveLength(0); expect(events).toHaveLength(0);
});

test("prepare returns canonical subject and signed POST persists exactly its signed bytes", async () => {
  const preparedResponse = await post("/prepare", { ...input, agent_id: `did:at:${I}`, signed_at: WHEN });
  expect(preparedResponse.status).toBe(200);
  const prepared = await preparedResponse.json();
  expect(prepared.identity_id).toBe(I);
  const signature = sign(null, Buffer.from(prepared.canonical_sha256_b64, "base64"), pair.privateKey).toString("base64");
  const response = await post("", { ...input, agent_id: prepared.agent_id, identity_id: prepared.identity_id, signed_at: WHEN, signing_key_id: K.toUpperCase(), signature });
  expect(response.status).toBe(201);
  expect(charged).toBe(1);
  const row = inserted[0];
  const stored = canonicalTraceBytes({ projectId: P, agentId: row.agentId as string, identityId: row.identityId as string, sessionId: null, parentTraceId: null, coreSha256Hex: traceSigningCoreSha256Hex(normalizeTraceCore(input)), signedAtIso: WHEN });
  expect(Buffer.from(stored).toString("base64")).toBe(prepared.canonical_sha256_b64);
  expect(row.signature).toBe(signature);
  expect((row.metadata as Record<string, unknown>).signature_context).toBe(TRACE_SIGNATURE_CONTEXT);
});

test("signed alias without explicit canonical identity never silently changes the signed fields", async () => {
  expect((await post("", { ...input, agent_id: I, signing_key_id: K, signed_at: WHEN, signature: "x" })).status).toBe(400);
  expect(charged).toBe(0); expect(inserted).toHaveLength(0);
});

test("empty signature is rejected through both route and service without a false signed record", async () => {
  expect((await post("", { ...input, signature: "" })).status).toBe(400);
  await expect(createTrace(P, { ...input, signature: "" })).rejects.toThrow("empty signature");
  expect(charged).toBe(0); expect(inserted).toHaveLength(0);
});

test("transaction rechecks lifecycle and key after successful preflight", async () => {
  const prepared = await (await post("/prepare", { ...input, identity_id: I, signed_at: WHEN })).json();
  const signature = sign(null, Buffer.from(prepared.canonical_sha256_b64, "base64"), pair.privateKey).toString("base64");
  for (const change of [() => { lifecycle = "revoked"; }, () => { keyActive = false; }, () => { keyIdentity = J; }]) {
    lifecycle = "active"; keyActive = true; keyIdentity = I; changeAtTransaction = change;
    const response = await post("", { ...input, identity_id: I, signed_at: WHEN, signing_key_id: K, signature });
    expect([403, 404]).toContain(response.status);
  }
  expect(inserted).toHaveLength(0); expect(events).toHaveLength(0);
});

test("wrong signer, inactive key and invalid cryptographic proof cannot be stored", async () => {
  const body = { ...input, identity_id: I, signing_key_id: K, signed_at: WHEN, signature: Buffer.alloc(64).toString("base64") };
  keyIdentity = J;
  expect((await post("", body)).status).toBe(403);
  keyIdentity = I; keyActive = false;
  expect((await post("", body)).status).toBe(403);
  keyActive = true;
  expect((await post("", body)).status).toBe(403);
  expect(charged).toBe(0); expect(inserted).toHaveLength(0);
});

test("failed commit never publishes a Wake event", async () => {
  failCommit = true;
  await expect(createTrace(P, { ...input, identity_id: I })).rejects.toThrow("commit failed");
  expect(events).toHaveLength(0);
});

test("list identity filter stays inside the project predicate", async () => {
  expect((await app().request(`/v1/traces?identity_id=${I}`)).status).toBe(200);
  expect(queries[0].params).toContain(P); expect(queries[0].params).toContain(I);
  expect(queries[0].sql).toContain('"traces"."identity_id" =');
});
