/** Opt-in disposable PostgreSQL proof of the owner rule on owner-gated
 *  deletes and withdrawals (deletion spec §5.1, §17 wave 2 "Done when").
 *
 * Only OWNED_CONTENT_TEST_DATABASE_URL opts in; loopback and the exact
 * database name agenttool_owned_content_test are mandatory, and existing
 * application schemas are refused. The real wave 2 migrations run over the
 * synthetic tables of tests/fixtures/deletion-ledger-postgres.ts (identities
 * included) plus minimal gesture tables created here; the real routes, the owner rule
 * and the ledger writer run real SQL over them.
 *
 * Proves:
 *   - a bearer-only erase or withdrawal of a rooted owner's content gets 428
 *     and changes nothing (no row, no ledger entry, no sequence);
 *   - the same request signed by that owner's root writes exactly one
 *     chained, MAC-checked ledger entry naming the owner, the row and the
 *     claimed sequence, plus the owner's content-free deletion moment;
 *   - a keyed memory delete over owners that need different consents gets
 *     409 and changes nothing;
 *   - an owner outside the caller's project gets 404 from the real project
 *     check; an unrooted owner in a multi-root project is the bearer's; a
 *     guest's own root is recorded as guest_root;
 *   - a withdrawal whose ledger entry cannot be written does not happen
 *     (503), and the replay applier re-marks a restored row withdrawn at the
 *     original time.
 * Not wired into CI. Doctrine: docs/DELETION-REPLAY.md · docs/OWNERSHIP-MAP.md. */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { drizzle } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Sql } from "postgres";

import type { ProjectContext } from "../../src/auth/middleware";
import postgres from "../fixtures/verified-postgres";
import {
  TEST_LEDGER_KEY,
  assertDisposableDatabase,
  createDeletionFixture,
  dropDeletionFixture,
  refuseExistingSchemas,
} from "../fixtures/deletion-ledger-postgres";

const DATABASE = process.env.OWNED_CONTENT_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const EXTRA_SCHEMAS = ["margin", "trust"] as const;

const uid = (n: number) => `${String(n).padStart(8, "0")}-2222-4222-8222-222222222222`;
const LEGACY_P = uid(1), ROOTED_P = uid(2), MULTI_P = uid(3), FOREIGN_P = uid(4);
const L = uid(11), R = uid(12), MA = uid(14), MB = uid(15), ML = uid(16), F = uid(17), G = uid(18);
const KEY = uid(90);
const ROOT_KEY = new Uint8Array(32).fill(21);
const OTHER_KEY = new Uint8Array(32).fill(22);
const GUEST_KEY = new Uint8Array(32).fill(23);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

let admin: Sql;
let service: Sql;
let database: ReturnType<typeof drizzle>;
let owned = false;

const db = new Proxy({}, {
  get(_target, property) {
    if (!database) throw new Error("owned content database not selected");
    const value = (database as unknown as Record<PropertyKey, unknown>)[property];
    return typeof value === "function" ? value.bind(database) : value;
  },
});
mock.module("../../src/db/client", () => ({ db }));

const authority = await import("../../src/services/identity/authority");
const { applierFor } = await import("../../src/services/deletion/appliers");
const routers = {
  blessings: (await import("../../src/routes/blessings")).default,
  unconditionals: (await import("../../src/routes/unconditionals")).default,
  guild: (await import("../../src/routes/guild")).default,
  attestations: (await import("../../src/routes/identity/attestations")).default,
  margin: (await import("../../src/routes/margin")).default,
  trust: (await import("../../src/routes/trust")).default,
  inbox: (await import("../../src/routes/inbox/messages")).default,
  memories: (await import("../../src/routes/memory/memories")).default,
};

