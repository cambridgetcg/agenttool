import { afterEach, describe, expect, test } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installCheck, installSettings, installWrite, tapCommand, uninstallSettings } from '../src/nuance/install-steps.ts'
import { readInstalled, readShares } from '../src/nuance/installed.ts'
import { readSeatPublicHex } from '../src/nuance/seatkey.ts'
import { readCurrentTools, seededNames } from '../src/nuance/tools-cache.ts'
import { writeToolsFile } from '../src/tools-digest.ts'
import { checkInput, claudeStub, FIXTURE_TOOLS, FIXTURE_TRAILER, summonReadyHome, makeTrialRepo, writeCheckBundle, type NuanceHome } from './install-fixtures.ts'
import { cleanupTmps, commitFiles, modeOf, PKG, REAL_GIT, repoGit, temp } from './helpers.ts'

afterEach(cleanupTmps)

const NOW = new Date('2026-10-13T12:34:56.000Z')

/** A home whose checks pass with the trial already cloned at the share and this bundle's binary installed, as bash leaves it before `install write`. */
function ready() {
  const h = summonReadyHome()
  const trial = makeTrialRepo()
  const b = writeCheckBundle({ trial, shares: [h.share] })
  repoGit('/', ['clone', '-q', trial.repo, h.share])
  repoGit(h.share, ['remote', 'remove', 'origin'])
  mkdirSync(h.paths.share, { recursive: true, mode: 0o700 })
  copyFileSync(join(b.dir, 'collab-bridge'), h.paths.binary)
  const report = installCheck(checkInput(h, b))
  if (!report.ok) throw new Error(report.failures.join('; '))
  return { h, trial, b, report }
}

const settingsOf = (folder: string) => join(folder, '.claude', 'settings.local.json')
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const exclude = (folder: string) => { const p = join(folder, '.git', 'info', 'exclude'); return existsSync(p) ? readFileSync(p, 'utf8') : '' }
const born = (p: string) => statSync(p, { bigint: true }).birthtimeNs

/** The verbs as the installer runs them: the Nuance entry from source, in the home's own test env. */
function verb(h: NuanceHome, args: string[]) {
  const r = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', `${PKG}/src/nuance/main.ts`, 'install', ...args],
    { env: h.env, cwd: '/', stdout: 'pipe', stderr: 'pipe' })
  const out = r.stdout.toString().trim()
  return { code: r.exitCode, json: out === '' ? null : JSON.parse(out.split('\n').pop()!), stderr: r.stderr.toString() }
}

