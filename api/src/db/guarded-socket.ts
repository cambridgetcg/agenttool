/** Inactivity guard for pool sockets — a dead connection returns its slot.
 *
 * The 2026-08-31 wedge and its 2026-09-02 recurrence share one mechanic:
 * Supabase's pooler drops the server side of a connection without RST/FIN,
 * the socket stays ESTABLISHED, its in-flight query never resolves, and the
 * pool slot is lost until the process exits. TCP keepalive does not see it,
 * postgres.js has no per-query timeout, and `idle_timeout` only recycles
 * connections that are idle — a connection with a pending query is busy by
 * definition. On 2026-09-02 single stuck requests surfaced roughly ten times
 * an hour; with a pool of ten that is a full wedge every hour.
 *
 * This socket bounds the loss instead of the cause: if the server has sent
 * nothing for `inactivityMs`, the socket is destroyed WITHOUT an error so
 * postgres.js sees a plain close, rejects the pending query with
 * CONNECTION_CLOSED (no retry — connection.js `closed()`), and opens a fresh
 * connection for the next one. The request that was stuck fails (it already
 * had — the proxy closed it at ten seconds); the slot no longer does. The
 * bound sits above the database's 120-second `statement_timeout`
 * (docs/STACK.md), so a legitimate long statement is always answered — with
 * a result or the server's own error — before the guard can fire, and
 * `idle_timeout` (20s on the shared pool) closes idle connections long
 * before it. A LISTEN/NOTIFY session, which is legitimately silent for
 * minutes, must not use this socket; only the shared pool installs it, via
 * installInactivityGuard() below.
 *
 * Why the guard is installed AFTER construction rather than through the
 * verified constructor: api/src/db/verified-postgres.ts is part of the
 * Phase-B maintenance bridge's sealed dependency closure (exact size, git
 * blob and SHA-256 pinned in bin/phase-b-refence-maintenance-bridge.ts and
 * its test), so changing its bytes would make the fenced deploy refuse until
 * the operator re-seals — that ceremony is the operator's lane, not a
 * hotfix's. The helper therefore wraps the transport the constructor already
 * resolved: the factory connects to postgres.js's own resolved host/port from
 * the verified URL, and the verified `ssl` object still drives the TLS
 * upgrade on top of it. Target, credentials and CA are untouched; only the
 * liveness bound is added. Folding an `inactivity_guard_seconds` option into
 * the constructor is the follow-up for the next closure re-seal.
 *
 * Why inbound bytes are sampled rather than `socket.setTimeout`: on Bun
 * 1.3.5 — the production runtime — a socket's timeout does not reset on
 * inbound data (CI caught it: a socket receiving a byte every 20ms still
 * fired an 80ms timeout; reproduced locally, and fixed by 1.3.13). The raw
 * socket's `bytesRead` does advance through postgres.js's TLS upgrade on
 * both versions, so the guard polls that counter. Inbound silence is also
 * the right signal: a wedged socket never hears from the server again,
 * while `bytesWritten` on the raw socket stays 0 after the TLS upgrade.
 *
 * Two more postgres.js facts shape the implementation. Its `socket` option
 * is a transport factory whose result must ALREADY BE CONNECTED — with a
 * factory present it skips its own `socket.connect()` and goes straight to
 * the TLS upgrade or the startup message (connection.js `connect()`), so
 * the factory here connects to the host/port postgres.js hands it before
 * resolving. And it calls `socket.removeAllListeners()` before that
 * upgrade, after which the raw socket has no error listener of its own —
 * destroying it WITH an error would surface as an uncaught exception — so
 * the guard destroys silently and re-adds a no-op error listener whenever
 * listeners are removed. Verified on Bun 1.3 against a real TLS server
 * (secureConnect → guard → tls close with hadError=false).
 */

import net from "node:net";

export interface GuardedSocketReport {
  inactivityMs: number;
  ageMs: number;
  bytesRead: number;
  bytesWritten: number;
}

