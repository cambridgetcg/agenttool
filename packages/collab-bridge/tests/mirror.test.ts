import { afterEach, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statfsSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CAPS, type TreeCaps } from '../src/air/diff-check.ts'
import { airGit, type GitRunner } from '../src/air/git.ts'
import {
  createMirror, DAILY_BUDGET_BYTES, FETCH_HEADROOM_BYTES, fetchArgv, fetchedTodayFromLedger, liveMirrorDeps, MIN_FREE_BYTES,
  MirrorLock, mirrorHead, mirrorIdOf, mirrorRefs, mirrorWorkspaceId, syncedOid, syncMirror, taskRefOk, ulimitBlocks, WIRE_CAP_BYTES,
  writeTaskRef, type MirrorDeps, type MirrorSpec,
} from '../src/air/mirror.ts'
import { AIR_LEDGER_KEYS, appendLedger, readLedger } from '../src/ledger.ts'
import { airPaths, type AirPaths } from '../src/paths.ts'
import { gateFromSource, makeFakeSsh, type FakeSsh } from './fake-ssh.ts'
import { cleanupTmps, commitFiles, commitIndexEntries, killQuietly, makeRepo, modeOf, pidGone, REAL_GIT, repoGit, temp, writeStub } from './helpers.ts'
import { collabHarness } from './mcp-harness.ts'
import { installedNuanceHome } from './nuance-home.ts'

afterEach(cleanupTmps)

const T = 30_000 // every test here spawns git, the fake ssh and the source gate

interface World {
  air: string; paths: AirPaths; airClone: string; base: string
  nuance: string; share: string; fake: FakeSsh; spec: MirrorSpec; deps: MirrorDeps
}

/**
 * An Air home with the trial clone, and a "Nuance" home whose ~/Projects/collab-trial is an edit share holding a clone
 * of it (or, with related: false, a repo with no shared history), INSTALLED, shares.json and the Summon allowlist. The
 * Air side fetches through the fake ssh into the real gate from source, which runs the real `git upload-pack`.
 */
function world(o: { related?: boolean; caps?: Partial<TreeCaps>; deps?: Partial<MirrorDeps> } = {}): World {
  const air = temp('cb-mirror-air-')
  const paths = airPaths(air)
  const airClone = join(air, 'Projects', 'collab-trial')
  const base = makeRepo(airClone)
  // Task 21's installed Nuance home: INSTALLED with the Air's git as Nuance's recorded git (recordedGit, its Cellar
  // realpath, as `install check` records it), shares.json naming the share, and ~/Projects review, ~/Projects/collab-trial edit.
  const h = installedNuanceHome({ share: join('Projects', 'collab-trial') })
  const nuance = h.home
  const share = h.share
  if (o.related === false) {
    makeRepo(share, { 'README.md': 'another repo\n' })
  } else {
    mkdirSync(join(nuance, 'Projects'), { recursive: true })
    repoGit(join(nuance, 'Projects'), ['clone', '-q', airClone, 'collab-trial'])
  }
  const fake = makeFakeSsh({ nuanceHome: nuance, target: gateFromSource(), env: h.env })
  const mirrorId = mirrorIdOf(share)
  const spec: MirrorSpec = {
    device: 'nuance', user: 'macair', mirrorId, mirrorPath: paths.mirrorDir('nuance', 'macair', mirrorId), airClone,
    remoteGitdir: join(share, '.git'), caps: { ...DEFAULT_CAPS, ...o.caps },
  }
  const deps: MirrorDeps = {
    git: airGit({ git: REAL_GIT, home: air }), sshBin: fake.bin, sshConfig: paths.sshConfig, alias: 'collab-nuance',
    freeBytes: () => 1e15, fetchedToday: () => 0, ledger: (f) => { appendLedger(paths.ledger, AIR_LEDGER_KEYS, f) }, ...o.deps,
  }
  return { air, paths, airClone, base, nuance, share, fake, spec, deps }
}

async function created(o: Parameters<typeof world>[0] = {}): Promise<World> {
  const w = world(o)
  const r = await createMirror(w.spec, w.deps)
  if (!r.ok) throw new Error(`createMirror: ${r.code}: ${r.message}`)
  return w
}

