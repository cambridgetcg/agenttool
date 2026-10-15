import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  gitAcceptable, hasLazyFetchGuard, parseGitVersion, resolveGit, runCmd, sha256File, versionAtLeast, type Run,
} from '../src/nuance/git-resolve.ts'
import { cleanupTmps, temp } from './helpers.ts'

afterEach(cleanupTmps)

const CLT_GIT = '/Library/Developer/CommandLineTools/usr/bin/git'
const APPLE_LINE = 'git version 2.39.5 (Apple Git-154)\n'
const BREW_LINE = 'git version 2.52.0\n'

/** A stand-in Run that records every call and answers from a table; anything unlisted exits 127. */
function stubRun(answer: (cmd: string, args: string[]) => { code: number | null; stdout: string } | undefined) {
  const calls: Array<{ cmd: string; args: string[]; env: Record<string, string> | undefined }> = []
  const run: Run = (cmd, args, o) => {
    calls.push({ cmd, args, env: o?.env })
    const a = answer(cmd, args)
    return a ? { ...a, stderr: '' } : { code: 127, stdout: '', stderr: 'not stubbed' }
  }
  return { run, calls }
}

/** Fake git files: a CLT-like binary with the guard string and a Homebrew-like Cellar binary behind a bin/ symlink. */
function fakeGits(o: { cltGuard?: boolean; brewGuard?: boolean } = {}) {
  const root = temp('cb-git-')
  const clt = join(root, 'CommandLineTools/usr/bin/git')
  const cellar = join(root, 'Cellar/git/2.52.0_1/bin/git')
  const brew = join(root, 'bin/git')
  for (const p of [clt, cellar, brew]) mkdirSync(dirname(p), { recursive: true })
  writeFileSync(clt, `\x7fELF fake clt git ${o.cltGuard === false ? 'GIT_NO_LAZY' : 'GIT_NO_LAZY_FETCH'} tail`)
  writeFileSync(cellar, `\x7fELF fake brew git ${o.brewGuard === false ? '' : 'GIT_NO_LAZY_FETCH'}`)
  symlinkSync(cellar, brew)
  return { root, clt, cellar, brew }
}

describe('versions', () => {
  test('parses Apple and Homebrew version lines', () => {
    expect(parseGitVersion(APPLE_LINE)).toEqual({ version: '2.39.5', apple: true })
    expect(parseGitVersion(BREW_LINE)).toEqual({ version: '2.52.0', apple: false })
    expect(parseGitVersion('git version 2.52.0\nsecond line\n')).toEqual({ version: '2.52.0', apple: false })
    for (const bad of ['', 'git version 2.52', 'hub version 2.52.0', 'git version 2.52.0 (Something)', ' git version 2.52.0x']) {
      expect([bad, parseGitVersion(bad)]).toEqual([bad, null])
    }
    expect(versionAtLeast('2.45.1', '2.45.1')).toBe(true)
    expect(versionAtLeast('2.45.10', '2.45.9')).toBe(true)
    expect(versionAtLeast('2.45.0', '2.45.1')).toBe(false)
    expect(versionAtLeast('3.0.0', '2.45.1')).toBe(true)
    expect(versionAtLeast('x', '2.45.1')).toBe(false)
  })
  test('accepts Homebrew 2.52.0 and Apple 2.39.5 with the guard', () => {
    expect(gitAcceptable({ version: '2.52.0', apple: false, guard: true })).toBe(true)
    expect(gitAcceptable({ version: '2.52.0', apple: false, guard: false })).toBe(true)   // ≥ 2.45.1 sets the default itself (K52)
    expect(gitAcceptable({ version: '2.45.1', apple: false, guard: false })).toBe(true)
    expect(gitAcceptable({ version: '2.39.5', apple: true, guard: true })).toBe(true)
    expect(gitAcceptable({ version: '2.44.0', apple: true, guard: true })).toBe(true)
  })
  test('refuses Apple 2.39.5 without the guard and 2.44.0', () => {
    expect(gitAcceptable({ version: '2.39.5', apple: true, guard: false })).toBe(false)
    expect(gitAcceptable({ version: '2.44.0', apple: false, guard: true })).toBe(false)
    expect(gitAcceptable({ version: '2.45.0', apple: false, guard: true })).toBe(false)
    expect(gitAcceptable({ version: '2.39.4', apple: true, guard: true })).toBe(false)
  })
})