export interface GuardedSocketOptions {
  /** Inbound silence after which the socket is destroyed. */
  inactivityMs: number;
  /** Called once, just before the socket is destroyed. Must not throw. */
  onGuard?: (report: GuardedSocketReport) => void;
  /** How often `bytesRead` is sampled. Defaults to a quarter of the bound,
   *  clamped to [50ms, 15s]. */
  sampleMs?: number;
  now?: () => number;
}

/** The subset of postgres.js's resolved options the factory connects with:
 *  host/port are arrays (multi-host URLs), `path` names a unix socket, and
 *  connect_timeout is in seconds. */
export interface GuardedSocketTarget {
  host?: string | readonly string[];
  port?: number | string | readonly (number | string)[];
  path?: string;
  connect_timeout?: number;
}

function assertBound(inactivityMs: number): void {
  if (!Number.isFinite(inactivityMs) || inactivityMs <= 0) {
    throw new Error("guarded socket inactivityMs must be a positive number");
  }
}

export class GuardedSocket extends net.Socket {
  private readonly inactivityMs: number;
  private readonly sampleMs: number;
  private readonly onGuard: ((report: GuardedSocketReport) => void) | undefined;
  private readonly now: () => number;
  private readonly bornAt: number;
  private lastActivityAt: number;
  private lastBytesRead = 0;
  private sampler: ReturnType<typeof setInterval> | undefined;
  private tripped = false;

  constructor(options: GuardedSocketOptions) {
    super();
    assertBound(options.inactivityMs);
    this.inactivityMs = options.inactivityMs;
    this.sampleMs =
      options.sampleMs ??
      Math.max(50, Math.min(15_000, Math.floor(options.inactivityMs / 4)));
    this.onGuard = options.onGuard;
    this.now = options.now ?? (() => Date.now());
    this.bornAt = this.now();
    this.lastActivityAt = this.bornAt;
    this.arm();
  }

  private readonly onClose = (): void => {
    this.disarm();
  };

  /** Survives postgres.js's listener reset; an unlistened 'error' would be fatal. */
  private readonly swallowError = (): void => {};

  private readonly sample = (): void => {
    if (this.destroyed) {
      this.disarm();
      return;
    }
    const read = typeof this.bytesRead === "number" ? this.bytesRead : 0;
    const at = this.now();
    if (read !== this.lastBytesRead) {
      this.lastBytesRead = read;
      this.lastActivityAt = at;
      return;
    }
    if (at - this.lastActivityAt >= this.inactivityMs) this.guard();
  };

  private guard(): void {
    if (this.tripped || this.destroyed) return;
    this.tripped = true;
    this.disarm();
    const report: GuardedSocketReport = {
      inactivityMs: this.inactivityMs,
      ageMs: this.now() - this.bornAt,
      bytesRead: typeof this.bytesRead === "number" ? this.bytesRead : -1,
      bytesWritten: typeof this.bytesWritten === "number" ? this.bytesWritten : -1,
    };
    try {
      this.onGuard?.(report);
    } catch {
      // A reporting failure must never keep a dead socket alive.
    }
    this.destroy();
  }

  /** Idempotent: starts the sampler if needed and (re)attaches the listeners. */
  arm(): void {
    if (!this.sampler && !this.destroyed) {
      this.sampler = setInterval(this.sample, this.sampleMs);
      // A guard must never be what keeps the process alive.
      this.sampler.unref?.();
    }
    this.removeListener("error", this.swallowError);
    this.on("error", this.swallowError);
    this.removeListener("close", this.onClose);
    this.on("close", this.onClose);
  }

  private disarm(): void {
    if (this.sampler) {
      clearInterval(this.sampler);
      this.sampler = undefined;
    }
  }

  /** Whether the guard has fired for this socket. */
  get guardTripped(): boolean {
    return this.tripped;
  }

