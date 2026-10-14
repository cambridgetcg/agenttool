// The Nuance binary (C6, K42, P15). The compiled tests share one ~63 MB compile made in beforeAll, in a temp dir that
// afterAll removes (it is not tracked: afterEach(cleanupTmps) would delete it after the first test). The reproducibility
// test compiles once more, from another folder, and removes that copy at once.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildNuance, cutAfterLinkedit, linkeditEnd, NUANCE_BUILD_FLAGS, type NuanceBuild } from '../scripts/build-nuance.ts'
import { readLedger } from '../src/ledger.ts'
import { encodeFrame, FRAME_TYPE, FrameDecoder, PreambleScanner, type Frame } from '../src/link/frame.ts'
import { MAX_PIPE_TO_HUB } from '../src/link/messages.ts'
import { readInstalled } from '../src/nuance/installed.ts'
import { nuancePaths } from '../src/paths.ts'
import { gateCompiled, makeFakeSsh, type FakeSsh } from './fake-ssh.ts'
import { cleanupTmps, modeOf, PKG, sha256File, SUITE, temp, testDropin, testEnv, TREE } from './helpers.ts'
import { makeInstallBundle, runInstaller, summonReadyHome } from './install-fixtures.ts'
import { installForHello } from './nuance-home.ts'

afterEach(cleanupTmps)

const NONCE = '0123456789abcdef0123456789abcdef'
const SYSTEM = { PATH: '/usr/bin:/bin' }
const lines = (s: string) => s.split('\n').filter(Boolean)

/** A minimal thin arm64 Mach-O: the 32-byte header, one 72-byte LC_SEGMENT_64 named __LINKEDIT, then `tail`. */
function fakeMacho(o: { linkeditOff: number; linkeditSize: number; tail: number[] }): Uint8Array {
  const end = o.linkeditOff + o.linkeditSize
  const b = new Uint8Array(end + o.tail.length)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0xfeedfacf, true)        // MH_MAGIC_64
  v.setUint32(4, 0x0100000c, true)        // CPU_TYPE_ARM64
  v.setUint32(16, 1, true)                // ncmds
  v.setUint32(20, 72, true)               // sizeofcmds
  v.setUint32(32, 0x19, true)             // LC_SEGMENT_64
  v.setUint32(36, 72, true)               // cmdsize
  b.set(new TextEncoder().encode('__LINKEDIT'), 40)
  v.setBigUint64(72, BigInt(o.linkeditOff), true)   // fileoff
  v.setBigUint64(80, BigInt(o.linkeditSize), true)  // filesize
  b.set(o.tail, end)
  return b
}

describe('Mach-O helpers', () => {
  test('linkeditEnd reads fileoff + filesize, and cutAfterLinkedit cuts only a zero tail', () => {
    const dir = temp('cb-macho-')
    expect(linkeditEnd(fakeMacho({ linkeditOff: 128, linkeditSize: 64, tail: [] }))).toBe(192)
    const zero = join(dir, 'zero')
    writeFileSync(zero, fakeMacho({ linkeditOff: 128, linkeditSize: 64, tail: new Array(10).fill(0) }))
    cutAfterLinkedit(zero)
    expect(statSync(zero).size).toBe(192)
    cutAfterLinkedit(zero)                   // already at its end: left alone
    expect(statSync(zero).size).toBe(192)
    const junk = join(dir, 'junk')
    writeFileSync(junk, fakeMacho({ linkeditOff: 128, linkeditSize: 64, tail: [0, 0, 7] }))
    expect(() => cutAfterLinkedit(junk)).toThrow('non-zero bytes after __LINKEDIT')
    expect(statSync(junk).size).toBe(195)    // refused, so the file is as it was
    expect(() => linkeditEnd(new TextEncoder().encode('#!/bin/bash\necho not a Mach-O file\n'))).toThrow('not a 64-bit Mach-O file')
  })

  test('the build flags are the arm64 compile and the four autoload refusals', () => {
    expect([...NUANCE_BUILD_FLAGS]).toEqual(['--compile', '--target=bun-darwin-arm64', '--no-compile-autoload-dotenv',
      '--no-compile-autoload-bunfig', '--no-compile-autoload-tsconfig', '--no-compile-autoload-package-json'])
  })
})

/** One ssh call through the fake, as the hub or pin-device makes it: stdout, stderr and the exit code. */
async function ssh(fake: FakeSsh, command: string | null) {
  const args = ['-F', '/Users/yuai/.ssh/collab-bridge/config', 'collab-nuance', ...(command === null ? [] : [command])]
  const p = Bun.spawn([fake.bin, ...args], { stdin: new Blob(['']), stdout: 'pipe', stderr: 'pipe', env: SYSTEM })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, out, err }
}

