// Builds the pinned hub bundle (spec §10.2 step 3, §10.4 build check, P32):
//   bun --no-env-file --config=/dev/null scripts/build-hub.ts [--out <absolute dir>]   (default: dist/hub)
// One file, hub.js, bundled from bin/collab-bridge.ts with `target: 'bun'`, with the commit it was built from and the
// sha256 of both tracked Collab dist files embedded as __COLLAB_BRIDGE_BUILD__, which the hub compares with the installed
// Collab at every start (collab_build_mismatch) and while it runs (collab_build_changed). It refuses a dirty tree, so the
// bundle is a commit's bytes, and an installed Collab dist that differs from the tracked one, because a hub built against
// another Collab would only refuse to start. "Dirty" is not what a plain `git status` shows: the user's and the system's git
// config are not read, untracked files are listed whatever status.showUntrackedFiles says, a file hidden from git with
// skip-worktree or assume-unchanged is dirty, and so is an ignored file among the bridge's own sources (a module the bundle
// could take that no commit holds). The bundle carries no Collab code, and the build checks it: every module in it is the
// bridge's own bin/ or src/, or the build refuses (P32): the hub runs the installed Collab bins.
// The bundler names every module by its path relative to the process cwd, so the build runs with its cwd at the package
// root: the bytes then depend only on the commit, never on where the build was started (and a cwd bunfig.toml is not
// read: the script runs with --config=/dev/null, P15, F5). Ai copies the result to
// ~/.local/share/collab-bridge/air/<sha256>/hub.js (Task 66), where it never changes again.
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { distMatches, type BuildInfo } from '../src/air/hub.ts'
import { sha256File } from '../src/nuance/git-resolve.ts'
import { collabDist, homeOf } from '../src/paths.ts'
import { systemBin } from '../src/sysbin.ts'

export interface HubBuildResult { hubJs: string; sha256: string; info: BuildInfo }

/** The two tracked Collab dist files the hub's children and host CLI run (spec §10.4). */
export const COLLAB_DIST_FILES = { mcp: 'agenttool-collab-mcp.js', host: 'agenttool-collab-host.js' } as const
const HEX40 = /^[0-9a-f]{40}$/

/**
 * Read-only git on the tree: cwd `/`, a built env (P14), no optional index locks, no fsmonitor, and neither the system's nor
 * the user's git config (a global status.showUntrackedFiles or core.excludesFile must not decide what counts as clean).
 */
