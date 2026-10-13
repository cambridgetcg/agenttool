// The hermetic guard (spec §12.1): what the preload set, where every resolved path lies, and no sudo anywhere.
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { airPaths, collabDist, nuancePaths } from '../src/paths.ts'
import { knobInt, knobName, PRODUCTION_BINS, systemBin, type SystemBinName } from '../src/sysbin.ts'
import { BACKOFF, scaled, timeScale, TIMING } from '../src/timing.ts'
import { COLLAB_DIST, PKG, PS_STUB_HOST, REAL_HOME, SUITE } from './helpers.ts'

const NAMES = Object.keys(PRODUCTION_BINS) as SystemBinName[]

const sampleArgs = (n: number): unknown[] => (n === 1 ? ['probe'] : n === 2 ? [4100, 4200] : n === 3 ? ['nuance', 'macair', '0123456789abcdef'] : [])
function allPaths(o: object): string[] {
  return Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String(v(...sampleArgs(v.length)))] : []))
}
const under = (p: string, root: string) => p === root || p.startsWith(`${root}/`)

/** This Mac's real places no test may resolve to. */
const FORBIDDEN = [
  `${REAL_HOME}/.ssh`, '/etc/ssh', `${REAL_HOME}/Library/LaunchAgents`, `${REAL_HOME}/.claude.json`, `${REAL_HOME}/.config/summon`,
  `${REAL_HOME}/.local/share/agenttool/collab.sqlite`, `${REAL_HOME}/.local/share/agenttool/collab-shared`,
]
const forbiddenHits = (paths: string[]) => paths.filter((p) => FORBIDDEN.some((f) => under(p, f)))

