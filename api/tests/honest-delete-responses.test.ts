/** Deletion scopes wave 1: delete responses say what actually happened.
 *
 *  Before: DELETE /v1/identity/backup/:id updated without checking that a row
 *  matched and always answered `revoked: true`, kept the blob, and moved
 *  revoked_at on every repeat. Inbox and vault deletes answered
 *  `deleted: true` while keeping the content.
 *
 *  Now: the backup delete answers 404 when no backup of this project has the
 *  id, `already_revoked: true` (revoked_at untouched) on a repeat, and
 *  `blob_retained: true`; inbox and vault deletes carry
 *  `content_retained: true`. The words come from the /public/retention
 *  module, so the response and the disclosure cannot drift apart.
 *
 *  Hermetic: real routers and Drizzle SQL over a pg-proxy transport.
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md (wave 1). */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../src/auth/middleware";
import { inboxMessages } from "../src/db/schema/inbox";
import { vaultSecrets } from "../src/db/schema/vault";
import { DELETE_RESPONSE_RETENTION } from "../src/services/discovery/retention";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const BACKUP = "99999999-7777-4888-8999-aaaaaaaaaaaa";
const MESSAGE = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const EARLIER = "2026-09-01T08:00:00.000Z";
const WHEN = "2026-10-12T09:00:00.000Z";

type Query = { sql: string; params: unknown[] };
let queries: Query[] = [];
let backupState: "absent" | "active" | "revoked" = "active";
let inTransaction = false;

function rowFor(table: Table, values: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(table)).map((key) => values[key] ?? null);
}

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "agent_continuity"."identity_backups"')) {
    expect(inTransaction).toBe(true);
    if (backupState === "absent") return { rows: [] };
    return { rows: [[BACKUP, backupState === "revoked" ? EARLIER : null]] };
  }
  if (sql.startsWith('update "agent_continuity"."identity_backups"')) {
    expect(inTransaction).toBe(true);
    return { rows: [[WHEN]] };
  }
  if (sql.startsWith('update "inbox"."messages"')) {
    return {
      rows: [rowFor(inboxMessages, {
        id: MESSAGE, recipientDid: "did:at:r", senderDid: "did:at:s", ciphertext: "c",
        nonce: "n", status: "deleted", metadata: {}, createdAt: WHEN,
      })],
    };
  }
  if (sql.startsWith("select") && sql.includes('from "agent_vault"."vault_secrets"')) {
    return { rows: [rowFor(vaultSecrets, { id: MESSAGE, projectId: PROJECT, name: "api-key", currentVersion: 1 })] };
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => {
  inTransaction = true;
  try { return await fn(database); } finally { inTransaction = false; }
}) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

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
const backupUpdates = () => queries.filter((q) => q.sql.startsWith('update "agent_continuity"."identity_backups"'));

beforeEach(() => {
  queries = [];
  backupState = "active";
  inTransaction = false;
});

describe("DELETE /v1/identity/backup/:id", () => {
  test("revokes an active backup of this project and says the blob stays", async () => {
    const response = await del(`/v1/identity/backup/${BACKUP}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: BACKUP,
      revoked: true,
      already_revoked: false,
      revoked_at: WHEN,
      blob_retained: true,
    });
    expect(body._retention).toEqual(DELETE_RESPONSE_RETENTION.identity_backup);
    const lookup = queries[0]!;
    expect(lookup.sql).toContain('"agent_continuity"."identity_backups"."project_id" = $');
    expect(lookup.sql).toContain("for update");
    expect(lookup.params).toEqual([BACKUP, PROJECT, 1]);
    expect(backupUpdates()).toHaveLength(1);
    expect(backupUpdates()[0].sql).toContain('"agent_continuity"."identity_backups"."revoked_at" is null');
    expect(backupUpdates()[0].params).toContain(PROJECT);
  });

  test("a repeat answers already_revoked and leaves revoked_at untouched", async () => {
    backupState = "revoked";
    const response = await del(`/v1/identity/backup/${BACKUP}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: BACKUP,
      revoked: true,
      already_revoked: true,
      revoked_at: EARLIER,
      blob_retained: true,
    });
    expect(backupUpdates()).toHaveLength(0);
  });

  test("an id with no backup in this project is a 404 that changes nothing", async () => {
    backupState = "absent";
    const response = await del(`/v1/identity/backup/${BACKUP}`);
    expect(response.status).toBe(404);
    expect(backupUpdates()).toHaveLength(0);
    expect(queries).toHaveLength(1);
  });

  test("a non-UUID id is a 404 without a query", async () => {
    const response = await del("/v1/identity/backup/not-a-uuid");
    expect(response.status).toBe(404);
    expect(queries).toHaveLength(0);
  });
});

describe("inbox and vault deletes say the content is retained", () => {
  test("DELETE /v1/inbox/:id", async () => {
    const response = await del(`/v1/inbox/${MESSAGE}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ id: MESSAGE, deleted: true, content_retained: true });
    expect(body._retention).toEqual(DELETE_RESPONSE_RETENTION.inbox);
    expect(body._retention.meaning).toMatch(/PATCH \/v1\/inbox\/:id can restore it/);
  });

  test("DELETE /v1/vault/:name", async () => {
    const response = await del("/v1/vault/api-key");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ name: "api-key", deleted: true, content_retained: true });
    expect(body._retention).toEqual(DELETE_RESPONSE_RETENTION.vault);
    expect(body._retention.meaning).toMatch(/ciphertext stays/);
  });

  test("every retained-content note points at /public/retention and the backfill rule", () => {
    for (const note of Object.values(DELETE_RESPONSE_RETENTION)) {
      expect(note.details).toBe("/public/retention");
      expect(note.already_deleted).toMatch(/No purge of it is scheduled/);
    }
  });
});
