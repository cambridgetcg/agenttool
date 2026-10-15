// The pinned hub bundle (spec §10.2 step 3, §10.4 build check, P15, P32). Every build runs from a temp git repo that holds
// copies of packages/collab-bridge (without dist/) and of the tracked packages/collab/dist, committed in two commits, so
// the dirty-tree and dist checks can be exercised without touching the worktree.
import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homeOf } from '../src/paths.ts'
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

  // Task 63 launcher-1-3, conformance-1-4: "the bundle is a commit's bytes" must not rest on what `git status` happens to show.
  describe('a tree that git status does not show all of is not a clean tree', () => {
    const refused = async (r: Repo, why: string) => {
      const out = join(temp('cb-hubout-'), 'hub')
      expect([why, treeClean(r.repo)]).toEqual([why, false])
      await expect(buildHub({ repo: r.repo, outDir: out, installedDist: r.dist })).rejects.toThrow('uncommitted or untracked changes')
      expect([why, existsSync(out)]).toEqual([why, false])
    }
    const pkg = (r: Repo, ...rel: string[]) => join(r.repo, 'packages', 'collab-bridge', ...rel)
    const POLICY = 'packages/collab-bridge/src/air/policy-table.ts'

    test('an edited tracked file marked skip-worktree or assume-unchanged', async () => {
      for (const flag of ['--skip-worktree', '--assume-unchanged']) {
        const r = hubRepo()
        repoGit(r.repo, ['update-index', flag, POLICY])
        appendFileSync(pkg(r, 'src', 'air', 'policy-table.ts'), '\nexport const edited = 1\n')
        expect(repoGit(r.repo, ['status', '--porcelain'])).toBe('') // the plain status is blind to it, which is the point
        await refused(r, flag)
      }
    })

    test('an untracked module that status.showUntrackedFiles=no hides, set in the repo config or in the global one', async () => {
      const repoCfg = hubRepo()
      repoGit(repoCfg.repo, ['config', 'status.showUntrackedFiles', 'no'])
      writeFileSync(pkg(repoCfg, 'src', 'stray.ts'), 'export const stray = 1\n')
      expect(repoGit(repoCfg.repo, ['status', '--porcelain'])).toBe('')
      await refused(repoCfg, 'repo config')

      const globalCfg = hubRepo()
      writeFileSync(pkg(globalCfg, 'src', 'stray.ts'), 'export const stray = 1\n')
      const gitconfig = join(homeOf(), '.gitconfig') // the HOME build-hub's git gets: the suite's temp home
      writeFileSync(gitconfig, '[status]\n\tshowUntrackedFiles = no\n')
      try { await refused(globalCfg, 'global config') } finally { rmSync(gitconfig, { force: true }) }
    })

    test('an untracked module that an ignore rule hides, from the repo or from the default global ignore file', async () => {
      const repoRule = hubRepo()
      appendFileSync(join(repoRule.repo, '.git', 'info', 'exclude'), 'packages/collab-bridge/src/hidden.ts\n')
      writeFileSync(pkg(repoRule, 'src', 'hidden.ts'), 'export const hidden = 1\n')
      expect(repoGit(repoRule.repo, ['status', '--porcelain'])).toBe('')
      await refused(repoRule, 'info/exclude')

      const globalRule = hubRepo()
      writeFileSync(pkg(globalRule, 'src', 'hidden2.ts'), 'export const hidden = 1\n')
      const ignore = join(homeOf(), '.config', 'git', 'ignore') // core.excludesFile's default, read even with GIT_CONFIG_GLOBAL=/dev/null
      mkdirSync(join(homeOf(), '.config', 'git'), { recursive: true })
      writeFileSync(ignore, 'hidden2.ts\n')
      try { await refused(globalRule, 'global ignore file') } finally { rmSync(ignore, { force: true }) }
    })

    test('ignored files outside bin and src (dist, a Finder .DS_Store) are not a reason to refuse', async () => {
      const r = hubRepo()
      appendFileSync(join(r.repo, '.git', 'info', 'exclude'), 'packages/collab-bridge/dist/\n.DS_Store\n')
      mkdirSync(pkg(r, 'dist', 'hub'), { recursive: true })
      writeFileSync(pkg(r, 'dist', 'hub', 'hub.js'), '// an earlier build\n')
      writeFileSync(pkg(r, 'src', '.DS_Store'), 'finder')
      expect(treeClean(r.repo)).toBe(true)
      const built = await buildHub({ repo: r.repo, outDir: join(temp('cb-hubout-'), 'hub'), installedDist: r.dist })
      expect(built.info.commit).toBe(r.head)
    }, 30_000)
  })

  // Task 63 launcher-1-9: the dependency rule's wording allows a relative import into packages/collab/src; the build is what enforces it.
  test('refuses a bundle that would carry code from outside the bridge\'s own bin and src', async () => {
    const r = hubRepo()
    const out = join(temp('cb-hubout-'), 'hub')
    mkdirSync(join(r.repo, 'packages', 'collab', 'src'), { recursive: true })
    writeFileSync(join(r.repo, 'packages', 'collab', 'src', 'leak.ts'), 'export const leaked = "CollabStoreInside"\n')
    writeFileSync(join(r.repo, 'packages', 'collab-bridge', 'src', 'air', 'leak.ts'), "import { leaked } from '../../../collab/src/leak.ts'\n;(globalThis as any).__leaked = leaked\n")
    appendFileSync(join(r.repo, 'packages', 'collab-bridge', 'bin', 'collab-bridge.ts'), "\nimport '../src/air/leak.ts'\n")
    repoGit(r.repo, ['add', 'packages'])
    repoGit(r.repo, ['-c', 'user.name=Ai', '-c', 'user.email=ai@collab-bridge.invalid', 'commit', '-q', '-m', 'a Collab import'])
    expect(treeClean(r.repo)).toBe(true)
    await expect(buildHub({ repo: r.repo, outDir: out, installedDist: r.dist })).rejects.toThrow('carries code from outside')
    expect(existsSync(out)).toBe(false)
  }, 30_000)

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
