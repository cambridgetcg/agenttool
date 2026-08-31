/** Shared-pool liveness watchdog — the self-healing the 2026-08-31 outage lacked.
 *
 * Supabase's transaction pooler sits behind an AWS NLB that can drop its
 * server side without RST/FIN. The shared postgres.js pool then holds
 * ESTABLISHED zombie sockets whose in-flight queries never resolve, every
 * later query queues behind them, and Bun's HTTP idle timeout turns each
 * hang into a client 502. `/health` is DB-free, so Fly's checks stay green
 * and no machine restarts itself. TCP keepalive cannot detect this: the NLB
 * keeps ACKing after the backend mapping is gone.
 *
 * This watchdog distinguishes "pool wedged, DB healthy" from "DB down":
 * a periodic bounded canary runs THROUGH the shared drizzle pool; after N
 * consecutive canary failures a fresh one-shot verified connection probes
 * the same database. Fresh probe healthy while the pool cannot answer means
 * the pool is the casualty — log one loud line and exit(1) so Fly's restart
 * policy hands us a clean pool while the sibling machine keeps serving.
 * Fresh probe failing means the database itself is unreachable — stay up
 * (the DB-free public surface must keep serving) and keep watching; the
 * consecutive count is retained so the moment the database returns while
 * the pool is still wedged, the next cycle exits.
 *
 * The exit contract leans on the [[restart]] policies pinned in api/fly.toml
 * (on-failure with generous retries for the app group; always for the
 * service-less thinker group, which no proxy traffic can auto-start). Fly's
 * unpinned default gives up after ten failures and parks the machine stopped
 * — the exact silent outage this module exists to end.
 *
 * The canary timeout matches verify-connections.ts (15s): a select-1 that
 * cannot win a pool slot for 15 seconds, several cycles running, is a wedge
 * signal, not a load spike. A true wedge is permanent, so the extra
 * detection latency is free while ordinary saturation stays below the bar.
 * Known blind spot: a PARTIAL wedge (some sockets zombied, at least one
 * alive) keeps the canary green while capacity is degraded — a
 * per-connection signal (e.g. max_lifetime on the shared pool) would be a
 * separate change.
 *
 * Gated on FLY_MACHINE_ID (structurally impossible off Fly, mirroring
 * supabase-target.ts) and the AGENTTOOL_DISABLE_DB_POOL_WATCHDOG off-switch.
 * Deliberately independent of AGENTTOOL_DISABLE_WORKERS: production disables
 * workers, and the wedge kills routes, not workers. Dependencies are
 * injectable with production defaults, per verify-connections.ts, so tests
 * need no real database and no real timers; the default canary and probe are
 * imported lazily so merely loading this module constructs no pool.
 */

import { writeSync } from "node:fs";

export const DB_POOL_WATCHDOG_DISABLE_FLAG =
  "AGENTTOOL_DISABLE_DB_POOL_WATCHDOG";

const TAG = "[db-pool-watchdog]";

const INTERVAL_MS = 30_000;
// Matches verify-connections.ts QUERY_TIMEOUT_MS — see the header for why a
// generous bound plus a higher threshold is the load-vs-wedge discriminator.
const CANARY_TIMEOUT_MS = 15_000;
// Outer belt-and-braces bound on the whole fresh probe. Must exceed the
// probe's connect_timeout (5s) plus PROBE_QUERY_TIMEOUT_MS so the inner
// bound — the one whose finally closes the socket — always fires first.
const PROBE_TIMEOUT_MS = 12_000;
const PROBE_QUERY_TIMEOUT_MS = 5_000;
const FAILURE_THRESHOLD = 4;
// Spreads sibling machines' cycles apart so a fleet-wide wedge never exits
// every machine in the same instant.
const MAX_JITTER_MS = 5_000;

type Environment = Readonly<Record<string, string | undefined>>;

