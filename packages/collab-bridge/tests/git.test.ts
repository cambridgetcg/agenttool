import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { airGit, airGitEnv, GIT_STDERR_MAX, GIT_STDOUT_MAX, MIRROR_GIT_FLAGS, OID_RE } from '../src/air/git.ts'
import { cleanupTmps, killQuietly, makeRepo, pidGone, REAL_GIT, temp, writeStub } from './helpers.ts'

afterEach(cleanupTmps)

/** Variables bash adds to its own environment, which a bash stub therefore always prints. */
const BASH_OWN = new Set(['PWD', 'SHLVL', '_', 'OLDPWD'])

function envOf(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n').filter(Boolean)) {
    const i = line.indexOf('=')
    const k = line.slice(0, i)
    if (!BASH_OWN.has(k)) out[k] = line.slice(i + 1)
  }
  return out
}

describe('airGit', () => {
  test('runs the given git from / with exactly HOME, PATH, LC_ALL and GIT_TERMINAL_PROMPT', async () => {
    const dir = temp('cb-git-stub-')
    const home = temp('cb-git-home-')
    const git = writeStub(dir, 'git', 'pwd; /usr/bin/env; echo "args: $*"')
    const r = await airGit({ git, home }).run(['-C', '/tmp', 'status'], { env: { GIT_TRACE: '0' } })
    expect(r.code).toBe(0)
    expect(r.timedOut).toBe(false)
    const text = new TextDecoder().decode(r.stdout)
    const [pwd, ...rest] = text.split('\n')
    expect(pwd).toBe('/')
    expect(envOf(rest.filter((l) => !l.startsWith('args: ')).join('\n'))).toEqual({
      HOME: home, PATH: '/opt/homebrew/bin:/usr/bin:/bin', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_TRACE: '0',
    })
    expect(text).toContain('args: -C /tmp status')
    expect(airGitEnv(home)).toEqual({ HOME: home, PATH: '/opt/homebrew/bin:/usr/bin:/bin', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' })
    expect(airGit({ git: REAL_GIT, home }).path).toBe(REAL_GIT)
    expect([...MIRROR_GIT_FLAGS]).toEqual(['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'])
  })

  test('prefix words run before git, and the real git answers', async () => {
    const dir = temp('cb-git-stub-')
    const git = writeStub(dir, 'git', 'echo "X_PREFIX=${X_PREFIX:-unset}"')
    const r = await airGit({ git, home: temp('cb-git-home-') }).run(['version'], { prefix: ['/usr/bin/env', 'X_PREFIX=set'] })
    expect(new TextDecoder().decode(r.stdout).trim()).toBe('X_PREFIX=set')
    const repo = temp('cb-git-repo-')
    const head = makeRepo(repo)
    const real = await airGit({ git: REAL_GIT, home: temp('cb-git-home-') }).run(['-C', repo, 'rev-parse', 'HEAD'])
    expect([real.code, new TextDecoder().decode(real.stdout).trim()]).toEqual([0, head])
    expect(OID_RE.test(head)).toBe(true)
    expect(OID_RE.test(head.toUpperCase())).toBe(false)
    expect(OID_RE.test(head.slice(0, 39))).toBe(false)
    expect(OID_RE.test('a'.repeat(64))).toBe(true)
  })

  test('a call past its timeout is SIGTERMed and reports timedOut with no exit code', async () => {
    const dir = temp('cb-git-stub-')
    const git = writeStub(dir, 'git', 'exec /bin/sleep 5')
    const t0 = Date.now()
    const r = await airGit({ git, home: temp('cb-git-home-') }).run(['fetch'], { timeoutMs: 200 })
    expect(r.timedOut).toBe(true)
    expect(r.code).toBeNull()
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  test('a missing git binary or stdout past 64 MiB is a failed call, never a throw', async () => {
    const missing = await airGit({ git: '/nonexistent/collab-bridge-git', home: temp('cb-git-home-') }).run(['version'])
    expect([missing.code, missing.timedOut]).toEqual([null, false])
    expect(missing.stderr).toContain('could not start /nonexistent/collab-bridge-git')
    const dir = temp('cb-git-stub-')
    const git = writeStub(dir, 'git', `exec /usr/bin/head -c ${GIT_STDOUT_MAX + 1} /dev/zero`)
    const flood = await airGit({ git, home: temp('cb-git-home-') }).run(['cat-file'], { timeoutMs: 20_000 })
    expect([flood.code, flood.stdout.byteLength]).toEqual([null, 0])
    expect(flood.stderr).toContain(`stdout over ${GIT_STDOUT_MAX} bytes`)
  }, 30_000)

  test('records streams NUL-separated records and stops git when the caller stops early', async () => {
    const dir = temp('cb-git-stub-')
    const git = writeStub(dir, 'git', `echo $$ > '${dir}/pid'\nn=0\nwhile :; do printf 'rec %d\\0' "$n"; n=$((n+1)); done`)
    const got: string[] = []
    for await (const rec of airGit({ git, home: temp('cb-git-home-') }).records(['ls-tree'], { timeoutMs: 5000 })) {
      got.push(rec)
      if (got.length === 3) break
    }
    expect(got).toEqual(['rec 0', 'rec 1', 'rec 2'])
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  })

  test('records keeps a record split across reads and throws when git fails after its output', async () => {
    const dir = temp('cb-git-stub-')
    const ok = writeStub(dir, 'git', "printf 'a b\\tnotes/one\\0'; sleep 0.1; printf 'second'; sleep 0.1; printf ' half\\0'")
    const all: string[] = []
    for await (const rec of airGit({ git: ok, home: temp('cb-git-home-') }).records(['x'])) all.push(rec)
    expect(all).toEqual(['a b\tnotes/one', 'second half'])
    const dir2 = temp('cb-git-stub-')
    const bad = writeStub(dir2, 'git', "printf 'one\\0'; echo 'fatal: not a tree' >&2; exit 128")
    const seen: string[] = []
    let error = ''
    try {
      for await (const rec of airGit({ git: bad, home: temp('cb-git-home-') }).records(['ls-tree'])) seen.push(rec)
    } catch (e) {
      error = String(e)
    }
    expect(seen).toEqual(['one'])
    expect(error).toContain('exit 128')
    const dir3 = temp('cb-git-stub-')
    const torn = writeStub(dir3, 'git', "printf 'one\\0two-without-its-NUL'")
    let tornError = ''
    try {
      for await (const _ of airGit({ git: torn, home: temp('cb-git-home-') }).records(['x'])) { /* drain */ }
    } catch (e) {
      tornError = String(e)
    }
    expect(tornError).toContain('unterminated')
  })

  test('run keeps only the first GIT_STDERR_MAX bytes of stderr, drains the rest, and says it truncated', async () => {
    const note = `airGit: stderr truncated after ${GIT_STDERR_MAX} bytes\n`
    const dir = temp('cb-git-stub-')
    // 4 MiB of stderr between a first line and a last line, then exit 128: an undrained pipe would block git until the timeout.
    const flood = writeStub(dir, 'git', "echo 'remote: first line' >&2\n/usr/bin/head -c 4194304 /dev/zero | /usr/bin/tr '\\0' x >&2\necho 'fatal: the real error comes last' >&2\nexit 128")
    const r = await airGit({ git: flood, home: temp('cb-git-home-') }).run(['fetch'], { timeoutMs: 20_000 })
    expect([r.code, r.timedOut]).toEqual([128, false])
    expect(r.stderr.startsWith('remote: first line\n')).toBe(true)
    expect(r.stderr).toContain('stderr truncated')
    expect(r.stderr.endsWith(note)).toBe(true)
    expect(r.stderr).not.toContain('the real error comes last')
    expect(r.stderr.length).toBeLessThanOrEqual(GIT_STDERR_MAX + 1 + note.length)
    // Exactly GIT_STDERR_MAX bytes come back whole; one byte more keeps the first GIT_STDERR_MAX and adds the note.
    const exact = writeStub(temp('cb-git-stub-'), 'git', `/usr/bin/head -c ${GIT_STDERR_MAX} /dev/zero | /usr/bin/tr '\\0' x >&2\nexit 3`)
    const whole = await airGit({ git: exact, home: temp('cb-git-home-') }).run(['x'], { timeoutMs: 20_000 })
    expect(whole.code).toBe(3)
    expect(whole.stderr).toBe('x'.repeat(GIT_STDERR_MAX))
    const over = writeStub(temp('cb-git-stub-'), 'git', `/usr/bin/head -c ${GIT_STDERR_MAX + 1} /dev/zero | /usr/bin/tr '\\0' x >&2\nexit 3`)
    const cut = await airGit({ git: over, home: temp('cb-git-home-') }).run(['x'], { timeoutMs: 20_000 })
    expect(cut.code).toBe(3)
    expect(cut.stderr).toBe(`${'x'.repeat(GIT_STDERR_MAX)}\n${note}`)
  }, 40_000)

  test('records drains a stderr flood, yields its record, and fails with the first stderr line', async () => {
    const dir = temp('cb-git-stub-')
    const flood = writeStub(dir, 'git', "printf 'one\\0'\necho 'remote: first line' >&2\n/usr/bin/head -c 4194304 /dev/zero | /usr/bin/tr '\\0' x >&2\necho 'fatal: the real error comes last' >&2\nexit 128")
    const seen: string[] = []
    let error = ''
    try {
      for await (const rec of airGit({ git: flood, home: temp('cb-git-home-') }).records(['ls-tree'], { timeoutMs: 20_000 })) seen.push(rec)
    } catch (e) {
      error = String(e)
    }
    expect(seen).toEqual(['one'])
    expect(error).toContain('exit 128: remote: first line')
    expect(error).not.toContain('timed out')
  }, 40_000)
  test('a call with ownGroup that times out takes down everything git started, not only git (Task 42 ruling, item 4)', async () => {
    const dir = temp('cb-git-stub-')
    // git's own child (ssh, index-pack) holds no pipe here, so only a signal to the whole group can end it.
    const git = writeStub(dir, 'git', `/bin/sleep 60 >/dev/null 2>&1 &\necho $! > '${dir}/child'\nwait`)
    const r = await airGit({ git, home: temp('cb-git-home-') }).run(['fetch'], { timeoutMs: 300, ownGroup: true })
    const child = Number(readFileSync(join(dir, 'child'), 'utf8'))
    try {
      expect([r.timedOut, r.code]).toEqual([true, null])
      expect(await pidGone(child, 2000)).toBe(true)
    } finally {
      killQuietly(child)
    }
  })

  test('a member of the group that ignores SIGTERM is SIGKILLed after the grace, even once git itself is gone', async () => {
    const dir = temp('cb-git-stub-')
    const git = writeStub(dir, 'git', `(trap '' TERM; exec /bin/sleep 60) >/dev/null 2>&1 &\necho $! > '${dir}/child'\nwait`)
    const r = await airGit({ git, home: temp('cb-git-home-') }).run(['fetch'], { timeoutMs: 300, ownGroup: true })
    const child = Number(readFileSync(join(dir, 'child'), 'utf8'))
    try {
      expect(r.timedOut).toBe(true)
      expect(await pidGone(child, 8000)).toBe(true)
    } finally {
      killQuietly(child)
    }
  }, 20_000)

  test('without ownGroup a timeout still signals only git itself', async () => {
    const dir = temp('cb-git-stub-')
    const git = writeStub(dir, 'git', `/bin/sleep 60 >/dev/null 2>&1 &\necho $! > '${dir}/child'\nwait`)
    const r = await airGit({ git, home: temp('cb-git-home-') }).run(['fetch'], { timeoutMs: 300 })
    const child = Number(readFileSync(join(dir, 'child'), 'utf8'))
    try {
      expect(r.timedOut).toBe(true)
      expect(await pidGone(child, 500)).toBe(false) // the default is unchanged: nothing outside git's own pid is signalled
    } finally {
      killQuietly(child)
    }
  })
})