describe('resolveGit', () => {
  test('resolves through xcrun with a fresh env, and through the Terminal git otherwise', () => {
    const g = fakeGits()
    const home = temp('cb-home-')
    const saved = process.env.DEVELOPER_DIR
    process.env.DEVELOPER_DIR = '/nonexistent'            // a bad DEVELOPER_DIR in our own env must never reach xcrun
    try {
      const viaXcrun = stubRun((cmd, args) => {
        if (cmd === '/usr/bin/xcrun' && args.join(' ') === '--find git') return { code: 0, stdout: g.clt + '\n' }
        if (cmd === g.clt && args.join(' ') === '--version') return { code: 0, stdout: APPLE_LINE }
        return undefined
      })
      const r = resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: g.brew, home, run: viaXcrun.run })
      expect(r).toEqual({ ok: true, git: { path: g.clt, version: '2.39.5', sha256: sha256File(g.clt), guard: true, apple: true } })
      for (const c of viaXcrun.calls) expect(c.env).toEqual({ PATH: '/usr/bin:/bin', HOME: home })
      expect(viaXcrun.calls.map((c) => c.cmd)).toEqual(['/usr/bin/xcrun', g.clt])

      const xcrunFails = stubRun((cmd, args) => {
        if (cmd === '/usr/bin/xcrun') return { code: 1, stdout: '' }
        if (cmd === g.cellar && args.join(' ') === '--version') return { code: 0, stdout: BREW_LINE }
        return undefined
      })
      const t = resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: g.brew, home, run: xcrunFails.run })
      // The Terminal git is recorded by its realpath: for Homebrew, the Cellar binary, never the bin/ symlink.
      expect(t).toEqual({ ok: true, git: { path: g.cellar, version: '2.52.0', sha256: sha256File(g.cellar), guard: true, apple: false } })
      for (const c of xcrunFails.calls) expect(c.env).toEqual({ PATH: '/usr/bin:/bin', HOME: home })
    } finally {
      if (saved === undefined) delete process.env.DEVELOPER_DIR
      else process.env.DEVELOPER_DIR = saved
    }
  })
  const OLD_CLT_LINE = 'git version 2.39.3 (Apple Git-146)\n'      // older Command Line Tools: below 2.39.5, whatever its binary holds

  test('an xcrun git that is not acceptable does not shadow an acceptable Terminal git (Task 63 gate-2-2)', () => {
    const g = fakeGits()
    const home = temp('cb-home-')
    const run = stubRun((cmd, args) => {
      if (cmd === '/usr/bin/xcrun') return { code: 0, stdout: g.clt + '\n' }
      if (cmd === g.clt && args.join(' ') === '--version') return { code: 0, stdout: OLD_CLT_LINE }
      if (cmd === g.cellar && args.join(' ') === '--version') return { code: 0, stdout: BREW_LINE }
      return undefined
    })
    const r = resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: g.brew, home, run: run.run })
    expect(r).toEqual({ ok: true, git: { path: g.cellar, version: '2.52.0', sha256: sha256File(g.cellar), guard: true, apple: false } })
    if (r.ok) expect(gitAcceptable(r.git)).toBe(true)
    for (const c of run.calls) expect(c.env).toEqual({ PATH: '/usr/bin:/bin', HOME: home })
  })

  test('an acceptable xcrun git is used without asking the Terminal git anything (Task 63 gate-2-2)', () => {
    const g = fakeGits()
    const run = stubRun((cmd, args) => {
      if (cmd === '/usr/bin/xcrun') return { code: 0, stdout: g.clt + '\n' }
      if (cmd === g.clt && args.join(' ') === '--version') return { code: 0, stdout: APPLE_LINE }
      return undefined
    })
    expect(resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: g.brew, home: temp('cb-home-'), run: run.run })).toMatchObject({ ok: true, git: { path: g.clt } })
    expect(run.calls.map((c) => c.cmd)).toEqual(['/usr/bin/xcrun', g.clt])
  })

  test('when neither git is acceptable the xcrun one is still returned, with the other named, so the install can say why (Task 63 gate-2-2)', () => {
    const g = fakeGits()
    const both = stubRun((cmd, args) => {
      if (cmd === '/usr/bin/xcrun') return { code: 0, stdout: g.clt + '\n' }
      if (cmd === g.clt && args.join(' ') === '--version') return { code: 0, stdout: OLD_CLT_LINE }
      if (cmd === g.cellar && args.join(' ') === '--version') return { code: 0, stdout: 'git version 2.44.0\n' }
      return undefined
    })
    const r = resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: g.brew, home: temp('cb-home-'), run: both.run })
    expect(r).toMatchObject({ ok: true, git: { path: g.clt, version: '2.39.3' }, alternatives: [{ path: g.cellar, version: '2.44.0' }] })
    if (r.ok) expect(gitAcceptable(r.git)).toBe(false)
    // With no Terminal git at all, the old answer is unchanged: just the xcrun git, nothing else claimed.
    const alone = resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: null, home: temp('cb-home-'), run: both.run })
    expect(alone).toEqual({ ok: true, git: expect.objectContaining({ path: g.clt, version: '2.39.3' }) })
  })

  test('never records /usr/bin/git, even when xcrun fails', () => {
    const home = temp('cb-home-')
    const link = join(temp('cb-git-'), 'git')
    symlinkSync('/usr/bin/git', link)
    const shim = stubRun((cmd) => (cmd === '/usr/bin/xcrun' ? { code: 0, stdout: '/usr/bin/git\n' } : undefined))
    const a = resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: '/usr/bin/git', home, run: shim.run })
    expect(a.ok).toBe(false)
    const failing = stubRun((cmd) => (cmd === '/usr/bin/xcrun' ? { code: 1, stdout: '' } : undefined))
    for (const terminalGit of ['/usr/bin/git', link, null, 'git']) {
      const r = resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit, home, run: failing.run })
      expect([terminalGit, r.ok]).toEqual([terminalGit, false])
      if (!r.ok) expect(r.reason).toStartWith('git not resolved (xcrun: ')
    }
    // The shim is never even asked for its version: on a Mac without the Command Line Tools it opens an install dialog.
    expect([...shim.calls, ...failing.calls].map((c) => c.cmd).filter((c) => c !== '/usr/bin/xcrun')).toEqual([])
  })
  test('a git that does not answer its version is not recorded', () => {
    const g = fakeGits()
    const silent = stubRun((cmd) => (cmd === '/usr/bin/xcrun' ? { code: 0, stdout: g.clt + '\n' } : { code: 0, stdout: 'hello\n' }))
    expect(resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: null, home: temp('cb-home-'), run: silent.run }).ok).toBe(false)
  })
  const CLT_ABSENT = !existsSync(CLT_GIT)
  if (CLT_ABSENT) console.warn(`skip: ${CLT_GIT} is absent on this Mac, so the real-binary guard test does not run`)
  test.skipIf(CLT_ABSENT)('the guard is found in the real CLT binary', () => {
    expect(hasLazyFetchGuard(CLT_GIT)).toBe(true)
    expect(hasLazyFetchGuard('/usr/bin/git')).toBe(false)   // the xcrun shim carries no guard (K43)
    const r = resolveGit({ xcrun: '/usr/bin/xcrun', terminalGit: null, home: temp('cb-home-') })
    expect(r).toMatchObject({ ok: true, git: { path: CLT_GIT, apple: true, guard: true } })
    if (r.ok) expect(gitAcceptable(r.git)).toBe(true)
  })
})