const collabRefs = (w: World) => repoGit(w.airClone, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/collab'])
const packTemps = (w: World) => readdirSync(join(w.airClone, '.git', 'objects', 'pack')).filter((n) => n.startsWith('tmp_'))
const fetchLines = (w: World) => readLedger(w.paths.ledger).filter((e) => e.event === 'fetch')

/**
 * A mirror whose tree carries `.gitattributes` naming a filter driver (allowed at a claim sync), and an Air that then
 * configures that driver, as `git lfs install` would. The mirror file's mtime is moved so `git status` must hash its
 * content, which runs the driver's clean command; the command leaves `marker` behind when it runs.
 */
async function mirrorWithLateFilter(): Promise<{ w: World; marker: string }> {
  const w = await created()
  const c2 = commitFiles(w.share, { '.gitattributes': 'notes/* filter=probe\n', 'notes/a.md': 'a\n' }, 'attributes name a driver')
  expect(await syncMirror(w.spec, { declaredHead: c2 }, w.deps)).toEqual({ ok: true, oid: c2 })
  const marker = join(w.air, 'filter-ran')
  const script = join(w.air, 'probe-clean.sh')
  writeFileSync(script, `#!/bin/sh\ncat\necho ran >> '${marker}'\n`, { mode: 0o755 })
  writeFileSync(join(w.air, '.gitconfig'), `[filter "probe"]\n\tclean = ${script}\n`)
  utimesSync(join(w.spec.mirrorPath, 'notes', 'a.md'), new Date(2020, 0, 1), new Date(2020, 0, 1))
  return { w, marker }
}

describe('createMirror', () => {
  test('createMirror makes a locked linked worktree at the fetched commit, with incoming and synced refs and no refs/heads', async () => {
    const w = world()
    const heads = repoGit(w.airClone, ['for-each-ref', '--format=%(refname)', 'refs/heads'])
    expect(await createMirror(w.spec, w.deps)).toEqual({ ok: true, oid: w.base })
    const refs = mirrorRefs(w.spec)
    expect(refs.incoming).toBe(`refs/collab/nuance/macair/${w.spec.mirrorId}/incoming`)
    expect(refs.synced).toBe(`refs/collab/nuance/macair/${w.spec.mirrorId}/synced`)
    expect(refs.task('t-notes-1')).toBe(`refs/collab/nuance/macair/${w.spec.mirrorId}/tasks/t-notes-1`)
    expect(repoGit(w.airClone, ['worktree', 'list', '--porcelain'])).toContain(
      `worktree ${w.spec.mirrorPath}\nHEAD ${w.base}\ndetached\nlocked collab-bridge mirror`)
    expect(collabRefs(w)).toBe(`${refs.incoming} ${w.base}\n${refs.synced} ${w.base}`)
    expect(repoGit(w.airClone, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe(heads)
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(await syncedOid(w.spec, w.deps)).toBe(w.base)
    expect(readFileSync(join(w.spec.mirrorPath, 'README.md'), 'utf8')).toBe('collab trial\n')
    expect(w.fake.calls().map((c) => c.at(-1))).toEqual([`git-upload-pack '${w.share}/.git'`])
    // A second createMirror (a re-pin) finds a healthy mirror and changes nothing.
    expect(await createMirror(w.spec, w.deps)).toEqual({ ok: true, oid: w.base })
    expect(w.fake.calls().length).toBe(1)
  }, T)

  test('after createMirror, collab-shared and every mirrors level are 0700', async () => {
    const w = world()
    mkdirSync(w.paths.sharedDir, { recursive: true, mode: 0o755 })
    chmodSync(w.paths.sharedDir, 0o755) // as if an Air session's Collab had made it first
    await createMirror(w.spec, w.deps)
    const levels = [w.paths.sharedDir, w.paths.mirrorsRoot, join(w.paths.mirrorsRoot, 'nuance'), join(w.paths.mirrorsRoot, 'nuance', 'macair'), w.spec.mirrorPath]
    for (const dir of levels) expect([dir, modeOf(dir)]).toEqual([dir, 0o700])
  }, T)

  test('the derived workspace id equals the one a real Collab session rooted at the mirror reports', async () => {
    const w = await created()
    const start = async (root: string) => {
      const h = collabHarness({ journal: w.paths.sharedJournal, home: w.air })
      try {
        await h.initialize()
        return await h.callTool('collab_session_start', { root_path: root, actor: 'mirror-test' })
      } finally {
        await h.close()
      }
    }
    const remote = await start(w.spec.mirrorPath)
    expect(remote.isError).toBeUndefined()
    expect(await mirrorWorkspaceId(w.spec, w.deps)).toBe(remote.structuredContent.workspace.id)
    // An Air session in the clone itself lands in the same workspace: mirrors share the clone's local-git key (§7.1).
    const local = await start(w.airClone)
    expect(local.structuredContent.workspace.id).toBe(remote.structuredContent.workspace.id)
    expect(await mirrorWorkspaceId({ ...w.spec, mirrorPath: join(w.air, 'no-such-mirror') }, w.deps)).toBeNull()
  }, T)

  test('liveMirrorDeps reads free space and today\'s fetch total', async () => {
    const air = temp('cb-mirror-air-')
    const paths = airPaths(air)
    const deps = liveMirrorDeps({ paths, git: airGit({ git: REAL_GIT, home: air }), ssh: '/usr/bin/ssh', alias: 'collab-nuance' })
    expect([deps.sshBin, deps.sshConfig, deps.alias, deps.git.path]).toEqual(['/usr/bin/ssh', paths.sshConfig, 'collab-nuance', REAL_GIT])
    const s = statfsSync(air)
    expect(Math.abs(deps.freeBytes(air) - Number(s.bavail) * Number(s.bsize))).toBeLessThan(256 * 1024 * 1024)
    deps.ledger({ event: 'fetch', device: 'nuance', user: 'macair', code: 'aaaaaaaaaaaaaaaa', bytes: 100, outcome: 'ok', ms: 5 })
    deps.ledger({ event: 'fetch', device: 'nuance', user: 'macair', code: 'aaaaaaaaaaaaaaaa', bytes: 23, outcome: 'failed', ms: 5 })
    deps.ledger({ event: 'fetch', device: 'nuance', user: 'macair', code: 'bbbbbbbbbbbbbbbb', bytes: 7, outcome: 'ok', ms: 5 })
    expect(deps.fetchedToday('aaaaaaaaaaaaaaaa')).toBe(123)
    expect(deps.fetchedToday('bbbbbbbbbbbbbbbb')).toBe(7)
    expect(deps.fetchedToday('cccccccccccccccc')).toBe(0)
    expect(modeOf(paths.ledger)).toBe(0o600)
  }, T)

  test('a Nuance repo with no shared history is repo_mismatch and leaves no worktree', async () => {
    const w = world({ related: false })
    const r = await createMirror(w.spec, w.deps)
    expect(r.ok === false && r.code).toBe('repo_mismatch')
    expect(existsSync(w.spec.mirrorPath)).toBe(false)
    expect(repoGit(w.airClone, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).length).toBe(1)
    expect(collabRefs(w)).toBe('')
  }, T)

  test('a filter reached only through an includeIf on the worktree gitdir stops createMirror and leaves no worktree', async () => {
    const w = world()
    const inc = join(w.air, 'filters.conf')
    writeFileSync(inc, '[filter "x"]\n\tsmudge = cat\n')
    writeFileSync(join(w.air, '.gitconfig'), `[includeIf "gitdir:${w.airClone}/.git/worktrees/"]\n\tpath = ${inc}\n`)
    const r = await createMirror(w.spec, w.deps)
    expect(r.ok === false && r.code).toBe('mirror_filters_present')
    expect(existsSync(w.spec.mirrorPath)).toBe(false)
    expect(existsSync(join(w.airClone, '.git', 'worktrees', w.spec.mirrorId))).toBe(false)
    expect(await syncedOid(w.spec, w.deps)).toBeNull()
    rmSync(join(w.air, '.gitconfig'))
    expect(await createMirror(w.spec, w.deps)).toEqual({ ok: true, oid: w.base })
  }, T)

  test('re-pinning an existing mirror checks filters before its status, so a clean filter never runs there either (Task 63 gate-1-10, conformance-4-13)', async () => {
    const { w, marker } = await mirrorWithLateFilter()
    const r = await createMirror(w.spec, w.deps)
    expect(r.ok === false && r.code).toBe('mirror_filters_present')
    expect(existsSync(marker)).toBe(false)
    rmSync(join(w.air, '.gitconfig'))
    expect(await createMirror(w.spec, w.deps)).toMatchObject({ ok: true }) // without the driver the healthy mirror is kept
  }, T)

  test('a level that is a regular file answers mirror_tampered and never throws, before anything is fetched', async () => {
    const w = world()
    mkdirSync(w.paths.sharedDir, { recursive: true })
    writeFileSync(w.paths.mirrorsRoot, 'a file where the mirrors directory belongs\n')
    const r = await createMirror(w.spec, w.deps)
    expect(r.ok === false && r.code).toBe('mirror_tampered')
    expect(w.fake.calls().length).toBe(0)
    expect(existsSync(w.spec.mirrorPath)).toBe(false)
    rmSync(w.paths.mirrorsRoot)
    expect(await createMirror(w.spec, w.deps)).toEqual({ ok: true, oid: w.base }) // nothing was left half done
  }, T)

  test('a chmod that fails after the first checkout removes the new worktree and answers checkout_failed', async () => {
    const w = world()
    const userDir = join(w.paths.mirrorsRoot, 'nuance', 'macair')
    const real = w.deps.git
    const calls: string[][] = []
    const shut: GitRunner = {
      path: real.path,
      records: (a, o) => real.records(a, o),
      run: async (a, o) => {
        calls.push(a)
        if (a.includes('worktree') && a.includes('remove')) chmodSync(userDir, 0o700) // let the cleanup see the mirror again
        const r = await real.run(a, o)
        if (a.includes('checkout')) chmodSync(userDir, 0o000) // the parent can no longer be searched: chmod of the mirror fails
        return r
      },
    }
    try {
      const r = await createMirror(w.spec, { ...w.deps, git: shut })
      expect(r.ok === false && r.code).toBe('checkout_failed')
    } finally {
      chmodSync(userDir, 0o700)
    }
    const checkout = calls.findIndex((a) => a.includes('checkout'))
    const remove = calls.findIndex((a) => a.includes('worktree') && a.includes('remove'))
    expect(checkout).toBeGreaterThan(-1)
    expect(remove).toBeGreaterThan(checkout)
    expect(calls.some((a) => a.includes('lock'))).toBe(false)
    expect(existsSync(w.spec.mirrorPath)).toBe(false)
    expect(repoGit(w.airClone, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).length).toBe(1)
    expect(await syncedOid(w.spec, w.deps)).toBeNull()
    expect(await createMirror(w.spec, w.deps)).toEqual({ ok: true, oid: w.base }) // the name is free again
  }, T)

  test('an existing mirror that vanishes while it is being locked answers mirror_tampered and never throws', async () => {
    const w = await created()
    const real = w.deps.git
    const vanishing: GitRunner = {
      path: real.path,
      records: (a, o) => real.records(a, o),
      run: async (a, o) => {
        const r = await real.run(a, o)
        if (a.includes('worktree') && a.includes('list')) rmSync(w.spec.mirrorPath, { recursive: true, force: true })
        return r
      },
    }
    const r = await createMirror(w.spec, { ...w.deps, git: vanishing })
    expect(r.ok === false && r.code).toBe('mirror_tampered')
  }, T)
})

describe('syncMirror', () => {
  test('a sync moves synced only after the checkout', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a note')
    const calls: string[][] = []
    const real = w.deps.git
    const recording: GitRunner = {
      path: real.path,
      run: (a, o) => { calls.push(a); return real.run(a, o) },
      records: (a, o) => { calls.push(a); return real.records(a, o) },
    }
    expect(await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, git: recording })).toEqual({ ok: true, oid: c2 })
    const checkout = calls.findIndex((a) => a.includes('checkout') && a.includes(c2))
    const update = calls.findIndex((a) => a.includes('update-ref') && a.includes(mirrorRefs(w.spec).synced))
    expect(checkout).toBeGreaterThan(-1)
    expect(update).toBeGreaterThan(checkout)
    expect(await mirrorHead(w.spec, w.deps)).toBe(c2)
    expect(await syncedOid(w.spec, w.deps)).toBe(c2)
    expect(readFileSync(join(w.spec.mirrorPath, 'notes', 'a.md'), 'utf8')).toBe('a\n')
    const last = fetchLines(w).at(-1)!
    expect([last.device, last.user, last.code, last.outcome]).toEqual(['nuance', 'macair', w.spec.mirrorId, 'ok'])
    expect(last.bytes as number).toBeGreaterThan(0)
  }, T)

  test('a dirty mirror or one whose HEAD is not synced is mirror_tampered', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a note')
    const code = async () => {
      const r = await syncMirror(w.spec, { declaredHead: c2 }, w.deps)
      return r.ok ? 'ok' : r.code
    }
    writeFileSync(join(w.spec.mirrorPath, 'stray.txt'), 'edited on the Air\n')
    expect(await code()).toBe('mirror_tampered')
    rmSync(join(w.spec.mirrorPath, 'stray.txt'))
    writeFileSync(join(w.spec.mirrorPath, 'README.md'), 'changed in place\n')
    expect(await code()).toBe('mirror_tampered')
    repoGit(w.spec.mirrorPath, ['checkout', '-q', '--', 'README.md'])
    const refs = mirrorRefs(w.spec)
    const airOnly = commitFiles(w.airClone, { 'notes/air.md': 'air\n' }, 'an Air commit')
    repoGit(w.airClone, ['update-ref', refs.synced, airOnly])
    expect(await code()).toBe('mirror_tampered')
    repoGit(w.airClone, ['update-ref', refs.synced, w.base])
    repoGit(w.spec.mirrorPath, ['switch', '-q', '-c', 'on-a-branch'])
    expect(await code()).toBe('mirror_tampered')
    repoGit(w.spec.mirrorPath, ['switch', '-q', '--detach', w.base])
    expect(w.fake.calls().length).toBe(1) // no refused sync ever fetched
    expect(await code()).toBe('ok')
  }, T)

  test('a filter in a temp global config is mirror_filters_present', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a note')
    for (const conf of ['[filter "lfs"]\n\tclean = git-lfs clean -- %f\n', '[diff "pdf"]\n\ttextconv = cat\n', '[core]\n\tfsmonitor = true\n']) {
      writeFileSync(join(w.air, '.gitconfig'), conf)
      const r = await syncMirror(w.spec, { declaredHead: c2 }, w.deps)
      expect([conf, r.ok === false && r.code]).toEqual([conf, 'mirror_filters_present'])
    }
    expect(w.fake.calls().length).toBe(1)
    rmSync(join(w.air, '.gitconfig'))
    expect(await syncMirror(w.spec, { declaredHead: c2 }, w.deps)).toEqual({ ok: true, oid: c2 })
  }, T)

  test('the filter check comes before any git status in the mirror, so a clean filter named by the fetched tree never runs (Task 63 gate-1-10, conformance-4-13)', async () => {
    const { w, marker } = await mirrorWithLateFilter()
    const c3 = commitFiles(w.share, { 'notes/b.md': 'b\n' }, 'a second note')
    const r = await syncMirror(w.spec, { declaredHead: c3 }, w.deps)
    expect(r.ok === false && r.code).toBe('mirror_filters_present')
    expect(existsSync(marker)).toBe(false) // step 1's status would have hashed notes/a.md through the driver
    // A tampered mirror is still tampered when a filter is configured too: the checks that run no filter come first.
    repoGit(w.spec.mirrorPath, ['switch', '-q', '-c', 'on-a-branch'])
    const t = await syncMirror(w.spec, { declaredHead: c3 }, w.deps)
    expect(t.ok === false && t.code).toBe('mirror_tampered')
    expect(existsSync(marker)).toBe(false)
  }, T)

  test('a filter reached only through an includeIf is mirror_filters_present', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a note')
    const inc = join(w.air, 'filters.conf')
    writeFileSync(inc, '[filter "x"]\n\tsmudge = cat\n')
    writeFileSync(join(w.air, '.gitconfig'), `[includeIf "gitdir:${w.airClone}/.git/worktrees/"]\n\tpath = ${inc}\n`)
    // The clone's own view is clean: the include matches only the mirror's gitdir, which the check reads from.
    expect((await w.deps.git.run(['-C', w.airClone, 'config', '--show-scope', '--get-regexp', '^filter\\.'])).code).toBe(1)
    const r = await syncMirror(w.spec, { declaredHead: c2 }, w.deps)
    expect(r.ok === false && r.code).toBe('mirror_filters_present')
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
  }, T)

  test('low disk before the fetch and before the checkout is mirror_low_disk', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a'.repeat(100) }, 'a note')
    const before = await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, freeBytes: () => MIN_FREE_BYTES + FETCH_HEADROOM_BYTES - 1 })
    expect(before.ok === false && before.code).toBe('mirror_low_disk')
    expect(w.fake.calls().length).toBe(1) // refused before fetching
    // Enough for the fetch, then less than the tree needs: README (13) + notes/a.md (100) = 113 bytes over the floor.
    const frees = [MIN_FREE_BYTES + FETCH_HEADROOM_BYTES, MIN_FREE_BYTES + 112]
    const after = await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, freeBytes: () => frees.shift() ?? 0 })
    expect(after.ok === false && after.code).toBe('mirror_low_disk')
    expect(w.fake.calls().length).toBe(2)
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(await syncedOid(w.spec, w.deps)).toBe(w.base)
    expect(existsSync(join(w.spec.mirrorPath, 'notes', 'a.md'))).toBe(false)
  }, T)

  test('a mirror past its daily budget is rate_limited', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a note')
    const r = await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, fetchedToday: () => DAILY_BUDGET_BYTES })
    expect(r.ok === false && r.code).toBe('rate_limited')
    expect(w.fake.calls().length).toBe(1)
    expect(await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, fetchedToday: () => DAILY_BUDGET_BYTES - 1 })).toEqual({ ok: true, oid: c2 })
  }, T)

  test('fetch.fsckObjects=true keeps the download one pack whatever fetch.unpackLimit says, so the cap and the day\'s budget still see it (Task 63 gate-1-1, conformance-4-12 declined: false premise)', async () => {
    const w = await created()
    const packFiles = () => readdirSync(join(w.airClone, '.git', 'objects', 'pack')).filter((n) => n.endsWith('.pack'))
    const looseCount = () => Number(/^count: (\d+)$/m.exec(repoGit(w.airClone, ['count-objects', '-v']))![1])
    // With fsck on, fetch-pack always runs index-pack, which stores the pack; unpack-objects (loose files) is used only
    // when fsck is off and the object count is under the limit. The argv fixes fsck on, so fetch.unpackLimit, which does
    // outrank transfer.unpackLimit, has nothing to override. This test is the tripwire if a future git changes that.
    const scopes: Array<[string, () => void]> = [
      ['global', () => writeFileSync(join(w.air, '.gitconfig'), '[fetch]\n\tunpackLimit = 100000\n')],
      ['repo', () => { rmSync(join(w.air, '.gitconfig')); repoGit(w.airClone, ['config', 'fetch.unpackLimit', '100000']) }],
    ]
    for (const [scope, arm] of scopes) {
      arm()
      const next = commitFiles(w.share, { [`notes/${scope}.md`]: `${scope}\n` }, `a note under ${scope} config`)
      const packsBefore = packFiles().length
      const looseBefore = looseCount()
      expect([scope, await syncMirror(w.spec, { declaredHead: next }, w.deps)]).toEqual([scope, { ok: true, oid: next }])
      expect([scope, packFiles().length]).toEqual([scope, packsBefore + 1]) // kept as one pack
      expect([scope, looseCount()]).toEqual([scope, looseBefore]) // and not unpacked into loose objects
      expect([scope, (fetchLines(w).at(-1)!.bytes as number) > 0]).toEqual([scope, true]) // so the day's budget is charged
    }
  }, T)

  test('the fetch never starts git auto-maintenance in the Air clone: packs pile up untouched, nothing detaches from the fetch\'s group (Task 63 gate-1-2, conformance-4-11)', async () => {
    const w = await created()
    const packFiles = () => readdirSync(join(w.airClone, '.git', 'objects', 'pack')).filter((n) => n.endsWith('.pack'))
    // Every bridge fetch adds a pack (transfer.unpackLimit=1); past gc.autoPackLimit a default fetch runs
    // `maintenance run --auto` and so `gc --auto`, which detaches (setsid) from ownGroup's kill and inherits ulimit -f.
    // Synchronous here, so a repack that did run would show as fewer packs straight away.
    writeFileSync(join(w.air, '.gitconfig'), '[gc]\n\tautoPackLimit = 1\n\tautoDetach = false\n[maintenance]\n\tautoDetach = false\n')
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a note')
    expect(await syncMirror(w.spec, { declaredHead: c2 }, w.deps)).toEqual({ ok: true, oid: c2 })
    const c3 = commitFiles(w.share, { 'notes/b.md': 'b\n' }, 'another note')
    expect(await syncMirror(w.spec, { declaredHead: c3 }, w.deps)).toEqual({ ok: true, oid: c3 })
    // The Air clone already held the base, so createMirror's fetch brought no pack: these are c2's and c3's. A gc --auto
    // with gc.autoPackLimit=1 would have folded them into one.
    expect(packFiles().length).toBe(2)
    expect(existsSync(join(w.airClone, '.git', 'gc.log'))).toBe(false)
  }, T)

  test('a pack over the wire cap is fetch_failed and leaves no temp pack', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/noise.txt': randomBytes(1536 * 1024).toString('base64') }, 'a 2 MiB note')
    const r = await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, wireCapBytes: 1024 * 1024 })
    expect(r.ok === false && [r.code, r.message]).toEqual(['fetch_failed', 'the fetched pack passed the 1 MiB limit for one sync'])
    expect(packTemps(w)).toEqual([])
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(collabRefs(w)).toBe(`${mirrorRefs(w.spec).incoming} ${w.base}\n${mirrorRefs(w.spec).synced} ${w.base}`)
    const last = fetchLines(w).at(-1)!
    expect(last.outcome).toBe('failed')
    expect(last.bytes as number).toBeGreaterThanOrEqual(1024 * 1024) // the cut pack counts against the day's budget
  }, T)

  test('a temp pack that cannot be removed does not turn a refused fetch into a throw', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/noise.txt': randomBytes(1536 * 1024).toString('base64') }, 'a 2 MiB note')
    const packDir = join(w.airClone, '.git', 'objects', 'pack')
    const real = w.deps.git
    const sealing: GitRunner = {
      path: real.path,
      records: (a, o) => real.records(a, o),
      run: async (a, o) => {
        const r = await real.run(a, o)
        if (a.includes('fetch')) chmodSync(packDir, 0o500) // the cut pack is there, and its directory no longer lets a file go
        return r
      },
    }
    try {
      const r = await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, git: sealing, wireCapBytes: 1024 * 1024 })
      expect(r.ok === false && [r.code, r.message]).toEqual(['fetch_failed', 'the fetched pack passed the 1 MiB limit for one sync'])
      expect(fetchLines(w).at(-1)!.outcome).toBe('failed') // still ledgered, so the day's budget counts it
    } finally {
      chmodSync(packDir, 0o700)
    }
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
  }, T)

  test('a fetch past its timeout is stopped with everything it started, and is fetch_failed', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a note')
    const dir = temp('cb-mirror-ssh-')
    // An ssh that never answers and leaves a child of its own behind that holds no pipe.
    const ssh = writeStub(dir, 'ssh', `/bin/sleep 60 >/dev/null 2>&1 &\necho $! > '${dir}/child'\nwait`)
    try {
      const r = await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, sshBin: ssh, fetchTimeoutMs: 400 })
      expect(r.ok === false && [r.code, r.message]).toEqual(['fetch_failed', 'the fetch from the device took longer than 60 s and was stopped'])
      expect(fetchLines(w).at(-1)!.outcome).toBe('timeout')
      expect(await pidGone(Number(readFileSync(join(dir, 'child'), 'utf8')), 3000)).toBe(true)
    } finally {
      try { killQuietly(Number(readFileSync(join(dir, 'child'), 'utf8'))) } catch { /* it never started */ }
    }
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(packTemps(w)).toEqual([])
    expect(await syncMirror(w.spec, { declaredHead: c2 }, w.deps)).toEqual({ ok: true, oid: c2 }) // a re-run succeeds
  }, T)

  test('the production cap is ulimit -f 131072', () => {
    expect(ulimitBlocks(WIRE_CAP_BYTES)).toBe(131072)
    expect(ulimitBlocks(1024 * 1024)).toBe(1024)
    const spec: MirrorSpec = {
      device: 'nuance', user: 'macair', mirrorId: '0123456789abcdef',
      mirrorPath: '/Users/yuai/.local/share/agenttool/collab-shared/mirrors/nuance/macair/0123456789abcdef',
      airClone: '/Users/yuai/Projects/collab-trial', remoteGitdir: '/Users/macair/Projects/collab-trial/.git', caps: DEFAULT_CAPS,
    }
    const git = airGit({ git: '/opt/homebrew/bin/git', home: '/Users/yuai' })
    expect(fetchArgv(spec, { git, sshBin: '/usr/bin/ssh', sshConfig: '/Users/yuai/.ssh/collab-bridge/config', alias: 'collab-nuance' }, WIRE_CAP_BYTES)).toEqual([
      '/bin/sh', '-c', 'ulimit -f 131072; exec "$@"', 'sh',
      'env', '-u', 'GIT_SSH', "GIT_SSH_COMMAND=/usr/bin/ssh -F '/Users/yuai/.ssh/collab-bridge/config'",
      '/opt/homebrew/bin/git', '-C', '/Users/yuai/Projects/collab-trial', '-c', 'protocol.version=0',
      '-c', 'transfer.fsckObjects=true', '-c', 'fetch.fsckObjects=true', '-c', 'transfer.unpackLimit=1',
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      'fetch', '--no-auto-maintenance', '--no-tags', '--no-recurse-submodules', '--no-prune', '--no-write-fetch-head',
      'collab-nuance:/Users/macair/Projects/collab-trial/.git', '+HEAD:refs/collab/nuance/macair/0123456789abcdef/incoming',
    ])
    expect(mirrorIdOf('/Users/macair/Projects/collab-trial')).toMatch(/^[0-9a-f]{16}$/)
    expect(() => fetchArgv({ ...spec, remoteGitdir: "/Users/macair/it's/.git" }, { git, sshBin: '/usr/bin/ssh', sshConfig: '/x', alias: 'collab-nuance' }, WIRE_CAP_BYTES)).toThrow()
  })

  test('a fetched oid other than the declared head is remote_head_moved and the mirror does not move', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a note')
    const notAnOid = await syncMirror(w.spec, { declaredHead: 'HEAD' }, w.deps)
    expect(notAnOid.ok === false && notAnOid.code).toBe('remote_head_moved')
    expect(w.fake.calls().length).toBe(1) // refused before fetching
    const r = await syncMirror(w.spec, { declaredHead: w.base }, w.deps)
    expect(r.ok === false && r.code).toBe('remote_head_moved')
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(await syncedOid(w.spec, w.deps)).toBe(w.base)
    expect(collabRefs(w)).toBe(`${mirrorRefs(w.spec).incoming} ${c2}\n${mirrorRefs(w.spec).synced} ${w.base}`)
  }, T)

  test('the tree caps refuse before anything is checked out', async () => {
    const w = await created({ caps: { maxEntries: 2 } })
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a third entry')
    const r = await syncMirror(w.spec, { declaredHead: c2 }, w.deps)
    expect(r.ok === false && r.code).toBe('remote_too_large')
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(existsSync(join(w.spec.mirrorPath, 'notes', 'a.md'))).toBe(false)
  }, T)

  test('at complete the commit is held to its task before anything is checked out', async () => {
    const w = await created()
    const atComplete = { base: w.base, scopes: ['notes'] }
    const outside = commitFiles(w.share, { 'src/x.ts': 'export {}\n' }, 'out of scope')
    const r1 = await syncMirror(w.spec, { declaredHead: outside, atComplete }, w.deps)
    expect(r1.ok === false && r1.code).toBe('remote_out_of_scope')
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    const good = commitFiles(w.share, { 'src/x.ts': null, 'notes/a.md': 'a\n' }, 'in scope')
    expect(await syncMirror(w.spec, { declaredHead: good, atComplete }, w.deps)).toEqual({ ok: true, oid: good, changed: 1 })
    const airOnly = commitFiles(w.airClone, { 'notes/air.md': 'air\n' }, 'an Air commit')
    const r3 = await syncMirror(w.spec, { declaredHead: good, atComplete: { base: airOnly, scopes: ['notes'] } }, w.deps)
    expect(r3.ok === false && r3.code).toBe('remote_base_not_ancestor')
    expect(await mirrorHead(w.spec, w.deps)).toBe(good)
  }, T)

  test('an at-complete base the clone does not have is fetch_failed, not a refusal about the base (§7.3 step 7)', async () => {
    const w = await created()
    const good = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'in scope')
    // git merge-base --is-ancestor exits 128 on an object it lacks, and step 7 says anything but 0 and 1 is fetch_failed;
    // remote_base_unknown is Task 44's answer when neither base is known, never this step's.
    const absent = 'deadbeef'.repeat(5)
    const r = await syncMirror(w.spec, { declaredHead: good, atComplete: { base: absent, scopes: ['notes'] } }, w.deps)
    expect(r.ok === false && [r.code, r.message]).toEqual(['fetch_failed', "the commit could not be checked against the task's base"])
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(existsSync(join(w.spec.mirrorPath, 'notes', 'a.md'))).toBe(false)
  }, T)

  test('a failed checkout restores the mirror and answers checkout_failed', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n', 'README.md': 'changed\n' }, 'two files')
    const real = w.deps.git
    const failing: GitRunner = {
      path: real.path,
      records: (a, o) => real.records(a, o),
      run: async (a, o) => {
        if (a.includes('checkout') && a.includes(c2)) {
          // A checkout that died half way: one file rewritten, one stray file left.
          writeFileSync(join(w.spec.mirrorPath, 'README.md'), 'half-written\n')
          writeFileSync(join(w.spec.mirrorPath, 'partial.tmp'), 'x')
          return { code: 1, stdout: new Uint8Array(), stderr: 'error: simulated checkout failure\n', timedOut: false }
        }
        return real.run(a, o)
      },
    }
    const r = await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, git: failing })
    expect(r.ok === false && r.code).toBe('checkout_failed')
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(await syncedOid(w.spec, w.deps)).toBe(w.base)
    expect(readFileSync(join(w.spec.mirrorPath, 'README.md'), 'utf8')).toBe('collab trial\n')
    expect(existsSync(join(w.spec.mirrorPath, 'partial.tmp'))).toBe(false)
    expect(await syncMirror(w.spec, { declaredHead: c2 }, w.deps)).toEqual({ ok: true, oid: c2 })
  }, T)

  test('a device HEAD that holds a symlink is refused at a claim sync too, before anything is checked out (Task 63 conformance-4-3)', async () => {
    const w = await created()
    // No atComplete: a claim sync checks out the device's whole tree, and the complete-time diff would never see a link
    // that is already in the base. The target is the Air's own key.
    const linked = commitIndexEntries(w.share, [{ path: 'notes.md', content: join(w.air, '.ssh', 'collab-bridge', 'collab_nuance_ed25519'), mode: '120000' }], 'notes.md is a symlink')
    const r = await syncMirror(w.spec, { declaredHead: linked }, w.deps)
    expect(r.ok === false && [r.code, r.message]).toEqual(['remote_non_regular_path', 'the fetched tree holds a gitlink, a symlink or two paths one Air file name would hold (notes.md)'])
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(await syncedOid(w.spec, w.deps)).toBe(w.base)
    expect(readdirSync(w.spec.mirrorPath).sort()).toEqual(['.git', 'README.md', 'notes'])
  }, T)

  test('two paths one Air file name would hold are refused before the checkout, so synced never moves to a tree the mirror cannot hold (Task 63 gate-1-3)', async () => {
    const w = await created()
    const collide = commitIndexEntries(w.share, [{ path: 'notes/a.md', content: 'harmless\n' }, { path: 'notes/A.md', content: 'different\n' }], 'a.md and A.md')
    for (const atComplete of [undefined, { base: w.base, scopes: ['notes'] }]) {
      const r = await syncMirror(w.spec, atComplete === undefined ? { declaredHead: collide } : { declaredHead: collide, atComplete }, w.deps)
      expect(r.ok === false && r.code).toBe('remote_non_regular_path')
      expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
      expect(await syncedOid(w.spec, w.deps)).toBe(w.base)
      expect(readdirSync(join(w.spec.mirrorPath, 'notes'))).toEqual(['.gitkeep'])
    }
    // The next honest commit still syncs: nothing was left half done.
    repoGit(w.share, ['reset', '-q', '--hard', w.base])
    const fine = commitFiles(w.share, { 'notes/b.md': 'b\n' }, 'a plain note')
    expect(await syncMirror(w.spec, { declaredHead: fine }, w.deps)).toEqual({ ok: true, oid: fine })
  }, T)

  test('a checkout that exits 0 but leaves the mirror unlike the commit is restored and refused, and synced does not move (Task 63 gate-1-3)', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n', 'README.md': 'changed\n' }, 'two files')
    const real = w.deps.git
    // As if the file system wrote one name over another: git says all is well, and the tree is not the commit.
    const silent: GitRunner = {
      path: real.path,
      records: (a, o) => real.records(a, o),
      run: async (a, o) => {
        const r = await real.run(a, o)
        if (a.includes('checkout') && a.includes(c2)) {
          expect(r.code).toBe(0)
          writeFileSync(join(w.spec.mirrorPath, 'README.md'), 'overwritten by a colliding name\n')
          writeFileSync(join(w.spec.mirrorPath, 'notes', 'extra.tmp'), 'x')
        }
        return r
      },
    }
    const r = await syncMirror(w.spec, { declaredHead: c2 }, { ...w.deps, git: silent })
    expect(r.ok === false && r.code).toBe('checkout_failed')
    expect(await mirrorHead(w.spec, w.deps)).toBe(w.base)
    expect(await syncedOid(w.spec, w.deps)).toBe(w.base)
    expect(readFileSync(join(w.spec.mirrorPath, 'README.md'), 'utf8')).toBe('collab trial\n')
    expect(existsSync(join(w.spec.mirrorPath, 'notes', 'extra.tmp'))).toBe(false)
    expect(await syncMirror(w.spec, { declaredHead: c2 }, w.deps)).toEqual({ ok: true, oid: c2 }) // the mirror was healthy again
  }, T)

  test('the tasks ref is written once and only when it equals the mirror\'s HEAD', async () => {
    const w = await created()
    const c2 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a note')
    await syncMirror(w.spec, { declaredHead: c2 }, w.deps)
    const ref = mirrorRefs(w.spec).task('t-notes-1')
    const refValue = () => repoGit(w.airClone, ['for-each-ref', '--format=%(objectname)', ref])
    expect(await writeTaskRef(w.spec, 't-notes-1', w.base, w.deps)).toBe('mirror_tampered')
    expect(refValue()).toBe('')
    expect(await writeTaskRef(w.spec, 't-notes-1', c2, w.deps)).toBe('ok')
    expect(refValue()).toBe(c2)
    expect(await writeTaskRef(w.spec, 't-notes-1', c2, w.deps)).toBe('ok')
    const c3 = commitFiles(w.share, { 'notes/b.md': 'b\n' }, 'another note')
    await syncMirror(w.spec, { declaredHead: c3 }, w.deps)
    expect(await writeTaskRef(w.spec, 't-notes-1', c3, w.deps)).toBe('mirror_tampered')
    expect(refValue()).toBe(c2)
    // Collab allows ':' in a task id; git refuses it in a ref name, so no ref is written and the reviewer reads the
    // task's result checkpoint head instead (§7.7).
    expect([taskRefOk('t-notes-1'), taskRefOk('a:b'), taskRefOk('x.lock'), taskRefOk('a..b'), taskRefOk('a.')]).toEqual([true, false, false, false, false])
    expect(await writeTaskRef(w.spec, 'a:b', c3, w.deps)).toBe('ok')
    expect(repoGit(w.airClone, ['for-each-ref', '--format=%(refname)', `refs/collab/nuance/macair/${w.spec.mirrorId}/tasks`])).toBe(ref)
    expect(() => mirrorRefs(w.spec).task('a:b')).toThrow()
  }, T)

  test('the daily total is summed from today\'s ledger lines', () => {
    const ledger = join(temp('cb-mirror-ledger-'), 'ledger.jsonl')
    const at = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m, 0).getTime()
    const line = (code: string, bytes: number, ms: number, event = 'fetch') =>
      appendLedger(ledger, AIR_LEDGER_KEYS, { event, device: 'nuance', user: 'macair', code, bytes, outcome: 'ok', ms: 1 }, ms)
    line('m1', 1000, at(12, 23, 59)) // yesterday
    line('m1', 200, at(13, 0, 0)) // local midnight counts
    line('m1', 30, at(13, 11, 0))
    line('m2', 4, at(13, 11, 30))
    line('m1', 5, at(13, 11, 31), 'dial')
    const now = new Date(2026, 9, 13, 12, 0, 0)
    expect(fetchedTodayFromLedger(ledger, 'm1', now)).toBe(230)
    expect(fetchedTodayFromLedger(ledger, 'm2', now)).toBe(4)
    expect(fetchedTodayFromLedger(join(temp('cb-mirror-ledger-'), 'none.jsonl'), 'm1', now)).toBe(0)
  })
})

describe('MirrorLock', () => {
  test('runs one at a time, in order, and a failure frees it', async () => {
    const lock = new MirrorLock()
    const order: string[] = []
    const a = lock.run(async () => { order.push('a start'); await Bun.sleep(30); order.push('a end'); return 1 })
    const b = lock.run(async () => { order.push('b'); throw new Error('b failed') })
    const c = lock.run(async () => { order.push('c'); return 3 })
    expect(await a).toBe(1)
    await expect(b).rejects.toThrow('b failed')
    expect(await c).toBe(3)
    expect(order).toEqual(['a start', 'a end', 'b', 'c'])
  })
})
