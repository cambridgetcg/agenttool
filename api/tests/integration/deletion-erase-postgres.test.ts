/** Opt-in disposable PostgreSQL proof that wave 2's deletes are real.
 *
 * Only DELETION_LEDGER_TEST_DATABASE_URL opts in; loopback and the exact
 * database name agenttool_deletion_ledger_test are mandatory, and existing
 * application schemas are refused. The real wave 2 migrations run over
 * minimal synthetic tables (tests/fixtures/deletion-ledger-postgres.ts); the
 * real routes and services run real SQL over them.
 *
 * Proves: each erase (inbox, vault and identity-backup routes; memory
 * deletes, including erase-in-place for a paid receipt; the bearer's trace,
 * organization and membership deletes) writes exactly one
 * chained ledger entry per action, really clears its columns and writes its
 * deletion moment; a purged message cannot be restored while a legacy
 * soft-delete still can; a failed ledger write aborts the erase (503); the
 * backfill dry-runs, refuses before its dates or without a mirror, then
 * purges with rule entries that reach the mirror.
 * Not wired into CI. Doctrine: docs/DELETION-REPLAY.md · docs/RETENTION.md. */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
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

const DATABASE = process.env.DELETION_LEDGER_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const P = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const KEYID = "33333333-3333-4333-8333-333333333333";

let admin: Sql;
let service: Sql;
let database: ReturnType<typeof drizzle>;
let owned = false;

const db = new Proxy({}, {
  get(_target, property) {
    if (!database) throw new Error("deletion erase database not selected");
    const value = (database as unknown as Record<PropertyKey, unknown>)[property];
    return typeof value === "function" ? value.bind(database) : value;
  },
});
mock.module("../../src/db/client", () => ({ db }));

const memoryStore = await import("../../src/services/memory/store");
const { default: inboxRouter } = await import("../../src/routes/inbox/messages");
const { default: vaultRouter } = await import("../../src/routes/vault/secrets");
const { default: backupRouter } = await import("../../src/routes/identity-backup");
const { default: traceRouter } = await import("../../src/routes/trace/traces");
const { default: orgRouter } = await import("../../src/routes/orgs");
const { applierFor } = await import("../../src/services/deletion/appliers");
// Project-owned stores this file adds beside the shared fixture.
const EXTRA_SCHEMAS = ["trace", "org"] as const;

function app(project = P) {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: project, credits: 100 } as never);
    await next();
  });
  server.route("/v1/inbox", inboxRouter);
  server.route("/v1/vault", vaultRouter);
  server.route("/v1/identity/backup", backupRouter);
  server.route("/v1/traces", traceRouter);
  server.route("/v1/orgs", orgRouter);
  server.onError((err, c) => {
    if (err instanceof HTTPException) {
      const cause = err.cause as Record<string, unknown> | undefined;
      return c.json(cause && typeof cause === "object" && "error" in cause ? cause : { error: err.message }, err.status);
    }
    return c.json({ error: String(err) }, 500);
  });
  return server;
}

async function ledgerRows() {
  return admin`SELECT seq::int AS seq, entry_id::text, scope, action, store, row_ids, row_count, rule_id,
    subject_identity_id::text, project_id::text, authority_mode, prev_hash, entry_hash,
    deletion.ledger_entry_hash(l) = entry_hash AS hash_ok,
    deletion.ledger_entry_mac(entry_hash, deletion.ledger_key()) = entry_mac AS mac_ok
    FROM deletion.ledger l ORDER BY seq`;
}

async function expectChain() {
  const rows = await ledgerRows();
  let prev = "";
  rows.forEach((row, index) => {
    expect(row.seq).toBe(index + 1);
    expect(row.prev_hash).toBe(prev);
    expect(row.hash_ok).toBe(true);
    expect(row.mac_ok).toBe(true);
    prev = row.entry_hash;
  });
  return rows;
}

async function moments() {
  return admin`SELECT agent_id::text, type, title, body, metadata FROM agent_continuity.chronicle
    WHERE type = 'deletion' ORDER BY (metadata->>'ledger_seq')::int, occurred_at, id`;
}

