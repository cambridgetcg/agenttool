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
 * The exit contract leans on the Machine's Fly restart policy. Today's fleet
 * runs Fly's default (on-failure, 10 retries), and the app group additionally
 * revives on proxy traffic via auto_start, so a recurring wedge costs
 * restarts, not availability. Pinning stronger policies (generous app
 * retries; always for the service-less thinker group, which no proxy traffic
 * can auto-start) is deliberately deferred: the Phase-B deploy guard and the
 * refence maintenance contract both pin the restored machine shape at
 * on-failure/10, so a policy change must land together with their reviewed
 * re-seal, not ahead of it. See docs/STACK.md §4.
 *
 * The canary timeout matches verify-connections.ts (15s): a select-1 that
 * cannot win a pool slot for 15 seconds, several cycles running, is a wedge
 * signal, not a load spike. Time alone, though, cannot tell a wedge from
 * legitimate saturation: docs/STACK.md permits 120-second statements and
 * client.ts sets no lower bound, so ten lock-waiting requests can hold every
 * slot for two minutes while a fresh connection answers instantly. The slow
 * budget (FAILURE_THRESHOLD cycles) therefore stays ABOVE that statement
 * timeout, exactly as first shipped.
 *
 * The fast path (added 2026-09-02, after the first day live saw four wedges
 * at ~3 minutes of failed authed routes each) uses the incident's own
 * signature instead of time. The 2026-08-31 diagnosis found ten ESTABLISHED
 * zombie sockets on the app and ZERO sessions for this role in
 * pg_stat_activity — the pooler had already lost their backends. Saturation
 * looks the opposite: every held slot is a live, non-idle session. So once
 * FAST_FAILURE_THRESHOLD canaries fail, the fresh probe also counts this
 * role's non-idle sessions; zero means the database sees no work from us
 * while our pool cannot answer, and the process exits early. Any other count
 * (including "unknown" when the catalog query is unavailable) holds the exit
 * until the slow budget, so a busy-but-healthy machine is never restarted
 * ahead of the original guarantee. Fleet-wide wedges — the observed pattern,
 * since the pooler event is shared — take the fast path on both machines.
 * DB_POOL_WATCHDOG_DEFAULTS is exported so tests pin both budgets.
 * A PARTIAL wedge (some sockets zombied, at least one alive) keeps the
 * canary green while capacity is degraded; that is bounded per connection
 * by the shared pool's inactivity guard (client.ts → guarded-socket.ts),
 * which returns a dead slot after 135s. This watchdog remains the answer
 * for the fleet-wide case where every slot dies inside one guard window.
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
// generous bound plus the slow threshold is the load-vs-wedge time budget.
const CANARY_TIMEOUT_MS = 15_000;
// Outer belt-and-braces bound on the whole fresh probe. Must exceed the
// probe's connect_timeout (5s) plus BOTH bounded queries (reachability, then
// the session count) so the inner bounds — the ones whose finally closes the
// socket — always fire first.
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_QUERY_TIMEOUT_MS = 5_000;
// Slow budget: 4 × 15s canaries + 3 × 30s cycles = 150s minimum from the
// first failed canary, above the 120s statement timeout STACK.md permits.
const FAILURE_THRESHOLD = 4;
// Fast path: after this many failures the fresh probe's session count may
// prove the wedge signature and exit early (~60–85s). Never exits on time.
const FAST_FAILURE_THRESHOLD = 2;
// Spreads sibling machines' cycles apart so a fleet-wide wedge never exits
// every machine in the same instant.
const MAX_JITTER_MS = 5_000;

/** Production defaults, exported for the detection-budget pin in tests. */
export const DB_POOL_WATCHDOG_DEFAULTS = Object.freeze({
  intervalMs: INTERVAL_MS,
  canaryTimeoutMs: CANARY_TIMEOUT_MS,
  probeTimeoutMs: PROBE_TIMEOUT_MS,
  failureThreshold: FAILURE_THRESHOLD,
  fastFailureThreshold: FAST_FAILURE_THRESHOLD,
  maxJitterMs: MAX_JITTER_MS,
});

/** What the fresh-connection probe saw. `activeSessions` counts this role's
 *  non-idle sessions in pg_stat_activity other than the probe itself; null
 *  when the catalog query was unavailable (reachability still proven). */
