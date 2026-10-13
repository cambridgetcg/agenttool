// The installed "Nuance" home that the gate, fetch, mirror, pipe and install tests start from. This file is a fixture and
// is never named *.test.ts (Summon ruling R1). It provides INSTALLED, shares.json naming one share, and the Summon
// allowlist that grants it, plus the recorded git and a repo with a hidden branch. Later tasks import these helpers
// instead of building the INSTALLED literal, the allowlist YAML and the recorded git again in each test file.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type { AllowlistFolder } from '../src/allowlist.ts'
import { hasLazyFetchGuard, parseGitVersion, sha256File, type ResolvedGit } from '../src/nuance/git-resolve.ts'
import { renderInstalled, writeShares, type InstalledInfo } from '../src/nuance/installed.ts'
import { nuancePaths, type NuancePaths } from '../src/paths.ts'
import { temp, testEnv } from './helpers.ts'

/** The Air's Homebrew git: a symlink into the Cellar, which is what the suite's git knob points at too. */
const HOMEBREW_GIT = '/opt/homebrew/bin/git'
/** Fixture git runs with no system or global config and no prompts. */
const FIXTURE_GIT_ENV = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }

let recorded: ResolvedGit | null = null

/**
 * The Air's git standing in for "Nuance's recorded git": the Cellar realpath of /opt/homebrew/bin/git, with its version,
 * sha256 and guard, recorded the way `install check` records a Terminal git (Task 20). It is computed once per test file.
 */
export function recordedGit(): ResolvedGit {
  if (recorded) return recorded
  const path = realpathSync(HOMEBREW_GIT)
  const v = parseGitVersion(Bun.spawnSync([path, '--version'], { env: FIXTURE_GIT_ENV }).stdout.toString())
  if (!v) throw new Error(`recordedGit: ${path} --version printed no git version line`)
  recorded = { path, version: v.version, sha256: sha256File(path), guard: hasLazyFetchGuard(path), apple: v.apple }
  return recorded
}

/** An INSTALLED record: fixed fixture values with `o` laid over them. The git is `o.git` when given, else recordedGit(), so the real git is read only when no git is passed. */
export function testInstalled(o: Partial<InstalledInfo> = {}): InstalledInfo {
  return {
    device: 'nuance', build: 'abcdef01', prepared: '20261013120000', expiry: '20270111', binary_sha256: 'a'.repeat(64),
    tools_seed: 'b'.repeat(64), summon_key_sha256: 'c'.repeat(64), summon_dropin_stat: '1 2 3 0 600',
    claude_version: '2.1.296 (Claude Code)', installed_at: '2026-10-13T12:00:00.000Z',
    ...o,
    git: o.git ?? recordedGit(),
  }
}

/** A Summon allowlist for device nuance in Summon's grammar (Task 17's parser reads it), granting these folders. */
export function allowlistYaml(folders: AllowlistFolder[]): string {
  return [
    'version: 1', 'device: nuance', 'peers: [air]',
    'runtimes:', '  - id: claude', '    models:', '      - model: sonnet',
    'folders:', ...folders.flatMap((f) => [`  - path: ${f.path}`, `    access: ${f.access}`]),
    'limits:', '  max_concurrent: 1', '  starts_per_hour: 6', '  job_timeout_max: 30m', '',
  ].join('\n')
}

/** Yu's Y1 grant: ~/Projects is review-only and ~/Projects/collab-trial is edit (spec §10.1). */
const TRIAL_FOLDERS: AllowlistFolder[] = [{ path: '~/Projects', access: 'review' }, { path: '~/Projects/collab-trial', access: 'edit' }]

export interface InstalledNuanceHome { home: string; env: Record<string, string>; paths: NuancePaths; share: string; installed: InstalledInfo }

/**
 * A temp "Nuance" home with the files `install write` leaves for the fetch gate:
 * - INSTALLED: testInstalled() with `installed` and then `git` laid over it.
 * - shares.json: one entry for `<home>/<share>` and its `.git`.
 * - the Summon allowlist: `folders`, or TRIAL_FOLDERS when none are given.
 * `share` is a path relative to the home. The caller creates the repo there.
 * `env` is testEnv(home) and `paths` is built from that env, so the Summon drop-in and the socket root are inside temp
 * dirs. `env` is also what a fake ssh should hand the gate.
 */
export function installedNuanceHome(o: { share: string; folders?: AllowlistFolder[]; git?: ResolvedGit; installed?: Partial<InstalledInfo> }): InstalledNuanceHome {
  if (isAbsolute(o.share)) throw new Error(`installedNuanceHome: share is relative to the home, not ${o.share}`)
  const home = temp('cb-nuance-')
  const env = testEnv(home)
  const paths = nuancePaths(home, env)
  const share = join(home, o.share)
  const installed = testInstalled({ ...o.installed, ...(o.git ? { git: o.git } : {}) })
  mkdirSync(dirname(paths.installed), { recursive: true, mode: 0o700 })
  writeFileSync(paths.installed, renderInstalled(installed), { mode: 0o600 })
  writeShares(paths, [{ realpath: share, gitdir: join(share, '.git') }])
  mkdirSync(dirname(paths.summonAllowlist), { recursive: true, mode: 0o700 })
  writeFileSync(paths.summonAllowlist, allowlistYaml(o.folders ?? TRIAL_FOLDERS))
  return { home, env, paths, share, installed }
}

/** Runs git with no system or global config and HOME=home. It throws, with git's stderr, on a non-zero exit, and returns stdout trimmed. */
export function fixtureGit(args: string[], home: string): string {
  const r = Bun.spawnSync([HOMEBREW_GIT, ...args], { env: { ...FIXTURE_GIT_ENV, HOME: home }, stdout: 'pipe', stderr: 'pipe' })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`)
  return r.stdout.toString().trim()
}

function commit(repo: string, home: string, file: string, text: string, message: string): string {
  mkdirSync(join(repo, file, '..'), { recursive: true })
  writeFileSync(join(repo, file), text)
  fixtureGit(['-C', repo, 'add', file], home)
  fixtureGit(['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', message], home)
  return fixtureGit(['-C', repo, 'rev-parse', 'HEAD'], home)
}

/**
 * A repo at `dir` with one commit on main and one commit only on refs/heads/secret, checked out at main. K49 needs this:
 * the gate advertises only HEAD, so `secret` is a commit that a client may want but must never get.
 */
export function secretBranchRepo(dir: string, home: string): { head: string; secret: string } {
  mkdirSync(dir, { recursive: true })
  fixtureGit(['init', '-q', '-b', 'main', dir], home)
  const head = commit(dir, home, 'README.md', 'trial\n', 'one')
  fixtureGit(['-C', dir, 'checkout', '-q', '-b', 'secret'], home)
  const secret = commit(dir, home, 'secret.txt', 'hidden\n', 'secret')
  fixtureGit(['-C', dir, 'checkout', '-q', 'main'], home)
  return { head, secret }
}