beforeAll(async () => {
  if (!DATABASE) return;
  assertDisposableDatabase(DATABASE, "agenttool_deletion_ledger_test");
  admin = postgres(DATABASE, { max: 4, prepare: false, onnotice: () => {}, connection: { application_name: "deletion-erase-admin-test" } });
  await refuseExistingSchemas(admin);
  const extra = await admin`SELECT nspname FROM pg_namespace WHERE nspname IN ${admin([...EXTRA_SCHEMAS])}`;
  if (extra.length) throw new Error(`refusing existing schemas: ${extra.map((row) => row.nspname).join(", ")}`);
  owned = true;
  await createDeletionFixture(admin);
  await admin.unsafe(`
    CREATE SCHEMA trace;
    CREATE TABLE trace.traces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trace_id text NOT NULL, project_id uuid NOT NULL,
      summary text NOT NULL DEFAULT 'why');
    CREATE SCHEMA org;
    CREATE TABLE org.organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL, description text,
      owner_project_id uuid NOT NULL, visibility text NOT NULL DEFAULT 'public', metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE org.organization_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
      project_id uuid NOT NULL, role text NOT NULL DEFAULT 'member', joined_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id, project_id));
    CREATE TABLE org.organization_invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
      invited_project_id uuid NOT NULL, inviter_project_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz);
  `);
  service = postgres(DATABASE, { max: 8, prepare: false, onnotice: () => {}, connection: { application_name: "deletion-erase-service-test" } });
  database = drizzle(service);
});

beforeEach(async () => {
  if (!owned) return;
  delete process.env.AGENTTOOL_DELETION_MIRROR_ENDPOINT;
  await admin.unsafe(`
    ALTER TABLE deletion.ledger DISABLE TRIGGER deletion_ledger_guard_mutation;
    ALTER TABLE deletion.ledger DISABLE TRIGGER deletion_ledger_guard_truncate;
    TRUNCATE deletion.ledger;
    ALTER TABLE deletion.ledger ENABLE TRIGGER deletion_ledger_guard_mutation;
    ALTER TABLE deletion.ledger ENABLE TRIGGER deletion_ledger_guard_truncate;
    DELETE FROM vault.decrypted_secrets;
    INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES ('agenttool_deletion_ledger_key', '${TEST_LEDGER_KEY}');
    TRUNCATE inbox.messages, agent_vault.vault_secrets, agent_vault.vault_versions, agent_vault.vault_audit,
      agent_continuity.identity_backups, agent_continuity.chronicle, marketplace.memory_witness_grants,
      memory.memory_attestations, memory.memories, trace.traces, org.organizations CASCADE;
  `);
});

afterAll(async () => {
  await service?.end({ timeout: 2 });
  if (owned) {
    await admin.unsafe("DROP SCHEMA IF EXISTS trace CASCADE; DROP SCHEMA IF EXISTS org CASCADE;");
    await dropDeletionFixture(admin);
  }
  await admin?.end({ timeout: 2 });
});

// ─── Real erases ────────────────────────────────────────────────────────

const MESSAGE = "a3000000-0000-4000-8000-000000000001";
const LEGACY_MESSAGE = "a3000000-0000-4000-8000-000000000002";
const RECIPIENT = "a3000000-0000-4000-8000-0000000000aa";

async function seedMessage(id: string, status = "unread") {
  await admin`INSERT INTO inbox.messages (id, recipient_did, recipient_identity_id, recipient_project_id, sender_did,
    sender_signing_key_id, ciphertext, nonce, ephemeral_pubkey, recipient_box_key_id, signature, subject, refs, status, metadata)
    VALUES (${id}, 'did:at:r', ${RECIPIENT}, ${P}, 'did:at:s', ${KEYID}, 'c2VhbGVk', 'bm9uY2U=', 'ZXBo', ${KEYID}, 'c2ln',
      'a plaintext subject', ${JSON.stringify([{ kind: "memory", ref: "m1" }])}::jsonb, ${status}, '{"note":"meta"}'::jsonb)`;
}

const request = (path: string, method: string, body?: unknown) => app().request(path, {
  method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});