/** Text that runs sudo, outside a comment line: sudo as a shell word, as a quoted program name, or by path. */
const SUDO = [/(^|[\s;&|(`'"])sudo(\s|$)/, /['"`]sudo['"`]/, /\/sudo(\s|['"`]|$)/]
const runsSudo = (line: string) => SUDO.some((re) => re.test(line))
function sudoLines(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).flatMap((rel) => {
    const p = join(dir, rel)
    if (!statSync(p).isFile()) return []
    return readFileSync(p, 'utf8').split('\n').flatMap((line, i) => {
      const t = line.trim()
      return t.startsWith('#') || t.startsWith('//') || !runsSudo(line) ? [] : [`${rel}:${i + 1}`]
    })
  })
}

describe('hermetic guard', () => {
  test('the preload set HOME, the override, PATH and every knob', () => {
    expect(SUITE.root).not.toBe('')
    expect(process.env.HOME).toBe(SUITE.home)
    expect(process.env.COLLAB_BRIDGE_HOME_OVERRIDE).toBe(SUITE.home)
    expect(process.env.NODE_ENV).toBe('test')
    expect(process.env.PATH).toBe(`${SUITE.stubs}:/usr/bin:/bin:/usr/sbin:/sbin`)
    expect(process.env.STUB_LOG).toBe(SUITE.stubLog)
    expect(process.env.COLLAB_BRIDGE_COLLAB_DIST).toBe(COLLAB_DIST)
    expect(collabDist()).toBe(COLLAB_DIST)
    expect(process.env.COLLAB_BRIDGE_SOCK_ROOT).toBe(SUITE.sockRoot)
    expect(under(process.env.COLLAB_BRIDGE_SUMMON_DROPIN!, SUITE.root)).toBe(true)
    for (const name of NAMES) {
      const knob = process.env[knobName(name)]
      expect([name, typeof knob === 'string' && knob.startsWith('/')]).toEqual([name, true])
      expect([name, systemBin(name)]).toEqual([name, knob!])
    }
    for (const name of ['ssh', 'launchctl'] as const) expect(systemBin(name)).toBe(join(SUITE.stubs, name))
    expect(systemBin('bun')).toBe(process.execPath)
    expect(existsSync(join(COLLAB_DIST, 'agenttool-collab-mcp.js')) && existsSync(join(COLLAB_DIST, 'agenttool-collab-host.js'))).toBe(true)
  })

  test('the preload cleared inherited harness, git, Collab, XDG and ssh-agent variables', () => {
    const leaked = Object.keys(process.env).filter((k) => /^(CLAUDE|CODEX_|HERMES_|GIT_|AGENTOOL_|XDG_|SSH_)|^BUN_OPTIONS$|^BUN_BE_BUN$/.test(k))
    expect(leaked).toEqual([])
  })

  test('a child spawned without env never resolves the real home', () => {
    // Bun 1.3.13 hands such a child the startup environment (the real HOME and PATH, NODE_ENV=test, no override), never the
    // preload's, which is why every spawn passes env (P14). homeOf then refuses rather than return the real home.
    const script = `import { homeOf } from '${join(PKG, 'src', 'paths.ts')}'; console.log(homeOf())`
    const p = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', '-e', script], { cwd: '/' })
    const out = p.stdout.toString().trim()
    expect(out).not.toBe(REAL_HOME)
    if (out !== SUITE.home) {
      expect(p.exitCode).not.toBe(0)
      expect(p.stderr.toString()).toContain('homeOf: refused under NODE_ENV=test without the override')
    }
  })

  test('the default ps knob is the P43 stub, never /bin/ps', () => {
    expect(systemBin('ps')).toBe(join(SUITE.stubs, 'ps'))
    expect(realpathSync(systemBin('ps'))).not.toBe(realpathSync('/bin/ps'))
  })

  test('the ps stub chains the caller to a claude host at pid 4100 and answers tty= with ttys001', () => {
    const ps = systemBin('ps')
    const table = Bun.spawnSync([ps, '-A', '-ww', '-o', 'pid=,ppid=,lstart=,comm='], { env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' } })
    expect(table.exitCode).toBe(0)
    expect(table.stdout.toString()).toBe(
      `${String(process.pid).padStart(5)}  4100 Tue Oct 13 11:33:11 2026     collab-bridge\n` +
      ` 4100     1 Wed Oct  7 16:22:59 2026     claude\n`)
    expect(PS_STUB_HOST).toEqual({ pid: 4100, lstart: 'Wed Oct  7 16:22:59 2026' })
    const tty = Bun.spawnSync([ps, '-o', 'tty=', '-p', '4100'], { env: { PATH: '/usr/bin:/bin' } })
    expect(tty.stdout.toString()).toBe('ttys001 \n')
  })

  test("the drop-in owner knob is the user's own uid", () => {
    expect(knobInt('COLLAB_BRIDGE_DROPIN_OWNER_UID')).toBe(process.getuid!())
  })

  test('every resolved path lies under the override or a temp root', () => {
    const roots = [SUITE.home, SUITE.root, realpathSync(tmpdir()), '/private/tmp']
    const paths = [...allPaths(airPaths(SUITE.home)), ...allPaths(nuancePaths(SUITE.home))]
    expect(paths.length).toBeGreaterThan(60)
    expect(paths.filter((p) => !roots.some((r) => under(p, r)))).toEqual([])
  })

  test("no resolved path is this Mac's ~/.ssh, /etc/ssh, ~/Library/LaunchAgents, ~/.claude.json, ~/.config/summon or either real journal", () => {
    expect(REAL_HOME).toMatch(/^\/Users\/[a-z_][a-z0-9._-]*$/)
    expect(forbiddenHits([...allPaths(airPaths(SUITE.home)), ...allPaths(nuancePaths(SUITE.home))])).toEqual([])
    // The check is not vacuous: the same walk over the real home finds those places.
    expect(forbiddenHits(allPaths(airPaths(REAL_HOME))).length).toBeGreaterThan(5)
  })

  test('no source file invokes sudo', () => {
    for (const [line, hit] of [['sudo rm -f x', true], ['x; sudo ls', true], ['echo "$(sudo id)"', true], ["spawnSync('sudo', ['ls'])", true],
      ["Bun.spawn(['/usr/bin/sudo', 'id'])", true], ['pseudo sudoers', false], ['const sudoku = 1', false]] as const) {
      expect([line, runsSudo(line)]).toEqual([line, hit])
    }
    const dirs = ['src', 'scripts', 'nuance', 'air-launcher', 'bin'].map((d) => join(PKG, d))
    expect(dirs.flatMap(sudoLines)).toEqual([])
  })

  test('timing scale applies only under the override', () => {
    const on = { HOME: '/h', COLLAB_BRIDGE_HOME_OVERRIDE: '/h' }
    expect(timeScale({ ...on, COLLAB_BRIDGE_TEST_TIME_SCALE: '0.01' })).toBe(0.01)
    expect(scaled(TIMING.pingMs, { ...on, COLLAB_BRIDGE_TEST_TIME_SCALE: '0.01' })).toBe(150)
    expect(timeScale({ HOME: '/h', COLLAB_BRIDGE_TEST_TIME_SCALE: '0.01' })).toBe(1)
    expect(scaled(TIMING.pingMs, { HOME: '/h', COLLAB_BRIDGE_TEST_TIME_SCALE: '0.01' })).toBe(15_000)
    expect(timeScale({ ...on, COLLAB_BRIDGE_TEST_TIME_SCALE: '0.00001' })).toBe(0.001)
    expect(timeScale({ ...on, COLLAB_BRIDGE_TEST_TIME_SCALE: '7' })).toBe(1)
    expect(timeScale({ ...on, COLLAB_BRIDGE_TEST_TIME_SCALE: 'fast' })).toBe(1)
    expect(timeScale({ ...on, COLLAB_BRIDGE_TEST_TIME_SCALE: '' })).toBe(1)
    expect(scaled(1, { ...on, COLLAB_BRIDGE_TEST_TIME_SCALE: '0.001' })).toBe(1)
    expect(timeScale()).toBe(1) // the preload sets no scale
  })

  test("the deadlines and backoff are R19's and §5.5's", () => {
    expect(TIMING).toEqual({ pingMs: 15_000, staleMs: 20_000, relayExitMs: 45_000, inodeCheckMs: 5_000, preambleMs: 30_000,
      handshakeStepMs: 5_000, callDefaultMs: 60_000, callLongMs: 150_000, childRequestMs: 600_000, claudeEntryTimeoutMs: 300_000,
      knocksMaxMs: 2_000, knocksMinRemainingMs: 1_000, callMinRemainingMs: 1_000, tapBudgetMs: 3_000, tapAskMs: 2_000, reattachMs: 2_000, childDetachedMs: 600_000,
      lineageRetireMs: 604_800_000, lineageSweepMs: 604_800_000, leaseMinRemainingMs: 150_000, fetchMs: 60_000, checkoutMs: 30_000,
      gitCallMs: 5_000, pongDropMs: 45_000 })
    expect(BACKOFF).toEqual({ stepsMs: [5_000, 10_000, 20_000, 40_000, 60_000], jitter: 0.2, resetAfterUpMs: 60_000,
      redialOncePerMs: 600_000, awayAfterMs: 600_000, awayCapMs: 900_000, hostKeyWindowMs: 1_800_000, hostKeyEscalateAt: 3,
      preambleHintAfter: 3, relayContestedWindowMs: 600_000, relayContestedAbove: 3, unexpectedExitsWindowMs: 600_000, unexpectedExitsMax: 5 })
    expect(TIMING.childRequestMs).toBeLessThan(2 ** 31 - 1) // a timer above 2^31−1 ms fires at once (K65)
  })
})
