/** Process-level safety net — an orphaned promise must not take the API down.
 *
 * Bun (like Node ≥15) treats an unhandled promise rejection as fatal: the
 * process prints the error and exits with code 1. On 2026-09-02 at 19:27Z
 * a Postgres `statement_timeout` (57014) rejected a promise nobody owned and
 * machine 8606e9ae201e98 rebooted mid-traffic — the same class as the
 * 2026-09-01 boot crash. Which promise is not yet known: the API keeps no
 * access log and Bun's crash report showed only postgres.js frames. (It was
 * NOT a `Promise.race` loser — race subscribes to every input, so a losing
 * promise's late rejection is already handled; that theory was tested and
 * dropped.) The next occurrence will be named by this net's log line, which
 * carries the rejection reason and its stack.
 *
 * This module is imported FIRST by both entrypoints (index.ts, thinker.ts)
 * so the listener exists before any other module can orphan a promise. It
 * logs one loud line per event and keeps serving: nothing awaited the
 * promise, so no request is left in an unknown state by ignoring it. It
 * deliberately does NOT catch `uncaughtException` — a synchronous throw
 * escaping every handler means state is unknown and the Fly restart policy
 * is the right recovery. Doctrine: docs/STACK.md §4.
 */

const TAG = "[agenttool] unhandled rejection";
const INSTALLED = Symbol.for("agenttool.process-guards.installed");

let unhandledRejections = 0;

/** How many rejections the net has absorbed since the process started. */
export function unhandledRejectionCount(): number {
  return unhandledRejections;
}

export interface ProcessGuardTarget {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

/** Installs the net once per process. Returns true when this call installed it. */
export function installProcessGuards(
  target: ProcessGuardTarget & object = process,
  log: (...args: unknown[]) => void = console.error,
): boolean {
  const holder = target as { [INSTALLED]?: true };
  if (holder[INSTALLED]) return false;
  holder[INSTALLED] = true;
  target.on("unhandledRejection", (reason) => {
    unhandledRejections += 1;
    log(`${TAG} #${unhandledRejections} (kept serving):`, reason);
  });
  return true;
}

installProcessGuards();