describe("real erases write exactly one chained entry and clear their columns", () => {
  databaseTest("inbox DELETE purges; a purged message cannot be restored; a legacy soft-delete still can", async () => {
    await seedMessage(MESSAGE);
    await seedMessage(LEGACY_MESSAGE, "deleted");
    const response = await request(`/v1/inbox/${MESSAGE}`, "DELETE");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ deleted: true, already_deleted: false, content_retained: false, ledger: { seq: 1, mirrored: false } });
    const [row] = await admin`SELECT status, ciphertext, nonce, ephemeral_pubkey, subject, refs, metadata, signature,
      content_purged_at IS NOT NULL AS purged FROM inbox.messages WHERE id = ${MESSAGE}`;
    expect(row).toEqual({ status: "deleted", ciphertext: "", nonce: "", ephemeral_pubkey: "", subject: null, refs: null,
      metadata: {}, signature: "c2ln", purged: true });
    const rows = await expectChain();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope: "record", action: "purge_content", store: "inbox.messages", row_ids: [MESSAGE],
      row_count: 1, subject_identity_id: RECIPIENT, project_id: P, authority_mode: "legacy_bearer" });
    const [moment] = await moments();
    expect(moment).toMatchObject({ agent_id: RECIPIENT, type: "deletion", body: null });
    expect(moment!.title).toBe("Deleted 1 inbox message: sealed body, subject, references and metadata erased");
    expect(moment!.metadata).toMatchObject({ ledger_entry_id: rows[0]!.entry_id, ledger_seq: 1, record_ids: [MESSAGE] });
    expect(JSON.stringify(moment)).not.toContain("a plaintext subject");

    expect((await request(`/v1/inbox/${MESSAGE}`, "PATCH", { status: "unread" })).status).toBe(409);
    expect(await (await request(`/v1/inbox/${MESSAGE}`, "DELETE")).json()).toMatchObject({ already_deleted: true, ledger: null });
    expect(await ledgerRows()).toHaveLength(1);

    const restored = await request(`/v1/inbox/${LEGACY_MESSAGE}`, "PATCH", { status: "unread" });
    expect(restored.status).toBe(200);
    expect((await admin`SELECT status, ciphertext FROM inbox.messages WHERE id = ${LEGACY_MESSAGE}`)[0])
      .toEqual({ status: "unread", ciphertext: "c2VhbGVk" });
  });

  databaseTest("vault DELETE zeroes every version, keeps the CHECK, audits, and writes one entry", async () => {
    const [{ id: secret }] = await admin`INSERT INTO agent_vault.vault_secrets (project_id, name, description, tags, current_version)
      VALUES (${P}, 'api-key', 'production key for X', ARRAY['prod'], 2) RETURNING id::text`;
    await admin`INSERT INTO agent_vault.vault_versions (secret_id, version, encrypted_value, iv, auth_tag, agent_encrypted) VALUES
      (${secret}, 1, '\\xdeadbeef', '\\x0102', '\\x0a0b', false),
      (${secret}, 2, '\\xcafebabe', '\\x0304', NULL, true)`;
    const response = await request("/v1/vault/api-key", "DELETE");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, content_retained: false, versions_zeroed: 2, ledger: { seq: 1 } });
    const versions = await admin`SELECT version, encode(encrypted_value, 'hex') AS v, encode(iv, 'hex') AS iv,
      encode(auth_tag, 'hex') AS tag, content_purged_at IS NOT NULL AS purged FROM agent_vault.vault_versions ORDER BY version`;
    expect(versions).toEqual([
      { version: 1, v: "", iv: "", tag: "", purged: true },
      { version: 2, v: "", iv: "", tag: null, purged: true },
    ]);
    expect((await admin`SELECT description, tags, deleted_at IS NOT NULL AS deleted FROM agent_vault.vault_secrets`)[0])
      .toEqual({ description: null, tags: null, deleted: true });
    expect(await admin`SELECT action FROM agent_vault.vault_audit`).toEqual([{ action: "delete" }]);
    const rows = await expectChain();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ store: "agent_vault.vault_secrets", row_ids: [secret], subject_identity_id: null });
    expect((await moments())[0]).toMatchObject({ agent_id: null });
    expect((await request("/v1/vault/api-key", "DELETE")).status).toBe(404);
  });

  databaseTest("identity-backup DELETE revokes and purges, once", async () => {
    const [{ id }] = await admin`INSERT INTO agent_continuity.identity_backups (project_id, agent_id, blob_base64, key_derivation, nonce, metadata)
      VALUES (${P}, ${AGENT}, 'ZW5jcnlwdGVk', 'argon2id-v1', 'bm9uY2U=', '{"hint":"x"}') RETURNING id::text`;
    const body = await (await request(`/v1/identity/backup/${id}`, "DELETE")).json();
    expect(body).toMatchObject({ revoked: true, already_revoked: false, blob_retained: false, already_purged: false, ledger: { seq: 1 } });
    expect((await admin`SELECT blob_base64, nonce, metadata, label, revoked_at IS NOT NULL AS revoked,
      content_purged_at IS NOT NULL AS purged FROM agent_continuity.identity_backups`)[0])
      .toEqual({ blob_base64: "", nonce: null, metadata: {}, label: "primary", revoked: true, purged: true });
    expect(await (await request(`/v1/identity/backup/${id}`, "DELETE")).json()).toMatchObject({ already_purged: true, ledger: null });
    const rows = await expectChain();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ store: "agent_continuity.identity_backups", subject_identity_id: AGENT });
    expect((await moments())[0]).toMatchObject({ agent_id: AGENT });
  });

  databaseTest("memory delete removes ordinary rows and erases a paid-receipt row in place", async () => {
    const PLAIN = "a4000000-0000-4000-8000-000000000001";
    const PAID = "a4000000-0000-4000-8000-000000000002";
    const EXPIRED = "a4000000-0000-4000-8000-000000000003";
    await admin`INSERT INTO memory.memories (id, project_id, identity_id, type, key, content, embedding, metadata, expression_patch, tier) VALUES
      (${PLAIN}, ${P}, ${AGENT}, 'episodic', 'k', 'plain words', ARRAY[0.1]::real[], '{"a":1}', NULL, 'episodic'),
      (${PAID}, ${P}, ${AGENT}, 'semantic', 'k', 'witnessed words', ARRAY[0.2]::real[], '{"b":2}', '{"walls_add":["x"]}', 'constitutive')`;
    await admin`INSERT INTO memory.memories (id, project_id, type, content, expires_at)
      VALUES (${EXPIRED}, ${P}, 'working', 'expired scratch', now() - interval '1 minute')`;
    await admin`INSERT INTO memory.memory_attestations (memory_id, attester_did, signing_key_id, signature, source_grant_id) VALUES
      (${PLAIN}, 'did:at:w', ${KEYID}, 'sig-plain', NULL),
      (${PAID}, 'did:at:w', ${KEYID}, 'sig-paid', ${KEYID})`;
    expect(await memoryStore.readById(P, EXPIRED)).toBeNull();

    const result = await memoryStore.deleteByKey(P, "k", { authority: { mode: "agent_root", sequence: 3 } });
    expect(result).toMatchObject({ deleted: 2, rows_removed: 1, erased_in_place: 1 });
    expect(await admin`SELECT id::text FROM memory.memories WHERE id = ${PLAIN}`).toHaveLength(0);
    expect(await admin`SELECT memory_id::text FROM memory.memory_attestations`).toEqual([{ memory_id: PAID }]);
    const [paid] = await admin`SELECT content, key, embedding, metadata, expression_patch, content_purged_at IS NOT NULL AS purged
      FROM memory.memories WHERE id = ${PAID}`;
    expect(paid).toMatchObject({ key: null, embedding: null, metadata: {}, expression_patch: null, purged: true });
    expect(paid!.content).toMatch(/^withdrawn by author on \d{4}-\d{2}-\d{2}$/);
    expect(await memoryStore.readById(P, PAID)).toBeNull();
    expect(await memoryStore.deleteById(P, PAID)).toMatchObject({ deleted: 0 });

    const rows = await expectChain();
    expect(rows.map((row) => [row.action, row.row_ids])).toEqual([["delete", [PLAIN]], ["purge_content", [PAID]]]);
    expect(rows.every((row) => row.authority_mode === "agent_root" && row.subject_identity_id === AGENT)).toBe(true);
    expect((await moments()).map((moment) => moment.metadata.ledger_kind)).toEqual(["memory.delete", "memory.erase_in_place"]);
  });

  databaseTest("a memory held only by a pre-2026-07-13 paid receipt is erased in place, not a 500", async () => {
    const LEGACY_PAID = "a4000000-0000-4000-8000-000000000004";
    await admin`INSERT INTO memory.memories (id, project_id, identity_id, type, key, content)
      VALUES (${LEGACY_PAID}, ${P}, ${AGENT}, 'semantic', 'legacy', 'witnessed long ago')`;
    const [receipt] = await admin`INSERT INTO memory.memory_attestations (memory_id, attester_did, signing_key_id, signature)
      VALUES (${LEGACY_PAID}, 'did:at:w', ${KEYID}, 'sig-legacy') RETURNING id::text AS id`;
    await admin`INSERT INTO marketplace.memory_witness_grants (memory_attestation_id) VALUES (${receipt!.id})`;
    expect(await memoryStore.deleteById(P, LEGACY_PAID)).toMatchObject({ deleted: 1, rows_removed: 0, erased_in_place: 1 });
    const [row] = await admin`SELECT content, content_purged_at IS NOT NULL AS purged FROM memory.memories WHERE id = ${LEGACY_PAID}`;
    expect(row!.purged).toBe(true);
    expect(row!.content).toMatch(/^withdrawn by author on /);
    expect(await admin`SELECT id::text FROM memory.memory_attestations`).toEqual([{ id: receipt!.id }]);
    expect((await expectChain()).map((entry) => [entry.action, entry.row_ids])).toEqual([["purge_content", [LEGACY_PAID]]]);
  });

  databaseTest("a failed ledger write aborts the route's erase: 503 and nothing changes", async () => {
    await seedMessage(MESSAGE);
    await admin`DELETE FROM vault.decrypted_secrets`;
    const response = await request(`/v1/inbox/${MESSAGE}`, "DELETE");
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("deletion_ledger_unavailable");
    expect((await admin`SELECT ciphertext, status FROM inbox.messages WHERE id = ${MESSAGE}`)[0])
      .toEqual({ ciphertext: "c2VhbGVk", status: "unread" });
    expect(await moments()).toHaveLength(0);
    expect(await ledgerRows()).toHaveLength(0);
  });
});

