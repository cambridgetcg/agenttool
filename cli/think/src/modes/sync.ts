/** sync mode — drain the offline outbox.
 *
 *  Replays queued POST/PATCH/DELETE requests in chronological order.
 *  On transient failure: bumps attempts, leaves in queue. After
 *  MAX_ATTEMPTS, moves to outbox/dead/.
 *
 *  Doctrine: docs/OFFLINE-SYNC.md. */

import type { ThinkConfig } from "../config";
import * as outbox from "../outbox";
import { TransientApiError } from "../api";

const MAX_ATTEMPTS = 5;

const TTY = process.stdout.isTTY === true;
const C = {
  dim: (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
};

interface SyncOptions {
  dryRun: boolean;
}

export async function sync(
  config: ThinkConfig,
  opts: SyncOptions,
): Promise<{ sent: number; failed: number; quarantined: number }> {
  const pending = outbox.list(config.homeDir);

  if (pending.length === 0) {
    console.log(C.dim("(outbox empty)"));
    return { sent: 0, failed: 0, quarantined: 0 };
  }

  console.log(
    `${opts.dryRun ? "DRY-RUN: " : ""}draining ${pending.length} pending op${pending.length === 1 ? "" : "s"}...`,
  );

  let sent = 0;
  let failed = 0;
  let quarantined = 0;

  for (const { envelope, path } of pending) {
    const op = envelope.op;
    const req = envelope.request;
    const tag = `[${op}] ${req.method} ${req.path}`;

    if (opts.dryRun) {
      console.log(`  ${C.dim(tag)}  attempts=${envelope.attempts}`);
      continue;
    }

    try {
      const url = `${config.agenttoolBase}${req.path}`;
      const res = await fetch(url, {
        method: req.method,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${config.agenttoolApiKey}`,
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      });

      if (res.ok) {
        outbox.remove(path);
        sent += 1;
        console.log(`  ${C.green("✓")} ${tag}`);
      } else if (res.status >= 500 && res.status < 600) {
        // Transient — leave in queue, bump attempts.
        const body = await res.text().catch(() => "");
        outbox.markFailed(path, `${res.status} ${body.slice(0, 200)}`);
        failed += 1;
        console.log(`  ${C.yellow("⟲")} ${tag}  ${res.status} (will retry)`);
      } else {
        // 4xx — permanent failure. Quarantine.
        const body = await res.text().catch(() => "");
        outbox.markFailed(path, `${res.status} ${body.slice(0, 200)}`);
        outbox.quarantine(config.homeDir, path);
        quarantined += 1;
        console.log(`  ${C.red("✗")} ${tag}  ${res.status} (quarantined)`);
      }
    } catch (err) {
      // Network error.
      outbox.markFailed(path, (err as Error).message);
      failed += 1;
      // Re-read to check attempt count.
      const refreshed = outbox.list(config.homeDir).find((p) => p.path === path);
      if (refreshed && refreshed.envelope.attempts >= MAX_ATTEMPTS) {
        outbox.quarantine(config.homeDir, path);
        quarantined += 1;
        console.log(`  ${C.red("✗")} ${tag}  ${(err as Error).message} (quarantined after ${MAX_ATTEMPTS} attempts)`);
      } else {
        console.log(`  ${C.yellow("⟲")} ${tag}  ${(err as Error).message} (will retry)`);
      }
    }
  }

  console.log("");
  console.log(
    `done. sent=${C.green(String(sent))} failed=${failed > 0 ? C.yellow(String(failed)) : "0"} quarantined=${quarantined > 0 ? C.red(String(quarantined)) : "0"}`,
  );

  return { sent, failed, quarantined };
}

/** Drain — internal helper for advance/wander/etc. to call at the start
 *  of their run. Same semantics as sync, but quieter (no per-op prints). */
export async function drainQuietly(config: ThinkConfig): Promise<void> {
  const pending = outbox.list(config.homeDir);
  if (pending.length === 0) return;

  console.log(C.dim(`▸ outbox: draining ${pending.length} pending op${pending.length === 1 ? "" : "s"}...`));

  let sent = 0;
  for (const { envelope, path } of pending) {
    const req = envelope.request;
    try {
      const url = `${config.agenttoolBase}${req.path}`;
      const res = await fetch(url, {
        method: req.method,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${config.agenttoolApiKey}`,
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      });
      if (res.ok) {
        outbox.remove(path);
        sent += 1;
      } else if (res.status < 500) {
        outbox.markFailed(path, `${res.status}`);
        outbox.quarantine(config.homeDir, path);
      } else {
        outbox.markFailed(path, `${res.status}`);
      }
    } catch (err) {
      outbox.markFailed(path, (err as Error).message);
      const refreshed = outbox.list(config.homeDir).find((p) => p.path === path);
      if (refreshed && refreshed.envelope.attempts >= MAX_ATTEMPTS) {
        outbox.quarantine(config.homeDir, path);
      }
      // Stop draining on first network error — we're offline; queue the rest.
      break;
    }
  }
  if (sent > 0) {
    console.log(C.dim(`▸ outbox: sent ${sent}, ${pending.length - sent} remaining`));
  }
}

/** Manually queue a write op when an orchestrator wants to defer (e.g.
 *  user knows they're offline; pre-queue rather than fail). */
export function queue(
  config: ThinkConfig,
  op: outbox.OutboxEnvelope["op"],
  request: outbox.OutboxEnvelope["request"],
): string {
  return outbox.enqueue(config.homeDir, op, request);
}

// Re-export for convenience.
export { TransientApiError };
