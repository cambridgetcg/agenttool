import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildNuance, cutAfterLinkedit, linkeditEnd, type NuanceBuild } from '../scripts/build-nuance.ts'
import { prepareBundle } from '../scripts/prepare-pairing.ts'
import { BASE_PATH, cleanupFixtureHostKey, cleanupTmps, END_TO_END, mode, PKG, run, sampleRequest, sha, targetHome, temp, world } from './helpers.ts'
import { CODEX_ALLOWLIST, fakeCodex } from './codex-fixture.ts'

afterEach(cleanupTmps)
afterAll(cleanupFixtureHostKey)

/** A minimal 64-bit Mach-O: the header and one LC_SEGMENT_64 named __LINKEDIT covering bytes [0, 256), then `tail`. */
function synthetic(tail: number[]): string {
  const f = join(temp('summon-macho-'), 'bin')
  const buf = new Uint8Array(256 + tail.length)
  const v = new DataView(buf.buffer)
  v.setUint32(0, 0xfeedfacf, true); v.setUint32(16, 1, true); v.setUint32(20, 72, true)
  v.setUint32(32, 0x19, true); v.setUint32(36, 72, true)
  buf.set(new TextEncoder().encode('__LINKEDIT'), 40)
  v.setBigUint64(72, 0n, true); v.setBigUint64(80, 256n, true) // fileoff, filesize
  buf.set(tail, 256)
  writeFileSync(f, buf)
  return f
}

describe('cutting a binary at the end of __LINKEDIT (B5)', () => {
  test('cuts trailing zero bytes, and leaves a file that already ends there alone', () => {
    for (const tail of [[0, 0, 0, 0], []]) {
      const f = synthetic(tail)
      expect(linkeditEnd(readFileSync(f))).toBe(256)
      cutAfterLinkedit(f)
      expect(statSync(f).size).toBe(256)
    }
  })
  test('refuses, and leaves the file as it was, when anything but zeros follows __LINKEDIT', () => {
    const f = synthetic([0, 0, 7, 0])
    const before = readFileSync(f)
    expect(() => cutAfterLinkedit(f)).toThrow('non-zero bytes after __LINKEDIT')
    expect(readFileSync(f).equals(before)).toBe(true)
  })
})