describe('install write', () => {
  test('writes INSTALLED, the seat key, shares.json, the state dirs and the seed, in that order', () => {
    const { h, b, report } = ready()
    const r = installWrite({ paths: h.paths, report, bundle: b.dir, claudeVersion: '2.1.296 (Claude Code)\n', now: NOW })
    if (!r.ok) throw new Error(r.reason)
    expect(r.created_seat).toBe(true)
    expect(readSeatPublicHex(h.paths)).toBe(r.seat_public)
    const i = readInstalled(h.paths)!
    expect(i).toEqual({ device: 'nuance', build: b.manifest.build, prepared: b.manifest.prepared, expiry: b.manifest.expiry,
      binary_sha256: b.manifest.binary_sha256, tools_seed: b.manifest.tools_digest, git: report.git!, summon_key_sha256: report.summon!.key_sha256,
      summon_dropin_stat: report.summon!.dropin_stat, claude_version: '2.1.296 (Claude Code)', installed_at: '2026-10-13T12:34:56.000Z' })
    expect(readShares(h.paths)).toEqual([{ realpath: h.share, gitdir: join(h.share, '.git') }])
    for (const d of [h.paths.state, h.paths.run, h.paths.pipes, h.paths.lineages, h.paths.tools]) expect([d, modeOf(d)]).toEqual([d, 0o700])
    for (const f of [h.paths.installed, h.paths.seatKey, h.paths.seatPub, h.paths.shares, h.paths.toolsSeed]) expect([f, modeOf(f)]).toEqual([f, 0o600])
    expect(readCurrentTools(h.paths)!.digest).toBe(b.manifest.tools_digest)
    expect([...seededNames(h.paths)!].sort()).toEqual(FIXTURE_TOOLS.map((t) => t.name).sort())
    const order = [h.paths.installed, h.paths.seatKey, h.paths.shares, h.paths.lineages, h.paths.toolsSeed].map(born)
    for (let k = 1; k < order.length; k++) expect(order[k - 1]! < order[k]!).toBe(true)
  }, 30_000)

  test('a second install keeps the seat key', () => {
    const { h, b, report } = ready()
    const first = installWrite({ paths: h.paths, report, bundle: b.dir, claudeVersion: null, now: NOW })
    const key = readFileSync(h.paths.seatKey)
    const second = installWrite({ paths: h.paths, report, bundle: b.dir, claudeVersion: null, now: new Date(NOW.getTime() + 60_000) })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.created_seat).toBe(false)
    expect(second.seat_public).toBe(first.seat_public)
    expect(readFileSync(h.paths.seatKey).equals(key)).toBe(true)
    expect(readInstalled(h.paths)!.claude_version).toBeNull()
  }, 30_000)

  test('a tools.json whose digest differs from MANIFEST is refused before anything else', () => {
    const { h, b, report } = ready()
    writeToolsFile(join(b.dir, 'tools.json'), [{ name: 'collab_next', inputSchema: { type: 'object' } }])
    const r = installWrite({ paths: h.paths, report, bundle: b.dir, claudeVersion: null, now: NOW })
    expect(r.ok).toBe(false)
    for (const p of [h.paths.installed, h.paths.seatKey, h.paths.shares, h.paths.tools]) expect([p, existsSync(p)]).toEqual([p, false])
  }, 30_000)

  test('a share path the gate cannot serve is refused before the first write, so INSTALLED never outlives a failed shares.json (Task 63 conformance-7-1)', () => {
    const { h, b, report } = ready()
    for (const real of ['/Users/macair/W!rk/trial', "/Users/macair/it's/trial", '/Users/macair/' + 'x'.repeat(1100)]) {
      const bad = { ...report, shares: [{ path: h.share, state: 'exists' as const, realpath: real, gitdir: real + '/.git' }] }
      const r = installWrite({ paths: h.paths, report: bad, bundle: b.dir, claudeVersion: null, now: NOW })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('share_path')
      for (const p of [h.paths.installed, h.paths.seatKey, h.paths.shares, h.paths.tools]) expect([p, existsSync(p)]).toEqual([p, false])
    }
    expect(installWrite({ paths: h.paths, report, bundle: b.dir, claudeVersion: null, now: NOW }).ok).toBe(true)
  }, 30_000)

  test('a binary that is not this bundle\'s, or a failed check, is refused before anything is written', () => {
    const { h, b, report } = ready()
    writeFileSync(h.paths.binary, '#!/bin/bash\nexit 1\n')
    expect(installWrite({ paths: h.paths, report, bundle: b.dir, claudeVersion: null, now: NOW }).ok).toBe(false)
    copyFileSync(join(b.dir, 'collab-bridge'), h.paths.binary)
    expect(installWrite({ paths: h.paths, report: { ...report, ok: false, failures: ['zshenv: noisy'] }, bundle: b.dir, claudeVersion: null, now: NOW }).ok).toBe(false)
    expect(existsSync(h.paths.installed)).toBe(false)
  }, 30_000)
})

