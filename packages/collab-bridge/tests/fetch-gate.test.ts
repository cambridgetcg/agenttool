import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAllowlist, type Allowlist, type AllowlistFolder } from '../src/allowlist.ts'
import { checkUploadPackPath, FETCH_STOPPED_EXIT, gitEnv, pktLineErr, runFetchGate, UPLOAD_PACK_CONFIG, uploadPackArgv, type FetchGateCtx } from '../src/nuance/fetch-gate.ts'
import { sha256File, type ResolvedGit } from '../src/nuance/git-resolve.ts'
import type { Share } from '../src/nuance/installed.ts'
import { cleanupTmps, temp, writeStub } from './helpers.ts'
import {
  allowlistYaml, fixtureGit as git, installedNuanceHome, recordedGit, secretBranchRepo, testInstalled, type InstalledNuanceHome,
} from './nuance-home.ts'

afterEach(cleanupTmps)

/** "Nuance's recorded git" in this suite: the Air's Homebrew git by its Cellar realpath. */
const GIT = recordedGit()
/** Variables bash adds to its own environment, which a bash stub therefore always prints. */
const BASH_OWN = ['PWD', 'SHLVL', '_']

interface Nuance extends InstalledNuanceHome { gitdir: string; head: string; secret: string }

/** An installed Nuance home. Its ~/Projects/collab-trial is edit under a review-only ~/Projects and holds a repo with a secret branch. */
function makeNuance(o: { folders?: AllowlistFolder[]; git?: ResolvedGit } = {}): Nuance {
  const h = installedNuanceHome({ share: 'Projects/collab-trial', folders: o.folders, git: o.git })
  const { head, secret } = secretBranchRepo(h.share, h.home)
  return { ...h, gitdir: join(h.share, '.git'), head, secret }
}

function allowlistOf(n: Nuance): Allowlist {
  const al = loadAllowlist(n.paths.summonAllowlist)
  if (!al.ok) throw new Error(`fixture allowlist: ${al.detail}`)
  return al.allowlist
}

function ctxOf(n: Nuance, shares?: Share[], g?: ResolvedGit): FetchGateCtx {
  return {
    home: n.home, installed: g ? testInstalled({ git: g }) : n.installed, shares: shares ?? [{ realpath: n.share, gitdir: n.gitdir }],
    allowlist: allowlistOf(n), uid: process.getuid!(),
  }
}

/** pkt-line framing for a raw upload-pack conversation. */
const pkt = (s: string) => `${(4 + Buffer.byteLength(s)).toString(16).padStart(4, '0')}${s}`
/** A raw v0 want for the commit only refs/heads/secret holds. A client that skips git's own unadvertised-object check would send exactly this. */
const hiddenWant = (n: Nuance) => pkt(`want ${n.secret} multi_ack\n`) + '0000' + pkt('done\n')

/** In-process io: stdin from `stdin` (empty by default), with stdout bytes and stderr text collected. */
function captureIo(stdin = '') {
  const chunks: Uint8Array[] = []
  let err = ''
  return {
    io: { stdin: new Blob([stdin]).stream(), stdout: { write: (b: Uint8Array) => { chunks.push(b) } }, stderr: { write: (s: string) => { err += s } } },
    out: () => Buffer.concat(chunks).toString('latin1'),
    err: () => err,
  }
}