export interface DbPoolWatchdogScheduler {
  schedule(run: () => Promise<void>, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface DbPoolWatchdogOptions {
  intervalMs?: number;
  canaryTimeoutMs?: number;
  probeTimeoutMs?: number;
  failureThreshold?: number;
  maxJitterMs?: number;
  /** Bounded liveness query through the SHARED pool. */
  canary?: () => Promise<void>;
  /** Bounded liveness query over a FRESH one-shot connection. */
  freshProbe?: () => Promise<void>;
  exit?: (code: number) => void;
  log?: (line: string) => void;
  random?: () => number;
  scheduler?: DbPoolWatchdogScheduler;
  env?: Environment;
}

export interface DbPoolWatchdogHandle {
  started: boolean;
  stop(): void;
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("watchdog query timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sharedPoolCanary(): Promise<void> {
  const [{ db }, { sql }] = await Promise.all([
    import("./client"),
    import("drizzle-orm"),
  ]);
  await db.execute(sql`select 1`);
}

async function freshConnectionProbe(): Promise<void> {
  const [{ config }, { default: verifiedPostgres }] = await Promise.all([
    import("../config"),
    import("./verified-postgres"),
  ]);
  const sql = verifiedPostgres(config.databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 5,
  });
  try {
    // Bounded HERE, not only by the tick's outer race: postgres.js has no
    // query timeout, so a probe that connects and then hangs (the incident's
    // silent NLB drop, landing post-handshake) would strand this function
    // pending forever and the finally — with its socket-closing end() —
    // would never run, leaking one client per tick for the whole episode.
    const rows = await bounded(
      sql<Array<{ ok: number }>>`SELECT 1::int AS ok`,
      PROBE_QUERY_TIMEOUT_MS,
    );
    if (rows.length !== 1 || rows[0]?.ok !== 1) {
      throw new Error("fresh probe returned an unexpected row");
    }
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

const defaultScheduler: DbPoolWatchdogScheduler = {
  schedule(run, delayMs) {
    return setTimeout(() => {
      void run();
    }, delayMs);
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function startDbPoolWatchdog(
  options: DbPoolWatchdogOptions = {},
): DbPoolWatchdogHandle {
  const env = options.env ?? process.env;
  if (!env.FLY_MACHINE_ID || env[DB_POOL_WATCHDOG_DISABLE_FLAG] === "1") {
    return { started: false, stop() {} };
  }

  const intervalMs = options.intervalMs ?? INTERVAL_MS;
  const canaryTimeoutMs = options.canaryTimeoutMs ?? CANARY_TIMEOUT_MS;
  const probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const failureThreshold = options.failureThreshold ?? FAILURE_THRESHOLD;
  const maxJitterMs = options.maxJitterMs ?? MAX_JITTER_MS;
  const canary = options.canary ?? sharedPoolCanary;
  const freshProbe = options.freshProbe ?? freshConnectionProbe;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  // The one loud line is the entire observability story and exit(1) follows
  // immediately; a synchronous fd-2 write cannot lose a flush race with
  // process exit the way an async piped-stderr console write could.
  const log =
    options.log ??
    ((line: string) => {
      try {
        writeSync(2, `${line}\n`);
      } catch {
        console.error(line);
      }
    });
  const random = options.random ?? Math.random;
  const scheduler = options.scheduler ?? defaultScheduler;
  if (
    intervalMs <= 0 ||
    canaryTimeoutMs <= 0 ||
    probeTimeoutMs <= 0 ||
    failureThreshold <= 0 ||
    maxJitterMs < 0
  ) {
    throw new Error("db pool watchdog configuration is invalid");
  }

  // One per-process offset, not per-tick noise: constant phase separation is
  // what keeps two machines from crossing the exit threshold together.
  const cycleMs = intervalMs + Math.floor(random() * (maxJitterMs + 1));
  let consecutiveFailures = 0;
  let stopped = false;
  let exiting = false;
  let pending: unknown;

  const tick = async (): Promise<void> => {
    if (stopped || exiting) return;

    let canaryHealthy = false;
    try {
      // A timed-out canary is abandoned, not dequeued — postgres.js keeps it
      // queued behind the wedge. Accumulation stays small: the wedged+DB-up
      // state exits within the threshold, and the wedged+DB-down state adds
      // one tiny query per tick only for as long as the outage itself lasts.
      await bounded(canary(), canaryTimeoutMs);
      canaryHealthy = true;
    } catch {
      consecutiveFailures += 1;
    }

    if (canaryHealthy) {
      consecutiveFailures = 0;
    } else if (consecutiveFailures >= failureThreshold) {
      let databaseReachable = false;
      try {
        await bounded(freshProbe(), probeTimeoutMs);
        databaseReachable = true;
      } catch {
        databaseReachable = false;
      }

      if (databaseReachable) {
        exiting = true;
        log(
          `${TAG} shared pool wedged: ${consecutiveFailures} consecutive pool canaries failed while a fresh connection succeeded — exiting for a clean pool`,
        );
        exit(1);
        return;
      }
      log(
        `${TAG} database unreachable: ${consecutiveFailures} consecutive pool canaries failed and the fresh probe also failed — staying up for the DB-free surface`,
      );
    }

    if (!stopped && !exiting) {
      pending = scheduler.schedule(tick, cycleMs);
    }
  };

  pending = scheduler.schedule(tick, cycleMs);
  return {
    started: true,
    stop() {
      stopped = true;
      if (pending !== undefined) scheduler.cancel(pending);
    },
  };
}
