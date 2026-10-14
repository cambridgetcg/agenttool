// The pinned hub bundle (spec §10.2 step 3, §10.4 build check, P15, P32). Every build runs from a temp git repo that holds
// copies of packages/collab-bridge (without dist/) and of the tracked packages/collab/dist, committed in two commits, so
// the dirty-tree and dist checks can be exercised without touching the worktree.
import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { buildHub, treeClean } from '../scripts/build-hub.ts'
import { cleanupTmps, COLLAB_DIST, modeOf, PKG, repoGit, sha256File, temp, testEnv } from './helpers.ts'

afterEach(cleanupTmps)

const DIST = ['agenttool-collab-mcp.js', 'agenttool-collab-host.js'] as const
const BUN_RUN = [process.execPath, '--no-env-file', '--config=/dev/null']

interface Repo { repo: string; dist: string; head: string; distCommit: string }

/** Commit 1 holds the Collab dist, commit 2 the bridge package: so `collab_commit` and `commit` differ, as on the branch. */
function hubRepo(): Repo {
  const repo = temp('cb-hubrepo-')
  repoGit(repo, ['init', '-q', '-b', 'main'])
  const dist = join(repo, 'packages', 'collab', 'dist')
  mkdirSync(dist, { recursive: true })
  for (const f of DIST) copyFileSync(join(COLLAB_DIST, f), join(dist, f))
  const commit = (paths: string, message: string) => {
    repoGit(repo, ['add', paths])
    repoGit(repo, ['-c', 'user.name=Ai', '-c', 'user.email=ai@collab-bridge.invalid', 'commit', '-q', '-m', message])
    return repoGit(repo, ['rev-parse', 'HEAD'])
  }
  const distCommit = commit('packages/collab/dist', 'collab dist')
  cpSync(PKG, join(repo, 'packages', 'collab-bridge'), {
    recursive: true,
    filter: (src) => !['dist', 'node_modules'].includes(relative(PKG, src).split('/')[0]!),
  })
  const head = commit('packages/collab-bridge', 'collab-bridge')
  return { repo, dist, head, distCommit }
}