describe('the upload-pack command', () => {
  test('uploadPackArgv is the §7.4 argv and gitEnv the seven keys, never GIT_PROTOCOL', () => {
    expect(UPLOAD_PACK_CONFIG).toEqual([
      '-c', 'uploadpack.hideRefs=refs/', '-c', 'uploadpack.allowTipSHA1InWant=false',
      '-c', 'uploadpack.allowReachableSHA1InWant=false', '-c', 'uploadpack.allowAnySHA1InWant=false',
      '-c', 'uploadpack.allowFilter=false', '-c', 'uploadpack.allowRefInWant=false',
    ])
    expect(uploadPackArgv('/Users/macair/Projects/collab-trial/.git')).toEqual([
      ...UPLOAD_PACK_CONFIG, 'upload-pack', '--strict', '--timeout=120', '/Users/macair/Projects/collab-trial/.git',
    ])
    expect(gitEnv('/Users/macair')).toEqual({
      PATH: '/usr/bin:/bin', HOME: '/Users/macair', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
    })
  })

  test('pktLineErr is one well-formed pkt-line', () => {
    const b = pktLineErr('not_shared')
    expect(Buffer.from(b).toString('latin1')).toBe('0013ERR not_shared\n')
    expect(parseInt(Buffer.from(b.subarray(0, 4)).toString('latin1'), 16)).toBe(b.byteLength)
  })

  test('upload-pack runs --strict on the gitdir, and --strict alone refuses the work-tree path', () => {
    const n = makeNuance()
    expect(uploadPackArgv(n.gitdir).slice(-4)).toEqual(['upload-pack', '--strict', '--timeout=120', n.gitdir])
    // The gate refuses the work tree before git runs (not_shared, below and in Task 24). --strict would refuse it as well (K51).
    const direct = Bun.spawnSync([GIT.path, ...uploadPackArgv(n.share)], { env: gitEnv(n.home), stdin: Buffer.from('0000'), stdout: 'pipe', stderr: 'pipe' })
    expect(direct.exitCode).toBe(128)
    expect(direct.stderr.toString()).toContain('does not appear to be a git repository')
  }, 30_000)

  test('the control run: v2 outside the gate serves the hidden want', () => {
    const n = makeNuance()
    const air = temp('cb-air-')
    git(['init', '-q', '-b', 'main', air], air)
    const up = `${GIT.path} ${UPLOAD_PACK_CONFIG.join(' ')} upload-pack`
    // fixtureGit throws with git's stderr on a non-zero exit. With protocol v2 and the gate's own -c pairs, the fetch succeeds.
    git(['-C', air, '-c', 'protocol.version=2', 'fetch', '--no-tags', `--upload-pack=${up}`, `file://${n.gitdir}`, n.secret], air)
    expect(git(['-C', air, 'cat-file', '-t', n.secret], air)).toBe('commit')   // K49: only an unset GIT_PROTOCOL stops this
  }, 30_000)
})

