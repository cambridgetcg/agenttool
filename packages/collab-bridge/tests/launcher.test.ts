import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLauncher, type LauncherBuild } from '../scripts/build-launcher.ts'
import { systemBin } from '../src/sysbin.ts'
import { cleanupTmps, modeOf, PKG, sha256File, temp, testEnv } from './helpers.ts'

afterEach(cleanupTmps)

// One build for the whole file (clang and codesign take about a second); removed in afterAll.
let dir = ''
let first: LauncherBuild
beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'cb-launcher-')))
  mkdirSync(join(dir, 'one'))
  first = buildLauncher({ out: join(dir, 'one', 'CollabBridgeHub.app') })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const ENV = () => ({ PATH: '/usr/bin:/bin', HOME: dir })
const run = (argv: string[], env: Record<string, string> = ENV()) => {
  const p = Bun.spawnSync(argv, { cwd: '/', env })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}
async function until(ok: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('until: timed out')
    await Bun.sleep(20)
  }
}
const childrenOf = (pid: number) => run(['/usr/bin/pgrep', '-P', String(pid)]).out.split('\n').filter(Boolean)

describe('the launcher app', () => {
  test('builds an app that passes plutil -lint and codesign --verify --deep --strict', () => {
    expect(run([systemBin('plutil'), '-lint', join(first.app, 'Contents', 'Info.plist')]).code).toBe(0)
    expect(run([systemBin('codesign'), '--verify', '--deep', '--strict', first.app])).toEqual({ code: 0, out: '', err: '' })
    expect(first.cdhash).toMatch(/^[0-9a-f]{40}$/)
    expect(first.sha256).toBe(sha256File(first.executable))
    const dwarf = run([systemBin('xcrun'), 'dwarfdump', '--uuid', first.executable]).out
    expect(dwarf).toContain(`UUID: ${first.uuid} (arm64)`)
  })

  test('the bundle id and executable name are exact', () => {
    const info = run([systemBin('plutil'), '-convert', 'json', '-o', '-', join(first.app, 'Contents', 'Info.plist')])
    expect(JSON.parse(info.out)).toEqual({
      CFBundleExecutable: 'collab-bridge-hub',
      CFBundleIdentifier: 'dev.agenttool.collab-bridge.hub',
      CFBundleName: 'CollabBridgeHub',
      CFBundlePackageType: 'APPL',
      NSLocalNetworkUsageDescription: "Collab Bridge reaches your other Mac on the home network so agents there can share this Mac's Collab journal.",
    })
    expect(first.executable).toBe(join(first.app, 'Contents', 'MacOS', 'collab-bridge-hub'))
    const dv = run([systemBin('codesign'), '-dv', first.app]).err
    expect(dv).toContain('Identifier=dev.agenttool.collab-bridge.hub')
    expect(dv).toContain('Signature=adhoc')
    expect([modeOf(first.app), modeOf(first.executable)]).toEqual([0o755, 0o755])
  })

  test('passes an exit status through', () => {
    expect(run([first.executable, '/bin/sh', '-c', 'exit 7']).code).toBe(7)
    expect(run([first.executable, '/usr/bin/true']).code).toBe(0)
  })

  test('with no program it prints its usage and exits 64', () => {
    const r = run([first.executable])
    expect([r.code, r.err]).toEqual([64, 'usage: collab-bridge-hub <program> [args...]\n'])
  })

  test('BUN_OPTIONS and BUN_BE_BUN never reach the child', () => {
    const r = run([first.executable, '/usr/bin/env'], { ...ENV(), BUN_OPTIONS: '--preload /nonexistent.ts', BUN_BE_BUN: '1', KEEP: 'yes' })
    expect(r.code).toBe(0)
    expect(r.out.split('\n').filter((l) => /^(BUN_OPTIONS|BUN_BE_BUN|KEEP)=/.test(l))).toEqual(['KEEP=yes'])
  })

  test('forwards SIGTERM to a bun child that exits 0', async () => {
    const d = temp('cb-launch-run-')
    const ready = join(d, 'ready')
    const got = join(d, 'got')
    writeFileSync(join(d, 'child.ts'), [
      "import { writeFileSync } from 'node:fs'",
      `process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(got)}, 'SIGTERM ' + process.ppid); process.exit(0) })`,
      `writeFileSync(${JSON.stringify(ready)}, String(process.ppid))`,
      'setInterval(() => {}, 1000)',
    ].join('\n'))
    const p = Bun.spawn([first.executable, process.execPath, '--no-env-file', '--config=/dev/null', join(d, 'child.ts')],
      { cwd: '/', env: ENV(), stdout: 'pipe', stderr: 'pipe' })
    await until(() => existsSync(ready), 5_000)
    expect(readFileSync(ready, 'utf8')).toBe(String(p.pid)) // the launcher stays the parent: it never exec'd bun
    p.kill('SIGTERM')
    expect(await p.exited).toBe(0)
    expect(readFileSync(got, 'utf8')).toBe(`SIGTERM ${p.pid}`)
  }, 15_000)

  test('reports 143 for a child killed by SIGTERM and 127 for a missing program', async () => {
    const p = Bun.spawn([first.executable, '/bin/sleep', '30'], { cwd: '/', env: ENV(), stdout: 'pipe', stderr: 'pipe' })
    await until(() => childrenOf(p.pid).length === 1, 5_000)
    const sleeper = Number(childrenOf(p.pid)[0])
    p.kill('SIGTERM')
    expect(await p.exited).toBe(143)
    expect(run(['/bin/ps', '-o', 'pid=', '-p', String(sleeper)]).out.trim()).toBe('') // no orphan left
    const missing = run([first.executable, '/no/such/program'])
    expect(missing.code).toBe(127)
    expect(missing.err).toBe('collab-bridge-hub: posix_spawn /no/such/program: No such file or directory\n')
  }, 15_000)

  test('two builds have the same cdhash, UUID and executable sha256', () => {
    mkdirSync(join(dir, 'two'))
    const second = buildLauncher({ out: join(dir, 'two', 'CollabBridgeHub.app') })
    expect({ cdhash: second.cdhash, uuid: second.uuid, sha256: second.sha256 }).toEqual({ cdhash: first.cdhash, uuid: first.uuid, sha256: first.sha256 })
  })

  test('a rebuild replaces an installed app in place and leaves nothing beside it', () => {
    mkdirSync(join(dir, 'three'))
    const out = join(dir, 'three', 'CollabBridgeHub.app')
    buildLauncher({ out })
    writeFileSync(join(out, 'Contents', 'stray'), 'x')
    const again = buildLauncher({ out })
    expect(again.cdhash).toBe(first.cdhash)
    expect(readdirSync(join(dir, 'three'))).toEqual(['CollabBridgeHub.app'])
    expect(existsSync(join(out, 'Contents', 'stray'))).toBe(false)
  })

  test('an edited Info.plist fails verification', () => {
    const copy = join(temp('cb-tamper-'), 'CollabBridgeHub.app')
    cpSync(first.app, copy, { recursive: true })
    expect(run([systemBin('codesign'), '--verify', '--deep', '--strict', copy]).code).toBe(0)
    expect(run([systemBin('plutil'), '-replace', 'NSLocalNetworkUsageDescription', '-string', 'changed', join(copy, 'Contents', 'Info.plist')]).code).toBe(0)
    const v = run([systemBin('codesign'), '--verify', '--deep', '--strict', copy])
    expect(v.code).not.toBe(0)
    expect(v.err).toContain('invalid Info.plist')
  })

  test('the script prints the build as one JSON line, and refuses a wrong --out', () => {
    const h = temp('cb-launcher-cli-')
    const out = join(h, 'CollabBridgeHub.app')
    const cli = (args: string[]) => Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', 'scripts/build-launcher.ts', ...args],
      { cwd: PKG, env: testEnv(h) })
    const ok = cli(['--out', out])
    expect(ok.exitCode).toBe(0)
    const lines = ok.stdout.toString().split('\n').filter(Boolean)
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0]!)).toEqual({ app: out, executable: join(out, 'Contents', 'MacOS', 'collab-bridge-hub'),
      cdhash: first.cdhash, uuid: first.uuid, sha256: first.sha256 })
    for (const bad of [[], ['--out'], ['--out', 'CollabBridgeHub.app'], ['--out', join(h, 'Other.app')]]) {
      const r = cli(bad)
      expect([bad, r.exitCode, r.stderr.toString()]).toEqual([bad, 2, 'usage: build-launcher.ts --out <absolute dir>/CollabBridgeHub.app\n'])
    }
  }, 30_000)
})