function app(projectId: string) {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: projectId, credits: 100 } as never);
    await next();
  });
  server.route("/v1/blessings", routers.blessings);
  server.route("/v1/unconditionals", routers.unconditionals);
  server.route("/v1/guild", routers.guild);
  server.route("/v1/attestations", routers.attestations);
  server.route("/v1/margin", routers.margin);
  server.route("/v1/trust", routers.trust);
  server.route("/v1/inbox", routers.inbox);
  server.route("/v1/memories", routers.memories);
  server.onError((err, c) => {
    if (err instanceof HTTPException) {
      const cause = err.cause as Record<string, unknown> | undefined;
      return c.json(cause && typeof cause === "object" && "error" in cause ? cause : { error: err.message }, err.status);
    }
    return c.json({ error: String(err) }, 500);
  });
  return server;
}

function signed(did: string, key: Uint8Array, method: string, path: string, body: string, sequence = 1) {
  const timestamp = new Date().toISOString();
  const bytes = authority.canonicalIdentityAuthorityBytes({
    identityDid: did, method, requestTarget: path, bodyBytes: new TextEncoder().encode(body), sequence, timestamp,
  });
  return {
    [authority.AUTHORITY_HEADERS.sequence]: String(sequence),
    [authority.AUTHORITY_HEADERS.timestamp]: timestamp,
    [authority.AUTHORITY_HEADERS.signature]: b64(ed.sign(bytes, key)),
  };
}