describe('checkUploadPackPath', () => {
  test('a shared edit gitdir passes, with itself as the common dir', () => {
    const n = makeNuance()
    expect(checkUploadPackPath(n.gitdir, ctxOf(n))).toEqual({ ok: true, gitdir: n.gitdir, worktree: n.share })
  })

  test('traversal and doubled or trailing slashes are refused', () => {
    const n = makeNuance()
    const ctx = ctxOf(n)
    for (const p of [
      `${n.share}//.git`, `${n.share}/./.git`, `${n.share}/../collab-trial/.git`, `${n.gitdir}/`, `${n.gitdir}/.`, `${n.gitdir}/..`,
      'relative/.git', '',
    ]) expect([p, checkUploadPackPath(p, ctx)]).toEqual([p, { ok: false, code: 'path_form' }])
  })

  test('a path that is not its own realpath is refused', () => {
    const n = makeNuance()
    expect(n.gitdir.startsWith('/private/var/')).toBe(true)          // $TMPDIR's realpath; /var is a symlink to /private/var
    const viaSymlink = n.gitdir.slice('/private'.length)
    expect(checkUploadPackPath(viaSymlink, ctxOf(n))).toEqual({ ok: false, code: 'not_realpath' })
    expect(checkUploadPackPath(join(n.share, 'missing.git'), ctxOf(n))).toEqual({ ok: false, code: 'not_realpath' })
  })

  test('a gitdir that shares.json does not list is refused', () => {
    const n = makeNuance()
    expect(checkUploadPackPath(n.gitdir, ctxOf(n, []))).toEqual({ ok: false, code: 'not_shared' })
  })

  test('a folder whose longest allowlist match is review is refused', () => {
    // An edit parent with a review child: the child decides.
    const n = makeNuance({ folders: [{ path: '~/Projects', access: 'edit' }, { path: '~/Projects/collab-trial', access: 'review' }] })
    expect(checkUploadPackPath(n.gitdir, ctxOf(n))).toEqual({ ok: false, code: 'not_edit_folder' })
    // No allowlist at all is no edit grant.
    expect(checkUploadPackPath(n.gitdir, { ...ctxOf(n), allowlist: null })).toEqual({ ok: false, code: 'not_edit_folder' })
  })

  test('a symlinked .git is refused', () => {
    const n = makeNuance()
    const elsewhere = join(n.home, 'Projects', 'collab-trial.git')
    git(['clone', '-q', '--bare', n.share, elsewhere], n.home)
    rmSync(n.gitdir, { recursive: true, force: true })
    symlinkSync(elsewhere, n.gitdir)
    const shares = [{ realpath: n.share, gitdir: elsewhere }]
    expect(checkUploadPackPath(elsewhere, ctxOf(n, shares))).toEqual({ ok: false, code: 'git_link' })
  })

  test('a gitdir file pointing at a root-owned dir is refused', () => {
    const n = makeNuance()
    rmSync(n.gitdir, { recursive: true, force: true })
    writeFileSync(n.gitdir, 'gitdir: /usr/share/man\n')
    const shares = [{ realpath: n.share, gitdir: '/usr/share/man' }]
    // It is outside every edit folder, so that check refuses it first …
    expect(checkUploadPackPath('/usr/share/man', ctxOf(n, shares))).toEqual({ ok: false, code: 'outside_edit_folder' })
    // … and it is owned by root, so it is refused even where an edit entry covers it (§12.1 Ownership).
    writeFileSync(n.paths.summonAllowlist, allowlistYaml([{ path: '~/Projects/collab-trial', access: 'edit' }, { path: '/usr/share', access: 'edit' }]))
    expect(checkUploadPackPath('/usr/share/man', ctxOf(n, shares))).toEqual({ ok: false, code: 'foreign_owner' })
  })

  test('a linked work tree is checked through its common dir', () => {
    const n = makeNuance({ folders: [{ path: '~/Projects/collab-trial', access: 'edit' }] })
    const main = join(n.home, 'Projects', 'main')
    secretBranchRepo(main, n.home)
    const wt = join(n.home, 'Projects', 'collab-trial', 'wt')
    git(['-C', main, 'worktree', 'add', '-q', '--detach', wt, 'main'], n.home)
    const gitdir = realpathSync(join(main, '.git', 'worktrees', 'wt'))
    const shares = [{ realpath: wt, gitdir }]
    // The work tree is in the edit folder, but its gitdir and common dir are in ~/Projects/main, which is not.
    expect(checkUploadPackPath(gitdir, ctxOf(n, shares))).toEqual({ ok: false, code: 'outside_edit_folder' })
    writeFileSync(n.paths.summonAllowlist, allowlistYaml([{ path: '~/Projects/collab-trial', access: 'edit' }, { path: '~/Projects/main', access: 'edit' }]))
    expect(checkUploadPackPath(gitdir, ctxOf(n, shares))).toEqual({ ok: true, gitdir, worktree: wt })
  })

  test('objects/info/alternates is refused', () => {
    const n = makeNuance()
    writeFileSync(join(n.gitdir, 'objects', 'info', 'alternates'), '/tmp/other/objects\n')
    expect(checkUploadPackPath(n.gitdir, ctxOf(n))).toEqual({ ok: false, code: 'alternates' })
  })

  test('a path in ~/Documents, by spelling or through a symlink, is refused', () => {
    const n = makeNuance({ folders: [{ path: '~/Projects', access: 'edit' }, { path: '~/Documents', access: 'edit' }, { path: '~/Cloud', access: 'edit' }] })
    // By spelling: a real repo inside ~/Documents.
    const docs = join(n.home, 'Documents', 'proj')
    secretBranchRepo(docs, n.home)
    const inDocs = [{ realpath: docs, gitdir: join(docs, '.git') }]
    expect(checkUploadPackPath(join(docs, '.git'), ctxOf(n, inDocs))).toEqual({ ok: false, code: 'tcc_protected' })
    // Through a symlink into ~/Documents: the path is never its own realpath.
    symlinkSync(docs, join(n.home, 'Projects', 'docs-link'))
    expect(checkUploadPackPath(join(n.home, 'Projects', 'docs-link', '.git'), ctxOf(n, inDocs))).toEqual({ ok: false, code: 'not_realpath' })
    // By target: ~/Documents is itself a symlink, and the path is spelled through the place it points at.
    const n2 = makeNuance({ folders: [{ path: '~/Projects', access: 'edit' }, { path: '~/Cloud', access: 'edit' }] })
    const cloud = join(n2.home, 'Cloud', 'Docs', 'proj')
    secretBranchRepo(cloud, n2.home)
    symlinkSync(join(n2.home, 'Cloud', 'Docs'), join(n2.home, 'Documents'))
    const inCloud = [{ realpath: cloud, gitdir: join(cloud, '.git') }]
    expect(checkUploadPackPath(join(cloud, '.git'), ctxOf(n2, inCloud))).toEqual({ ok: false, code: 'tcc_protected' })
    // A work tree in ~/Documents whose gitdir file points outside it is refused because of where the work tree is.
    const outside = join(n2.home, 'Projects', 'gitdirs', 'p.git')
    const wtInDocs = join(n2.home, 'Cloud', 'Docs', 'p')
    mkdirSync(wtInDocs, { recursive: true })
    mkdirSync(join(n2.home, 'Projects', 'gitdirs'), { recursive: true })
    git(['init', '-q', '-b', 'main', `--separate-git-dir=${outside}`, wtInDocs], n2.home)
    expect(checkUploadPackPath(outside, ctxOf(n2, [{ realpath: wtInDocs, gitdir: outside }]))).toEqual({ ok: false, code: 'tcc_protected' })
  })
})

