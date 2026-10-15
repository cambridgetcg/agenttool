import { afterEach, describe, expect, test } from 'bun:test'
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { fullFsync, getuid, monoNowMs, passwdOfSelf, tryFlock, unlockFlock, writeFileDurable } from '../src/native.ts'
import { cleanupTmps, temp } from './helpers.ts'

afterEach(cleanupTmps)

const NATIVE = join(import.meta.dir, '..', 'src', 'native.ts')
/** An fd number no test has open, for the error paths. */
const NOT_OPEN = 9999

/** Writes a small bun script that imports src/native.ts by absolute path; returns its path. */
function childScript(dir: string, name: string, body: string): string {
  const p = join(dir, name)
  writeFileSync(p, `import { getuid, monoNowMs, passwdOfSelf, tryFlock } from ${JSON.stringify(NATIVE)}\n${body}\n`)
  return p
}
/** A bun child as the bridge starts one: no .env, no bunfig, and only the env given. */
const bunArgv = (script: string) => [process.execPath, '--no-env-file', '--config=/dev/null', script]
const idOf = (flag: '-un' | '-u') => Bun.spawnSync(['/usr/bin/id', flag], { env: { PATH: '/usr/bin:/bin' } }).stdout.toString().trim()

describe('flock', () => {
  test('a second open in the same process is busy', () => {
    const lock = join(temp('cb-native-'), 'hub.lock')
    const a = openSync(lock, 'a+', 0o600)
    const b = openSync(lock, 'a+', 0o600)
    try {
      expect(tryFlock(a)).toBe('locked')
      expect(tryFlock(b)).toBe('busy')
      unlockFlock(a)
      expect(tryFlock(b)).toBe('locked')
    } finally { closeSync(a); closeSync(b) }
  })

  test('a lock held by another process is busy, and a SIGKILL releases it', async () => {
    const dir = temp('cb-native-')
    const lock = join(dir, 'hub.lock')
    const script = childScript(dir, 'holder.ts', [
      "import { openSync } from 'node:fs'",
      `const fd = openSync(${JSON.stringify(lock)}, 'a+', 0o600)`,
      'console.log(tryFlock(fd))',
      'setInterval(() => {}, 1000)',
    ].join('\n'))
    const holder = Bun.spawn(bunArgv(script), { cwd: dir, env: { PATH: '/usr/bin:/bin', HOME: dir }, stdout: 'pipe', stderr: 'pipe' })
    const reader = holder.stdout.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('locked\n')
    const fd = openSync(lock, 'a+', 0o600)
    try {
      expect(tryFlock(fd)).toBe('busy')
      holder.kill('SIGKILL')
      await holder.exited
      // The kernel drops a dead holder's lock: a stale hub.lock never blocks the next hub.
      expect(tryFlock(fd)).toBe('locked')
    } finally { closeSync(fd) }
  }, 15_000)

  test('a spawned child does not inherit the lock', async () => {
    const lock = join(temp('cb-native-'), 'hub.lock')
    const a = openSync(lock, 'a+', 0o600)
    expect(tryFlock(a)).toBe('locked')
    const child = Bun.spawn(['/bin/sleep', '5'], { stdio: ['ignore', 'ignore', 'ignore'] })
    // A lock lives as long as its open file; had the child inherited `a`, the lock would outlive this close.
    closeSync(a)
    const b = openSync(lock, 'a+', 0o600)
    try { expect(tryFlock(b)).toBe('locked') } finally {
      closeSync(b)
      child.kill()
      await child.exited
    }
  }, 15_000)

  test('any errno but EWOULDBLOCK throws with that errno', () => {
    expect(() => tryFlock(NOT_OPEN)).toThrow('flock failed: errno 9')
    expect(() => unlockFlock(NOT_OPEN)).toThrow('flock(LOCK_UN) failed: errno 9')
  })
})

