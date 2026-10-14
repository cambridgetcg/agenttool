import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { readDevice } from '../src/air/devices.ts'
import { DEFAULT_CAPS, isControlPath } from '../src/air/diff-check.ts'
import { mirrorIdOf } from '../src/air/mirror.ts'
import { seatTools } from '../src/air/policy-table.ts'
import { parseAllowlist } from '../src/allowlist.ts'
import { parseManifest } from '../src/nuance/install-steps.ts'
import { airPaths } from '../src/paths.ts'
import { readToolsFile, toolsDigest } from '../src/tools-digest.ts'
import type { NuanceBuild } from '../scripts/build-nuance.ts'
import { parsePrepareArgs, prepareBundle, readyText, TRIAL_README, type PrepareInput } from '../scripts/prepare-pairing.ts'
import { readToolsFixture } from './fixtures/make-collab-tools.ts'
import { cleanupTmps, COLLAB_DIST, makeRepo, modeOf, PKG, REAL_GIT, repoGit, sha256File, temp } from './helpers.ts'

afterEach(cleanupTmps)

const T = 60_000 // each prepare runs git and one Collab probe child
const TRAILER = 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>'
const NUANCE_SHARE = '/Users/macair/Projects/collab-trial'
const NOW = Date.UTC(2026, 9, 13, 12, 34, 56) // 2026-10-13T12:34:56Z
/** A test git identity and no system config: the temp Air home has no ~/.gitconfig. */
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Collab Test', GIT_AUTHOR_EMAIL: 'test@collab-bridge.invalid',
  GIT_COMMITTER_NAME: 'Collab Test', GIT_COMMITTER_EMAIL: 'test@collab-bridge.invalid' }

/** A clean git repo standing in for the bridge worktree: prepare reads the installer template from it. */
function bridgeRepo(): string {
  const repo = temp('cb-pair-repo-')
  makeRepo(repo, { 'packages/collab-bridge/nuance/install.sh.tmpl': readFileSync(join(PKG, 'nuance', 'install.sh.tmpl'), 'utf8') })
  return repo
}

/** Stands in for the 63 MB compile (Task 58): one small file and its real digest. */
function standInBuild(tag = ''): () => NuanceBuild {
  return () => {
    const binary = join(temp('cb-pair-build-'), 'collab-bridge')
    writeFileSync(binary, `#!/bin/sh\necho stand-in${tag}\n`, { mode: 0o755 })
    const sha256 = sha256File(binary)
    return { binary, sha256, build: sha256.slice(0, 8) }
  }
}

function input(o: Partial<PrepareInput> = {}): PrepareInput {
  const home = o.home ?? temp('cb-pair-air-')
  return {
    home, repo: bridgeRepo(), device: 'nuance', user: 'macair',
    shares: [{ remote: NUANCE_SHARE, airClone: join(home, 'Projects', 'collab-trial') }],
    trailer: TRAILER, collabDist: COLLAB_DIST, bun: process.execPath, git: REAL_GIT, now: NOW, build: standInBuild(), gitEnv: GIT_ENV,
    ...o,
  }
}

const cloneOf = (o: PrepareInput) => o.shares[0]!.airClone

describe('parsePrepareArgs', () => {
  test('reads the four flags and refuses anything else', () => {
    expect(parsePrepareArgs(['--device', 'nuance', '--user', 'macair', '--share', `${NUANCE_SHARE}=/Users/yuai/Projects/collab-trial`, '--trailer', TRAILER]))
      .toEqual({ device: 'nuance', user: 'macair', shares: [{ remote: NUANCE_SHARE, airClone: '/Users/yuai/Projects/collab-trial' }], trailer: TRAILER })
    for (const argv of [[], ['--device', 'nuance'], ['--device', 'nuance', '--user', 'macair', '--trailer', TRAILER],
      ['--device', 'nuance', '--user', 'macair', '--share', NUANCE_SHARE, '--trailer', TRAILER],
      ['--device', 'nuance', '--device', 'zerone', '--user', 'macair', '--share', `${NUANCE_SHARE}=/a`, '--trailer', TRAILER],
      ['--device', 'nuance', '--user', 'macair', '--share', `${NUANCE_SHARE}=/a`, '--trailer', TRAILER, 'extra'],
      ['--device', 'nuance', '--user', 'macair', '--share', `${NUANCE_SHARE}=/a`, '--trailer']]) {
      expect(parsePrepareArgs(argv)).toHaveProperty('error')
    }
  })
})

