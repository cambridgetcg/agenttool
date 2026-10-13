import { afterEach, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listenPrivate, Outbox, type RawSock } from '../src/nuance/unix.ts'
import { cleanupTmps, modeOf, shortSockRoot } from './helpers.ts'

const servers: Array<{ stop(closeActive?: boolean): void }> = []
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true)
  cleanupTmps()
})

const handlers = { data() {} }

/** A socket file whose listener died by SIGKILL, so nothing listens on it (F8): what a crashed relay or pipe leaves. */
function staleSocket(path: string): void {
  const killed = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', '-e',
    `Bun.listen({ unix: ${JSON.stringify(path)}, socket: { data() {} } }); process.kill(process.pid, 'SIGKILL')`],
  { cwd: '/', env: { PATH: '/usr/bin:/bin' } })
  expect(killed.signalCode).toBe('SIGKILL')
  expect(lstatSync(path).isSocket()).toBe(true)
}

/** Resolves once a client has connected to `path`: something listens there. */
async function reaches(path: string): Promise<void> {
  const s = await Bun.connect({ unix: path, socket: { data() {} } })
  s.end()
}

const inode = (p: string) => lstatSync(p, { bigint: true }).ino

describe('listenPrivate', () => {
  test('the socket is 0600 and the umask is restored, in both modes and after a failed bind', async () => {
    for (const replace of [true, false]) {
      const path = join(shortSockRoot(), 'a.sock')
      const prev = process.umask(0o022)
      try {
        const l = listenPrivate(path, handlers, { replace })
        servers.push(l.server)
        expect(modeOf(path)).toBe(0o600)
        expect(process.umask()).toBe(0o022)
        expect(() => listenPrivate(join(shortSockRoot(), 'missing', 'b.sock'), handlers, { replace })).toThrow()
        expect(process.umask()).toBe(0o022)
      } finally {
        process.umask(prev)
      }
      await reaches(path)
    }
  })

  test('replace renames over the path, returns its inode and leaves no <path>.<pid> behind', async () => {
    const root = shortSockRoot()
    const path = join(root, 'hub.sock')
    writeFileSync(`${path}.${process.pid}`, 'left by an earlier listener that had this pid')
    const older = listenPrivate(path, handlers, { replace: true })
    expect(readdirSync(root)).toEqual(['hub.sock'])
    expect(older.ino).toBe(inode(path))
    await reaches(path)
    // A newer listener takes the path; stopping the older one unlinks only the name it bound, which is long gone (P17).
    const newer = listenPrivate(path, handlers, { replace: true })
    servers.push(newer.server)
    expect(newer.ino).not.toBe(older.ino)
    older.server.stop(true)
    expect(readdirSync(root)).toEqual(['hub.sock'])
    expect(inode(path)).toBe(newer.ino!)
    await reaches(path)
  })

  test('without replace it binds the path itself and returns no inode', async () => {
    const root = shortSockRoot()
    const path = join(root, 'tap.sock')
    const l = listenPrivate(path, handlers, { replace: false })
    servers.push(l.server)
    expect(l.ino).toBeNull()
    expect(readdirSync(root)).toEqual(['tap.sock'])
    await reaches(path)
  })

  test('a stale socket file at the path blocks neither mode', async () => {
    for (const replace of [true, false]) {
      const path = join(shortSockRoot(), 'hub.sock')
      staleSocket(path)
      const l = listenPrivate(path, handlers, { replace })
      servers.push(l.server)
      expect(modeOf(path)).toBe(0o600)
      await reaches(path)
    }
  }, 10_000)

  test('a failure after the bind stops the listener and leaves no <path>.<pid>', () => {
    const root = shortSockRoot()
    const path = join(root, 'hub.sock')
    mkdirSync(path)
    writeFileSync(join(path, 'x'), 'a non-empty dir: renaming a socket over it fails with EISDIR')
    expect(() => listenPrivate(path, handlers, { replace: true })).toThrow()
    expect(existsSync(`${path}.${process.pid}`)).toBe(false)
  })
})

/** A RawSock that takes at most `take` bytes a write (8192 is what this Air's kernel takes), or -1 once it is dead. */
function fakeSock(o: { take?: number } = {}) {
  const got: Uint8Array[] = []
  let ends = 0
  let attempts = 0
  let dead = false
  const sock: RawSock = {
    write(b) {
      attempts++
      if (dead) return -1
      const n = Math.min(o.take ?? 8192, b.byteLength)
      got.push(b.slice(0, n))
      return n
    },
    end() { ends++ },
  }
  return { sock, bytes: () => Buffer.concat(got), ends: () => ends, attempts: () => attempts, kill: () => { dead = true } }
}

describe('Outbox', () => {
  test('a 4 MiB push arrives whole and in order across partial writes', () => {
    const f = fakeSock()
    const out = new Outbox(f.sock)
    const big = randomBytes(4 * 1024 * 1024)
    const tail = new TextEncoder().encode('and then this')
    out.push(big)
    out.push(tail) // queued behind the rest of big, not written past it
    expect(f.bytes().byteLength).toBe(8192)
    const total = big.byteLength + tail.byteLength
    for (let i = 0; i < 1000 && f.bytes().byteLength < total; i++) out.drain()
    expect(Buffer.compare(f.bytes(), Buffer.concat([big, tail]))).toBe(0)
    expect(f.ends()).toBe(0)
  })

  test('a write of -1 drops the queue and calls onDead once', () => {
    const f = fakeSock()
    let dead = 0
    const out = new Outbox(f.sock, { onDead: () => { dead++ } })
    out.push(new Uint8Array(20_000)) // 8192 out, the rest waits
    f.kill()
    out.drain()
    expect(dead).toBe(1)
    const tries = f.attempts()
    out.push(new Uint8Array(10))
    out.drain()
    expect(f.attempts()).toBe(tries) // nothing is written after it
    expect(dead).toBe(1)
    expect(f.bytes().byteLength).toBe(8192)
  })

  test('endWhenFlushed ends the socket only after the queue is empty', () => {
    const f = fakeSock()
    const out = new Outbox(f.sock)
    out.push(new Uint8Array(20_000)) // 8192 now, 11808 wait
    out.endWhenFlushed()
    expect(f.ends()).toBe(0)
    out.drain() // 8192 more, 3616 wait
    expect(f.ends()).toBe(0)
    out.drain()
    expect(f.bytes().byteLength).toBe(20_000)
    expect(f.ends()).toBe(1)
    const g = fakeSock()
    new Outbox(g.sock).endWhenFlushed()
    expect(g.ends()).toBe(1) // nothing waits: it ends at once
  })

  test('clear drops what waits and leaves the socket open', () => {
    const f = fakeSock()
    const out = new Outbox(f.sock)
    out.push(new Uint8Array(20_000))
    out.clear()
    out.drain()
    expect(f.bytes().byteLength).toBe(8192)
    expect(f.ends()).toBe(0)
    out.push(new Uint8Array(5)) // still usable
    expect(f.bytes().byteLength).toBe(8197)
  })
})
