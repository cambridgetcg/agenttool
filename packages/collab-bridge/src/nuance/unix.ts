// Unix-socket plumbing the Nuance side shares: the relay (C3), the pipe's link client and its tap socket (C4), and the
// tests' fake link. Two things: a listener that is 0600 from its first moment (P17), and an outbox that keeps what
// Bun's socket.write did not take. Bun writes what the kernel accepts right now (8 KiB at a time on this Air for a unix
// socket), returns that count and buffers nothing, so the rest of every partial write waits here, in order, for `drain`.
import type { SocketHandler, UnixSocketListener } from 'bun'
import { chmodSync, lstatSync, renameSync, unlinkSync } from 'node:fs'

/** The two calls of a Bun socket the outbox makes. */
export interface RawSock { write(b: Uint8Array): number; end(): void }

/**
 * Bytes for one socket, in order. A push goes straight to the socket while nothing waits, and a partial write keeps the
 * rest for `drain`. A write that returns -1 (the socket is closed) drops the queue and calls onDead, once; nothing is
 * written after it.
 */
export class Outbox {
  private queue: Uint8Array[] = []
  private ending = false
  private dead = false
  constructor(private readonly sock: RawSock, private readonly o: { onDead?(): void } = {}) {}

  push(b: Uint8Array): void {
    if (this.dead) return
    if (this.queue.length > 0) this.queue.push(b)
    else this.send(b)
  }

  /** Bun's drain callback: the kernel takes bytes again. */
  drain(): void {
    while (this.queue.length > 0) if (!this.send(this.queue.shift()!)) return
    if (this.ending) this.sock.end()
  }

  /** P18: the side that ends an exchange writes its CLOSE frame first; the socket ends once everything is out. */
  endWhenFlushed(): void {
    if (this.queue.length === 0) this.sock.end()
    else this.ending = true
  }

  /** Drops what waits, without ending the socket. */
  clear(): void {
    this.queue = []
  }

  private send(b: Uint8Array): boolean {
    const n = this.sock.write(b)
    if (n < 0) {
      this.queue = []
      this.dead = true
      this.o.onDead?.()
      return false
    }
    if (n < b.byteLength) { this.queue.unshift(b.subarray(n)); return false }
    return true
  }
}

/**
 * Bun.listen on a unix socket that is 0600 from its first moment: bound under umask 0177 (restored afterwards, a throw
 * included), then chmodded 0600. A socket file outlives a SIGKILLed listener and listening on a path that exists fails
 * with EADDRINUSE (F8), so the name is unlinked before the bind.
 * - replace: true binds `<path>.<pid>`, a name only this process uses, reads its inode, then renames it over `path`. A
 *   stale or older socket at `path` is replaced in one step, and Bun's stop() later unlinks only the name it bound,
 *   which the rename already moved, so it never removes a newer listener's socket (P17). `ino` lets the caller check
 *   later whether `path` is still its own.
 * - replace: false unlinks `path` and binds it directly; `ino` is null.
 * Path-length checks stay with the callers, each with its own refusal code (P16). A failure after the bind stops the
 * listener (which unlinks the name it bound) and throws.
 */
export function listenPrivate<T>(path: string, socket: SocketHandler<T>, o: { replace: boolean }): { server: UnixSocketListener<T>; ino: bigint | null } {
  const bind = o.replace ? `${path}.${process.pid}` : path
  try { unlinkSync(bind) } catch { /* nothing there: the usual case */ }
  const mask = process.umask(0o177)
  let server: UnixSocketListener<T>
  try {
    server = Bun.listen<T>({ unix: bind, socket })
  } finally {
    process.umask(mask)
  }
  try {
    chmodSync(bind, 0o600)
    if (!o.replace) return { server, ino: null }
    const ino = lstatSync(bind, { bigint: true }).ino
    renameSync(bind, path)
    return { server, ino }
  } catch (e) {
    server.stop(true)
    throw e
  }
}