describe('runFetchGate', () => {
  test('a refusal answers one pkt-line ERR, one stderr line and exit 64', async () => {
    const n = makeNuance()
    const c = captureIo()
    expect(await runFetchGate(n.share, ctxOf(n), c.io)).toEqual({ exit: 64, outcome: 'not_shared', bytes: 0 })
    expect(c.out()).toBe('0013ERR not_shared\n')
    expect(c.err().split('\n').filter(Boolean)).toHaveLength(1)
  })

  test('a sha256 mismatch answers ERR git_changed', async () => {
    const n = makeNuance()
    const c = captureIo()
    const changed = { ...GIT, sha256: '0'.repeat(64) }
    expect(await runFetchGate(n.gitdir, ctxOf(n, undefined, changed), c.io)).toEqual({ exit: 64, outcome: 'git_changed', bytes: 0 })
    expect(c.out()).toBe(Buffer.from(pktLineErr('git_changed')).toString('latin1'))
    // A recorded git that no longer exists counts as changed too.
    const gone = captureIo()
    expect((await runFetchGate(n.gitdir, ctxOf(n, undefined, { ...GIT, path: join(n.home, 'no-git') }), gone.io)).outcome).toBe('git_changed')
  })

  test('a git below the floor answers ERR git_unsafe', async () => {
    const n = makeNuance()
    const c = captureIo()
    const old = { ...GIT, version: '2.44.0', apple: false, guard: true }
    expect(await runFetchGate(n.gitdir, ctxOf(n, undefined, old), c.io)).toEqual({ exit: 64, outcome: 'git_unsafe', bytes: 0 })
    expect(c.out()).toBe('0013ERR git_unsafe\n')
  })

  test('the env reaching git has exactly the seven keys', async () => {
    const n = makeNuance()
    const dir = temp('cb-stub-git-')
    const stub = writeStub(dir, 'git', `/usr/bin/env > '${dir}/env.txt'\nprintf '%s\\n' "$@" > '${dir}/args.txt'\nprintf 'served'\n`)
    const stubGit = { path: stub, version: '2.52.0', sha256: sha256File(stub), guard: true, apple: false }
    const before = process.env.GIT_PROTOCOL
    process.env.GIT_PROTOCOL = 'version=2'         // set in the gate's own env, as a permissive sshd would leave it
    try {
      const c = captureIo()
      expect(await runFetchGate(n.gitdir, ctxOf(n, undefined, stubGit), c.io)).toEqual({ exit: 0, outcome: 'served', bytes: 6 })
      expect(c.out()).toBe('served')
    } finally {
      if (before === undefined) delete process.env.GIT_PROTOCOL
      else process.env.GIT_PROTOCOL = before
    }
    const env = Object.fromEntries(readFileSync(join(dir, 'env.txt'), 'utf8').split('\n').filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]).filter(([k]) => !BASH_OWN.includes(k!)))
    expect(env).toEqual(gitEnv(n.home))
    expect(readFileSync(join(dir, 'args.txt'), 'utf8').split('\n').filter(Boolean)).toEqual(uploadPackArgv(n.gitdir))
  })

  test('real upload-pack under the gate advertises only HEAD and refuses a hidden want with not our ref', async () => {
    const n = makeNuance()
    const c = captureIo(hiddenWant(n))
    const r = await runFetchGate(n.gitdir, ctxOf(n), c.io)
    expect(r).toMatchObject({ exit: 128, outcome: 'git_failed' })
    expect(r.bytes).toBeGreaterThan(0)
    expect(r.bytes).toBe(c.out().length)                       // bytes counts exactly what git wrote to stdout (latin1: one char per byte)
    expect(c.out()).toContain(`${n.head} HEAD\0`)              // v0: HEAD comes first, with the capabilities after a NUL
    expect(c.out()).not.toMatch(/[0-9a-f]{40} refs\//)          // no ref under refs/ is advertised (hideRefs=refs/)
    expect(c.out()).toContain(`ERR upload-pack: not our ref ${n.secret}`)   // K49: the server refuses the want itself
    expect(c.err()).toContain('not our ref')
  }, 30_000)

  test('GIT_PROTOCOL=version=2 in the gate env never reaches upload-pack, and the hidden want is still refused', async () => {
    const n = makeNuance()
    // Control: the same upload-pack that is handed GIT_PROTOCOL speaks v2, opening with `version 2` and advertising no refs.
    const v2 = Bun.spawnSync([GIT.path, ...uploadPackArgv(n.gitdir)], {
      env: { ...gitEnv(n.home), GIT_PROTOCOL: 'version=2' }, stdin: Buffer.from('0000'), stdout: 'pipe', stderr: 'pipe',
    })
    expect(v2.stdout.toString('latin1').startsWith('000eversion 2\n')).toBe(true)
    const before = process.env.GIT_PROTOCOL
    process.env.GIT_PROTOCOL = 'version=2'         // set in the gate's own env, as an sshd with AcceptEnv GIT_PROTOCOL would leave it
    try {
      const c = captureIo(hiddenWant(n))
      expect(await runFetchGate(n.gitdir, ctxOf(n), c.io)).toMatchObject({ exit: 128, outcome: 'git_failed' })
      expect(c.out()).not.toContain('version 2')
      expect(c.out()).toContain(`${n.head} HEAD\0`)
      expect(c.out()).not.toMatch(/[0-9a-f]{40} refs\//)
      expect(c.out()).toContain(`ERR upload-pack: not our ref ${n.secret}`)
    } finally {
      if (before === undefined) delete process.env.GIT_PROTOCOL
      else process.env.GIT_PROTOCOL = before
    }
  }, 30_000)
})