function git(repo: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(systemBin('git'), ['-C', repo, '-c', 'core.fsmonitor=false', ...args], {
    cwd: '/', env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: homeOf(), LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
  return { ok: r.status === 0, out: r.stdout ?? '' }
}

/** The folders whose every file the bundle may take: an ignored file there is code that no commit holds. */
const BRIDGE_SOURCES = ['packages/collab-bridge/bin/', 'packages/collab-bridge/src/']
/** What the build reads from the tree besides the bridge: both tracked Collab dist files (their sha256s go into the build info). */
const BUILT_FROM = ['packages/collab-bridge', 'packages/collab/dist']

/**
 * The tree is exactly HEAD's bytes for everything the build reads: `git status` lists nothing modified, staged or
 * untracked (all of them, whatever status.showUntrackedFiles says), nothing ignored among the bridge's bin/ and src/ (a
 * Finder .DS_Store aside; ignored files elsewhere, such as dist/, do not count), and no tracked file the build reads is
 * hidden from status with skip-worktree or assume-unchanged (every `ls-files -v` tag is `H`).
 */
export function treeClean(repo: string): boolean {
  const status = git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none', '--ignored'])
  if (!status.ok) return false
  for (const entry of status.out.split('\0')) {
    if (entry === '') continue
    if (!entry.startsWith('!! ')) return false // modified, staged, untracked, renamed
    const path = entry.slice(3)
    if (BRIDGE_SOURCES.some((d) => path.startsWith(d) || d.startsWith(path)) && basename(path) !== '.DS_Store') return false
  }
  const tracked = git(repo, ['ls-files', '-v', '-z', '--', ...BUILT_FROM])
  return tracked.ok && tracked.out.split('\0').every((e) => e === '' || e.startsWith('H '))
}

/** The modules a bundle was made of, from the `// <path>` line the bundler writes above each one. */
export function bundledModules(text: string): string[] {
  return text.split('\n').filter((l) => /^\/\/ \S+\.(?:ts|tsx|js|jsx|mjs|cjs|json|node)$/.test(l)).map((l) => l.slice(3))
}

/** The commit HEAD names in `repo`, or null when git cannot say. */
export function headCommit(repo: string): string | null {
  const r = git(repo, ['rev-parse', '--verify', 'HEAD^{commit}'])
  const oid = r.out.trim()
  return r.ok && HEX40.test(oid) ? oid : null
}

export async function buildHub(o: { repo: string; outDir: string; installedDist: string }): Promise<HubBuildResult> {
  for (const p of [o.repo, o.outDir, o.installedDist]) if (!isAbsolute(p)) throw new Error(`buildHub: not an absolute path: ${p}`)
  if (!treeClean(o.repo)) {
    throw new Error(`buildHub: ${o.repo} has uncommitted or untracked changes; commit them first, so the hub bundle is a commit's bytes`)
  }
  const commit = git(o.repo, ['rev-parse', '--verify', 'HEAD^{commit}']).out.trim()
  const collabCommit = git(o.repo, ['log', '-1', '--format=%H', '--', 'packages/collab/dist']).out.trim()
  if (!HEX40.test(commit) || !HEX40.test(collabCommit)) throw new Error(`buildHub: cannot read HEAD and the last commit of packages/collab/dist in ${o.repo}`)
  const tracked = join(o.repo, 'packages', 'collab', 'dist')
  const info: BuildInfo = {
    commit,
    collab_commit: collabCommit,
    mcp_sha256: sha256File(join(tracked, COLLAB_DIST_FILES.mcp)),
    host_sha256: sha256File(join(tracked, COLLAB_DIST_FILES.host)),
    hub_build: commit.slice(0, 8),
  }
  let same = false
  try { same = distMatches(o.installedDist, info) } catch { same = false }
  if (!same) {
    throw new Error(`buildHub: the installed Collab dist at ${o.installedDist} differs from the tracked one; build from the commit the installed Collab was built from (spec §10.4)`)
  }
  const pkgRoot = join(o.repo, 'packages', 'collab-bridge')
  const before = process.cwd()
  process.chdir(pkgRoot)
  let text: string
  try {
    const r = await Bun.build({
      entrypoints: [join(pkgRoot, 'bin', 'collab-bridge.ts')],
      target: 'bun',
      define: { __COLLAB_BRIDGE_BUILD__: JSON.stringify(info) },
    })
    if (!r.success || r.outputs.length !== 1) throw new Error(`buildHub: the bundle failed: ${r.logs.map((l) => String(l)).join('; ').slice(0, 500)}`)
    text = await r.outputs[0]!.text()
  } finally {
    process.chdir(before)
  }
  // The hub imports no Collab code (P32): every module is the bridge's own, named relative to the package root it was built from.
  const modules = bundledModules(text)
  const foreign = modules.filter((m) => !/^(bin|src)\//.test(m))
  if (modules.length === 0) throw new Error("buildHub: the bundle lists no modules, so it cannot be checked to carry only the bridge's own code")
  if (foreign.length > 0) throw new Error(`buildHub: the bundle carries code from outside the bridge's own bin/ and src/ (${foreign.slice(0, 3).join(', ')}); the hub runs the installed Collab bins and bundles none of their code`)
  mkdirSync(o.outDir, { recursive: true, mode: 0o700 })
  chmodSync(o.outDir, 0o700)
  const hubJs = join(o.outDir, 'hub.js')
  const partial = join(o.outDir, `.hub.js.partial-${randomBytes(6).toString('hex')}`)
  try {
    writeFileSync(partial, text, { mode: 0o600, flag: 'wx' })
    renameSync(partial, hubJs)
  } finally {
    rmSync(partial, { force: true })
  }
  return { hubJs, sha256: createHash('sha256').update(text).digest('hex'), info }
}

async function main(argv: string[]): Promise<number> {
  let out = join(import.meta.dir, '..', 'dist', 'hub')
  if (argv.length === 2 && argv[0] === '--out' && isAbsolute(argv[1]!)) out = argv[1]!
  else if (argv.length !== 0) {
    process.stderr.write('usage: build-hub.ts [--out <absolute dir>]\n')
    return 2
  }
  try {
    // The tree is the worktree that holds this script; the installed Collab is the one the hub's children will run.
    const r = await buildHub({ repo: resolve(import.meta.dir, '..', '..', '..'), outDir: out, installedDist: collabDist(process.env) })
    process.stdout.write(`${JSON.stringify(r)}\n`)
    return 0
  } catch (e) {
    process.stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`)
    return 1
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
