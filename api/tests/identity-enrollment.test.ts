/** Hermetic proof, transaction and project-boundary checks. Real rollback and
 * concurrent uniqueness are also exercised by integration/identity-enrollment-postgres.test.ts. */
import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { PgDialect } from "drizzle-orm/pg-core";
import { canonicalIdentityEnrollmentBytes, enrollIdentity, ENROLLMENT_MAX_BYTES, identityEnrollmentSchema, type EnrollmentInput } from "../src/services/identity/enrollment";

const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const P = uid(1), I = uid(2), K = uid(3), A = uid(4), O = uid(5);
const ORIGIN = "https://api.agenttool.dev", NOW = new Date("2026-09-29T12:00:00.000Z");
const PRIVATE = new Uint8Array(32).fill(7), PUBLIC = Buffer.from(ed.getPublicKey(PRIVATE)).toString("base64");
const body = () => ({ format: "agenttool-identity-enrollment/v1", origin: ORIGIN, project_id: P, identity_id: I,
  signing_key_id: K, display_name: "Selected participant", capabilities: ["review"], public_key: PUBLIC,
  nonce: Buffer.alloc(32, 8).toString("base64url"), timestamp: NOW.toISOString() });
function request(value: unknown = body(), privateKey = PRIVATE): EnrollmentInput {
  const input = { origin: ORIGIN, projectId: P, issuerApiKeyId: A, bodyBytes: Buffer.from(JSON.stringify(value)), signature: "" };
  input.signature = Buffer.from(ed.sign(canonicalIdentityEnrollmentBytes(input), privateKey)).toString("base64url");
  return input;
}
const parent = () => ({ id: A, projectId: P, revokedAt: null, expiresAt: null });
function staged(input: { parent?: unknown[]; failInsert?: number; error?: unknown } = {}) {
  const events: Array<{ operation: string; values?: Record<string, unknown>; lock?: string; condition?: { sql: string; params: unknown[] } }> = [];
  const dialect = new PgDialect();
  let commits = 0, rollbacks = 0, inserts = 0;
  const tx = {
    select: () => {
      const event: typeof events[number] = { operation: "select" }; events.push(event);
      const builder = { from: () => builder, where: (v: never) => { event.condition = dialect.sqlToQuery(v); return builder; },
        for: (lock: string) => { event.lock = lock; return builder; }, limit: async () => input.parent ?? [parent()] };
      return builder;
    },
    insert: () => {
      const event: typeof events[number] = { operation: "insert" }; events.push(event);
      return { values: (values: Record<string, unknown>) => { event.values = values; return { returning: async () => {
        inserts++;
        if (inserts === input.failInsert) throw input.error ?? new Error("injected persistence failure");
        return [values];
      } }; } };
    },
  };
  const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    try { const result = await fn(tx); commits++; return result; } catch (e) { rollbacks++; throw e; }
  } };
  return { options: { database: database as never, now: NOW }, events, commits: () => commits, rollbacks: () => rollbacks };
}

