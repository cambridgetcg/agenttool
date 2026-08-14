import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FixtureThread {
  id: string;
  parentId?: string;
  tokens: number;
  createdAt: number;
  updatedAt: number;
  nickname?: string;
  role?: string;
  model?: string;
  archived?: boolean;
  lines?: string[];
}

export function createUsageFixture(root: string, threads: FixtureThread[]): {
  databasePath: string;
  sessionsRoot: string;
} {
  const sessionsRoot = join(root, "sessions");
  mkdirSync(sessionsRoot, { recursive: true });
  const databasePath = join(root, "state_5.sqlite");
  const database = new Database(databasePath, { create: true, strict: true });
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      tokens_used INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      model TEXT,
      agent_nickname TEXT,
      agent_role TEXT,
      title TEXT,
      cwd TEXT
    );
    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT NOT NULL,
      child_thread_id TEXT NOT NULL PRIMARY KEY
    );
  `);
  const insert = database.query(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, tokens_used, archived,
      created_at_ms, updated_at_ms,
      model, agent_nickname, agent_role, title, cwd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const thread of threads) {
    const rolloutPath = join(sessionsRoot, `${thread.id}.jsonl`);
    writeFileSync(rolloutPath, `${(thread.lines ?? []).join("\n")}\n`, { mode: 0o600 });
    insert.run(
      thread.id,
      rolloutPath,
      thread.createdAt,
      thread.updatedAt,
      thread.nickname ? '{"subagent":{"agent_path":"/secret/path"}}' : "cli",
      thread.tokens,
      thread.archived ? 1 : 0,
      thread.createdAt * 1000,
      thread.updatedAt * 1000,
      thread.model ?? "gpt-test",
      thread.nickname ?? null,
      thread.role ?? null,
      "TOP SECRET THREAD TITLE",
      "/TOP/SECRET/CWD",
    );
    if (thread.parentId) {
      database.query(
        "INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id) VALUES (?, ?)",
      ).run(thread.parentId, thread.id);
    }
  }
  database.close();
  return { databasePath, sessionsRoot };
}

export function tokenEvent(timestamp: string, total: number, last: number): string {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: total - 10,
          cached_input_tokens: Math.max(0, total - 20),
          cache_write_input_tokens: 0,
          output_tokens: 10,
          reasoning_output_tokens: 3,
          total_tokens: total,
        },
        last_token_usage: {
          input_tokens: Math.max(0, last - 5),
          cached_input_tokens: 1,
          cache_write_input_tokens: 0,
          output_tokens: 5,
          reasoning_output_tokens: 2,
          total_tokens: last,
        },
        model_context_window: 1000,
      },
    },
  });
}