describe('a fetch whose client has gone or run out of time (Task 63 gate-1-9)', () => {
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

  /** A recorded git that writes for ever. It records its pid, and is that very process (exec), so a kill reaches it. */
  function endlessGit(n: Nuance, body: string) {
    const dir = temp('cb-endless-git-')
    const stub = writeStub(dir, 'git', `echo $$ > '${dir}/pid'\n${body}`)
    const git = { path: stub, version: '2.52.0', sha256: sha256File(stub), guard: true, apple: false }
    return { ctx: ctxOf(n, undefined, git), pid: () => Number(readFileSync(join(dir, 'pid'), 'utf8').trim()) }
  }

  test('once the sink says the client is gone, git is killed, nothing more is written, and the outcome is client_gone, not served', async () => {
    const n = makeNuance()
    const g = endlessGit(n, 'exec /usr/bin/yes')
    let writes = 0
    const io = { stdin: new Blob(['']).stream(), stdout: { write: () => { writes++ } }, stderr: { write() {} },
      stopped: () => (writes >= 3 ? ('client_gone' as const) : null) }
    const r = await runFetchGate(n.gitdir, g.ctx, io)
    expect(r).toMatchObject({ exit: FETCH_STOPPED_EXIT, outcome: 'client_gone' })
    expect(writes).toBe(3)                                   // it stopped at the first chunk after the sink said so
    expect(alive(g.pid())).toBe(false)                       // git was stopped, not left to run into a dead sink
  }, 30_000)

  test('a deadline stops it the same way, with the outcome deadline', async () => {
    const n = makeNuance()
    const g = endlessGit(n, 'exec /usr/bin/yes')
    let writes = 0
    const io = { stdin: new Blob(['']).stream(), stdout: { write: () => { writes++ } }, stderr: { write() {} },
      stopped: () => (writes >= 2 ? ('deadline' as const) : null) }
    expect(await runFetchGate(n.gitdir, g.ctx, io)).toMatchObject({ exit: FETCH_STOPPED_EXIT, outcome: 'deadline' })
    expect(alive(g.pid())).toBe(false)
  }, 30_000)

  test('a git that ignores SIGTERM is killed with SIGKILL after the grace', async () => {
    const n = makeNuance()
    const g = endlessGit(n, "trap '' TERM\nwhile :; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; done")
    let writes = 0
    const io = { stdin: new Blob(['']).stream(), stdout: { write: () => { writes++ } }, stderr: { write() {} },
      stopped: () => (writes >= 1 ? ('client_gone' as const) : null), killGraceMs: 300 }
    const t0 = Date.now()
    expect(await runFetchGate(n.gitdir, g.ctx, io)).toMatchObject({ exit: FETCH_STOPPED_EXIT, outcome: 'client_gone' })
    expect(Date.now() - t0).toBeLessThan(10_000)
    expect(alive(g.pid())).toBe(false)
  }, 30_000)

  test('a fetch that is never told to stop is served as before', async () => {
    const n = makeNuance()
    const c = captureIo()
    const io = { ...c.io, stopped: () => null }
    expect(await runFetchGate(n.gitdir, ctxOf(n), io)).toMatchObject({ outcome: 'git_failed' })   // real upload-pack on an empty request
  }, 30_000)
})