describe("same-project enrollment proof", () => {
  test("binds exact bytes, configured origin and project independently", async () => {
    const signed = request();
    const variants = [
      { ...signed, origin: "https://other.example" }, { ...signed, projectId: O },
      { ...signed, bodyBytes: Buffer.concat([signed.bodyBytes, Buffer.from(" ")]) },
      ...["identity_id", "signing_key_id", "project_id"].map(key => ({ ...signed, bodyBytes: Buffer.from(JSON.stringify({ ...body(), [key]: O })) })),
      { ...signed, bodyBytes: Buffer.from(JSON.stringify({ ...body(), capabilities: [] })) },
      { ...signed, bodyBytes: Buffer.from(JSON.stringify({ ...body(), display_name: "Changed" })) },
      { ...signed, bodyBytes: Buffer.from(JSON.stringify({ ...body(), nonce: Buffer.alloc(32, 9).toString("base64url") })) },
      { ...signed, signature: request(body(), new Uint8Array(32).fill(9)).signature },
    ];
    for (const input of variants) {
      const f = staged();
      await expect(enrollIdentity(input, f.options)).rejects.toMatchObject({ status: 401 });
      expect(f.events).toEqual([]);
    }
  });
  test("rejects ZIP215 identity-point forgery and zero public keys before admission", async () => {
    for (const first of [0, 1]) {
      const publicKey = Buffer.alloc(32); publicKey[0] = first;
      const signature = Buffer.alloc(64); signature[0] = 1;
      const input = request({ ...body(), public_key: publicKey.toString("base64") }); input.signature = signature.toString("base64url");
      const f = staged();
      await expect(enrollIdentity(input, f.options)).rejects.toMatchObject({ status: 401 });
      expect(f.events).toEqual([]);
    }
  });
  test("strict schema excludes metadata, authority overrides and noncanonical encodings", async () => {
    for (const value of [
      { ...body(), metadata: { lifecycle: "at_rest" } }, { ...body(), authority_root_public_key: PUBLIC },
      { ...body(), private_key: "never accepted" }, { ...body(), public_key: PUBLIC.slice(0, -1) },
      { ...body(), nonce: body().nonce + "=" }, { ...body(), timestamp: "2026-09-29T12:00:00Z" },
      { ...body(), display_name: "\ud800" }, { ...body(), display_name: "x\0y" },
      { ...body(), capabilities: undefined }, { ...body(), display_name: "😀".repeat(129) },
    ]) {
      const f = staged();
      await expect(enrollIdentity(request(value), f.options)).rejects.toMatchObject({ status: 400 });
      expect(f.events).toEqual([]);
    }
    expect(identityEnrollmentSchema.safeParse({ ...body(), display_name: "😀".repeat(128) }).success).toBe(true);
  });
  test("strict parser rejects escaped duplicate fields, malformed UTF8, and oversized bodies", async () => {
    const signed = request();
    for (const bodyBytes of [Buffer.from(JSON.stringify(body()).replace('"display_name":', '"display_name":"other","display_\\u006eame":')),
      Buffer.concat([Buffer.from([0xff]), signed.bodyBytes]), Buffer.alloc(ENROLLMENT_MAX_BYTES + 1, 32)]) {
      const f = staged();
      await expect(enrollIdentity({ ...signed, bodyBytes }, f.options)).rejects.toMatchObject({ status: 400 });
      expect(f.events).toEqual([]);
    }
  });
  test("refuses stale/future intent and rechecks freshness after the administrator lock", async () => {
    for (const timestamp of [-300001, 300001].map(n => new Date(NOW.getTime() + n).toISOString())) {
      const f = staged(); await expect(enrollIdentity(request({ ...body(), timestamp }), f.options)).rejects.toMatchObject({ status: 401 });
      expect(f.events).toEqual([]);
    }
    const f = staged(); let clockReads = 0;
    await expect(enrollIdentity(request(), { ...f.options, now: () => ++clockReads === 1 ? NOW : new Date(NOW.getTime() + 300001) })).rejects.toMatchObject({ status: 401 });
    expect(f.events).toHaveLength(1); expect(f.rollbacks()).toBe(1);
  });
});

describe("atomic rooted enrollment", () => {
  test("rechecks the selected administrator and creates only proof, identity and its held root key", async () => {
    const f = staged(), result = await enrollIdentity(request(), f.options);
    expect(f.events[0].condition?.params).toEqual([A, P]); expect(f.events[0].lock).toBe("share");
    expect(f.events.map(e => e.operation)).toEqual(["select", "insert", "insert", "insert"]);
    expect(f.events[1].values).toMatchObject({ domain: "identity-enrollment/v1", rootPublicKey: PUBLIC });
    expect(f.events[1].values?.nonceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(f.events[2].values).toMatchObject({ id: I, projectId: P, authorityRootPublicKey: PUBLIC, authoritySequence: 0, metadata: {} });
    expect(f.events[3].values).toMatchObject({ id: K, identityId: I, publicKey: PUBLIC, active: true });
    expect(result).toMatchObject({ identity: { id: I }, key: { kid: K, public_key: PUBLIC }, authority: { mode: "agent_root", sequence: 0 } });
    expect(Object.keys(result.key).sort()).toEqual(["kid", "public_key"]);
    expect(JSON.stringify(result)).not.toMatch(/private_key|bearer|token/);
    expect(f.commits()).toBe(1); expect(f.rollbacks()).toBe(0);
  });
  test("revoked, expired, foreign and missing administrator rows cannot create anything", async () => {
    for (const rows of [[], [{ ...parent(), id: O }], [{ ...parent(), projectId: O }], [{ ...parent(), revokedAt: NOW }],
      [{ ...parent(), expiresAt: NOW }], [{ ...parent(), expiresAt: new Date(NaN) }]]) {
      const f = staged({ parent: rows });
      await expect(enrollIdentity(request(), f.options)).rejects.toMatchObject({ status: 401 });
      expect(f.events).toHaveLength(1); expect(f.rollbacks()).toBe(1);
    }
  });
  test("nonce replay and identity/key collision reject the transaction callback", async () => {
    for (const failInsert of [1, 2, 3]) {
      const f = staged({ failInsert, error: { cause: { code: "23505" } } });
      await expect(enrollIdentity(request(), f.options)).rejects.toMatchObject({ status: 409 });
      expect(f.commits()).toBe(0); expect(f.rollbacks()).toBe(1);
    }
    const f = staged({ failInsert: 3 });
    await expect(enrollIdentity(request(), f.options)).rejects.toThrow("injected persistence failure");
    expect(f.commits()).toBe(0); expect(f.rollbacks()).toBe(1);
  });
});
