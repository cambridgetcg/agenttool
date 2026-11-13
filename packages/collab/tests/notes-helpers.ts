import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore, type CollabStoreOptions } from "../src/store-notes.js";

// Shared by the collab_note, collab_take and collab_done tests: a temp
// journal whose sessions are served by in-process MCP servers, as host
// restarts hand sessions over. Nothing touches the real data directory.

export const cleanup: Array<() => void> = [];

export function runCleanup(): void {
  while (cleanup.length) cleanup.pop()!();
}

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.org",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.org",
};

export function git(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: GIT_ENV });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function journal(options: { git?: boolean; store?: Omit<CollabStoreOptions, "now"> } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-notes-"));
  const root = join(directory, "repo");
  mkdirSync(root);
  if (options.git) {
    git(root, ["init", "-q"]);
    writeFileSync(join(root, "README.txt"), "fixture\n");
    git(root, ["add", "README.txt"]);
    git(root, ["commit", "-q", "-m", "fixture"]);
  }
  let now = Date.parse("2026-11-12T10:00:00.000Z");
  const store = new CollabStore(join(directory, "state", "collab.sqlite"), { ...options.store, now: () => new Date(now) });
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    root,
    store,
    start(actor: string, extra: Record<string, unknown> = {}): SessionHandle {
      return store.startSession({ root_path: root, actor, role: `${actor}'s work`, ...extra });
    },
    advance(ms: number) {
      now += ms;
    },
    /** The store's clock now, as an ISO time. */
    now(): string {
      return new Date(now).toISOString();
    },
    write(path: string, content: string | Buffer) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    },
    /** An MCP process holding this session. */
    serve(handle: SessionHandle, environment: Record<string, string> = {}): any {
      const credentialFile = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
      return buildCollabMcpServer(store, { environment, resumed_session: { handle, credential_file: credentialFile } });
    },
    events(): Array<{ sequence: number; type: string; entity_id: string; payload: Record<string, any> }> {
      return (store.db.query(`SELECT sequence, type, entity_id, payload_json FROM events ORDER BY sequence`).all() as Array<{
        sequence: number; type: string; entity_id: string; payload_json: string;
      }>).map((row) => ({ sequence: row.sequence, type: row.type, entity_id: row.entity_id, payload: JSON.parse(row.payload_json) }));
    },
    count(): number {
      return (store.db.query(`SELECT COUNT(*) AS count FROM events`).get() as { count: number }).count;
    },
    report(id: string): Record<string, any> {
      return store.db.query(`SELECT * FROM reports WHERE id = ?`).get(id) as Record<string, any>;
    },
    payload(reportId: string): Record<string, any> {
      const row = store.db.query(`SELECT payload_json FROM events WHERE type = 'report.posted' AND entity_id = ?`)
        .get(reportId) as { payload_json: string };
      return JSON.parse(row.payload_json);
    },
  };
}

export type Journal = ReturnType<typeof journal>;

export async function call(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {}) as {
    isError?: boolean;
    structuredContent: Record<string, any>;
  };
}

export async function ok(server: any, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const result = await call(server, name, args);
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent;
}

export async function refused(server: any, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const result = await call(server, name, args);
  if (!result.isError) throw new Error(`${name} was expected to refuse: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent;
}

/** A task the session created and claimed through the legacy store calls, then reported done. */
export function completedTask(j: Journal, holder: SessionHandle, options: { title?: string; paths?: string[]; key?: string } = {}) {
  const key = options.key ?? "t";
  const created = j.store.createTaskForSession({
    ...holder.credential,
    idempotency_key: `${key}-create`,
    title: options.title ?? "Edit the parser",
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: options.paths ?? ["src/parser.ts"],
  });
  const claimed = j.store.claimTaskForSession({ ...holder.credential, idempotency_key: `${key}-claim`, task_id: created.id, expected_version: created.version });
  return j.store.completeTaskForSession({
    ...holder.credential,
    idempotency_key: `${key}-complete`,
    task_id: claimed.id,
    lease_id: claimed.lease_id!,
    expected_version: claimed.version,
    summary: "Parser edited.",
  });
}
