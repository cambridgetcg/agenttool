import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupTmps, makeRepo, repoGit, temp, writeStub } from './helpers.ts'
import { systemBin } from '../src/sysbin.ts'
import { declaredState } from '../src/nuance/gitstate.ts'

afterEach(cleanupTmps)

// The preload's COLLAB_BRIDGE_BIN_GIT: the real /opt/homebrew/bin/git, run on temp repos only.
const GIT = systemBin('git')

/** A repo with one commit on main (the trial shape: README.md and notes/.gitkeep), and a HOME with no git config. */
function trialRepo(): { repo: string; home: string; head: string } {
  const repo = temp('cb-gs-repo-')
  return { repo, home: temp('cb-gs-home-'), head: makeRepo(repo) }
}

describe('declared git state', () => {
  test('a clean tree', () => {
    const { repo, home, head } = trialRepo()
    expect(declaredState(repo, GIT, home)).toEqual({ head, branch: 'main', dirty: false })
  }, 10_000)

  test('an untracked file is dirty', () => {
    const { repo, home, head } = trialRepo()
    mkdirSync(join(repo, 'drafts'))
    writeFileSync(join(repo, 'drafts', 'a.md'), 'draft\n') // in a new dir: only --untracked-files=all names it
    expect(declaredState(repo, GIT, home)).toEqual({ head, branch: 'main', dirty: true })
  }, 10_000)

  test('a modified tracked file is dirty', () => {
    const { repo, home, head } = trialRepo()
    writeFileSync(join(repo, 'README.md'), 'trial, edited\n')
    expect(declaredState(repo, GIT, home)).toEqual({ head, branch: 'main', dirty: true })
  }, 10_000)

  test('a detached HEAD has branch null', () => {
    const { repo, home, head } = trialRepo()
    repoGit(repo, ['checkout', '-q', '--detach'])
    expect(declaredState(repo, GIT, home)).toEqual({ head, branch: null, dirty: false })
  }, 10_000)

  test('the index is not rewritten', () => {
    const { repo, home } = trialRepo()
    const index = join(repo, '.git', 'index')
    const past = Date.now() / 1000 - 3600
    // README's stat no longer matches its index entry, so a plain `git status` would refresh and rewrite the index.
    utimesSync(index, past, past)
    utimesSync(join(repo, 'README.md'), Date.now() / 1000, Date.now() / 1000)
    const before = statSync(index).mtimeMs
    expect(declaredState(repo, GIT, home)).toMatchObject({ dirty: false })
    expect(statSync(index).mtimeMs).toBe(before)
    // The control: the same status without GIT_OPTIONAL_LOCKS=0 does rewrite it, so the check above can fail.
    repoGit(repo, ['status', '--porcelain=v1'])
    expect(statSync(index).mtimeMs).not.toBe(before)
  }, 10_000)

  test('not a repo is an error', () => {
    const home = temp('cb-gs-home-')
    expect(declaredState(temp('cb-gs-plain-'), GIT, home)).toEqual({ error: 'git rev-parse HEAD failed (exit 128)' })
    const unborn = temp('cb-gs-unborn-')
    repoGit(unborn, ['init', '-q', '-b', 'main']) // no commit: HEAD names nothing yet
    expect(declaredState(unborn, GIT, home)).toEqual({ error: 'git rev-parse HEAD failed (exit 128)' })
    expect(declaredState(join(home, 'missing'), GIT, home)).toEqual({ error: 'git rev-parse HEAD failed (exit 128)' })
  }, 10_000)

  test('/usr/bin/git, the xcrun shim, is never run', () => {
    const { repo, home } = trialRepo()
    expect(declaredState(repo, '/usr/bin/git', home)).toEqual({ error: 'refusing /usr/bin/git, the xcrun shim; run the git INSTALLED records' })
  }, 10_000)

  test('the env reaching git has GIT_OPTIONAL_LOCKS=0 and no inherited key', () => {
    const stubs = temp('cb-gs-stub-')
    const dump = join(stubs, 'env.txt')
    const argv = join(stubs, 'argv.txt')
    const fake = writeStub(stubs, 'git', [
      `env >> '${dump}'`,
      `echo "$*" >> '${argv}'`,
      'case " $* " in',
      '  *" rev-parse "*) echo 0123456789abcdef0123456789abcdef01234567 ;;',
      '  *" symbolic-ref "*) echo main ;;',
      'esac',
      'exit 0',
    ].join('\n'))
    const home = temp('cb-gs-home-')
    const canaries = { GIT_DIR: '/nonexistent/canary', BUN_OPTIONS: '--preload /nonexistent/canary.ts', CB_CANARY: '1' }
    Object.assign(process.env, canaries)
    try {
      expect(declaredState('/some/folder', fake, home)).toEqual({ head: '0123456789abcdef0123456789abcdef01234567', branch: 'main', dirty: false })
    } finally {
      for (const k of Object.keys(canaries)) delete process.env[k]
    }
    expect(readFileSync(argv, 'utf8').split('\n').filter(Boolean)).toEqual([
      '-C /some/folder -c core.fsmonitor=false rev-parse HEAD',
      '-C /some/folder -c core.fsmonitor=false symbolic-ref -q --short HEAD',
      '-C /some/folder -c core.fsmonitor=false status --porcelain=v1 --untracked-files=all',
    ])
    // bash itself adds PWD, SHLVL and _; everything else is exactly what declaredState built, three times.
    const seen = readFileSync(dump, 'utf8').split('\n').filter(Boolean).filter((l) => !/^(PWD|SHLVL|_)=/.test(l))
    const expected = [`HOME=${home}`, 'PATH=/usr/bin:/bin', 'LC_ALL=C', 'GIT_CONFIG_NOSYSTEM=1', 'GIT_CONFIG_GLOBAL=/dev/null',
      'GIT_NO_LAZY_FETCH=1', 'GIT_TERMINAL_PROMPT=0', 'GIT_OPTIONAL_LOCKS=0'].sort()
    expect(seen.length).toBe(expected.length * 3)
    expect([...new Set(seen)].sort()).toEqual(expected)
  }, 10_000)
})
