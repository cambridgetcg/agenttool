import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderInstaller, type InstallerValues } from '../scripts/prepare-pairing.ts'
import { dropinStat, readInstalled, readShares, summonKeySha256 } from '../src/nuance/installed.ts'
import { localYmd } from '../src/nuance/install-steps.ts'
import {
  expectedKeyLine, FIXTURE_PUBKEY, FIXTURE_TRAILER, makeInstallBundle, summonReadyHome, makeTrialRepo, recordingClaude, runInstaller,
  summonLine, treeOf, type NuanceHome,
} from './install-fixtures.ts'
import { cleanupTmps, modeOf, PKG, repoGit, sha256File } from './helpers.ts'

afterEach(cleanupTmps)

const TMPL = readFileSync(join(PKG, 'nuance', 'install.sh.tmpl'), 'utf8')
const lastLine = (out: string) => (out.trim().split('\n').pop() ?? '').trim()
const keyLines = (h: NuanceHome) => readFileSync(h.paths.authorizedKeys, 'utf8').split('\n').filter(Boolean)
const settingsOf = (h: NuanceHome) => join(h.share, '.claude', 'settings.local.json')

/** A Nuance home, the Air's trial repo, a bundle for the trial share, and a claude that records its calls. */
function world(o: { files?: Record<string, string>; expiry?: string; prepared?: string; quarantine?: boolean } = {}) {
  const h = summonReadyHome()
  const trial = makeTrialRepo({ files: o.files })
  const b = makeInstallBundle({ airRepo: trial.repo, shares: [h.share], expiry: o.expiry, prepared: o.prepared, quarantine: o.quarantine })
  const claude = recordingClaude()
  const run = (answers: string | null = 'y\ny\n') => runInstaller(b.dir, h.home, { answers, extraEnv: { COLLAB_BRIDGE_BIN_CLAUDE: claude.bin } })
  return { h, trial, b, claude, run }
}

describe('renderInstaller', () => {
  const good = (): InstallerValues => ({ device: 'nuance', user: 'macair', pubkey: FIXTURE_PUBKEY, expiry: '20270111', preparedAt: '20261013120000',
    build: '1a2b3c4d', shaBinary: 'a'.repeat(64), shaManifest: 'b'.repeat(64), shaTools: 'c'.repeat(64), shaTrialBundle: 'd'.repeat(64),
    trailer: FIXTURE_TRAILER, shares: ['/Users/macair/Projects/collab-trial'] })

  test('fills every placeholder and leaves no __NAME__ word', () => {
    const out = renderInstaller(TMPL, good())
    expect(out.match(/__[A-Z][A-Z_]*__/g)).toBeNull()
    expect(out).toContain(`PUBKEY='${FIXTURE_PUBKEY}'`)
    expect(out).toContain("SHARES=('/Users/macair/Projects/collab-trial')")
    expect(out).toContain(`TRAILER='${FIXTURE_TRAILER}'`)
    expect(renderInstaller(TMPL, { ...good(), trailer: 'Signed: $& and $1' })).toContain("TRAILER='Signed: $& and $1'")
    // Shares follow the gate's rule (§5.2): a space or an accented letter is servable, so it renders, single-quoted.
    expect(renderInstaller(TMPL, { ...good(), shares: ['/Users/macair/Projects/my trial', '/Users/macair/café'] }))
      .toContain("SHARES=('/Users/macair/Projects/my trial' '/Users/macair/café')")
  })

  test('refuses a value outside its pattern and a template with an unknown placeholder', () => {
    const bad: Array<Partial<InstallerValues>> = [
      { trailer: "Yu's" }, { pubkey: 'ssh-ed25519 AAAA summon-air' }, { user: 'Mac Air' }, { expiry: '2027-01-11' }, { build: '1A2B3C4D' },
      { shaTools: 'c'.repeat(63) }, { shares: [] }, { shares: ["/Users/macair/it's"] }, { shares: ['/Users/macair/wow!'] },
      { shares: ['Projects/collab-trial'] }, { shares: ['/Users/macair/' + 'x'.repeat(1010)] }, { shares: ['/Users/macair//x'] },
      { shares: ['/Users/macair/b\\c'] }, { shares: ['/Users/macair/x\ny'] },
    ]
    for (const over of bad) expect(() => renderInstaller(TMPL, { ...good(), ...over })).toThrow()
    expect(() => renderInstaller(TMPL + '# __EXTRA__\n', good())).toThrow()
    expect(() => renderInstaller(TMPL.replace("TRAILER='__TRAILER__'", ''), good())).toThrow()
  })
})