describe('the real build', () => {
  // Compiled once for the tests below; kept out of the per-test temp tracking, which removes things after each test.
  let buildDir = ''
  let built: NuanceBuild
  beforeAll(() => { buildDir = mkdtempSync(join(tmpdir(), 'summon-build-')); built = buildNuance(join(buildDir, 'nuance')) }, 120_000)
  afterAll(() => { rmSync(buildDir, { recursive: true, force: true }) })
  const strictlyValid = (bin: string) => {
    const v = Bun.spawnSync(['/usr/bin/codesign', '--verify', '--strict', '-vvv', bin])
    expect([bin, v.exitCode]).toEqual([bin, 0])
    expect(v.stderr.toString()).toContain('valid on disk')
  }

  test('compiles two arm64 binaries; the gatekeeper refuses `ls`; the runner settles an empty home', () => {
    expect(built.sha).toEqual({ gatekeeper: sha(built.gatekeeper), runner: sha(built.runner) })
    for (const bin of [built.gatekeeper, built.runner]) {
      expect(new TextDecoder().decode(Bun.spawnSync(['/usr/bin/file', bin]).stdout)).toContain('Mach-O 64-bit executable arm64')
      expect(new TextDecoder().decode(Bun.spawnSync(['/usr/bin/codesign', '-dv', bin]).stderr)).toContain('Signature=adhoc')
    }
    const gkHome = temp('summon-gk-home-')
    const gk = Bun.spawnSync([built.gatekeeper], { env: { PATH: BASE_PATH, HOME: gkHome, SUMMON_HOME_OVERRIDE: gkHome, SSH_ORIGINAL_COMMAND: 'ls' } })
    expect(gk.exitCode).toBe(2)
    expect(gk.stdout.toString()).toBe('{"status":"refused","reason":"malformed","detail":"unknown command"}\n')
    const rnHome = temp('summon-rn-home-')
    const rn = Bun.spawnSync([built.runner], { env: { PATH: BASE_PATH, HOME: rnHome, SUMMON_HOME_OVERRIDE: rnHome } })
    expect(rn.exitCode).toBe(0)
    const tree = (d: string, rel = ''): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? [`${rel}${e.name}/`, ...tree(join(d, e.name), `${rel}${e.name}/`)] : [`${rel}${e.name}`])
    // Nothing but Summon's own spool (and the folders above it), all private, appears in the home.
    expect(tree(rnHome).sort()).toEqual(['.local/', '.local/state/', '.local/state/summon/', '.local/state/summon/spool/'])
    for (const d of tree(rnHome)) expect([d, mode(join(rnHome, d)).toString(8)]).toEqual([d, '700'])
  })

  test("F44: both carry a valid ad-hoc signature (codesign --verify --strict), with nothing after __LINKEDIT, not Bun's linker one", () => {
    for (const bin of [built.gatekeeper, built.runner]) {
      strictlyValid(bin)
      expect(statSync(bin).size).toBe(linkeditEnd(readFileSync(bin)))
      expect(Bun.spawnSync(['/usr/bin/codesign', '-dv', bin]).stderr.toString()).not.toContain('linker-signed')
    }
  })

  test('F39: the bytes do not depend on the folder the build is started from, and carry no path of this Mac', () => {
    const elsewhere = temp('summon-cwd-')
    const before = process.cwd()
    let again: NuanceBuild
    try { process.chdir(elsewhere); again = buildNuance(join(temp('summon-build2-'), 'nuance')) } finally { process.chdir(before) }
    expect(again.sha).toEqual(built.sha)
    for (const bin of [built.gatekeeper, built.runner]) expect([bin, readFileSync(bin).includes(PKG)]).toEqual([bin, false])
  }, 120_000)

  test('F06: the compiled gatekeeper ignores a .env and a bunfig.toml in the home sshd starts it in', () => {
    const home = temp('summon-gk-home-')
    const elsewhere = temp('summon-elsewhere-')
    writeFileSync(join(home, '.env'), `SUMMON_HOME_OVERRIDE=${elsewhere}\nSUMMON_TEST_GUI=1\n`)
    writeFileSync(join(home, 'pre.ts'), `require('node:fs').writeFileSync(${JSON.stringify(join(elsewhere, 'preload-ran'))}, 'x'); console.log('PRELOAD RAN')\n`)
    for (const bunfig of ['preload = ["./pre.ts"]\n', 'this is [ not toml\n']) {
      writeFileSync(join(home, 'bunfig.toml'), bunfig)
      const gk = Bun.spawnSync([built.gatekeeper], { cwd: home, env: { PATH: BASE_PATH, HOME: home, SSH_ORIGINAL_COMMAND: 'ls' } })
      expect([bunfig, gk.exitCode, gk.stdout.toString()]).toEqual([bunfig, 2, '{"status":"refused","reason":"malformed","detail":"unknown command"}\n'])
    }
    expect(existsSync(join(home, '.local/state/summon/ledger.jsonl'))).toBe(true)
    expect(readdirSync(elsewhere)).toEqual([])
  })

  test('the real binaries go through the bundle and the installer, keep their valid signature, and still run', () => {
    const home = temp('summon-air-')
    const r = prepareBundle({ home, build: () => built })
    const root = temp('summon-root-')
    const out = run(r.bundle, root)
    expect(out.exitCode).toBe(0)
    expect(out.stdout.toString()).not.toContain('could not sign')
    const installed = join(root, '.local/share/summon/summon-gatekeeper')
    expect(sha(installed)).toBe(built.sha.gatekeeper)
    expect(sha(join(root, '.local/share/summon/summon-runner'))).toBe(built.sha.runner)
    for (const bin of [installed, join(root, '.local/share/summon/summon-runner')]) strictlyValid(bin)
    const gk = Bun.spawnSync([installed], { env: { PATH: BASE_PATH, HOME: root, SUMMON_HOME_OVERRIDE: root, SSH_ORIGINAL_COMMAND: 'ls' } })
    expect([gk.exitCode, gk.stdout.toString()]).toEqual([2, '{"status":"refused","reason":"malformed","detail":"unknown command"}\n'])
  })

  // F40: the end-to-end checks of e2e.test.ts, through the compiled gatekeeper and the compiled runner.
  for (const [name, check] of Object.entries(END_TO_END)) test(`through the compiled pair: ${name}`, () => check(world(built)), 30_000)

  test('compiled pair admits and completes an explicit Codex review without a Claude executable', () => {
    const home = targetHome(CODEX_ALLOWLIST), fake = fakeCodex()
    const env = { PATH: BASE_PATH, HOME: home, SUMMON_HOME_OVERRIDE: home, SUMMON_TEST_GUI: '1', SUMMON_TEST_RUNNER: '1',
      SUMMON_CODEX_BIN: fake.bin, SUMMON_CLAUDE_BIN: '/does-not-exist' }
    const req = sampleRequest({ runtime: 'codex', model: 'gpt-6-astra', prompt: 'compiled-codex-fixture' })
    const start = Bun.spawnSync([built.gatekeeper], { env: { ...env, SSH_ORIGINAL_COMMAND: 'start' }, stdin: new TextEncoder().encode(JSON.stringify(req)) })
    expect(JSON.parse(start.stdout.toString())).toMatchObject({ status: 'admitted' })
    const runner = Bun.spawnSync([built.runner], { env, cwd: '/', timeout: 15_000 })
    expect(runner.exitCode).toBe(0)
    const result = Bun.spawnSync([built.gatekeeper], { env: { ...env, SSH_ORIGINAL_COMMAND: `result ${req.id}` } })
    expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: 'completed', result_text: 'echo: compiled-codex-fixture', exit_code: 0,
      codex_diagnostics: { parser_status: 'completed', exit: { code: 0, signal: null, after_stop: false },
        events: { 'turn.completed': { count: 1 } } } })
    expect(readFileSync(join(home, '.local/state/summon/ledger.jsonl'), 'utf8')).not.toContain(req.prompt)
  }, 30_000)
})