// ─── Project-owned operational erases (spec §5.2: B, plus an entry) ─────

describe("trace and organization deletes write their entry", () => {
  const OTHER = "11111111-1111-4111-8111-1111111111ff";

  async function replayOnRestoredRow(restore: () => Promise<unknown>) {
    const [entry] = await admin`SELECT seq::int AS seq, scope, action, store, row_ids, rule_id, occurred_at
      FROM deletion.ledger ORDER BY seq DESC LIMIT 1`;
    await restore();
    const applier = applierFor({ store: entry!.store, action: entry!.action, ruleId: entry!.rule_id });
    expect(applier).not.toBeNull();
    const stored = { ...entry, rowIds: entry!.row_ids, occurredAt: new Date(entry!.occurred_at).toISOString() } as never;
    return database.transaction((tx) => applier!.apply(tx as never, stored));
  }

  databaseTest("DELETE /v1/traces/:id: one entry keyed on the row UUIDs, a project moment, and replay re-deletes", async () => {
    const [kept] = await admin`INSERT INTO trace.traces (trace_id, project_id) VALUES ('t-other', ${P}) RETURNING id::text AS id`;
    const [mine] = await admin`INSERT INTO trace.traces (trace_id, project_id, summary)
      VALUES ('t-1', ${P}, 'private reasoning') RETURNING id::text AS id`;
    await admin`INSERT INTO trace.traces (trace_id, project_id) VALUES ('t-1', ${OTHER})`;
    const response = await request("/v1/traces/t-1", "DELETE");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ deleted: 1, ledger: { seq: 1, mirrored: false } });
    expect((await admin`SELECT id::text, project_id::text FROM trace.traces ORDER BY trace_id, project_id`).map((row) => row.id))
      .toContain(kept!.id);
    expect(await admin`SELECT 1 FROM trace.traces WHERE id = ${mine!.id}`).toHaveLength(0);
    // Another project's trace with the same trace_id is untouched.
    expect(await admin`SELECT 1 FROM trace.traces WHERE trace_id = 't-1' AND project_id = ${OTHER}`).toHaveLength(1);
    const rows = await expectChain();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "record", action: "delete", store: "trace.traces", row_ids: [mine!.id], row_count: 1,
      project_id: P, subject_identity_id: null, authority_mode: "legacy_bearer",
    });
    const [moment] = await moments();
    expect(moment).toMatchObject({ agent_id: null, title: "Deleted 1 trace: removed from the live database" });
    expect(JSON.stringify(moment)).not.toContain("private reasoning");
    // A missing trace writes nothing.
    expect(await (await request("/v1/traces/t-1", "DELETE")).json()).toEqual({ deleted: 0, ledger: null });
    expect(await ledgerRows()).toHaveLength(1);
    // Restore stand-in: the row comes back; replay deletes it again, once.
    expect(await replayOnRestoredRow(() => admin`INSERT INTO trace.traces (id, trace_id, project_id)
      VALUES (${mine!.id}, 't-1', ${P})`)).toBe(1);
    expect(await admin`SELECT 1 FROM trace.traces WHERE id = ${mine!.id}`).toHaveLength(0);
  });

  databaseTest("a trace delete whose entry cannot be written does not happen (503)", async () => {
    await admin`INSERT INTO trace.traces (trace_id, project_id) VALUES ('t-2', ${P})`;
    await admin`DELETE FROM vault.decrypted_secrets`;
    const response = await request("/v1/traces/t-2", "DELETE");
    expect(response.status).toBe(503);
    expect(await admin`SELECT 1 FROM trace.traces WHERE trace_id = 't-2'`).toHaveLength(1);
    expect(await ledgerRows()).toHaveLength(0);
  });

  databaseTest("DELETE /v1/orgs/:slug and member removal: one entry each; replay re-deletes", async () => {
    const [org] = await admin`INSERT INTO org.organizations (slug, name, owner_project_id)
      VALUES ('circle', 'Circle', ${P}) RETURNING id::text AS id`;
    const [member] = await admin`INSERT INTO org.organization_members (organization_id, project_id, role)
      VALUES (${org!.id}, ${OTHER}, 'member') RETURNING id::text AS id`;
    await admin`INSERT INTO org.organization_members (organization_id, project_id, role) VALUES (${org!.id}, ${P}, 'owner')`;
    await admin`INSERT INTO org.organization_invitations (organization_id, invited_project_id, inviter_project_id)
      VALUES (${org!.id}, ${KEYID}, ${P})`;

    // A non-owner cannot remove or delete, and nothing is written.
    const foreign = await app(OTHER).request("/v1/orgs/circle", { method: "DELETE" });
    expect(foreign.status).toBe(403);

    const removed = await request(`/v1/orgs/circle/members/${OTHER}`, "DELETE");
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ project_id: OTHER, removed: true, ledger: { seq: 1 } });
    expect(await admin`SELECT 1 FROM org.organization_members WHERE id = ${member!.id}`).toHaveLength(0);
    expect(await replayOnRestoredRow(() => admin`INSERT INTO org.organization_members (id, organization_id, project_id)
      VALUES (${member!.id}, ${org!.id}, ${OTHER})`)).toBe(1);

    const deleted = await request("/v1/orgs/circle", "DELETE");
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ slug: "circle", deleted: true, ledger: { seq: 2 } });
    expect(await admin`SELECT 1 FROM org.organizations`).toHaveLength(0);
    expect(await admin`SELECT 1 FROM org.organization_members`).toHaveLength(0);
    expect(await admin`SELECT 1 FROM org.organization_invitations`).toHaveLength(0);
    const rows = await expectChain();
    expect(rows.map((row) => [row.store, row.action, row.row_ids, row.project_id, row.authority_mode])).toEqual([
      ["org.organization_members", "delete", [member!.id], P, "legacy_bearer"],
      ["org.organizations", "delete", [org!.id], P, "legacy_bearer"],
    ]);
    expect((await moments()).map((moment) => moment.title)).toEqual([
      "Deleted 1 organization membership: membership removed from the live database",
      "Deleted 1 organization: removed from the live database with its memberships and invitations",
    ]);
    expect(await replayOnRestoredRow(() => admin`INSERT INTO org.organizations (id, slug, name, owner_project_id)
      VALUES (${org!.id}, 'circle', 'Circle', ${P})`)).toBe(1);
    expect(await admin`SELECT 1 FROM org.organizations`).toHaveLength(0);
  });
});