function git(args: string[], home: string): string {
  const r = Bun.spawnSync(['/opt/homebrew/bin/git', ...args], {
    cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' } })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`)
  return r.stdout.toString().trim()
}

/** The Air's trial repo as prepare-pairing makes it: README.md and notes/.gitkeep in one commit ending with the trailer. */
function trialRepo(): string {
  const home = temp('cb-air-git-')
  const repo = join(temp('cb-air-'), 'collab-trial')
  git(['init', '-q', '-b', 'main', repo], home)
  writeFileSync(join(repo, 'README.md'), '# collab-trial\n')
  mkdirSync(join(repo, 'notes'))
  writeFileSync(join(repo, 'notes', '.gitkeep'), '')
  git(['-C', repo, 'add', 'README.md', 'notes/.gitkeep'], home)
  git(['-C', repo, '-c', 'user.name=Ai', '-c', 'user.email=ai@collab-trial.invalid', 'commit', '-q', '-m', 'collab-trial: the shared base',
    '-m', 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>'], home)
  return repo
}

describe('the compiled Nuance binary', () => {
  let buildRoot = ''
  let built: NuanceBuild

  beforeAll(() => {
    buildRoot = realpathSync(mkdtempSync(join(tmpdir(), 'cb-build-')))
    built = buildNuance(join(buildRoot, 'out'))
  }, 120_000)

  afterAll(() => {
    if (buildRoot) rmSync(buildRoot, { recursive: true, force: true })
  })

  test('compiles one arm64 binary with a valid strict ad hoc signature and nothing after __LINKEDIT', () => {
    expect(built.binary).toBe(join(buildRoot, 'out', 'collab-bridge'))
    expect(readdirSync(join(buildRoot, 'out'))).toEqual(['collab-bridge'])
    const bytes = readFileSync(built.binary)
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(v.getUint32(0, true)).toBe(0xfeedfacf)        // thin 64-bit Mach-O
    expect(v.getUint32(4, true)).toBe(0x0100000c)        // CPU_TYPE_ARM64
    expect(linkeditEnd(bytes)).toBe(bytes.byteLength)
    expect(built.sha256).toBe(sha256File(built.binary))
    expect(built.build).toBe(built.sha256.slice(0, 8))
    expect(modeOf(built.binary)).toBe(0o755)
    expect(Bun.spawnSync(['/usr/bin/codesign', '--verify', '--strict', built.binary], { env: SYSTEM }).exitCode).toBe(0)
    const info = Bun.spawnSync(['/usr/bin/codesign', '-dv', '--verbose=4', built.binary], { env: SYSTEM }).stderr.toString()
    expect(info).toContain('Identifier=dev.agenttool.collab-bridge\n')
    expect(info).toContain('Signature=adhoc\n')
    expect(info).toContain('TeamIdentifier=not set\n')
  })

  test('the bytes do not depend on the folder the build starts from and carry no path of this Mac', () => {
    const start = temp('cb-build-start-')
    const again = join(temp('cb-build-again-'), 'nuance')
    const home = temp('cb-build-home-')
    const r = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', join(PKG, 'scripts', 'build-nuance.ts'), '--out', again],
      { cwd: start, env: testEnv(home) })
    expect(r.stderr.toString()).toBe('')
    expect(r.exitCode).toBe(0)
    const second = JSON.parse(r.stdout.toString()) as NuanceBuild
    expect(second.binary).toBe(join(again, 'collab-bridge'))
    expect(second.sha256).toBe(built.sha256)
    expect(sha256File(second.binary)).toBe(built.sha256)
    rmSync(dirname(again), { recursive: true, force: true })   // 63 MB: not kept until afterEach
    // The build's own places: the worktree, the output dirs, the dir it started from, its home and the temp roots. Each is
    // searched without its leading slash, because the bundler names a module relative to its cwd (`private/tmp/…` from
    // `/`, `../../Users/…` from elsewhere). A production constant such as Collab's install path on the Air is code, not a
    // path of the build, and is not searched for.
    const bytes = readFileSync(built.binary)
    for (const p of [PKG, TREE, buildRoot, dirname(again), start, home, SUITE.root, realpathSync(tmpdir())]) {
      expect({ path: p, found: bytes.includes(Buffer.from(p.slice(1))) }).toEqual({ path: p, found: false })
    }
  }, 120_000)

  test('the binary carries no Air code (P20)', () => {
    // The bundler marks each bundled module with a `// <path relative to the package>` line; Bun's own runtime modules
    // carry `build/release/…` paths and are not ours.
    const text = readFileSync(built.binary).toString('latin1')
    const modules = [...new Set([...text.matchAll(/\/\/ ((?:src|bin|scripts|tests)\/[A-Za-z0-9._\/-]+\.ts)\n/g)].map((m) => m[1]!))].sort()
    expect(modules).toContain('src/nuance/main.ts')
    expect(modules).toContain('src/nuance/gate-main.ts')
    expect(modules.filter((m) => !m.startsWith('src/') || m.startsWith('src/air/') || m === 'src/cli.ts')).toEqual([])
  })

  test('the compiled gate refuses ls with exit 64 and ignores a .env and a bunfig.toml in its home', async () => {
    const home = temp('cb-nuance-')
    const env = testEnv(home)
    const paths = nuancePaths(home, env)
    installForHello(paths)                   // so a gate that read the planted .env would answer hello
    const marker = join(home, 'PRELOADED')
    writeFileSync(join(home, '.env'), 'SSH_ORIGINAL_COMMAND=hello\n')
    writeFileSync(join(home, 'planted.ts'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')\n`)
    writeFileSync(join(home, 'bunfig.toml'), 'preload = ["./planted.ts"]\n')
    // Control: a plain bun started there reads both, so the plant is real.
    const control = Bun.spawnSync([process.execPath, '-e', 'process.stdout.write(process.env.SSH_ORIGINAL_COMMAND ?? "")'],
      { cwd: home, env: { PATH: '/usr/bin:/bin', HOME: home } })
    expect(control.stdout.toString()).toBe('hello')
    expect(existsSync(marker)).toBe(true)
    rmSync(marker)
    const fake = makeFakeSsh({ nuanceHome: home, target: gateCompiled(built.binary), env })
    const ls = await ssh(fake, 'ls -la')
    expect(ls.code).toBe(64)
    expect(ls.out).toBe('')
    expect(lines(ls.err)).toHaveLength(1)
    const unset = await ssh(fake, null)      // the .env's command never reaches the gate either
    expect(unset.code).toBe(64)
    expect(unset.out).toBe('')
    expect(existsSync(marker)).toBe(false)
    expect(readLedger(paths.ledger).filter((e) => e.event === 'gate').map((e) => [e.form, e.outcome]))
      .toEqual([['bad', 'refused'], ['bad', 'refused']])
  }, 30_000)

  test('the compiled relay prints the preamble through the fake ssh', async () => {
    const home = temp('cb-nuance-')
    const env = testEnv(home)
    const paths = nuancePaths(home, env)
    const fake = makeFakeSsh({ nuanceHome: home, target: gateCompiled(built.binary), env })
    const p = Bun.spawn([fake.bin, '-F', '/Users/yuai/.ssh/collab-bridge/config', 'collab-nuance', `relay 1 ${NONCE}`],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: SYSTEM })
    const reader = p.stdout.getReader()
    const scanner = new PreambleScanner(NONCE)
    const decoder = new FrameDecoder(MAX_PIPE_TO_HUB)
    const frames: Frame[] = []
    let found = false
    const deadline = Date.now() + 10_000
    const readUntil = async (done: () => boolean) => {
      while (!done()) {
        if (Date.now() > deadline) throw new Error('relay: no answer')
        const { value, done: eof } = await reader.read()
        if (eof) throw new Error('relay: stdout closed early')
        let rest = value
        if (!found) {
          const s = scanner.push(value)
          if (s.state !== 'found') continue
          found = true
          rest = s.rest
        }
        frames.push(...decoder.push(rest))
      }
    }
    await readUntil(() => found)
    expect(existsSync(paths.hubSock)).toBe(true)
    p.stdin.write(encodeFrame(FRAME_TYPE.PING, 0))
    p.stdin.flush()
    await readUntil(() => frames.some((f) => f.type === FRAME_TYPE.PONG))
    expect(frames.map((f) => [f.type, f.stream])).toEqual([[FRAME_TYPE.PONG, 0]])
    p.stdin.end()
    expect(await p.exited).toBe(0)
    expect(existsSync(paths.hubSock)).toBe(false)
  }, 30_000)

  test('the real binary goes through the bundle and the installer, keeps its signature, and still runs', () => {
    const { home, share } = summonReadyHome({ home: temp('cb-nuance-install-') })
    const bundle = makeInstallBundle({ airRepo: trialRepo(), shares: [share], quarantine: true, binary: built.binary, build: built.build })
    expect(bundle.values.shaBinary).toBe(built.sha256)
    const r = runInstaller(bundle.dir, home, { answers: 'y\ny\n' })
    // The install verbs report on stderr with ✓ lines; any ✗ line there or on stdout names the check that stopped it.
    const refusals = lines(r.stdout + r.stderr).filter((l) => l.startsWith('✗'))
    expect({ code: r.code, refusals }).toEqual({ code: 0, refusals: [] })
    expect(lines(r.stdout).at(-1)).toMatch(/^Done\b/)    // two y's: `Done`, never `✗ Not confirmed`
    const env = testEnv(home)
    const paths = nuancePaths(home, env)
    const installed = paths.binary
    expect(sha256File(installed)).toBe(built.sha256)  // copied byte for byte: a signed binary is never signed again
    const record = readInstalled(paths)
    expect({ build: record?.build, binary_sha256: record?.binary_sha256 }).toEqual({ build: built.build, binary_sha256: built.sha256 })
    expect(modeOf(installed)).toBe(0o755)
    expect(Bun.spawnSync(['/usr/bin/xattr', '-p', 'com.apple.quarantine', installed], { env: SYSTEM }).exitCode).not.toBe(0)
    expect(Bun.spawnSync(['/usr/bin/codesign', '--verify', '--strict', installed], { env: SYSTEM }).exitCode).toBe(0)
    const status = Bun.spawnSync([installed, 'status'], { cwd: '/', env })
    expect(status.exitCode).toBe(0)
    expect(lines(status.stdout.toString())[0]).toBe('relay: none')
  }, 120_000)
})
