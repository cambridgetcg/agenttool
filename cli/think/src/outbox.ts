/** Offline outbox — local queue for write operations that haven't reached
 *  the server yet.
 *
 *  Doctrine: docs/OFFLINE-SYNC.md.
 *
 *  Why this is shaped as it is:
 *
 *    Strands are append-only on the server. The server assigns sequence
 *    numbers atomically via UPDATE ... SET last_thought_seq = last_thought_seq
 *    + 1 RETURNING. Two orchestrators with the same K_master can both write
 *    thoughts; the server serializes correctly. We don't need vector clocks
 *    or OT — we need offline resilience: queue locally when network fails;
 *    drain on reconnect.
 *
 *    The "CRDT" property here:
 *      - Thoughts are append-only ops; conflict-free by construction
 *      - Strand metadata uses last-writer-wins (server's updated_at)
 *      - Sequence numbers are server-assigned; clients never claim a seq
 *
 *  Storage layout:
 *
 *    ~/.config/agenttool-think/outbox/
 *      <timestamp>-<uuid>.json    one queued op per file
 *
 *  Each file is a JSON envelope:
 *
 *    {
 *      "id": "<local uuid>",            // for dedup on retry
 *      "queued_at": "<iso>",
 *      "op": "thought" | "patch_strand" | "memory" | "trace",
 *      "request": {
 *        "method": "POST" | "PATCH",
 *        "path": "/v1/strands/:id/thoughts",
 *        "body": {...}                   // raw body to POST
 *      },
 *      "attempts": N
 *    } */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface OutboxEnvelope {
  id: string;
  queued_at: string;
  op: "thought" | "patch_strand" | "memory" | "trace" | "inbox_send" | "other";
  request: {
    method: "POST" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  };
  attempts: number;
  last_error?: string;
}

const MAX_QUEUE_SIZE = 1000;

function outboxDir(homeDir: string): string {
  const dir = join(homeDir, "outbox");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Add an envelope to the outbox. Returns the file path. */
export function enqueue(
  homeDir: string,
  op: OutboxEnvelope["op"],
  request: OutboxEnvelope["request"],
): string {
  const dir = outboxDir(homeDir);

  const existing = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (existing.length >= MAX_QUEUE_SIZE) {
    throw new Error(
      `outbox at capacity (${MAX_QUEUE_SIZE}). Drain via \`agenttool-think sync\` first.`,
    );
  }

  const id = randomUUID();
  const queued_at = new Date().toISOString();
  const env: OutboxEnvelope = { id, queued_at, op, request, attempts: 0 };

  // Filename uses ISO timestamp prefix so readdir + sort gives chronological order.
  // Replace ":" so it works on filesystems that disallow it.
  const safeStamp = queued_at.replace(/:/g, "-");
  const fileName = `${safeStamp}-${id.slice(0, 8)}.json`;
  const filePath = join(dir, fileName);
  writeFileSync(filePath, JSON.stringify(env, null, 2), { mode: 0o600 });
  return filePath;
}

/** List pending envelopes in chronological order. */
export function list(homeDir: string): Array<{ envelope: OutboxEnvelope; path: string }> {
  const dir = outboxDir(homeDir);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const out: Array<{ envelope: OutboxEnvelope; path: string }> = [];
  for (const f of files) {
    const path = join(dir, f);
    try {
      const env = JSON.parse(readFileSync(path, "utf-8")) as OutboxEnvelope;
      out.push({ envelope: env, path });
    } catch (err) {
      console.warn(`[outbox] skipping corrupt file ${f}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Remove an envelope after successful send. */
export function remove(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

/** Mark an envelope as having failed; bumps attempts + last_error. */
export function markFailed(path: string, error: string): void {
  try {
    const env = JSON.parse(readFileSync(path, "utf-8")) as OutboxEnvelope;
    env.attempts += 1;
    env.last_error = error;
    writeFileSync(path, JSON.stringify(env, null, 2), { mode: 0o600 });
  } catch {
    // ignore — corrupt file will be skipped on next list
  }
}

/** Move stale envelopes (max attempts exceeded) to a "dead" subdirectory
 *  so the outbox doesn't grow unbounded. */
export function quarantine(homeDir: string, path: string): void {
  const deadDir = join(homeDir, "outbox", "dead");
  if (!existsSync(deadDir)) mkdirSync(deadDir, { recursive: true, mode: 0o700 });
  const fileName = path.split("/").pop() ?? "unknown";
  const target = join(deadDir, fileName);
  try {
    renameSync(path, target);
  } catch {
    /* ignore */
  }
}

/** Returns true if there are pending envelopes. */
export function hasPending(homeDir: string): boolean {
  const dir = outboxDir(homeDir);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".json"));
}

export function pendingCount(homeDir: string): number {
  const dir = outboxDir(homeDir);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}