  override removeAllListeners(event?: string | symbol): this {
    super.removeAllListeners(event);
    if (event === undefined || event === "error" || event === "close") this.arm();
    return this;
  }
}

function first<T>(value: T | readonly T[] | undefined): T | undefined {
  return Array.isArray(value) ? (value as readonly T[])[0] : (value as T | undefined);
}

/** Factory in the shape postgres.js expects for its `socket` option: it
 *  resolves to a socket that is already connected to the target postgres.js
 *  names (first host/port of a multi-host URL, or the unix `path`). A
 *  connect failure or timeout rejects, which postgres.js routes into its
 *  ordinary connection-error path. */
export function guardedSocketFactory(
  options: GuardedSocketOptions,
): (target?: GuardedSocketTarget) => Promise<GuardedSocket> {
  assertBound(options.inactivityMs);
  return async (target: GuardedSocketTarget = {}) => {
    const socket = new GuardedSocket(options);
    const path = target.path;
    const host = first(target.host) ?? "localhost";
    const port = Number(first(target.port) ?? 5432);
    const where = path ?? `${host}:${port}`;
    const connectMs = Math.max(1, Number(target.connect_timeout ?? 30)) * 1000;
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (err?: Error): void => {
        if (timer) clearTimeout(timer);
        socket.removeListener("connect", onConnect);
        socket.removeListener("error", onError);
        if (err) {
          socket.destroy();
          reject(err);
        } else {
          resolve();
        }
      };
      const onConnect = (): void => settle();
      const onError = (err: Error): void => settle(err);
      socket.once("connect", onConnect);
      socket.once("error", onError);
      timer = setTimeout(
        () => settle(new Error(`guarded socket connect to ${where} timed out after ${connectMs}ms`)),
        connectMs,
      );
      if (path) socket.connect(path);
      else socket.connect(port, host);
    });
    return socket;
  };
}

/** The narrow surface of a postgres.js instance the guard needs. */
export interface GuardablePostgres {
  options: {
    socket?: unknown;
    host?: string | readonly string[];
    port?: number | string | readonly (number | string)[];
    path?: string | false;
  };
}

/** Installs the inactivity guard on a pool built by the verified
 *  constructor. Must run before the pool opens its first connection (the
 *  factory is read at connect time) and refuses a pool that already has a
 *  transport factory. Returns the same instance for chaining. */
export function installInactivityGuard<T extends GuardablePostgres>(
  sql: T,
  inactivitySeconds: number,
  onGuard: (report: GuardedSocketReport) => void = reportGuardedSocket,
): T {
  if (
    typeof inactivitySeconds !== "number" ||
    !Number.isFinite(inactivitySeconds) ||
    inactivitySeconds <= 0
  ) {
    throw new Error("inactivity guard seconds must be a positive number");
  }
  if (sql.options.socket !== undefined) {
    throw new Error("this pool already has a transport factory");
  }
  if (!sql.options.path && !first(sql.options.host)) {
    throw new Error("this pool has no resolved target to guard");
  }
  sql.options.socket = guardedSocketFactory({
    inactivityMs: inactivitySeconds * 1000,
    onGuard,
  });
  return sql;
}

const GUARD_TAG = "[db-socket-guard]";

function kb(bytes: number): string {
  return bytes < 0 ? "?" : `${(bytes / 1024).toFixed(1)} kB`;
}

/** The one loud line per guarded socket — its count is the zombie rate. */
export function reportGuardedSocket(
  report: GuardedSocketReport,
  log: (line: string) => void = (line) => console.warn(line),
): void {
  log(
    `${GUARD_TAG} closed a pool socket after ${Math.round(report.inactivityMs / 1000)}s without a byte from the server — its slot returns to the pool (age ${Math.round(report.ageMs / 1000)}s, read ${kb(report.bytesRead)}, wrote ${kb(report.bytesWritten)})`,
  );
}
