/** Deletion scopes waves 1 and 2: delete responses say what actually happened.
 *
 *  Wave 1 made the responses honest about retained content. Wave 2 makes the
 *  deletes real: inbox, vault and identity-backup deletes erase content in
 *  one transaction with an ids-only ledger entry (recordErasure), and say
 *  content_retained / blob_retained: false. A purged inbox message cannot be
 *  restored, and PATCH to 'deleted' takes the same purge path as DELETE.
 *  The backup delete still answers 404 for an id this project lacks and
 *  already_revoked: true (revoked_at untouched) on a repeat.
 *
 *  Hermetic: real routers and purge SQL over a pg-proxy transport; the
 *  ledger writer is replaced by a recorder (its SQL is proven on real
 *  PostgreSQL in tests/integration/deletion-ledger-postgres.test.ts).
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §17. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../src/auth/middleware";
import { inboxMessages } from "../src/db/schema/inbox";
import { DELETE_RESPONSE_RETENTION } from "../src/services/discovery/retention";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const BACKUP = "99999999-7777-4888-8999-aaaaaaaaaaaa";
const MESSAGE = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const SECRET = "77777777-7777-4888-8999-aaaaaaaaaaaa";
const RECIPIENT = "88888888-7777-4888-8999-aaaaaaaaaaaa";
const AGENT = "55555555-7777-4888-8999-aaaaaaaaaaaa";
const EARLIER = "2026-09-01T08:00:00.000Z";
const NOW = "2026-10-12T09:00:00.123456Z";
const ENTRY = { seq: 42, entryId: "abababab-abab-4bab-8bab-abababababab", entryHash: "a".repeat(64), occurredAt: NOW };

type Query = { sql: string; params: unknown[] };
let queries: Query[] = [];
let recorded: Array<Record<string, unknown>> = [];
let backupState: "absent" | "active" | "revoked" | "purged" = "active";
let messagePurged = false;
let inTransaction = false;

function rowFor(table: Table, values: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(table)).map((key) => values[key] ?? null);
}

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "agent_continuity"."identity_backups"')) {
    expect(inTransaction).toBe(true);
    expect(sql).toContain("for update");
    if (backupState === "absent") return { rows: [] };
    const revoked = backupState === "active" ? null : EARLIER;
    const purged = backupState === "purged" ? EARLIER : null;
    return { rows: [[BACKUP, AGENT, revoked, purged]] };
  }
  if (sql.includes("UPDATE agent_continuity.identity_backups")) {
    expect(inTransaction).toBe(true);
    return { rows: [{ id: BACKUP }] };
  }
  if (sql.includes('from "inbox"."messages"') && sql.includes("for update")) {
    expect(inTransaction).toBe(true);
    return { rows: [[MESSAGE, RECIPIENT, messagePurged ? EARLIER : null]] };
  }
  if (sql.includes("UPDATE inbox.messages")) {
    expect(inTransaction).toBe(true);
    return { rows: [{ id: MESSAGE }] };
  }
  if (sql.startsWith('update "inbox"."messages"')) {
    // updateStatus: refuses a purged row through its WHERE clause.
    return { rows: messagePurged ? [] : [rowFor(inboxMessages, {
      id: MESSAGE, recipientDid: "did:at:r", senderDid: "did:at:s", ciphertext: "c",
      nonce: "n", status: "unread", metadata: {}, createdAt: EARLIER,
    })] };
  }
  if (sql.startsWith("select") && sql.includes('from "inbox"."messages"')) {
    return { rows: [rowFor(inboxMessages, {
      id: MESSAGE, recipientDid: "did:at:r", senderDid: "did:at:s", ciphertext: "",
      nonce: "", status: "deleted", metadata: {}, createdAt: EARLIER,
    })].map((row) => (sql.includes('"id" from') ? [MESSAGE] : row)) };
  }
  if (sql.includes('from "agent_vault"."vault_secrets"')) {
    expect(inTransaction).toBe(true);
    return { rows: [[SECRET]] };
  }
  if (sql.includes("UPDATE agent_vault.vault_secrets")) return { rows: [{ id: SECRET }] };
  if (sql.includes("UPDATE agent_vault.vault_versions")) return { rows: [{ id: "v1" }, { id: "v2" }] };
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => {
  inTransaction = true;
  try { return await fn(database); } finally { inTransaction = false; }
}) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

const realRecord = await import("../src/services/deletion/record");
mock.module("../src/services/deletion/record", () => ({
  ...realRecord,
  recordErasure: async (_tx: unknown, input: Record<string, unknown>) => {
    expect(inTransaction).toBe(true);
    recorded.push(input);
    return { entry: ENTRY, momentIds: ["m1"] };
  },
}));

const { default: backupRouter } = await import("../src/routes/identity-backup");
const { default: inboxRouter } = await import("../src/routes/inbox/messages");
const { default: vaultRouter } = await import("../src/routes/vault/secrets");

function app() {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: PROJECT, credits: 100 } as never);
    await next();
  });
  server.route("/v1/identity/backup", backupRouter);
  server.route("/v1/inbox", inboxRouter);
  server.route("/v1/vault", vaultRouter);
  server.onError((err, c) =>
    err instanceof HTTPException ? c.json({ error: err.message }, err.status) : c.json({ error: String(err) }, 500),
  );
  return server;
}

const del = (path: string) => app().request(path, { method: "DELETE" });
const patch = (path: string, body: unknown) => app().request(path, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const ran = (fragment: string) => queries.filter((q) => q.sql.includes(fragment));

beforeEach(() => {
  queries = [];
  recorded = [];
  backupState = "active";
  messagePurged = false;
  inTransaction = false;
  delete process.env.AGENTTOOL_DELETION_MIRROR_ENDPOINT;
});

describe("DELETE /v1/identity/backup/:id", () => {
  test("revokes and purges an active backup with one ledger record", async () => {
    const response = await del(`/v1/identity/backup/${BACKUP}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: BACKUP, revoked: true, already_revoked: false, revoked_at: NOW,
      blob_retained: false, already_purged: false, purged_at: NOW,
      ledger: { entry_id: ENTRY.entryId, seq: 42, mirrored: false },
    });
    expect(body._retention).toEqual(DELETE_RESPONSE_RETENTION.identity_backup);
    expect(recorded).toEqual([expect.objectContaining({
      kind: "identity_backup.purge", projectId: PROJECT, rowIds: [BACKUP],
      owners: [{ agentId: AGENT, rowIds: [BACKUP] }],
    })]);
    const purge = ran("UPDATE agent_continuity.identity_backups")[0]!;
    expect(purge.sql).toMatch(/blob_base64 = ''.*nonce = NULL.*metadata = '\{\}'::jsonb/s);
    expect(purge.sql).toContain("revoked_at = coalesce(revoked_at,");
    expect(purge.params).toContain(NOW);
  });

  test("a backup revoked before purges existed is purged now and keeps its revoked_at", async () => {
    backupState = "revoked";
    const body = await (await del(`/v1/identity/backup/${BACKUP}`)).json();
    expect(body).toMatchObject({ already_revoked: true, revoked_at: EARLIER, already_purged: false, blob_retained: false });
    expect(recorded).toHaveLength(1);
  });

  test("a repeat after the purge writes nothing", async () => {
    backupState = "purged";
    const body = await (await del(`/v1/identity/backup/${BACKUP}`)).json();
    expect(body).toMatchObject({ already_revoked: true, already_purged: true, blob_retained: false, ledger: null });
    expect(recorded).toHaveLength(0);
    expect(ran("UPDATE agent_continuity.identity_backups")).toHaveLength(0);
  });

  test("an id with no backup in this project is a 404 that changes nothing", async () => {
    backupState = "absent";
    expect((await del(`/v1/identity/backup/${BACKUP}`)).status).toBe(404);
    expect(recorded).toHaveLength(0);
    expect(queries).toHaveLength(1);
  });

  test("a non-UUID id is a 404 without a query", async () => {
    expect((await del("/v1/identity/backup/not-a-uuid")).status).toBe(404);
    expect(queries).toHaveLength(0);
  });
});

describe("inbox deletes purge, and a purged message cannot come back", () => {
  test("DELETE /v1/inbox/:id erases the content with one ledger record", async () => {
    const response = await del(`/v1/inbox/${MESSAGE}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: MESSAGE, deleted: true, already_deleted: false, content_retained: false, purged_at: NOW,
      ledger: { seq: 42 },
    });
    expect(body._retention).toEqual(DELETE_RESPONSE_RETENTION.inbox);
    expect(recorded).toEqual([expect.objectContaining({
      kind: "inbox.purge", rowIds: [MESSAGE], owners: [{ agentId: RECIPIENT, rowIds: [MESSAGE] }],
    })]);
    const purge = ran("UPDATE inbox.messages")[0]!;
    expect(purge.sql).toMatch(/ciphertext = '', nonce = '', ephemeral_pubkey = ''.*subject = NULL, refs = NULL, metadata = '\{\}'::jsonb/s);
    expect(purge.sql).toContain("content_purged_at IS NULL");
  });

  test("a repeat is already_deleted and writes nothing", async () => {
    messagePurged = true;
    const body = await (await del(`/v1/inbox/${MESSAGE}`)).json();
    expect(body).toMatchObject({ deleted: true, already_deleted: true, ledger: null });
    expect(recorded).toHaveLength(0);
  });

  test("PATCH to deleted takes the same purge path", async () => {
    const body = await (await patch(`/v1/inbox/${MESSAGE}`, { status: "deleted" })).json();
    expect(body).toMatchObject({ id: MESSAGE, deleted: true, content_retained: false, status: "deleted" });
    expect(recorded).toHaveLength(1);
  });

  test("PATCH cannot move a purged message out of deleted", async () => {
    messagePurged = true;
    const response = await patch(`/v1/inbox/${MESSAGE}`, { status: "unread" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("message_deleted");
    expect(ran('update "inbox"."messages"')[0]!.sql).toContain('"content_purged_at" is null');
  });

  test("a message soft-deleted before purges existed can still be restored", async () => {
    const response = await patch(`/v1/inbox/${MESSAGE}`, { status: "unread" });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("unread");
  });

  test("a non-UUID id is a 404 without a query", async () => {
    expect((await del("/v1/inbox/not-a-uuid")).status).toBe(404);
    expect(queries).toHaveLength(0);
  });
});

describe("vault delete zeroes every version", () => {
  test("DELETE /v1/vault/:name", async () => {
    const response = await del("/v1/vault/api-key");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ name: "api-key", deleted: true, content_retained: false, versions_zeroed: 2, purged_at: NOW });
    expect(body._retention).toEqual(DELETE_RESPONSE_RETENTION.vault);
    expect(recorded).toEqual([expect.objectContaining({ kind: "vault.purge", rowIds: [SECRET] })]);
    const versions = ran("UPDATE agent_vault.vault_versions")[0]!;
    expect(versions.sql).toMatch(/encrypted_value = decode\('', 'hex'\), iv = decode\('', 'hex'\)/);
    expect(versions.sql).toContain("auth_tag = CASE WHEN auth_tag IS NULL THEN NULL ELSE decode('', 'hex') END");
    expect(ran("UPDATE agent_vault.vault_secrets")[0]!.sql).toContain("description = NULL, tags = NULL");
    expect(ran('insert into "agent_vault"."vault_audit"')).toHaveLength(1);
  });

  test("every note now says the content is gone and announces the backfill", () => {
    for (const note of Object.values(DELETE_RESPONSE_RETENTION)) {
      expect(note.details).toBe("/public/retention");
      expect(note.already_deleted).toMatch(/purged on or after \d{4}-\d{2}-\d{2}/);
    }
    expect(DELETE_RESPONSE_RETENTION.inbox.content_retained).toBe(false);
    expect(DELETE_RESPONSE_RETENTION.vault.content_retained).toBe(false);
    expect(DELETE_RESPONSE_RETENTION.identity_backup.blob_retained).toBe(false);
  });
});
