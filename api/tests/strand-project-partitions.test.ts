/** Real SQL and Ed25519; no database, provider or notification transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";
import { strands, thoughts } from "../src/db/schema/strand";
import { canonicalThoughtBytesV2 } from "../src/services/strand/sig";

const P = "11111111-2222-4333-8444-555555555555";
const Q = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const I = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const J = "77777777-7777-4888-8999-aaaaaaaaaaaa";
const K = "99999999-7777-4888-8999-aaaaaaaaaaaa";
const S = "88888888-7777-4888-8999-aaaaaaaaaaaa";
const T = "bbbbbbbb-7777-4888-8999-aaaaaaaaaaaa";
const OTHER = "cccccccc-7777-4888-8999-aaaaaaaaaaaa";
const WHEN = "2026-09-27T12:00:00.000Z";
const pair = generateKeyPairSync("ed25519");
const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
let owner = P;
let identityStatus = "active";
let signerIdentity = I;
let keyActive = true;
let keyRevoked = false;
let keyPresent = true;
let keyChangesOnLock = false;
let inTransaction = false;
let strand: Record<string, unknown>;
let thought: Record<string, unknown>;
let queries: { sql: string; params: unknown[] }[] = [];
let writes: string[] = [];
let wakeEvents: unknown[] = [];
let voiceEvents: unknown[] = [];
let charges = 0;

function row(table: typeof strands | typeof thoughts, value: Record<string, unknown>) {
  return Object.keys(getTableColumns(table)).map((name) => value[name] ?? null);
}
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "identity"."identities"')) {
    expect(inTransaction || writes.length === 0).toBe(true);
    const id = params[0];
    return { rows: [[id, owner, `did:at:${id}`, identityStatus]] };
  }
  if (sql.includes('from "identity"."identity_keys"')) {
    expect(inTransaction).toBe(true);
    const selected = keyChangesOnLock && sql.includes("for share") ? J : signerIdentity;
    return { rows: keyPresent ? [[K, selected, publicKey, keyActive, keyRevoked ? WHEN : null]] : [] };
  }
  if (sql.includes('from "strand"."strands"')) {
    expect(inTransaction).toBe(true);
    if (sql.startsWith('select "id", "project_id" from')) return { rows: [[strand.id, strand.projectId]] };
    return { rows: [row(strands, strand)] };
  }
  if (sql.includes('from "strand"."thoughts"')) {
    expect(inTransaction).toBe(true);
    return { rows: [row(thoughts, thought)] };
  }
  if (sql.startsWith("insert") || sql.startsWith("update")) {
    expect(inTransaction).toBe(true);
    writes.push(sql);
    if (sql.includes('"strand"."strands"')) {
      return { rows: sql.startsWith("update") ? [[2]] : [row(strands, strand)] };
    }
    return { rows: [row(thoughts, thought)] };
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => {
  const before = writes.length;
  inTransaction = true;
  try { return await fn(database); }
  catch (error) { writes.length = before; throw error; }
  finally { inTransaction = false; }
}) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));
mock.module("../src/services/wake/push", () => ({ publishWakeEvent: async (event: unknown) => { expect(inTransaction).toBe(false); wakeEvents.push(event); } }));
mock.module("../src/services/strand/voice", () => ({ publishThought: async (...event: unknown[]) => { expect(inTransaction).toBe(false); voiceEvents.push(event); } }));
mock.module("../src/billing/charge", () => ({ charge: async () => { charges++; } }));
const { createStrand, addThought, updateThoughtCiphertext } = await import("../src/services/strand/store");
const { default: thoughtRouter } = await import("../src/routes/strand/thoughts");
const { default: strandRouter } = await import("../src/routes/strand/strands");
function app() {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => { c.set("project", { id: P } as never); await next(); });
  server.route("/v1/strands", strandRouter);
  server.route("/v1/strands/:strandId/thoughts", thoughtRouter);
  return server;
}
function payload(strandId = S) {
  const bytes = { strandId, ciphertextB64: "YWJj", nonceB64: "ZGVm", kind: "observation" };
  return { strand_id: strandId, ciphertext: bytes.ciphertextB64, nonce: bytes.nonceB64,
    kind: bytes.kind, signing_key_id: K, agent_id: `did:at:${I}`,
    signature: sign(null, canonicalThoughtBytesV2(bytes), pair.privateKey).toString("base64") };
}
beforeEach(() => {
  owner = P; identityStatus = "active"; signerIdentity = I; keyActive = true;
  keyRevoked = false; keyPresent = true; keyChangesOnLock = false; inTransaction = false;
  queries = []; writes = []; wakeEvents = []; voiceEvents = []; charges = 0;
  strand = { id: S, projectId: P, agentId: `did:at:${I}`, identityId: I,
    status: "active", topicEncrypted: false, moodEncrypted: false, visibility: "private",
    lastThoughtSeq: 1, metadata: {}, createdAt: WHEN, updatedAt: WHEN };
  thought = { id: T, strandId: S, projectId: P, agentId: `did:at:${I}`,
    sequenceNum: 2, kind: "observation", kindEncrypted: false, ciphertext: "YWJj",
    nonce: "ZGVm", refs: [], signature: payload().signature, signingKeyId: K, createdAt: WHEN };
});

describe("strand subject creation", () => {
  test("a DID alias binds its canonical identity under SHARE while retaining label bytes", async () => {
    await createStrand(P, { agent_id: `did:at:${I}` });
    const query = queries.find((q) => q.sql.startsWith("insert"))!;
    expect(query.params).toContain(I);
    expect(query.params).toContain(`did:at:${I}`);
    expect(queries[0].sql).toContain("for share");
  });
  test("cross-project parent links fail; same-project cross-subject context links remain possible", async () => {
    strand = { ...strand, id: OTHER, identityId: J, projectId: Q };
    await expect(createStrand(P, { identity_id: I, parent_strand_id: OTHER })).rejects.toThrow("strand_parent_not_found");
    expect(writes).toHaveLength(0);
    strand.projectId = P;
    await createStrand(P, { identity_id: I, parent_strand_id: OTHER.toUpperCase() });
    expect(writes).toHaveLength(1);
  });
  test("route refuses a conflicting subject before charging", async () => {
    const response = await app().request("/v1/strands", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity_id: I, agent_id: J }) });
    expect(response.status).toBe(400);
    expect(charges).toBe(0);
    expect(writes).toHaveLength(0);
  });
});

describe("thought commit subject and signer", () => {
  test("valid same-subject bytes commit before notifications, with identity-before-key locks", async () => {
    const result = await addThought(P, payload());
    expect(result.id).toBe(T);
    expect(writes).toHaveLength(2);
    expect(voiceEvents).toHaveLength(1);
    expect(wakeEvents).toHaveLength(1);
    const identityLock = queries.findIndex((q) => q.sql.includes('from "identity"."identities"') && q.sql.includes("for share"));
    const keyLock = queries.findIndex((q) => q.sql.includes('from "identity"."identity_keys"') && q.sql.includes("for share"));
    expect(identityLock).toBeGreaterThanOrEqual(0);
    expect(keyLock).toBeGreaterThan(identityLock);
    expect(queries[keyLock].params).toContain(I);
  });
  test("UUID key case variants resolve the same key without rewriting signed bytes", async () => {
    const input = { ...payload(), signing_key_id: K.toUpperCase() };
    await addThought(P, input);
    expect(writes).toHaveLength(2);
    const insert = queries.find((q) => q.sql.startsWith('insert into "strand"."thoughts"'))!;
    expect(insert.params).toContain(input.signature);
  });
  test("foreign, inactive, missing and revoked identities/keys cannot append", async () => {
    for (const mode of ["foreign", "inactive", "key-absent", "key-inactive", "key-revoked", "key-rebound"]) {
      owner = mode === "foreign" ? Q : P; identityStatus = mode === "inactive" ? "revoked" : "active";
      keyPresent = mode !== "key-absent"; keyActive = mode !== "key-inactive";
      keyRevoked = mode === "key-revoked"; keyChangesOnLock = mode === "key-rebound";
      await expect(addThought(P, payload())).rejects.toThrow();
      expect(writes).toHaveLength(0);
      expect(voiceEvents).toHaveLength(0);
      expect(wakeEvents).toHaveLength(0);
    }
  });
  test("a sibling identity's valid signing key cannot author a bound strand", async () => {
    signerIdentity = J;
    await expect(addThought(P, { ...payload(), agent_id: J })).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });
  test("project-level strands accept an owned signer, but not an unrelated identity label", async () => {
    strand.identityId = null; strand.agentId = "task context";
    await expect(addThought(P, { ...payload(), agent_id: J })).rejects.toThrow();
    expect(writes).toHaveLength(0);
    await addThought(P, { ...payload(), agent_id: "a descriptive label" });
    expect(writes).toHaveLength(2);
    expect(wakeEvents).toHaveLength(0);
  });
  test("an invalid signature and a missing runtime fence commit neither sequence nor thought", async () => {
    await expect(addThought(P, { ...payload(), signature: Buffer.alloc(64).toString("base64") })).rejects.toThrow("signature_invalid");
    await expect(addThought(P, payload(), { runtimeFence: { runtimeId: OTHER, leaseToken: "stale", llmRequestKey: "request", priorSeq: 1 } })).rejects.toThrow("runtime_cycle_lease_lost");
    expect(writes).toHaveLength(0);
    expect(voiceEvents).toHaveLength(0);
  });
});

describe("ciphertext replacement binds the complete nested resource", () => {
  test("the URL parent must equal the stored thought parent, even within one project", async () => {
    strand.id = OTHER;
    const response = await app().request(`/v1/strands/${OTHER}/thoughts/${T}/ciphertext`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()),
    });
    expect(response.status).toBe(404);
    expect(writes).toHaveLength(0);
    const query = queries.find((q) => q.sql.includes('from "strand"."thoughts"'))!;
    expect(query.params).toEqual([T, OTHER, P, 1]);
  });
  test("replacement checks current signer admission and preserves the original key and sequence", async () => {
    keyRevoked = true;
    await expect(updateThoughtCiphertext(P, { ...payload(), thought_id: T })).rejects.toThrow("signing_key_revoked");
    expect(writes).toHaveLength(0);
    keyRevoked = false;
    await updateThoughtCiphertext(P, { ...payload(), thought_id: T });
    expect(writes).toHaveLength(1);
    const update = queries.find((q) => q.sql.startsWith("update"))!;
    expect(update.params.slice(-3)).toEqual([T, S, P]);
    expect(update.sql.split(" where ")[0]).not.toContain('"signing_key_id" =');
    expect(update.sql.split(" where ")[0]).not.toContain('"sequence_num" =');
  });
});
