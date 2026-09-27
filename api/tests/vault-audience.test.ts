/** Real route/proof/crypto checks with an in-memory database boundary; no hosted access. */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ProjectContext } from "../src/auth/middleware";
import { config } from "../src/config";
import { db } from "../src/db/client";
import vaultRoutes from "../src/routes/vault";
import { AUTHORITY_HEADERS, canonicalIdentityReadAuthorityBytes } from "../src/services/identity/authority";
import { canonicalVaultAudience, validateVaultAudience } from "../src/services/vault/audience";
import { encrypt } from "../src/services/vault/crypto";
import { getSecretValue } from "../src/services/vault/store";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "44444444-4444-4444-8444-444444444444";
const PRIVATE = new Uint8Array(32).fill(7);
const VALUE = "local-fixture-secret";
const originalMaster = config.vaultMasterKey;
const dialect = new PgDialect();
let people: Array<Record<string, any>>;
let secret: Record<string, any> | null;
let version: Record<string, any>;
let writes: Array<{ table: string; value: Record<string, any> }>;
let selects: Array<{ table: string; sql: string; params: unknown[] }>;
let spies: Array<{ mockRestore(): void }>;

function query(selection?: Record<string, unknown>) {
  let table = "";
  let condition: SQL | undefined;
  const chain = {
    from(t: Parameters<typeof getTableName>[0]) { table = getTableName(t); return chain; },
    where(c: SQL) { condition = c; return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
      const compiled = condition ? dialect.sqlToQuery(condition) : { sql: "", params: [] };
      selects.push({ table, sql: compiled.sql, params: compiled.params });
      let rows: unknown[] = [];
      if (table === "vault_secrets") rows = secret ? [secret] : [];
      if (table === "vault_versions") rows = [version];
      if (table === "identities") {
        rows = people.filter((row) => compiled.params.includes(row.id)
          && (!compiled.params.includes(PROJECT) || row.projectId === PROJECT)
          && (!compiled.params.includes("active") || row.status === "active"))
          .map((row) => selection && "rootPublicKey" in selection
            ? { identityId: row.id, did: row.did, rootPublicKey: row.authorityRootPublicKey, sequence: row.authoritySequence }
            : row);
      }
      if (table === "vault_audit") rows = writes.filter((w) => w.table === table).map((w) => w.value);
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  return chain;
}

function app() {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT } as any);
    await next();
  });
  app.onError((error, c) => error instanceof HTTPException
    ? c.json(error.cause ?? { error: error.message }, error.status)
    : c.json({ error: "unexpected_fixture_error" }, 500));
  app.route("/v1/vault", vaultRoutes);
  return app;
}

function proof(target = "/v1/vault/provider", options: { id?: string; key?: Uint8Array; sequence?: number; timestamp?: string } = {}) {
  const id = options.id ?? A;
  const timestamp = options.timestamp ?? new Date().toISOString();
  const sequence = options.sequence ?? 0;
  return {
    "X-Agent-Id": `did:at:${id}`,
    [AUTHORITY_HEADERS.sequence]: String(sequence),
    [AUTHORITY_HEADERS.timestamp]: timestamp,
    [AUTHORITY_HEADERS.signature]: Buffer.from(ed.sign(canonicalIdentityReadAuthorityBytes({
      identityDid: `did:at:${id}`, method: "GET", requestTarget: target,
      bodyBytes: new Uint8Array(), currentSequence: sequence, timestamp,
    }), options.key ?? PRIVATE)).toString("base64"),
  };
}