describe('build-hub', () => {
  test('refuses a dirty tree', async () => {
    const r = hubRepo()
    const out = join(temp('cb-hubout-'), 'hub')
    expect(treeClean(r.repo)).toBe(true)
    expect(treeClean(temp('cb-notarepo-'))).toBe(false)
    const stray = join(r.repo, 'packages', 'collab-bridge', 'src', 'stray.ts')
    writeFileSync(stray, 'export const stray = 1\n')
    expect(treeClean(r.repo)).toBe(false)
    await expect(buildHub({ repo: r.repo, outDir: out, installedDist: r.dist })).rejects.toThrow('uncommitted or untracked changes')
    rmSync(stray)
    appendFileSync(join(r.repo, 'packages', 'collab-bridge', 'bin', 'collab-bridge.ts'), '\n')
    expect(treeClean(r.repo)).toBe(false)
    await expect(buildHub({ repo: r.repo, outDir: out, installedDist: r.dist })).rejects.toThrow('uncommitted or untracked changes')
    expect(existsSync(out)).toBe(false)
  })

  test('refuses when the installed dist differs from the tracked one', async () => {
    const r = hubRepo()
    const out = join(temp('cb-hubout-'), 'hub')
    const installed = temp('cb-installed-dist-')
    for (const f of DIST) copyFileSync(join(r.dist, f), join(installed, f))
    appendFileSync(join(installed, 'agenttool-collab-host.js'), '\n// another build\n')
    await expect(buildHub({ repo: r.repo, outDir: out, installedDist: installed })).rejects.toThrow('differs from the tracked one')
    await expect(buildHub({ repo: r.repo, outDir: out, installedDist: temp('cb-empty-dist-') })).rejects.toThrow('differs from the tracked one')
    expect(existsSync(out)).toBe(false)
  })

  test('embeds the build info, which version prints', async () => {
    const r = hubRepo()
    const out = join(temp('cb-hubout-'), 'hub')
    const built = await buildHub({ repo: r.repo, outDir: out, installedDist: r.dist })
    expect(built.info).toEqual({
      commit: r.head, collab_commit: r.distCommit,
      mcp_sha256: sha256File(join(r.dist, 'agenttool-collab-mcp.js')), host_sha256: sha256File(join(r.dist, 'agenttool-collab-host.js')),
      hub_build: r.head.slice(0, 8),
    })
    expect(built.hubJs).toBe(join(out, 'hub.js'))
    expect(built.sha256).toBe(sha256File(built.hubJs))
    expect(modeOf(out)).toBe(0o700)
    expect(modeOf(built.hubJs)).toBe(0o600)
    const v = Bun.spawnSync([...BUN_RUN, built.hubJs, 'version'], { cwd: '/', env: testEnv(temp('cb-hubhome-')) })
    expect(v.stderr.toString()).toBe('')
    expect(v.exitCode).toBe(0)
    const printed = v.stdout.toString().split('\n').filter(Boolean)
    expect(printed).toHaveLength(1)
    expect(JSON.parse(printed[0]!)).toEqual(built.info)
  }, 30_000)

  test('a bunfig.toml with [define] in the build\'s cwd changes nothing', async () => {
    const r = hubRepo()
    const planted = temp('cb-planted-')
    const marker = join(planted, 'PRELOADED')
    writeFileSync(join(planted, 'planted.ts'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')\n`)
    writeFileSync(join(planted, 'bunfig.toml'), [
      'preload = ["./planted.ts"]', '[define]',
      '"__COLLAB_BRIDGE_BUILD__" = "{\\"commit\\":\\"planted-define\\"}"', '"process.env.NODE_ENV" = "\\"planted-define\\""', '',
    ].join('\n'))
    // Control: a plain `bun build` started there inlines the planted define, so the plant is real (F5).
    writeFileSync(join(planted, 'probe.ts'), 'declare const __COLLAB_BRIDGE_BUILD__: unknown\nconsole.log(typeof __COLLAB_BRIDGE_BUILD__ !== "undefined" ? __COLLAB_BRIDGE_BUILD__ : null)\n')
    const control = Bun.spawnSync([process.execPath, 'build', '--target=bun', 'probe.ts'], { cwd: planted, env: { PATH: '/usr/bin:/bin', HOME: planted } })
    expect(control.stdout.toString()).toContain('planted-define')
    const script = join(r.repo, 'packages', 'collab-bridge', 'scripts', 'build-hub.ts')
    const env = testEnv(temp('cb-hubhome-'), { COLLAB_BRIDGE_COLLAB_DIST: r.dist })
    const outs = [join(temp('cb-hubout-'), 'a'), join(temp('cb-hubout-'), 'b')]
    const fromPlanted = Bun.spawnSync([...BUN_RUN, script, '--out', outs[0]!], { cwd: planted, env })
    const fromRoot = Bun.spawnSync([...BUN_RUN, script, '--out', outs[1]!], { cwd: '/', env })
    for (const run of [fromPlanted, fromRoot]) {
      expect(run.stderr.toString()).toBe('')
      expect(run.exitCode).toBe(0)
    }
    const a = JSON.parse(fromPlanted.stdout.toString())
    expect(a.info.commit).toBe(r.head)
    expect(a.hubJs).toBe(join(outs[0]!, 'hub.js'))
    expect(sha256File(join(outs[0]!, 'hub.js'))).toBe(sha256File(join(outs[1]!, 'hub.js')))
    expect(readFileSync(join(outs[0]!, 'hub.js'), 'utf8')).not.toContain('planted-define')
    expect(existsSync(marker)).toBe(false)
  }, 60_000)

  test('the bundle contains no Collab code', async () => {
    const r = hubRepo()
    const built = await buildHub({ repo: r.repo, outDir: join(temp('cb-hubout-'), 'hub'), installedDist: r.dist })
    const text = readFileSync(built.hubJs, 'utf8')
    for (const s of ['CollabStore', 'buildCollabMcpServer', '@modelcontextprotocol', 'bun:sqlite']) {
      expect({ s, found: text.includes(s) }).toEqual({ s, found: false })
    }
    // Every bundled module is the bridge's own (the bundler names each one relative to the package root it builds from).
    const modules = text.split('\n').filter((l) => /^\/\/ \S+\.ts$/.test(l)).map((l) => l.slice(3))
    expect(modules.length).toBeGreaterThan(0)
    expect(modules.filter((m) => !/^(bin|src)\//.test(m))).toEqual([])
    // The hub reaches Collab only by running the installed bins.
    expect(text).toContain('agenttool-collab-mcp.js')
  }, 30_000)

  test('two builds of one commit are byte-identical', async () => {
    const r = hubRepo()
    const one = await buildHub({ repo: r.repo, outDir: join(temp('cb-hubout-'), 'one'), installedDist: r.dist })
    const two = await buildHub({ repo: r.repo, outDir: join(temp('cb-hubout-'), 'two'), installedDist: r.dist })
    expect(two.sha256).toBe(one.sha256)
    expect(readFileSync(two.hubJs).equals(readFileSync(one.hubJs))).toBe(true)
    expect(two.info).toEqual(one.info)
  }, 30_000)
})