describe('the bash installer', () => {
  test("a full install with two y's ends Done", () => {
    const { h, trial, run } = world()
    const r = run()
    expect([r.code, lastLine(r.stdout)]).toEqual([0, expect.stringMatching(/^Done\. /)])
    expect(repoGit(h.share, ['rev-parse', 'HEAD'])).toBe(trial.commit)
    expect(readShares(h.paths)).toEqual([{ realpath: h.share, gitdir: join(h.share, '.git') }])
    expect(modeOf(h.paths.binary)).toBe(0o755)
    const s = JSON.parse(readFileSync(settingsOf(h), 'utf8'))
    expect(s.hooks.UserPromptSubmit).toEqual([{ hooks: [{ type: 'command', command: `${h.paths.binary} tap --host claude`, timeout: 5 }] }])
  }, 60_000)

  test('the stubbed claude records the remove and the exact add-json argv, in the share', () => {
    const { h, claude, run } = world()
    expect(run().code).toBe(0)
    const mcp = claude.calls().filter((c) => c.argv[0] === 'mcp')
    expect(mcp).toEqual([
      { cwd: h.share, argv: ['mcp', 'remove', '-s', 'local', 'agenttool-collab-hub'] },
      { cwd: h.share, argv: ['mcp', 'add-json', '-s', 'local', 'agenttool-collab-hub',
        `{"type":"stdio","command":"${h.home}/.local/share/collab-bridge/collab-bridge","args":["pipe"],"timeout":300000}`] },
    ])
  }, 60_000)

  test('~/.claude.json is never written and claude mcp list or get is never run', () => {
    const { h, claude, run } = world()
    expect(run().code).toBe(0)
    expect(existsSync(join(h.home, '.claude.json'))).toBe(false)
    expect(existsSync(join(h.home, '.claude'))).toBe(false)
    expect(claude.calls().filter((c) => c.argv[0] === 'mcp' && (c.argv[1] === 'list' || c.argv[1] === 'get'))).toEqual([])
    expect(claude.calls().map((c) => c.argv.slice(0, 2).join(' '))).toEqual(['--version', 'mcp remove', 'mcp add-json'])
  }, 60_000)

  test('the bundle\'s binary is never executed in place, and the installed binary carries no com.apple.quarantine', () => {
    const { h, b, run } = world({ quarantine: true })
    expect(run().code).toBe(0)
    const runs = readFileSync(b.runs, 'utf8').split('\n').filter(Boolean)
    expect(runs.length).toBeGreaterThan(0)
    for (const r of runs) expect([r, r.startsWith(b.dir) || r.startsWith('quarantined')]).toEqual([r, false])
    const xattr = (p: string) => Bun.spawnSync(['/usr/bin/xattr', '-p', 'com.apple.quarantine', p]).exitCode
    expect(xattr(join(b.dir, 'collab-bridge'))).toBe(0)
    expect(xattr(h.paths.binary)).not.toBe(0)
    expect(sha256File(h.paths.binary)).toBe(b.values.shaBinary)
  }, 60_000)

  test('a checksum mismatch stops with nothing changed', () => {
    const { h, b, run } = world()
    writeFileSync(join(b.dir, 'tools.json'), readFileSync(join(b.dir, 'tools.json'), 'utf8') + ' ')
    const before = treeOf(h.home)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('✗ tools.json does not match its checksum')
    expect(r.stdout).toContain('Nothing was changed.')
    expect(treeOf(h.home)).toEqual(before)
  }, 60_000)

  test('the citizen-root, zshenv, Summon-missing, password-drop-in-missing, expired-key and older-bundle stops all fire, each with nothing changed', () => {
    const cases: Array<[string, (w: ReturnType<typeof world>) => void, Parameters<typeof world>[0]?]> = [
      ['share_citizen', (w) => { repoGit('/', ['clone', '-q', w.trial.repo, w.h.share]) }, { files: { 'README.md': 'collab trial\n', REST: '' } }],
      ['zshenv', (w) => { writeFileSync(join(w.h.home, '.zshenv'), 'echo good morning\n') }],
      ['summon_not_installed', (w) => { rmSync(w.h.paths.summonInstalled) }],
      ['dropin_missing', (w) => { rmSync(w.h.paths.summonDropin) }],
      ['expired', () => {}, { expiry: localYmd(new Date()) }],
    ]
    for (const [code, breakIt, opts] of cases) {
      const w = world(opts)
      breakIt(w)
      const before = treeOf(w.h.home)
      const r = w.run()
      expect([code, r.code]).toEqual([code, 1])
      expect([code, r.stderr]).toEqual([code, expect.stringContaining(`✗ ${code}: `)])
      expect([code, r.stdout]).toEqual([code, expect.stringContaining('✗ a check failed (the ✗ lines above say which).')])
      expect([code, lastLine(r.stdout)]).toEqual([code, 'Nothing was changed.'])
      expect([code, treeOf(w.h.home)]).toEqual([code, before])
    }
    // Older: a newer bundle is installed first, then an older one (prepared earlier) is refused.
    const w = world({ prepared: '20261014000000' })
    expect(w.run().code).toBe(0)
    const older = makeInstallBundle({ airRepo: w.trial.repo, shares: [w.h.share], prepared: '20261013000000' })
    const before = treeOf(w.h.home)
    const r = runInstaller(older.dir, w.h.home, { answers: 'y\ny\n', extraEnv: { COLLAB_BRIDGE_BIN_CLAUDE: w.claude.bin } })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('✗ older_bundle: ')
    expect(treeOf(w.h.home)).toEqual(before)
  }, 120_000)

  test('the collab-air line is exactly restrict,from="192.168.50.0/24",expiry-time="<expiry>",command="<home>/.local/share/collab-bridge/collab-bridge gate" <pubkey>', () => {
    const { h, b, run } = world()
    expect(run().code).toBe(0)
    expect(keyLines(h)).toEqual([summonLine(h.home), expectedKeyLine({ home: h.home, pubkey: FIXTURE_PUBKEY, expiry: b.values.expiry })])
    expect(modeOf(h.paths.authorizedKeys)).toBe(0o600)
  }, 60_000)

  test('the key-line replace leaves summon-air byte-identical', () => {
    const { h, b, run } = world()
    const other = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherKeyOtherKeyOtherKeyOtherKeyOtherKeyOther yu@elsewhere'
    const stale = `restrict,from="192.168.50.0/24",expiry-time="20261201",command="${h.home}/.local/share/collab-bridge/collab-bridge gate" ssh-ed25519 AAAAstale collab-air`
    writeFileSync(h.paths.authorizedKeys, [summonLine(h.home), stale, other].join('\n') + '\n')
    expect(run().code).toBe(0)
    expect(keyLines(h)).toEqual([summonLine(h.home), other, expectedKeyLine({ home: h.home, pubkey: FIXTURE_PUBKEY, expiry: b.values.expiry })])
  }, 60_000)

  test('a failed re-check after the clone ends with no shares.json, no INSTALLED and no collab-air line', () => {
    const { h, run } = world({ files: { 'README.md': 'collab trial\n', REST: '' } })
    const keysBefore = readFileSync(h.paths.authorizedKeys, 'utf8')
    const r = run()
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('share_citizen')
    expect(lastLine(r.stdout)).toBe('Nothing was changed.')
    for (const p of [h.paths.shares, h.paths.installed, h.paths.binary, h.share]) expect([p, existsSync(p)]).toEqual([p, false])
    expect(readFileSync(h.paths.authorizedKeys, 'utf8')).toBe(keysBefore)
  }, 60_000)

  test("the README's rollback sed removes only the collab-air line", () => {
    const readme = readFileSync(join(PKG, 'README.md'), 'utf8')
    expect(readme).toContain("sed -i '' '/ collab-air$/d' ~/.ssh/authorized_keys")
    const { h, run } = world()
    const other = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherKeyOtherKeyOtherKeyOtherKeyOtherKeyOther yu@elsewhere'
    writeFileSync(h.paths.authorizedKeys, [summonLine(h.home), other].join('\n') + '\n')
    expect(run().code).toBe(0)
    expect(keyLines(h)).toHaveLength(3)
    const sed = Bun.spawnSync(['/usr/bin/sed', '-i', '', '/ collab-air$/d', h.paths.authorizedKeys])
    expect(sed.exitCode).toBe(0)
    expect(readFileSync(h.paths.authorizedKeys, 'utf8')).toBe([summonLine(h.home), other].join('\n') + '\n')
  }, 60_000)

  test('the baselines are in INSTALLED', () => {
    const { h, b, run } = world()
    expect(run().code).toBe(0)
    const i = readInstalled(h.paths)!
    expect(i.summon_key_sha256).toBe(summonKeySha256(summonLine(h.home) + '\n'))
    expect(i.summon_dropin_stat).toBe(dropinStat(h.paths.summonDropin)!)
    expect([i.device, i.build, i.prepared, i.expiry, i.binary_sha256, i.claude_version])
      .toEqual(['nuance', b.values.build, b.values.preparedAt, b.values.expiry, b.values.shaBinary, '2.1.296 (Claude Code)'])
    expect(i.git.path.startsWith('/')).toBe(true)
  }, 60_000)

  test('with no tty it ends ✗ Not confirmed, with no claude call and nothing written', () => {
    const { h, claude, run } = world()
    const before = treeOf(h.home)
    const r = run(null)
    expect(r.code).toBe(1)
    expect(lastLine(r.stdout)).toStartWith('✗ Not confirmed')
    expect(r.stdout).toContain('(no terminal to answer on)')
    expect(claude.calls()).toEqual([])
    for (const p of [h.paths.installed, h.paths.binary, h.paths.shares, h.paths.seatKey, h.share]) expect([p, existsSync(p)]).toEqual([p, false])
    expect(keyLines(h)).toEqual([summonLine(h.home)])
    expect(treeOf(h.home)).toEqual(before)
  }, 60_000)

  test('a second install is idempotent', () => {
    const { h, b, run } = world()
    expect(run().code).toBe(0)
    const key = readFileSync(h.paths.seatKey)
    const settings = readFileSync(settingsOf(h), 'utf8')
    const shares = readFileSync(h.paths.shares, 'utf8')
    const r = run()
    expect([r.code, lastLine(r.stdout)]).toEqual([0, expect.stringMatching(/^Done\. /)])
    expect(readFileSync(h.paths.seatKey).equals(key)).toBe(true)
    expect(readFileSync(settingsOf(h), 'utf8')).toBe(settings)
    expect(readFileSync(h.paths.shares, 'utf8')).toBe(shares)
    expect(keyLines(h)).toEqual([summonLine(h.home), expectedKeyLine({ home: h.home, pubkey: FIXTURE_PUBKEY, expiry: b.values.expiry })])
  }, 90_000)

  test("attribution.commit is written, and the README's rollback removes it exactly", () => {
    const readme = readFileSync(join(PKG, 'README.md'), 'utf8')
    expect(readme).toContain('~/.local/share/collab-bridge/collab-bridge install unsettings --folder ~/Projects/collab-trial')
    const { h, run } = world()
    expect(run().code).toBe(0)
    expect(JSON.parse(readFileSync(settingsOf(h), 'utf8')).attribution).toEqual({ commit: FIXTURE_TRAILER })
    const u = Bun.spawnSync([h.paths.binary, 'install', 'unsettings', '--folder', h.share], { env: h.env, cwd: '/', stdout: 'pipe', stderr: 'pipe' })
    expect(u.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(settingsOf(h), 'utf8'))).toEqual({})
    expect(repoGit(h.share, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
  }, 60_000)
})