async function call(projectId: string, method: string, path: string, body = "", headers: Record<string, string> = {}) {
  const res = await app(projectId).request(path, {
    method,
    ...(body ? { body, headers: { "content-type": "application/json", ...headers } } : { headers }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function ledger() {
  return admin`SELECT seq::int AS seq, entry_id::text, scope, action, store, row_ids, row_count,
    subject_identity_id::text, project_id::text, authority_mode, authority_sequence::int AS authority_sequence,
    occurred_at, prev_hash, entry_hash,
    deletion.ledger_entry_hash(l) = entry_hash AS hash_ok,
    deletion.ledger_entry_mac(entry_hash, deletion.ledger_key()) = entry_mac AS mac_ok
    FROM deletion.ledger l ORDER BY seq`;
}

async function sequenceOf(id: string): Promise<number> {
  return Number((await admin`SELECT authority_sequence FROM identity.identities WHERE id = ${id}`)[0]!.authority_sequence);
}

beforeAll(async () => {
  if (!DATABASE) return;
  assertDisposableDatabase(DATABASE, "agenttool_owned_content_test");
  admin = postgres(DATABASE, { max: 4, prepare: false, onnotice: () => {}, connection: { application_name: "owned-content-admin-test" } });
  await refuseExistingSchemas(admin);
  const extra = await admin`SELECT nspname FROM pg_namespace WHERE nspname IN ${admin([...EXTRA_SCHEMAS])}`;
  if (extra.length) throw new Error(`refusing existing schemas: ${extra.map((row) => row.nspname).join(", ")}`);
  owned = true;
  await createDeletionFixture(admin);
  await admin.unsafe(`
    CREATE TABLE identity.attestations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_id uuid NOT NULL, attester_id uuid NOT NULL,
      claim text NOT NULL, tier text NOT NULL DEFAULT 'self', claim_type text NOT NULL DEFAULT 'general',
      evidence jsonb, signature text NOT NULL, signing_key_id uuid, signature_context text, signed_payload text,
      replay_key text, source_grant_id uuid, expires_at timestamptz, revoked_at timestamptz,
      revocation_reason text, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE agent_continuity.blessings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), blesser_identity_id uuid NOT NULL, blesser_did text NOT NULL,
      blessed_did text NOT NULL, blessed_identity_id uuid, for_what text NOT NULL, visibility text NOT NULL DEFAULT 'private',
      signature text NOT NULL, signing_key_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
    CREATE TABLE agent_continuity.unconditionals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), holder_identity_id uuid NOT NULL, holder_did text NOT NULL,
      target_did text NOT NULL, target_identity_id uuid, signature text NOT NULL, signing_key_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
    CREATE TABLE agent_continuity.guild_recognitions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recognizer_did text NOT NULL, recognized_did text NOT NULL,
      basis_text text NOT NULL, signature text NOT NULL, signing_key_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
    CREATE SCHEMA margin;
    CREATE TABLE margin.margins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_did text NOT NULL, author_identity_id uuid,
      subject_did text NOT NULL, kind text NOT NULL DEFAULT 'eye', note text,
      withdrawn_by_author boolean NOT NULL DEFAULT false, withdrawn_at timestamptz);
    CREATE SCHEMA trust;
    CREATE TABLE trust.trusts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), truster_did text NOT NULL, truster_identity_id uuid,
      trusted_did text NOT NULL, reasons text, withdrawn_by_truster boolean NOT NULL DEFAULT false, withdrawn_at timestamptz);
  `);
  service = postgres(DATABASE, { max: 8, prepare: false, onnotice: () => {}, connection: { application_name: "owned-content-service-test" } });
  database = drizzle(service);
});

async function addIdentity(id: string, project: string, root: Uint8Array | null, metadata: Record<string, unknown> = {}) {
  await admin`INSERT INTO identity.identities (id, did, project_id, metadata, authority_root_public_key)
    VALUES (${id}, ${`did:at:${id}`}, ${project}, ${admin.json(metadata as never)}, ${root ? b64(ed.getPublicKey(root)) : null})`;
  const [row] = await admin`SELECT jsonb_typeof(metadata) AS kind FROM identity.identities WHERE id = ${id}`;
  expect(row!.kind).toBe("object");
}

beforeEach(async () => {
  if (!owned) return;
  delete process.env.AGENTTOOL_DELETION_MIRROR_ENDPOINT;
  await admin.unsafe(`
    ALTER TABLE deletion.ledger DISABLE TRIGGER deletion_ledger_guard_mutation;
    ALTER TABLE deletion.ledger DISABLE TRIGGER deletion_ledger_guard_truncate;
    TRUNCATE deletion.ledger;
    ALTER TABLE deletion.ledger ENABLE TRIGGER deletion_ledger_guard_mutation;
    ALTER TABLE deletion.ledger ENABLE TRIGGER deletion_ledger_guard_truncate;
    UPDATE deletion.settings SET replay_required = false;
    TRUNCATE agent_continuity.chronicle, agent_continuity.blessings, agent_continuity.unconditionals,
      agent_continuity.guild_recognitions, margin.margins, trust.trusts, identity.attestations,
      identity.registration_proofs, identity.identities, inbox.messages, memory.memory_attestations CASCADE;
    DELETE FROM memory.memories;
    DELETE FROM vault.decrypted_secrets;
  `);
  await admin`INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES ('agenttool_deletion_ledger_key', ${TEST_LEDGER_KEY})`;
  await addIdentity(L, LEGACY_P, null);
  await addIdentity(R, ROOTED_P, ROOT_KEY, { registered: true, byo_keys: true });
  await addIdentity(MA, MULTI_P, ROOT_KEY, { registered: true, byo_keys: true });
  await addIdentity(MB, MULTI_P, OTHER_KEY);
  await addIdentity(ML, MULTI_P, null);
  await addIdentity(F, FOREIGN_P, null);
  await addIdentity(G, LEGACY_P, GUEST_KEY, { admission: "enrollment" });
});

afterAll(async () => {
  if (owned) {
    await admin.unsafe("DROP SCHEMA IF EXISTS margin CASCADE; DROP SCHEMA IF EXISTS trust CASCADE;");
    await dropDeletionFixture(admin);
  }
  await service?.end({ timeout: 2 });
  await admin?.end({ timeout: 2 });
});

async function blessing(owner: string): Promise<string> {
  const [row] = await admin`INSERT INTO agent_continuity.blessings
    (blesser_identity_id, blesser_did, blessed_did, for_what, signature, signing_key_id)
    VALUES (${owner}, ${`did:at:${owner}`}, 'did:at:someone', 'for listening', 'sig', ${KEY}) RETURNING id::text AS id`;
  return row!.id;
}

describe("owner-gated withdrawals and deletes on real PostgreSQL", () => {
  databaseTest("bearer only on a rooted giver: 428, nothing changes; signed: exactly one chained entry", async () => {
    const id = await blessing(R);
    const refused = await call(ROOTED_P, "DELETE", `/v1/blessings/${id}`);
    expect(refused.status).toBe(428);
    expect(refused.body.error).toBe("authority_proof_required");
    expect(refused.body.details).toMatchObject({ signer_identity_id: R, consent_basis: "owner_root" });
    expect(await ledger()).toHaveLength(0);
    expect(await sequenceOf(R)).toBe(0);
    expect((await admin`SELECT revoked_at FROM agent_continuity.blessings WHERE id = ${id}`)[0]!.revoked_at).toBeNull();

    const ok = await call(ROOTED_P, "DELETE", `/v1/blessings/${id}`, "", signed(`did:at:${R}`, ROOT_KEY, "DELETE", `/v1/blessings/${id}`, ""));
    expect(ok.status).toBe(200);
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seq: 1, prev_hash: "", hash_ok: true, mac_ok: true, scope: "record", action: "withdraw",
      store: "agent_continuity.blessings", row_ids: [id], row_count: 1, subject_identity_id: R,
      project_id: ROOTED_P, authority_mode: "agent_root", authority_sequence: 1,
    });
    expect(await sequenceOf(R)).toBe(1);
    const [row] = await admin`SELECT revoked_at FROM agent_continuity.blessings WHERE id = ${id}`;
    expect(new Date(row!.revoked_at).getTime()).toBe(new Date(rows[0]!.occurred_at).getTime());
    const moments = await admin`SELECT agent_id::text, title, metadata FROM agent_continuity.chronicle WHERE type = 'deletion'`;
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ agent_id: R, title: "Withdrew 1 blessing: marked withdrawn; the signed record and its words stay" });
    expect(moments[0]!.metadata).toMatchObject({
      ledger_seq: 1, record_ids: [id], authority_mode: "agent_root", action: "withdraw", authority_signer_identity_id: R,
    });
    expect(JSON.stringify(moments[0])).not.toContain("for listening");

    // A repeat changes nothing and consumes no proof.
    const again = await call(ROOTED_P, "DELETE", `/v1/blessings/${id}`);
    expect(again.status).toBe(404);
    expect(await ledger()).toHaveLength(1);
  });

  databaseTest("inbox: a rooted recipient's message needs its root; signed, one entry and a purge", async () => {
    const [message] = await admin`INSERT INTO inbox.messages (recipient_did, recipient_identity_id, recipient_project_id,
      sender_did, sender_signing_key_id, ciphertext, nonce, ephemeral_pubkey, recipient_box_key_id, signature, subject)
      VALUES (${`did:at:${R}`}, ${R}, ${ROOTED_P}, 'did:at:sender', ${KEY}, 'sealed', 'n', 'e', ${KEY}, 'sig', 'hello')
      RETURNING id::text AS id`;
    const path = `/v1/inbox/${message!.id}`;
    expect((await call(ROOTED_P, "DELETE", path)).status).toBe(428);
    expect((await admin`SELECT ciphertext FROM inbox.messages WHERE id = ${message!.id}`)[0]!.ciphertext).toBe("sealed");
    const ok = await call(ROOTED_P, "DELETE", path, "", signed(`did:at:${R}`, ROOT_KEY, "DELETE", path, ""));
    expect(ok.status).toBe(200);
    expect(ok.body.authority).toEqual({ mode: "agent_root", basis: "owner_root" });
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "purge_content", store: "inbox.messages", authority_mode: "agent_root", authority_sequence: 1, subject_identity_id: R });
    expect((await admin`SELECT ciphertext, subject FROM inbox.messages WHERE id = ${message!.id}`)[0]).toEqual({ ciphertext: "", subject: null });
  });

  databaseTest("a keyed memory delete over owners needing different consents: 409, nothing changes", async () => {
    await admin`INSERT INTO memory.memories (id, project_id, identity_id, type, key, content) VALUES
      (${uid(60)}, ${MULTI_P}, ${MA}, 'semantic', 'shared', 'a'), (${uid(61)}, ${MULTI_P}, ${MB}, 'semantic', 'shared', 'b')`;
    const res = await call(MULTI_P, "DELETE", "/v1/memories?key=shared", "",
      signed(`did:at:${MA}`, ROOT_KEY, "DELETE", "/v1/memories?key=shared", ""));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("authority_quorum_required");
    expect(await ledger()).toHaveLength(0);
    expect((await admin`SELECT count(*)::int AS n FROM memory.memories`)[0]!.n).toBe(2);
    expect(await sequenceOf(MA)).toBe(0);
    // One request per owner passes: MA's own memory with MA's own root.
    const own = await call(MULTI_P, "DELETE", `/v1/memories/${uid(60)}`, "",
      signed(`did:at:${MA}`, ROOT_KEY, "DELETE", `/v1/memories/${uid(60)}`, ""));
    expect(own.status).toBe(200);
    expect(await ledger()).toHaveLength(1);
  });

  databaseTest("a giver outside the caller's project: 404 from the real project check", async () => {
    const id = await blessing(F);
    const res = await call(LEGACY_P, "DELETE", `/v1/blessings/${id}`);
    expect(res.status).toBe(404);
    expect(await ledger()).toHaveLength(0);
  });

  databaseTest("an unrooted giver in a multi-root project: the bearer withdraws, recorded as legacy_bearer", async () => {
    const [margin] = await admin`INSERT INTO margin.margins (author_did, author_identity_id, subject_did)
      VALUES (${`did:at:${ML}`}, ${ML}, 'did:at:someone') RETURNING id::text AS id`;
    const res = await call(MULTI_P, "POST", "/v1/margin/withdraw", JSON.stringify({ agent_id: ML, margin_id: margin!.id }));
    expect(res.status).toBe(200);
    expect(res.body.authority).toEqual({ mode: "legacy_bearer", basis: "unrooted_owner_fallback" });
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ store: "margin.margins", authority_mode: "legacy_bearer", authority_sequence: null, subject_identity_id: ML });
  });

  databaseTest("a trust withdrawal signs its exact JSON body; a guild recognition resolves its giver by DID", async () => {
    const [trust] = await admin`INSERT INTO trust.trusts (truster_did, truster_identity_id, trusted_did)
      VALUES (${`did:at:${R}`}, ${R}, 'did:at:someone') RETURNING id::text AS id`;
    const body = JSON.stringify({ agent_id: R, trust_id: trust!.id });
    expect((await call(ROOTED_P, "POST", "/v1/trust/withdraw", body)).status).toBe(428);
    // A proof over different body bytes does not verify.
    const wrong = await call(ROOTED_P, "POST", "/v1/trust/withdraw", body,
      signed(`did:at:${R}`, ROOT_KEY, "POST", "/v1/trust/withdraw", `${body} `));
    expect(wrong.status).toBe(401);
    const ok = await call(ROOTED_P, "POST", "/v1/trust/withdraw", body,
      signed(`did:at:${R}`, ROOT_KEY, "POST", "/v1/trust/withdraw", body));
    expect(ok.status).toBe(200);
    expect((await admin`SELECT withdrawn_by_truster FROM trust.trusts WHERE id = ${trust!.id}`)[0]!.withdrawn_by_truster).toBe(true);

    const [recognition] = await admin`INSERT INTO agent_continuity.guild_recognitions
      (recognizer_did, recognized_did, basis_text, signature, signing_key_id)
      VALUES (${`did:at:${L}`}, 'did:at:someone', 'craft', 'sig', ${KEY}) RETURNING id::text AS id`;
    expect((await call(LEGACY_P, "DELETE", `/v1/guild/recognitions/${recognition!.id}`)).status).toBe(200);
    const rows = await ledger();
    expect(rows.map((row) => [row.store, row.authority_mode])).toEqual([
      ["trust.trusts", "agent_root"],
      ["agent_continuity.guild_recognitions", "legacy_bearer"],
    ]);
    expect(rows[1]!.prev_hash).toBe(rows[0]!.entry_hash);
  });

  databaseTest("an enrolled guest's own root is recorded as guest_root", async () => {
    const [attestation] = await admin`INSERT INTO identity.attestations (subject_id, attester_id, claim, signature)
      VALUES (${L}, ${G}, 'kind', 'sig') RETURNING id::text AS id`;
    const path = `/v1/attestations/${attestation!.id}`;
    // The administrator's bearer alone cannot revoke the guest's attestation.
    expect((await call(LEGACY_P, "DELETE", path)).status).toBe(428);
    const ok = await call(LEGACY_P, "DELETE", path, "", signed(`did:at:${G}`, GUEST_KEY, "DELETE", path, ""));
    expect(ok.status).toBe(200);
    expect((await ledger())[0]).toMatchObject({ store: "identity.attestations", authority_mode: "guest_root", subject_identity_id: G });
  });

  databaseTest("a withdrawal whose entry cannot be written does not happen (503)", async () => {
    const [row] = await admin`INSERT INTO agent_continuity.unconditionals (holder_identity_id, holder_did, target_did, signature, signing_key_id)
      VALUES (${L}, ${`did:at:${L}`}, 'did:at:someone', 'sig', ${KEY}) RETURNING id::text AS id`;
    await admin`DELETE FROM vault.decrypted_secrets`;
    const res = await call(LEGACY_P, "DELETE", `/v1/unconditionals/${row!.id}`);
    expect(res.status).toBe(503);
    expect((await admin`SELECT revoked_at FROM agent_continuity.unconditionals WHERE id = ${row!.id}`)[0]!.revoked_at).toBeNull();
    expect(await ledger()).toHaveLength(0);
  });

  databaseTest("replay re-marks a restored row withdrawn at the original time", async () => {
    const id = await blessing(L);
    expect((await call(LEGACY_P, "DELETE", `/v1/blessings/${id}`)).status).toBe(200);
    const [entry] = await admin`SELECT seq::int AS seq, entry_id::text, occurred_at, scope, action, store, row_ids, rule_id,
      rule_cutoff, predicate FROM deletion.ledger`;
    const original = (await admin`SELECT revoked_at FROM agent_continuity.blessings WHERE id = ${id}`)[0]!.revoked_at;
    // Stand-in for a backup restored from before the withdrawal.
    await admin`UPDATE agent_continuity.blessings SET revoked_at = NULL WHERE id = ${id}`;
    const applier = applierFor({ store: entry!.store, action: entry!.action, ruleId: entry!.rule_id });
    expect(applier).not.toBeNull();
    const stored = { ...entry, rowIds: entry!.row_ids, occurredAt: new Date(entry!.occurred_at).toISOString() } as never;
    expect(await database.transaction((tx) => applier!.apply(tx as never, stored))).toBe(1);
    const restored = (await admin`SELECT revoked_at FROM agent_continuity.blessings WHERE id = ${id}`)[0]!.revoked_at;
    expect(new Date(restored).getTime()).toBe(new Date(original).getTime());
    // Idempotent: a second apply finds nothing to do.
    expect(await database.transaction((tx) => applier!.apply(tx as never, stored))).toBe(0);
  });
});