describe('helpers', () => {
  test('sha256File and hasLazyFetchGuard read the bytes', () => {
    const g = fakeGits({ brewGuard: false, cltGuard: false })
    expect(sha256File(g.clt)).toBe(createHash('sha256').update(`\x7fELF fake clt git GIT_NO_LAZY tail`).digest('hex'))
    expect(hasLazyFetchGuard(g.clt)).toBe(false)
    expect(hasLazyFetchGuard(g.cellar)).toBe(false)
    expect(hasLazyFetchGuard(join(g.root, 'missing'))).toBe(false)
    expect(hasLazyFetchGuard(fakeGits().clt)).toBe(true)
  })
  test('runCmd builds its env and never inherits one', () => {
    expect(runCmd('/usr/bin/env', [])).toEqual({ code: 0, stdout: 'PATH=/usr/bin:/bin\n', stderr: '' })
    expect(runCmd('/usr/bin/env', [], { env: { A: '1', PATH: '/usr/bin:/bin' } }).stdout).toBe('A=1\nPATH=/usr/bin:/bin\n')
    expect(runCmd('/bin/cat', [], { input: 'hi\n' }).stdout).toBe('hi\n')
    expect(runCmd('/bin/pwd', []).stdout).toBe('/\n')
    expect(runCmd('/bin/sleep', ['5'], { timeoutMs: 200 }).code).toBeNull()
    expect(runCmd('/no/such/binary', []).code).toBeNull()
  })
})