describe('prepareBundle (the Air side of pairing, spec §10.2 step 1)', () => {
  test('refuses a dirty bridge tree', async () => {
    const o = input()
    appendFileSync(join(o.repo, 'packages', 'collab-bridge', 'nuance', 'install.sh.tmpl'), '# an edit not yet committed\n')
    await expect(prepareBundle(o)).rejects.toThrow('uncommitted changes')
    expect(readdirSync(o.home)).toEqual([])
  }, T)

  test('expiry is the pairing date + 90 days, YYYYMMDD', async () => {
    const a = await prepareBundle(input())
    expect([a.expiry, a.preparedAt]).toEqual(['20270111', '20261013123456'])
    const o = input({ now: Date.UTC(2026, 10, 30, 23, 59, 59) }) // across the ends of November, December and January
    const b = await prepareBundle(o)
    expect([b.expiry, b.preparedAt]).toEqual(['20270228', '20261130235959'])
    expect(readDevice(airPaths(o.home).deviceFile('nuance'))!.key_expiry).toBe('20270228')
    expect(parseManifest(readFileSync(join(b.bundle, 'MANIFEST.txt'), 'utf8'))!.expiry).toBe('20270228')
  }, T)

  test('creates the trial repo once with README.md, notes/.gitkeep and the trailer', async () => {
    const o = input()
    const r = await prepareBundle(o)
    const clone = cloneOf(o)
    expect(repoGit(clone, ['rev-list', '--count', 'HEAD'])).toBe('1')
    expect(repoGit(clone, ['symbolic-ref', '--short', 'HEAD'])).toBe('main')
    expect(repoGit(clone, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).toEqual(['README.md', 'notes/.gitkeep'])
    expect(readFileSync(join(clone, 'README.md'), 'utf8')).toBe(TRIAL_README)
    expect(readFileSync(join(clone, 'notes', '.gitkeep'), 'utf8')).toBe('')
    expect(repoGit(clone, ['log', '-1', '--format=%B']).trimEnd().split('\n').at(-1)).toBe(TRAILER)
    expect(repoGit(clone, ['status', '--porcelain'])).toBe('')
    expect(r.trialCommit).toBe(repoGit(clone, ['rev-parse', 'HEAD']))
    const again = await prepareBundle({ ...o, now: NOW + 60_000 })
    expect([again.trialCommit, repoGit(clone, ['rev-list', '--count', 'HEAD'])]).toEqual([r.trialCommit, '1'])
  }, T)

  test('the trial README carries the four Air-session rules and is not a control path', () => {
    expect(TRIAL_README.split('\n')[0]).toMatch(/^collab-trial: /)
    expect(TRIAL_README).toContain('\nRules for Air sessions here (Phase 1):\n')
    for (const rule of [
      'Never merge, check out, switch to, reset to, rebase onto, restore from or cherry-pick a refs/collab/* ref',
      'Never offer a handoff to a remote session',
      'Before taking over a task a remote actor holds, run `collab-bridge hub status` and send an addressed note first, or recover only by release or block',
      'Review remote work with `git diff --no-ext-diff --no-textconv <base> refs/collab/<device>/<user>/<mirror_id>/tasks/<task_id>`',
    ]) expect(TRIAL_README).toContain(rule)
    expect(isControlPath('README.md')).toBe(false)
    expect(isControlPath('notes/.gitkeep')).toBe(false)
  })

  test('keeps an existing trial repo', async () => {
    const o = input()
    const head = makeRepo(cloneOf(o), { 'README.md': 'my own trial\n', 'notes/.gitkeep': '' })
    const r = await prepareBundle(o)
    expect(r.trialCommit).toBe(head)
    expect(readFileSync(join(cloneOf(o), 'README.md'), 'utf8')).toBe('my own trial\n')
    expect(repoGit(cloneOf(o), ['rev-list', '--count', 'HEAD'])).toBe('1')
    // A folder that exists but is not a repository root is refused, never turned into one.
    const p = input()
    mkdirSync(cloneOf(p), { recursive: true })
    writeFileSync(join(cloneOf(p), 'notes.txt'), 'not a repo\n')
    await expect(prepareBundle(p)).rejects.toThrow('not the root of a git repository with a commit')
    expect(readdirSync(cloneOf(p))).toEqual(['notes.txt'])
  }, T)

  test('makes the collab key once, with comment collab-air', async () => {
    const o = input()
    const r = await prepareBundle(o)
    const key = airPaths(o.home).sshKey('nuance')
    const pub = readFileSync(`${key}.pub`, 'utf8')
    expect(pub).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ collab-air\n$/)
    expect([modeOf(key), modeOf(`${key}.pub`), modeOf(dirname(key))]).toEqual([0o600, 0o600, 0o700])
    expect(readFileSync(join(r.bundle, 'collab-install.sh'), 'utf8')).toContain(pub.trim())
    const before = sha256File(key)
    chmodSync(`${key}.pub`, 0o644)
    await prepareBundle({ ...o, now: NOW + 60_000 })
    expect([readFileSync(`${key}.pub`, 'utf8'), sha256File(key), modeOf(`${key}.pub`)]).toEqual([pub, before, 0o600])
  }, T)

  test("refuses a share path with ' or !, or longer than 1019 bytes", async () => {
    for (const remote of ["/Users/macair/it's-mine", '/Users/macair/hey!', `/Users/macair/${'a'.repeat(1006)}`, 'Projects/collab-trial']) {
      const o = input()
      o.shares = [{ remote, airClone: cloneOf(o) }]
      await expect(prepareBundle(o)).rejects.toThrow('--share')
      expect(readdirSync(o.home)).toEqual([])
    }
  }, T)

  test('every template value is regex-checked', async () => {
    const bad: Array<Partial<PrepareInput>> = [
      { device: 'Nuance' }, { device: 'nu ance' }, { user: 'MacAir' }, { user: 'mac air' }, { user: '-oProxyCommand=x' },
      { trailer: "it's mine" }, { trailer: 'two\nlines' }, { trailer: '' },
    ]
    for (const b of bad) {
      const o = input(b)
      await expect(prepareBundle(o)).rejects.toThrow('prepare:')
      expect(readdirSync(o.home)).toEqual([])
    }
    const o = input()
    o.shares = [{ remote: '/Users/macair/b\\c', airClone: cloneOf(o) }] // a backslash: the gate's form cannot carry it
    await expect(prepareBundle(o)).rejects.toThrow('prepare:')
    expect(readdirSync(o.home)).toEqual([])
  }, T)

  test('MANIFEST lists the sha256 of every file and the template carries the same', async () => {
    const r = await prepareBundle(input())
    expect(readdirSync(r.bundle).sort()).toEqual(['MANIFEST.txt', 'collab-bridge', 'collab-install.sh', 'collab-trial.bundle', 'tools.json'])
    const text = readFileSync(join(r.bundle, 'MANIFEST.txt'), 'utf8')
    const files = Object.fromEntries(['collab-bridge', 'tools.json', 'collab-trial.bundle'].map((n) => [n, sha256File(join(r.bundle, n))]))
    for (const [name, sha] of Object.entries(files)) expect(text).toContain(`sha256 ${sha} ${name}\n`)
    const m = parseManifest(text)!
    expect(m.files).toEqual(files)
    expect(m).toMatchObject({ device: 'nuance', build: r.build, prepared: r.preparedAt, expiry: r.expiry, binary_sha256: files['collab-bridge'],
      tools_digest: r.toolsDigest, trial_commit: r.trialCommit, shares: [NUANCE_SHARE] })
    const installer = readFileSync(join(r.bundle, 'collab-install.sh'), 'utf8')
    for (const sha of [...Object.values(files), sha256File(join(r.bundle, 'MANIFEST.txt'))]) expect(installer).toContain(sha)
    expect(r.build).toBe(files['collab-bridge']!.slice(0, 8))
  }, T)

  test("tools.json's digest is the seat list's", async () => {
    const r = await prepareBundle(input())
    const f = readToolsFile(join(r.bundle, 'tools.json'))!
    const want = toolsDigest(seatTools(readToolsFixture().tools, 'nuance', 'macair'))
    expect([f.digest, r.toolsDigest]).toEqual([want, want])
    expect(f.list.length).toBe(24)
  }, T)

  test('the bundle clones and shares history with the Air repo', async () => {
    const o = input()
    const r = await prepareBundle(o)
    const into = temp('cb-pair-clone-')
    repoGit(into, ['clone', '-q', join(r.bundle, 'collab-trial.bundle'), 'collab-trial'])
    const dest = join(into, 'collab-trial')
    expect(repoGit(dest, ['rev-parse', 'HEAD'])).toBe(r.trialCommit)
    expect(readFileSync(join(dest, 'README.md'), 'utf8')).toBe(TRIAL_README)
    expect(repoGit(cloneOf(o), ['merge-base', r.trialCommit, 'HEAD'])).toBe(r.trialCommit)
  }, T)

  test('writes the device file as prepared', async () => {
    const o = input()
    const r = await prepareBundle(o)
    const paths = airPaths(o.home)
    expect(readDevice(paths.deviceFile('nuance'))).toEqual({
      v: 1, device: 'nuance', user: 'macair', state: 'prepared', host_alias: 'collab-nuance', seat_public: null, bundle_build: r.build,
      key_expiry: r.expiry, trailer: TRAILER, git: null, summon: null,
      shares: [{ remote_realpath: NUANCE_SHARE, remote_gitdir: null, air_clone: cloneOf(o), mirror_id: mirrorIdOf(NUANCE_SHARE),
        mirror_worktree_id: null, workspace_id: null, caps: DEFAULT_CAPS }],
      prepared_at: new Date(NOW).toISOString(), paired_at: null,
    })
    expect([modeOf(paths.deviceFile('nuance')), modeOf(paths.devicesDir)]).toEqual([0o600, 0o700])
  }, T)

  test('prints the two-line allowlist entry and the exact install line', async () => {
    const r = await prepareBundle(input())
    const folder = basename(r.bundle)
    expect(folder).toBe(`collab-bridge-nuance-bundle-${r.expiry}-${r.build}`)
    expect(r.command).toBe(`bash ~/Downloads/${folder}/collab-install.sh`)
    expect(r.allowlistEntry).toBe('  - path: ~/Projects/collab-trial\n    access: edit')
    const text = readyText(r)
    expect(text).toContain(`bundle ready: ${r.bundle} (build ${r.build}, prepared ${r.preparedAt} UTC)\n`)
    expect(text).toContain('the collab key expires 2027-01-11 (20270111)')
    expect(text).toContain(`\n${r.allowlistEntry}\n`)
    expect(text).toContain(`\n  ${r.command}\n`)
    expect(text).not.toContain('rm -rf')
    // Summon's own parser takes the printed lines as an edit folder (Task 17's copy of it).
    const al = parseAllowlist(['version: 1', 'device: nuance', 'peers: [air]', 'runtimes:', '  - id: claude', '    models:', '      - model: sonnet',
      'folders:', '  - path: ~/Projects', '    access: review', r.allowlistEntry, 'limits:', '  max_concurrent: 1', '  starts_per_hour: 6',
      '  job_timeout_max: 30m', ''].join('\n'))
    expect(al.ok && al.allowlist.folders).toEqual([{ path: '~/Projects', access: 'review' }, { path: '~/Projects/collab-trial', access: 'edit' }])
  }, T)

  test('bundle dirs are 0700 and files 0600', async () => {
    const o = input()
    const r = await prepareBundle(o)
    expect(modeOf(r.bundle)).toBe(0o700)
    for (const f of ['collab-install.sh', 'MANIFEST.txt', 'tools.json', 'collab-trial.bundle']) expect([f, modeOf(join(r.bundle, f))]).toEqual([f, 0o600])
    expect(modeOf(join(r.bundle, 'collab-bridge'))).toBe(0o700)
    // A second run with the same build and day reuses the folder and tightens looser modes.
    chmodSync(r.bundle, 0o755)
    chmodSync(join(r.bundle, 'MANIFEST.txt'), 0o644)
    const again = await prepareBundle(o)
    expect([again.bundle, modeOf(r.bundle), modeOf(join(r.bundle, 'MANIFEST.txt'))]).toEqual([r.bundle, 0o700, 0o600])
    // A new build gets a folder of its own; the older one is listed, never removed.
    const newer = await prepareBundle({ ...o, build: standInBuild(' v2') })
    expect(newer.bundle).not.toBe(r.bundle)
    expect(newer.older).toEqual([r.bundle])
    expect(existsSync(join(r.bundle, 'collab-install.sh'))).toBe(true)
    expect(readyText(newer)).toContain(`rm -rf '${r.bundle}'`)
  }, T)
})
