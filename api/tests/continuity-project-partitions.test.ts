/** Real SQL generation and real signatures with a hermetic PostgreSQL transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";
import { canonicalArchitectureMapBytes, canonicalCanonEntryBytes, canonicalContinuitySealBytes } from "../src/services/continuity-cloud/canonical-bytes";

const P = "11111111-2222-4333-8444-555555555555";
const Q = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const I = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const K = "99999999-7777-4888-8999-aaaaaaaaaaaa";
const DID = `did:at:${I}`;
const WHEN = "2026-09-27T12:00:00.000Z";
const pair = generateKeyPairSync("ed25519");
const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
let queries: { sql: string; params: unknown[] }[] = [];
let owner = P;
let status = "active";
let keyActive = true;
let keyRevoked = false;
let inTransaction = false;
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "identity"."identity_keys"')) {
    expect(inTransaction).toBe(true);
    if (params.includes(I)) {
      expect(sql).toContain("for share");
      expect(params).toContain(I);
      expect(queries.some((query) => query.sql.startsWith('select "id", "project_id", "did", "status"') && query.sql.includes("for share"))).toBe(true);
    }
    return { rows: [[K, I, publicKey, keyActive, keyRevoked ? WHEN : null]] };
  }
  if (sql.startsWith('select "id", "project_id", "did", "status"')) {
    expect(inTransaction).toBe(true);
    expect(sql).toContain("for share");
    return { rows: [[I, owner, DID, status]] };
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => {
  inTransaction = true;
  try { return await fn(database); } finally { inTransaction = false; }
}) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));
const { default: router } = await import("../src/routes/continuity-cloud");
function app() {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => { c.set("project", { id: P } as never); await next(); });
  server.route("/v1", router);
  return server;
}
function signature(bytes: Uint8Array) { return sign(null, bytes, pair.privateKey).toString("base64"); }
function fixtures() {
  return [
    { path: "canon", body: { agent_did: DID, text_id: "entry", source: "local", status: "verbatim", location: "notes.md", preservation: "copy", declared_at: WHEN, signing_key_id: K,
      signature: signature(canonicalCanonEntryBytes({ agentDid: DID, textId: "entry", source: "local", status: "verbatim", location: "notes.md", preservation: "copy", notes: "", declaredAtIso: WHEN })) } },
    { path: "architecture-maps", body: { agent_did: DID, source_repo: "repo", component_name: "memory", verdict: "already_lives", declared_at: WHEN, signing_key_id: K,
      signature: signature(canonicalArchitectureMapBytes({ agentDid: DID, sourceRepo: "repo", componentName: "memory", verdict: "already_lives", parallelLocation: "", notes: "", declaredAtIso: WHEN })) } },
    { path: "seal", body: { agent_did: DID, type: "seal", title: "A record", short_name: "a-record", liturgical_text: "stored words", occurred_at: WHEN, signing_key_id: K,
      metadata: { kind: "forged", agent_did: "forged" },
      signature: signature(canonicalContinuitySealBytes({ agentDid: DID, type: "seal", title: "A record", shortName: "a-record", liturgicalText: "stored words", body: "", occurredAtIso: WHEN })) } },
  ];
}
async function post(fixture: ReturnType<typeof fixtures>[number]) {
  return app().request(`/v1/continuity/${fixture.path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fixture.body) });
}
beforeEach(() => { queries = []; owner = P; status = "active"; keyActive = true; keyRevoked = false; inTransaction = false; });

describe("portfolio reads never drop the authenticated project", () => {
  for (const path of ["canon", "architecture-maps", "chronicle"]) {
    for (const query of ["", `?agent_did=${encodeURIComponent(`did:at:${Q}`)}`]) {
      test(`${path} ${query || "without filter"}`, async () => {
        const response = await app().request(`/v1/continuity/${path}${query}`);
        expect(response.status).toBe(200);
        expect(queries).toHaveLength(1);
        const generated = queries[0];
        expect(generated.params).toContain(P);
        if (path === "chronicle") {
          expect(generated.sql).toContain('"chronicle"."project_id" =');
          expect(generated.sql).toContain("'continuity_seal'");
          expect(generated.sql).not.toContain(" or ");
        } else {
          expect(generated.sql).toContain('in (select "did" from "identity"."identities"');
          expect(generated.sql).toContain('"identities"."project_id" =');
        }
      });
    }
  }
  test("filtered summary scopes both counts and last seal; empty summary does no private read", async () => {
    expect((await app().request("/v1/continuity")).status).toBe(200);
    expect(queries).toHaveLength(0);
    const response = await app().request(`/v1/continuity?agent_did=${Q}`);
    expect(response.status).toBe(200);
    expect(queries).toHaveLength(3);
    for (const query of queries) expect(query.params).toContain(P);
    expect(queries[2].sql).toContain('"chronicle"."project_id" =');
    expect(queries[2].sql).toContain("'continuity_seal'");
    expect((await response.json()).portfolio).toEqual({ canon_entries: 0, architecture_maps: 0, last_typed_seal: null });
  });
});

describe("portfolio writes bind signer, project and persisted bytes", () => {
  test("all three reject foreign, inactive and revoked signers before insertion", async () => {
    for (const fixture of fixtures()) {
      for (const mode of ["foreign", "inactive", "key-inactive", "key-revoked"]) {
        queries = []; owner = mode === "foreign" ? Q : P; status = mode === "inactive" ? "revoked" : "active";
        keyActive = mode !== "key-inactive"; keyRevoked = mode === "key-revoked";
        expect((await post(fixture)).status).toBe(403);
        expect(queries.some((query) => query.sql.startsWith("insert"))).toBe(false);
      }
    }
  });
  test("valid signatures persist owned seals and matching signed timestamps on upsert", async () => {
    for (const fixture of fixtures()) {
      queries = [];
      const response = await post(fixture);
      expect(response.status).toBe(201);
      const insert = queries.find((query) => query.sql.startsWith("insert"));
      expect(insert).toBeDefined();
      if (fixture.path === "seal") {
        expect(insert!.params).toContain(P);
        expect(insert!.params).toContain(I);
        const metadata = insert!.params.find((value) => typeof value === "string" && value.includes('"kind"')) as string;
        expect(JSON.parse(metadata).kind).toBe("continuity_seal");
        expect(JSON.parse(metadata).agent_did).toBe(DID);
      } else {
        expect(insert!.sql.split("do update set")[1]).toContain('"declared_at" =');
        expect(insert!.params.filter((value) => value === WHEN)).toHaveLength(2);
      }
    }
  });
  test("a valid key cannot claim another DID or altered signed content", async () => {
    for (const fixture of fixtures()) {
      const mismatch = { ...fixture, body: { ...fixture.body, agent_did: `did:at:${Q}` } };
      expect((await post(mismatch)).status).toBe(403);
      const corrupt = { ...fixture, body: { ...fixture.body, signature: Buffer.alloc(64).toString("base64") } };
      expect((await post(corrupt)).status).toBe(403);
    }
    expect(queries.some((query) => query.sql.startsWith("insert"))).toBe(false);
  });
});