describe('install settings', () => {
  test('settings: attribution.commit is set and the backup taken once', () => {
    const { h, report } = ready()
    mkdirSync(join(h.share, '.claude'))
    const original = '{\n  "permissions": { "allow": ["Read"] }\n}\n'
    writeFileSync(settingsOf(h.share), original)
    const r = installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: false, paths: h.paths, git: report.git! })
    expect(r).toEqual({ ok: true, changed: true })
    expect(readJson(settingsOf(h.share))).toEqual({ permissions: { allow: ['Read'] }, attribution: { commit: FIXTURE_TRAILER } })
    const backup = settingsOf(h.share) + '.collab-bridge-backup'
    expect(readFileSync(backup, 'utf8')).toBe(original)
    expect(installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: true, paths: h.paths, git: report.git! })).toEqual({ ok: true, changed: true })
    expect(readFileSync(backup, 'utf8')).toBe(original)
    expect(repoGit(h.share, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
  }, 30_000)

  test('settings with tap adds exactly one hook entry and keeps other hooks', () => {
    const { h, report } = ready()
    mkdirSync(join(h.share, '.claude'))
    const other = { UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/opt/other/hook', timeout: 3 }] }], Stop: [{ hooks: [{ type: 'command', command: '/opt/stop' }] }] }
    writeFileSync(settingsOf(h.share), JSON.stringify({ hooks: other }))
    installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: true, paths: h.paths, git: report.git! })
    const s = readJson(settingsOf(h.share))
    expect(s.hooks.Stop).toEqual(other.Stop)
    expect(s.hooks.UserPromptSubmit).toEqual([...other.UserPromptSubmit,
      { hooks: [{ type: 'command', command: `${h.paths.binary} tap --host claude`, timeout: 5 }] }])
    expect(tapCommand(h.paths)).toBe(`${h.home}/.local/share/collab-bridge/collab-bridge tap --host claude`)
  }, 30_000)

  test('running settings twice changes nothing', () => {
    const { h, report } = ready()
    const once = installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: true, paths: h.paths, git: report.git! })
    expect(once).toEqual({ ok: true, changed: true })
    const [s1, e1] = [readFileSync(settingsOf(h.share), 'utf8'), exclude(h.share)]
    const twice = installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: true, paths: h.paths, git: report.git! })
    expect(twice).toEqual({ ok: true, changed: false })
    expect([readFileSync(settingsOf(h.share), 'utf8'), exclude(h.share)]).toEqual([s1, e1])
    expect(readJson(settingsOf(h.share)).hooks.UserPromptSubmit).toHaveLength(1)
    expect(modeOf(settingsOf(h.share))).toBe(0o600)
    expect(existsSync(settingsOf(h.share) + '.collab-bridge-backup')).toBe(false)
  }, 30_000)

  test('.git/info/exclude gains the file only when it is not already ignored', () => {
    const { h, report } = ready()
    const before = exclude(h.share)
    installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: false, paths: h.paths, git: report.git! })
    expect(exclude(h.share)).toBe(before + '.claude/settings.local.json\n.claude/settings.local.json.collab-bridge-backup\n')
    expect(repoGit(h.share, ['status', '--porcelain', '--untracked-files=all'])).toBe('')

    const { h: h2, report: report2 } = ready()
    commitFiles(h2.share, { '.gitignore': '.claude/\n' }, 'ignore .claude')
    const before2 = exclude(h2.share)
    installSettings({ folder: h2.share, trailer: FIXTURE_TRAILER, tap: true, paths: h2.paths, git: report2.git! })
    expect(exclude(h2.share)).toBe(before2)
    expect(repoGit(h2.share, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
  }, 30_000)

  test('unsettings removes exactly the tap entry and attribution.commit', () => {
    const { h, report } = ready()
    mkdirSync(join(h.share, '.claude'))
    const original = { permissions: { allow: ['Read'] }, attribution: { pr: 'kept' },
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/opt/other/hook', timeout: 3 }] }] } }
    writeFileSync(settingsOf(h.share), JSON.stringify(original, null, 2))
    installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: true, paths: h.paths, git: report.git! })
    expect(uninstallSettings({ folder: h.share, paths: h.paths })).toEqual({ ok: true, changed: true })
    expect(readJson(settingsOf(h.share))).toEqual(original)
    expect(uninstallSettings({ folder: h.share, paths: h.paths })).toEqual({ ok: true, changed: false })

    const { h: fresh, report: freshReport } = ready()
    installSettings({ folder: fresh.share, trailer: FIXTURE_TRAILER, tap: true, paths: fresh.paths, git: freshReport.git! })
    uninstallSettings({ folder: fresh.share, paths: fresh.paths })
    expect(readJson(settingsOf(fresh.share))).toEqual({})
  }, 30_000)

  test('a .claude that is a link to another folder is never read or written through, by settings or unsettings (Task 63 installer-2-3)', () => {
    const { h, report } = ready()
    const other = temp('cb-other-claude-')   // another project's, or a citizen's, .claude
    const theirs = JSON.stringify({ permissions: { allow: ['Read'] }, attribution: { commit: 'their trailer' },
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${h.paths.binary} tap --host claude`, timeout: 5 }] }] } }, null, 2) + '\n'
    writeFileSync(join(other, 'settings.local.json'), theirs)
    symlinkSync(other, join(h.share, '.claude'))
    const before = exclude(h.share)
    expect(uninstallSettings({ folder: h.share, paths: h.paths }).ok).toBe(false)
    expect(readFileSync(join(other, 'settings.local.json'), 'utf8')).toBe(theirs)
    const set = installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: true, paths: h.paths, git: report.git! })
    expect(set.ok).toBe(false)
    if (!set.ok) expect(set.reason).toContain('.claude')
    expect(readFileSync(join(other, 'settings.local.json'), 'utf8')).toBe(theirs)
    expect(existsSync(join(other, 'settings.local.json.collab-bridge-backup'))).toBe(false)
    expect(exclude(h.share)).toBe(before)
    // A link to nothing is no folder of ours either.
    rmSync(join(h.share, '.claude'))
    symlinkSync(join(other, 'gone'), join(h.share, '.claude'))
    expect(installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: true, paths: h.paths, git: report.git! }).ok).toBe(false)
    expect(uninstallSettings({ folder: h.share, paths: h.paths }).ok).toBe(false)
    expect(existsSync(join(other, 'gone'))).toBe(false)
  }, 30_000)

  test('a settings file that is not a JSON object is refused and left alone', () => {
    const { h, report } = ready()
    mkdirSync(join(h.share, '.claude'))
    writeFileSync(settingsOf(h.share), '[1, 2]\n')
    expect(installSettings({ folder: h.share, trailer: FIXTURE_TRAILER, tap: true, paths: h.paths, git: report.git! }).ok).toBe(false)
    expect(readFileSync(settingsOf(h.share), 'utf8')).toBe('[1, 2]\n')
  }, 30_000)
})

describe('the write, settings and unsettings verbs', () => {
  test('run from the installer\'s flags, and settings refuses a folder that is not shared', () => {
    const { h, b } = ready()
    const check = ['--bundle', b.dir, '--share', h.share, '--terminal-git', REAL_GIT, '--claude', claudeStub()]
    const w = verb(h, ['write', ...check, '--claude-version', '2.1.296 (Claude Code)'])
    expect([w.code, w.json.ok, w.json.created_seat]).toEqual([0, true, true])
    const s = verb(h, ['settings', '--folder', h.share, '--trailer', FIXTURE_TRAILER, '--tap'])
    expect([s.code, s.json]).toEqual([0, { ok: true, changed: true }])
    expect(readJson(settingsOf(h.share)).attribution).toEqual({ commit: FIXTURE_TRAILER })
    const elsewhere = join(h.home, 'Projects')
    expect(verb(h, ['settings', '--folder', elsewhere, '--trailer', FIXTURE_TRAILER]).code).toBe(1)
    expect(verb(h, ['settings', '--folder', h.share, '--trailer', "it's"]).code).toBe(1)
    const u = verb(h, ['unsettings', '--folder', h.share])
    expect([u.code, u.json]).toEqual([0, { ok: true, changed: true }])
    expect(readJson(settingsOf(h.share))).toEqual({})
    writeFileSync(settingsOf(h.share), '[1]\n')
    expect(verb(h, ['unsettings', '--folder', h.share]).code).toBe(1)
    expect(readFileSync(settingsOf(h.share), 'utf8')).toBe('[1]\n')
  }, 30_000)
})