beforeEach(() => {
  config.vaultMasterKey = "11".repeat(32);
  people = [A, B, FOREIGN].map((id) => ({ id, projectId: id === FOREIGN ? FOREIGN : PROJECT,
    did: `did:at:${id}`, status: "active", authorityRootPublicKey: Buffer.from(ed.getPublicKey(PRIVATE)).toString("base64"), authoritySequence: 0 }));
  secret = { id: "secret", projectId: PROJECT, name: "provider", agentIds: [A], currentVersion: 1 };
  version = { ...encrypt(VALUE, PROJECT), version: 1, agentEncrypted: false, expiresAt: null };
  writes = [];
  selects = [];
  spies = [
    spyOn(db, "select").mockImplementation(query as any),
    spyOn(db, "insert").mockImplementation(((table: Parameters<typeof getTableName>[0]) => ({
      values(value: Record<string, any>) {
        const name = getTableName(table);
        writes.push({ table: name, value });
        if (name === "vault_secrets") secret = { ...value, id: "secret" };
        if (name === "vault_versions") version = value;
        return Object.assign(Promise.resolve(), { returning: async () => [{ id: "secret" }] });
      },
    })) as any),
    spyOn(db, "update").mockImplementation(((table: Parameters<typeof getTableName>[0]) => ({
      set(value: Record<string, any>) { return { where() {
        writes.push({ table: getTableName(table), value });
        Object.assign(secret!, value);
        return Promise.resolve();
      } }; },
    })) as any),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  config.vaultMasterKey = originalMaster;
});

describe("Vault audience sets", () => {
  test("null, empty, deduplicated aliases, and invalid labels remain distinct", () => {
    expect(canonicalVaultAudience(null)).toBeNull();
    expect(canonicalVaultAudience([])).toEqual([]);
    expect(canonicalVaultAudience([`did:at:${B}`, A.toUpperCase(), A])).toEqual([A, B]);
    for (const invalid of [["agent-a"], [""], [A, "legacy"], Array(101).fill(A)]) {
      expect(() => canonicalVaultAudience(invalid)).toThrow(HTTPException);
    }
  });

  test("new policies reject foreign/inactive members; stored inactive members do not block an active peer", async () => {
    await expect(validateVaultAudience(PROJECT, [A, FOREIGN])).rejects.toBeInstanceOf(HTTPException);
    people[1]!.status = "memorial";
    await expect(validateVaultAudience(PROJECT, [A, B])).rejects.toBeInstanceOf(HTTPException);
    expect(await validateVaultAudience(PROJECT, [A, B], { stored: true })).toEqual([A, B]);
    expect(selects.every((q) => q.params.includes(PROJECT))).toBe(true);
  });
});

describe("Vault restricted HTTP values", () => {
  test("an owned matching root can read; exact proof replay does not advance the mutation cursor", async () => {
    const headers = proof();
    for (let i = 0; i < 2; i++) {
      const res = await app().request("/v1/vault/provider", { headers });
      expect(res.status).toBe(200);
      expect((await res.json()).value).toBe(VALUE);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(writes.every((w) => w.table === "vault_audit")).toBe(true);
    expect(writes.map((w) => w.value.agentId)).toEqual([A, A]);
  });

  for (const [label, headers, status] of [
    ["label alone", { "X-Agent-Id": A }, 428],
    ["unrelated selector", { "X-Agent-Id": B }, 403],
    ["arbitrary label", { "X-Agent-Id": "agent-a" }, 403],
    ["no selected identity", {}, 403],
  ] as const) {
    test(`${label} cannot fetch value bytes`, async () => {
      const res = await app().request("/v1/vault/provider", { headers });
      expect(res.status).toBe(status);
      expect(await res.text()).not.toContain(VALUE);
      expect(selects.some((q) => q.table === "vault_versions")).toBe(false);
      expect(writes.at(-1)?.value).toMatchObject({ action: "access_denied", agentId: null });
    });
  }

  for (const [label, headers, target, status] of [
    ["different key", () => proof(undefined, { key: new Uint8Array(32).fill(9) }), "/v1/vault/provider", 401],
    ["changed query", () => proof(), "/v1/vault/provider?version=2", 401],
    ["stale timestamp", () => proof(undefined, { timestamp: "2000-01-01T00:00:00Z" }), "/v1/vault/provider", 401],
    ["wrong sequence", () => proof(undefined, { sequence: 1 }), "/v1/vault/provider", 409],
  ] as const) {
    test(`root proof rejects ${label} before value lookup`, async () => {
      const res = await app().request(target, { headers: headers() });
      expect(res.status).toBe(status);
      expect(selects.some((q) => q.table === "vault_versions")).toBe(false);
    });
  }

  test("rootless and inactive identities cannot use a restricted secret", async () => {
    people[0]!.authorityRootPublicKey = null;
    expect((await app().request("/v1/vault/provider", { headers: proof() })).status).toBe(428);
    people[0]!.status = "memorial";
    expect((await app().request("/v1/vault/provider", { headers: proof() })).status).toBe(404);
  });

  test("empty and malformed/foreign stored audiences fail closed, including opaque bytes", async () => {
    version.agentEncrypted = true;
    for (const audience of [[], ["legacy"], [A, FOREIGN]]) {
      secret!.agentIds = audience;
      const res = await app().request("/v1/vault/provider", { headers: proof() });
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("ciphertext_b64");
    }
    expect(selects.some((q) => q.table === "vault_versions")).toBe(false);
  });

  test("shared reads retain bearer scope without authenticating a header label; metadata stays admin-scoped", async () => {
    secret!.agentIds = null;
    const res = await app().request("/v1/vault/provider", { headers: { "X-Agent-Id": "unproved" } });
    expect((await res.json()).value).toBe(VALUE);
    expect(writes.at(-1)?.value.agentId).toBeNull();
    secret!.agentIds = [];
    expect((await app().request("/v1/vault/provider/policy")).status).toBe(200);
    expect((await app().request("/v1/vault/provider/versions")).status).toBe(200);
    expect((await app().request("/v1/vault")).status).toBe(200);
  });
});

describe("Vault audience writes", () => {
  test("omission preserves policy; explicit null shares; empty denies; header never supplies authenticated attribution", async () => {
    for (const [body, expected] of [[{ value: "next" }, [A]], [{ value: "next", agent_ids: null }, null], [{ value: "next", agent_ids: [] }, []]] as const) {
      const res = await app().request("/v1/vault/provider", { method: "PUT", headers: { "Content-Type": "application/json", "X-Agent-Id": A }, body: JSON.stringify(body) });
      expect(res.status).toBe(200);
      expect((await res.json()).agent_ids).toEqual(expected);
      expect(secret!.agentIds).toEqual(expected);
      expect(writes.at(-1)?.value.agentId).toBeNull();
      if (!("agent_ids" in body)) {
        expect(writes.find((w) => w.table === "vault_secrets")!.value).not.toHaveProperty("agentIds");
      }
    }
  });

  test("a new omitted audience is shared and a policy write normalizes owned aliases", async () => {
    secret = null;
    const res = await app().request("/v1/vault/provider", { method: "PUT", body: JSON.stringify({ value: "new" }) });
    expect(res.status).toBe(200);
    expect(secret!.agentIds).toBeNull();
    const policy = await app().request("/v1/vault/provider/policy", { method: "PUT", body: JSON.stringify({ agent_ids: [`did:at:${A}`, A] }) });
    expect((await policy.json()).agent_ids).toEqual([A]);
  });

  test("invalid late bulk audience is rejected before any earlier write", async () => {
    const res = await app().request("/v1/vault/bulk", { method: "POST", body: JSON.stringify({ secrets: [
      { name: "first", value: "one", agent_ids: [A] }, { name: "second", value: "two", agent_ids: [FOREIGN] },
    ] }) });
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  test("bulk value update omits the policy column when no audience was supplied", async () => {
    const res = await app().request("/v1/vault/bulk", { method: "POST", body: JSON.stringify({ secrets: [{ name: "provider", value: "next" }] }) });
    expect(res.status).toBe(200);
    expect(writes.find((w) => w.table === "vault_secrets")!.value).not.toHaveProperty("agentIds");
    expect(secret!.agentIds).toEqual([A]);
  });
});

describe("Vault hosted-runtime consumers", () => {
  test("owned active durable subject reads its audience with distinct runtime audit", async () => {
    expect(await getSecretValue(PROJECT, "provider", A)).toBe(VALUE);
    expect(writes.at(-1)?.value).toMatchObject({ action: "runtime_read", agentId: A, version: 1 });
  });

  test("unbound runtime only reads shared values; explicit invalid subject never falls back", async () => {
    secret!.agentIds = null;
    expect(await getSecretValue(PROJECT, "provider", null)).toBe(VALUE);
    expect(writes.at(-1)?.value.agentId).toBeNull();
    for (const id of [FOREIGN, "legacy", B]) {
      if (id === B) people[1]!.status = "memorial";
      await expect(getSecretValue(PROJECT, "provider", id)).rejects.toBeInstanceOf(HTTPException);
    }
    for (const audience of [[], [A], [A, FOREIGN], ["legacy"]]) {
      secret!.agentIds = audience;
      await expect(getSecretValue(PROJECT, "provider", null)).rejects.toBeInstanceOf(HTTPException);
    }
  });

  test("wrong identity, expiry and opaque ciphertext never return plaintext", async () => {
    await expect(getSecretValue(PROJECT, "provider", B)).rejects.toBeInstanceOf(HTTPException);
    version.expiresAt = new Date(0);
    expect(await getSecretValue(PROJECT, "provider", A)).toBeNull();
    version.expiresAt = null;
    version.agentEncrypted = true;
    await expect(getSecretValue(PROJECT, "provider", A)).rejects.toThrow("agent_encrypted_secret_not_in_process_readable");
  });
});