describe('passwd', () => {
  test('passwd reads yuai even with USER=bogus and HOME elsewhere', () => {
    const dir = temp('cb-native-')
    const script = childScript(dir, 'pw.ts', 'console.log(JSON.stringify({ ...passwdOfSelf(), getuid: getuid() }))')
    const r = Bun.spawnSync(bunArgv(script), { cwd: dir, env: { USER: 'bogus', HOME: dir, PATH: '/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' })
    expect(r.stderr.toString()).toBe('')
    const name = idOf('-un')
    const uid = Number(idOf('-u'))
    expect(name).not.toBe('bogus')
    expect(JSON.parse(r.stdout.toString())).toEqual({ uid, name, dir: `/Users/${name}`, getuid: uid })
  })

  test('passwd works with only HOME and PATH set', () => {
    // launchd gives the hub exactly these two (the LaunchAgent's EnvironmentVariables), and no USER.
    const dir = temp('cb-native-')
    const script = childScript(dir, 'pw.ts', 'console.log(JSON.stringify(passwdOfSelf()))')
    const r = Bun.spawnSync(bunArgv(script), { cwd: '/', env: { HOME: dir, PATH: '/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' })
    const name = idOf('-un')
    expect(JSON.parse(r.stdout.toString())).toEqual({ uid: Number(idOf('-u')), name, dir: `/Users/${name}` })
  })

  test('getuid in this process is process.getuid()', () => {
    expect(getuid()).toBe(process.getuid!())
    expect(passwdOfSelf().uid).toBe(process.getuid!())
  })
})

describe('fsync and the clock', () => {
  test('fullFsync flushes an open file and throws on a bad fd', () => {
    const p = join(temp('cb-native-'), 'f')
    const fd = openSync(p, 'w', 0o600)
    try {
      writeSync(fd, 'x\n')
      expect(() => fullFsync(fd)).not.toThrow()
    } finally { closeSync(fd) }
    expect(() => fullFsync(NOT_OPEN)).toThrow('fcntl(F_FULLFSYNC) failed: errno 9')
  })

  test('monoNowMs advances with a sleep and is system-wide', async () => {
    const a = monoNowMs()
    await Bun.sleep(100)
    const b = monoNowMs()
    expect(b - a).toBeGreaterThanOrEqual(90)
    expect(b - a).toBeLessThan(5000)
    // A process-relative clock (performance.now, Bun.nanoseconds) would read a few ms in a fresh child.
    const dir = temp('cb-native-')
    const script = childScript(dir, 'mono.ts', 'console.log(String(monoNowMs()))')
    const before = monoNowMs()
    const r = Bun.spawnSync(bunArgv(script), { cwd: dir, env: { PATH: '/usr/bin:/bin', HOME: dir }, stdout: 'pipe' })
    const after = monoNowMs()
    const child = Number(r.stdout.toString())
    expect(child).toBeGreaterThanOrEqual(before)
    expect(child).toBeLessThanOrEqual(after)
    expect(Math.abs(after - child)).toBeLessThan(1000)
  }, 15_000)

  test('monoNowMs is the time since boot, sleep included', () => {
    // CLOCK_UPTIME_RAW, or any clock that stops while the Mac sleeps, falls behind the wall-clock time since boot by
    // every sleep since then (days on a laptop); CLOCK_MONOTONIC keeps up with it, give or take clock adjustments.
    const boot = /sec = (\d+)/.exec(Bun.spawnSync(['/usr/sbin/sysctl', '-n', 'kern.boottime']).stdout.toString())
    expect(boot).not.toBeNull()
    const sinceBootMs = Date.now() - Number(boot![1]) * 1000
    expect(Math.abs(monoNowMs() - sinceBootMs)).toBeLessThan(600_000)
  })
})

describe('writeFileDurable', () => {
  test('writeFileDurable replaces atomically and leaves no temp file', () => {
    const dir = temp('cb-native-')
    const p = join(dir, 'lineages.json')
    writeFileDurable(p, '{"v":1}\n')
    const reader = openSync(p, 'r') // holds the first file, as a concurrent reader would
    try {
      writeFileDurable(p, new TextEncoder().encode('{"v":2}\n'))
      expect(readFileSync(p, 'utf8')).toBe('{"v":2}\n')
      // A rename, not an in-place rewrite: the reader still sees the whole old file.
      expect(readFileSync(reader, 'utf8')).toBe('{"v":1}\n')
    } finally { closeSync(reader) }
    expect(readdirSync(dir)).toEqual(['lineages.json'])
    expect(statSync(p).mode & 0o777).toBe(0o600)
  })

  test('the rename is made durable with F_FULLFSYNC on the directory, after the rename, as the file is (Task 63 relay-2-4)', () => {
    const p = join(temp('cb-native-'), 'lineages.json')
    const synced: Array<{ dir: boolean; renamed: boolean }> = []
    // A plain fsync of the directory leaves the rename in the drive's cache (F12), so "the rename itself lasts" would not hold.
    writeFileDurable(p, 'x', 0o600, { fullFsync: (fd) => { synced.push({ dir: fstatSync(fd).isDirectory(), renamed: existsSync(p) }); fullFsync(fd) } })
    expect(synced).toEqual([{ dir: false, renamed: false }, { dir: true, renamed: true }])
    expect(readFileSync(p, 'utf8')).toBe('x')
  })

  test('a volume that cannot fully sync a directory keeps the plain fsync, and the write has succeeded', () => {
    const dir = temp('cb-native-')
    const p = join(dir, 'lineages.json')
    writeFileDurable(p, 'old')
    writeFileDurable(p, 'new', 0o600, { fullFsync: (fd) => { if (fstatSync(fd).isDirectory()) throw new Error('ENOTSUP'); fullFsync(fd) } })
    expect(readFileSync(p, 'utf8')).toBe('new')
    expect(readdirSync(dir)).toEqual(['lineages.json'])
    // A failure on the file itself, before the rename, still throws and leaves the old file.
    expect(() => writeFileDurable(p, 'newer', 0o600, { fullFsync: () => { throw new Error('EIO') } })).toThrow('EIO')
    expect(readFileSync(p, 'utf8')).toBe('new')
    expect(readdirSync(dir)).toEqual(['lineages.json'])
  })

  test('the mode is set whatever the umask, and a missing dir throws and leaves nothing', () => {
    const dir = temp('cb-native-')
    const old = process.umask(0o277)
    try {
      writeFileDurable(join(dir, 'a.json'), 'a')
      writeFileDurable(join(dir, 'b.json'), 'b', 0o644)
    } finally { process.umask(old) }
    expect(statSync(join(dir, 'a.json')).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'b.json')).mode & 0o777).toBe(0o644)
    expect(() => writeFileDurable(join(dir, 'missing', 'c.json'), 'c')).toThrow('ENOENT')
    expect(readdirSync(dir).sort()).toEqual(['a.json', 'b.json'])
  })
})