// ─── Backfill of content deleted before wave 2 ─────────────────────────

describe("backfill of already-deleted content", () => {
  databaseTest("dry-runs any time, refuses before its dates or without a mirror, then purges with rule entries", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { runBackfill, backfillEarliestRun, BackfillRefusedError } = await import("../../src/services/deletion/backfill");
    const { FileLedgerMirror } = await import("../../src/services/deletion/mirror");
    const { ALREADY_DELETED_PURGE } = await import("../../src/services/discovery/retention");

    await seedMessage(LEGACY_MESSAGE, "deleted");
    await seedMessage(MESSAGE, "deleted");
    await admin`UPDATE inbox.messages SET status = 'unread' WHERE id = ${MESSAGE}`; // restored before the run
    const [{ id: secret }] = await admin`INSERT INTO agent_vault.vault_secrets (project_id, name, description, deleted_at)
      VALUES (${P}, 'old', 'old secret', now() - interval '40 days') RETURNING id::text`;
    await admin`INSERT INTO agent_vault.vault_versions (secret_id, version, encrypted_value, iv, auth_tag)
      VALUES (${secret}, 1, '\\x01', '\\x02', '\\x03')`;
    await admin`INSERT INTO agent_continuity.identity_backups (project_id, agent_id, blob_base64, key_derivation, revoked_at)
      VALUES (${P}, ${AGENT}, 'b2xk', 'argon2id-v1', now() - interval '40 days')`;

    const announcedOn = "2026-10-20";
    const earliest = backfillEarliestRun(announcedOn);
    expect(earliest.toISOString()).toBe(new Date(Math.max(
      Date.parse(`${ALREADY_DELETED_PURGE.not_before}T00:00:00Z`), Date.parse("2026-11-19T00:00:00Z"))).toISOString());
    const dry = await runBackfill(database, { apply: false, announcedOn, mirror: null, now: new Date("2026-10-21T00:00:00Z") });
    expect(dry.wouldTouch).toEqual({ inbox: 1, vaultVersions: 1, identityBackups: 1 });
    expect(dry.refusal).toMatch(/may not run before/);

    await expect(runBackfill(database, { apply: true, announcedOn, mirror: null, now: new Date("2026-10-21T00:00:00Z") }))
      .rejects.toBeInstanceOf(BackfillRefusedError);
    await expect(runBackfill(database, { apply: true, announcedOn: "2027-01-01", mirror: null, now: new Date("2027-01-02T00:00:00Z") }))
      .rejects.toThrow(/may not run before 2027-01-31/);
    await expect(runBackfill(database, { apply: true, announcedOn, mirror: null, now: earliest }))
      .rejects.toThrow(/no deletion-ledger mirror is configured/);

    const directory = await mkdtemp(join(process.env.DELETION_TEST_TMPDIR ?? tmpdir(), "deletion-mirror-"));
    try {
      const mirror = new FileLedgerMirror(directory);
      const report = await runBackfill(database, { apply: true, announcedOn, mirror, now: earliest });
      expect(report.steps.map((step) => [step.kind, step.rows])).toEqual([
        ["backfill.inbox", 1], ["backfill.vault", 1], ["backfill.identity_backups", 1],
      ]);
      expect((await admin`SELECT id::text, status, ciphertext FROM inbox.messages ORDER BY id`).map((row) => [row.id, row.status, row.ciphertext]))
        .toEqual([[MESSAGE, "unread", "c2VhbGVk"], [LEGACY_MESSAGE, "deleted", ""]]);
      expect((await admin`SELECT encode(encrypted_value, 'hex') AS v FROM agent_vault.vault_versions`)[0]!.v).toBe("");
      expect((await admin`SELECT description FROM agent_vault.vault_secrets`)[0]!.description).toBeNull();
      expect((await admin`SELECT blob_base64 FROM agent_continuity.identity_backups`)[0]!.blob_base64).toBe("");
      const rows = await expectChain();
      expect(rows.map((row) => [row.store, row.rule_id, row.authority_mode, row.row_ids])).toEqual([
        ["inbox.messages", "already_deleted_backfill", "operator", []],
        ["agent_vault.vault_versions", "already_deleted_backfill", "operator", []],
        ["agent_continuity.identity_backups", "already_deleted_backfill", "operator", []],
      ]);
      expect(await admin`SELECT seq FROM deletion.ledger WHERE mirrored_at IS NULL`).toHaveLength(0);
      expect((await mirror.list("ledger/v1/")).length).toBe(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
