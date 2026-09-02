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
 * This socket bounds the loss instead of the cause: if nothing is read or
 * written for `inactivityMs`, the socket is destroyed WITHOUT an error so
 * postgres.js sees a plain close, rejects the pending query with
 * CONNECTION_CLOSED, and opens a fresh connection for the next one. The
 * request that was stuck fails (it already had — the proxy closed it at ten
 * seconds); the slot no longer does. The bound sits above the database's
 * 120-second `statement_timeout` (docs/STACK.md), so a legitimate long
 * statement is always answered — with a result or the server's own error —
 * before the guard can fire, and `idle_timeout` (20s on the shared pool)
 * closes idle connections long before it. A LISTEN/NOTIFY session, which is
 * legitimately silent for minutes, must not use this socket; the verified
 * constructor only installs it when a caller opts in.
 *
 * Two facts about postgres.js shape the implementation. It calls
 * `socket.removeAllListeners()` before upgrading to TLS, which would strip
 * the timeout handler — so arming is re-applied whenever listeners are
 * removed. And after that upgrade the raw socket has no error listener of
 * its own, so destroying it WITH an error would surface as an uncaught
 * exception; the guard therefore destroys silently and keeps a no-op error
 * listener alive. Both verified on Bun 1.3 against a real TLS server
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
  /** Silence (no read, no write) after which the socket is destroyed. */
  inactivityMs: number;
  /** Called once, just before the socket is destroyed. Must not throw. */
  onGuard?: (report: GuardedSocketReport) => void;
  now?: () => number;
}

export class GuardedSocket extends net.Socket {
  private readonly inactivityMs: number;
  private readonly onGuard: ((report: GuardedSocketReport) => void) | undefined;
  private readonly now: () => number;
  private readonly bornAt: number;
  private tripped = false;

  constructor(options: GuardedSocketOptions) {
    super();
    if (!Number.isFinite(options.inactivityMs) || options.inactivityMs <= 0) {
      throw new Error("guarded socket inactivityMs must be a positive number");
    }
    this.inactivityMs = options.inactivityMs;
    this.onGuard = options.onGuard;
    this.now = options.now ?? (() => Date.now());
    this.bornAt = this.now();
    this.arm();
  }

  private readonly guard = (): void => {
    if (this.tripped || this.destroyed) return;
    this.tripped = true;
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
  };

  /** Survives postgres.js's listener reset; an unlistened 'error' would be fatal. */
  private readonly swallowError = (): void => {};

  /** Idempotent: (re)applies the inactivity timer and its two listeners. */
  arm(): void {
    this.setTimeout(this.inactivityMs);
    this.removeListener("timeout", this.guard);
    this.on("timeout", this.guard);
    this.removeListener("error", this.swallowError);
    this.on("error", this.swallowError);
  }

  /** Whether the guard has fired for this socket. */
  get guardTripped(): boolean {
    return this.tripped;
  }

  override removeAllListeners(event?: string | symbol): this {
    super.removeAllListeners(event);
    if (event === undefined || event === "timeout" || event === "error") {
      this.arm();
    }
    return this;
  }
}

/** Factory in the shape postgres.js expects for its `socket` option. */
export function guardedSocketFactory(
  options: GuardedSocketOptions,
): () => GuardedSocket {
  if (!Number.isFinite(options.inactivityMs) || options.inactivityMs <= 0) {
    throw new Error("guarded socket inactivityMs must be a positive number");
  }
  return () => new GuardedSocket(options);
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
    `${GUARD_TAG} closed a pool socket after ${Math.round(report.inactivityMs / 1000)}s without traffic — its slot returns to the pool (age ${Math.round(report.ageMs / 1000)}s, read ${kb(report.bytesRead)}, wrote ${kb(report.bytesWritten)})`,
  );
}