export interface FreshProbeObservation {
  activeSessions: number | null;
}

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
  fastFailureThreshold?: number;
  maxJitterMs?: number;
  /** Bounded liveness query through the SHARED pool. */
  canary?: () => Promise<void>;
  /** Bounded liveness query over a FRESH one-shot connection. Resolving to a
   *  FreshProbeObservation enables the fast path; resolving to anything else
   *  proves reachability only (fast path declines). */
  freshProbe?: () => Promise<FreshProbeObservation | void>;
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

function normalizeObservation(result: unknown): FreshProbeObservation {
  if (
    result !== null &&
    typeof result === "object" &&
    "activeSessions" in result &&
    typeof (result as { activeSessions: unknown }).activeSessions === "number" &&
    Number.isInteger((result as { activeSessions: number }).activeSessions) &&
    (result as { activeSessions: number }).activeSessions >= 0
  ) {
    return { activeSessions: (result as { activeSessions: number }).activeSessions };
  }
  return { activeSessions: null };
}

async function freshConnectionProbe(): Promise<FreshProbeObservation> {
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
    // Reachability is proven above; the session count is best-effort. A
    // wedge leaves this role with no live client backends (the 2026-08-31
    // signature), saturation leaves every held slot non-idle. `usename =
    // current_user` keeps the rows visible without pg_read_all_stats; the
    // probe excludes its own backend; and `backend_type = 'client backend'`
    // excludes Supabase's background workers, which run under the same role
    // with a NULL state (verified live 2026-09-02: the `pg_net` worker would
    // otherwise pin the idle-state count at 1 and disarm the fast path).
    // Through Supavisor each in-flight client transaction is exactly one
    // server-side client backend, so the count maps 1:1 to held pool slots.
    // Any failure here reads as "unknown", which never takes the fast path.
    let activeSessions: number | null = null;
    try {
      const counted = await bounded(
        sql<Array<{ active: number }>>`
          SELECT count(*)::int AS active
          FROM pg_stat_activity
          WHERE usename = current_user
            AND pid <> pg_backend_pid()
            AND backend_type = 'client backend'
            AND state IS NOT NULL
            AND state <> 'idle'
        `,
        PROBE_QUERY_TIMEOUT_MS,
      );
      const active = counted[0]?.active;
      if (typeof active === "number" && Number.isInteger(active) && active >= 0) {
        activeSessions = active;
      }
    } catch {
      activeSessions = null;
    }
    return { activeSessions };
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
  // Default fast threshold never exceeds the slow one, so a caller lowering
  // only failureThreshold keeps a single-tier watchdog.
  const fastFailureThreshold = Math.min(
    options.fastFailureThreshold ?? FAST_FAILURE_THRESHOLD,
    failureThreshold,
  );
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
    fastFailureThreshold <= 0 ||
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
    } else if (consecutiveFailures >= fastFailureThreshold) {
      let observation: FreshProbeObservation | null = null;
      try {
        observation = normalizeObservation(
          await bounded(freshProbe(), probeTimeoutMs),
        );
      } catch {
        observation = null;
      }

      if (observation === null) {
        log(
          `${TAG} database unreachable: ${consecutiveFailures} consecutive pool canaries failed and the fresh probe also failed — staying up for the DB-free surface`,
        );
      } else if (consecutiveFailures >= failureThreshold) {
        exiting = true;
        log(
          `${TAG} shared pool wedged: ${consecutiveFailures} consecutive pool canaries failed while a fresh connection succeeded — exiting for a clean pool`,
        );
        exit(1);
        return;
      } else if (observation.activeSessions === 0) {
        exiting = true;
        log(
          `${TAG} shared pool wedged: ${consecutiveFailures} consecutive pool canaries failed while a fresh connection succeeded and the database reports no active sessions for this role — exiting early for a clean pool`,
        );
        exit(1);
        return;
      } else {
        const seen =
          observation.activeSessions === null
            ? "an unknown number of"
            : String(observation.activeSessions);
        log(
          `${TAG} shared pool slow, not proven wedged: ${consecutiveFailures} consecutive pool canaries failed but the database reports ${seen} active sessions for this role — holding until the ${failureThreshold}-failure budget`,
        );
      }
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
