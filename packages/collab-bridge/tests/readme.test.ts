// The README's copy-paste blocks, run for real against temp homes (hermetic: the Air's paths are rewritten to a temp home,
// and the pinned git is a recording wrapper around the real one).
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cleanupTmps, makeRepo, PKG, REAL_GIT, repoGit, temp } from './helpers.ts'

afterEach(cleanupTmps)

const README = readFileSync(join(PKG, 'README.md'), 'utf8')

/** The ```sh block after the sentence that opens the mirror removal. */
function mirrorBlock(): string {
  const at = README.indexOf('The mirrors go last')
  const m = at < 0 ? null : /```sh\n([\s\S]*?)```/.exec(README.slice(at))
  if (!m) throw new Error('the README has no mirror-removal block after "The mirrors go last"')
  return m[1]!
}

describe("the README's mirror removal (spec §10.6, Task 63 installer-1-12)", () => {
  test('runs the Air\'s pinned git with the mirror flags from /, never a git found on PATH, and removes the mirrors and bridge refs', () => {
    const home = realpathSync(temp('cb-readme-home-'))
    const clone = join(home, 'Projects', 'collab-trial')
    makeRepo(clone)
    const mirror = join(home, '.local', 'share', 'agenttool', 'collab-shared', 'mirrors', 'nuance', 'macair', '0123456789abcdef')
    mkdirSync(dirname(mirror), { recursive: true })
    repoGit(clone, ['worktree', 'add', '-q', '--detach', mirror, 'HEAD'])
    repoGit(clone, ['worktree', 'lock', '--reason', 'collab-bridge mirror', mirror])
    repoGit(clone, ['update-ref', 'refs/collab/nuance/macair/0123456789abcdef/synced', 'HEAD'])
    mkdirSync(join(home, '.cache', 'agenttool', 'collab-bridge-archive'), { recursive: true })
    // The pinned git, as a wrapper that logs the folder and arguments of every call before running the real one.
    const calls = join(home, 'git-calls.log')
    const pinned = join(home, 'pinned-git')
    writeFileSync(pinned, `#!/bin/bash\nprintf '%s\\t%s\\n' "$(pwd -P)" "$*" >> '${calls}'\nexec '${REAL_GIT}' "$@"\n`, { mode: 0o755 })
    writeFileSync(calls, '')

    const block = mirrorBlock()
    expect(block).not.toMatch(/(^|[\s|(])git\s/m)                     // no bare git anywhere in the block
    const script = block.replaceAll('/Users/yuai', home).replaceAll('/opt/homebrew/bin/git', pinned)
    // Nothing but the system folders on PATH, as on a Terminal that has not put Homebrew first.
    const r = Bun.spawnSync(['/bin/zsh', '-f', '-c', script], { cwd: home, stdout: 'pipe', stderr: 'pipe',
      env: { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' } })
    expect([r.exitCode, r.stderr.toString()]).toEqual([0, ''])

    const log = readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string])
    const verbs = log.map(([, args]) => args.replace(/^-c core\.hooksPath=\/dev\/null -c core\.fsmonitor=false -C \S+ /, '').split(' ').slice(0, 2).join(' '))
    expect(verbs).toEqual(['worktree list', 'worktree unlock', 'worktree remove', 'bundle create', 'for-each-ref --format=delete', 'update-ref --stdin', 'worktree prune'])
    for (const [cwd, args] of log) {
      expect([cwd, args.startsWith(`-c core.hooksPath=/dev/null -c core.fsmonitor=false -C ${clone} `)]).toEqual(['/', true])
    }
    // And it did its job: no mirror, no bridge ref, an archive of the refs.
    expect(existsSync(mirror)).toBe(false)
    expect(repoGit(clone, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree '))).toEqual([`worktree ${clone}`])
    expect(repoGit(clone, ['for-each-ref', 'refs/collab'])).toBe('')
    expect(existsSync(join(home, '.cache', 'agenttool', 'collab-bridge-archive', 'collab-refs.bundle'))).toBe(true)
  })
})
