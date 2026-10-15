import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readLedger, verifyLedger } from '../src/ledger.ts'
import { encodeFrame, FRAME_TYPE, FrameDecoder, PreambleScanner, type Frame } from '../src/link/frame.ts'
import { MAX_PIPE_TO_HUB } from '../src/link/messages.ts'
import { FETCH_STOPPED_EXIT, pktLineErr } from '../src/nuance/fetch-gate.ts'
import { runGate } from '../src/nuance/gate-main.ts'
import { nuancePaths, type NuancePaths } from '../src/paths.ts'
import { gateFromSource, makeFakeSsh, type FakeSsh } from './fake-ssh.ts'
import { cleanupTmps, sha256File, temp, testEnv } from './helpers.ts'
import { fixtureGit as git, installedNuanceHome, installForHello, recordedGit, secretBranchRepo } from './nuance-home.ts'

afterEach(cleanupTmps)

const NONCE = 'fedcba9876543210fedcba9876543210'
const MARKER = 'cdc-7f3a'
const SELF = Bun.spawnSync(['/usr/bin/id', '-un'], { env: { PATH: '/usr/bin:/bin' } }).stdout.toString().trim()

/** A temp "Nuance" home and the env its gate gets under the fake ssh: the override, a short socket root, the knobs. */
function nuance() {
  const home = temp('cb-gate-')
  const env = testEnv(home)
  return { home, env, paths: nuancePaths(home, env) }
}

/** One ssh call as the hub or pin-device makes it: argv in; stdout bytes, stderr and the exit code out. */
async function ssh(n: ReturnType<typeof nuance>, command: string | null, extraEnv: Record<string, string> = {}) {
  const fake = makeFakeSsh({ nuanceHome: n.home, target: gateFromSource(), env: { ...n.env, ...extraEnv } })
  const args = ['-F', '/Users/yuai/.ssh/collab-bridge/config', 'collab-nuance', ...(command === null ? [] : [command])]
  const p = Bun.spawn([fake.bin, ...args], { stdin: new Blob(['']), stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/bin:/bin' } })
  const [out, err, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited])
  return { code, bytes: new Uint8Array(out), out: new TextDecoder().decode(out), err }
}

const lines = (s: string) => s.split('\n').filter(Boolean)
const gateLines = (paths: NuancePaths) => readLedger(paths.ledger).filter((e) => e.event === 'gate')

describe('gate entry', () => {
  test('ls gets one stderr line, empty stdout and exit 64', async () => {
    const n = nuance()
    const r = await ssh(n, `ls -la ~/${MARKER}`)
    expect(r.code).toBe(64)
    expect(r.out).toBe('')
    expect(lines(r.err).length).toBe(1)
    expect(r.err).not.toContain(MARKER)
    expect(gateLines(n.paths).map((e) => [e.form, e.outcome])).toEqual([['bad', 'refused']])
  })

  test('a free-text command puts no word of the client\'s into the hash-chained ledger (Task 63 gate-2-1)', async () => {
    const n = nuance()
    const r = await ssh(n, `summarize the ${MARKER} payroll repo`)
    expect(r.code).toBe(64)
    const line = gateLines(n.paths)[0]!
    expect([line.form, line.outcome, line.code]).toEqual(['bad', 'refused', `len ${`summarize the ${MARKER} payroll repo`.length}, first token not shown`])
    const raw = readFileSync(n.paths.ledger, 'utf8')
    for (const word of ['summarize', MARKER, 'payroll']) expect(raw).not.toContain(word)
  })

  test('an upload-pack-shaped refusal answers a pkt-line ERR', async () => {
    const n = nuance()
    const r = await ssh(n, "git-upload-pack 'relative/path'")
    expect(r.code).toBe(64)
    expect(Array.from(r.bytes)).toEqual(Array.from(pktLineErr('bad_command')))
    expect(lines(r.err).length).toBe(1)
  })

  test('an upload-pack form without INSTALLED answers ERR not_installed', async () => {
    const n = nuance()
    const r = await ssh(n, "git-upload-pack '/Users/macair/Projects/collab-trial/.git'")
    expect(r.code).toBe(64)
    expect(Array.from(r.bytes)).toEqual(Array.from(pktLineErr('not_installed')))
    expect(lines(r.err).length).toBe(1)
  })

  test('hello prints exactly one JSON line', async () => {
    const n = nuance()
    const seat = installForHello(n.paths)
    const r = await ssh(n, 'hello')
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    expect(r.out.endsWith('\n')).toBe(true)
    expect(r.out.split('\n')).toHaveLength(2)
    const hello = JSON.parse(r.out)
    expect(hello.v).toBe(1)
    expect(hello.seat_public).toBe(seat)
    expect(hello.user).toBe(SELF)
    expect(gateLines(n.paths).map((e) => [e.form, e.outcome, e.bytes])).toEqual([['hello', 'ok', r.bytes.byteLength]])
  })

  test('hello without INSTALLED is refused with one stderr line and no stdout', async () => {
    const n = nuance()
    const r = await ssh(n, 'hello')
    expect(r.code).toBe(64)
    expect(r.out).toBe('')
    expect(lines(r.err).length).toBe(1)
    expect(gateLines(n.paths).map((e) => [e.form, e.outcome])).toEqual([['hello', 'refused']])
  })

  test('relay 1 <nonce> prints the preamble and frames', async () => {
    const n = nuance()
    const fake = makeFakeSsh({ nuanceHome: n.home, target: gateFromSource(), env: n.env })
    const p = Bun.spawn([fake.bin, '-F', '/Users/yuai/.ssh/collab-bridge/config', 'collab-nuance', `relay 1 ${NONCE}`],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/bin:/bin' } })
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
    expect(existsSync(n.paths.hubSock)).toBe(true)
    p.stdin.write(encodeFrame(FRAME_TYPE.PING, 0))
    p.stdin.flush()
    await readUntil(() => frames.some((f) => f.type === FRAME_TYPE.PONG))
    expect(frames.map((f) => [f.type, f.stream])).toEqual([[FRAME_TYPE.PONG, 0]])
    p.stdin.end()
    expect(await p.exited).toBe(0)
    expect(existsSync(n.paths.hubSock)).toBe(false)
    const ledger = readLedger(n.paths.ledger)
    expect(ledger.map((e) => [e.event, e.form ?? e.outcome])).toEqual([['relay', 'start'], ['relay', 'exit'], ['gate', 'relay']])
    expect(ledger[2]!.outcome).toBe('ok')
  }, 20_000)

  test('every invocation appends one content-free ledger line', async () => {
    const n = nuance()
    installForHello(n.paths)
    const calls = [`cat /Users/macair/${MARKER}/notes`, 'hello', `git-upload-pack '${MARKER}'`,
      `git-upload-pack '/Users/macair/${MARKER}/.git'`, `relay 1 ${MARKER}`, null]
    const sent: number[] = []
    for (const c of calls) sent.push((await ssh(n, c)).bytes.byteLength)
    const gate = gateLines(n.paths)
    expect(gate.map((e) => e.form)).toEqual(['bad', 'hello', 'bad', 'upload-pack', 'bad', 'bad'])
    expect(gate.map((e) => e.bytes)).toEqual(sent)
    expect(sent[2]).toBe(pktLineErr('bad_command').byteLength)
    for (const e of gate) {
      expect(typeof e.outcome).toBe('string')
      expect(typeof e.ms).toBe('number')
    }
    expect(readFileSync(n.paths.ledger, 'utf8')).not.toContain(MARKER)
    expect(verifyLedger(n.paths.ledger).ok).toBe(true)
  }, 30_000)

  test('an unset SSH_ORIGINAL_COMMAND is refused', async () => {
    const n = nuance()
    const r = await ssh(n, null)
    expect(r.code).toBe(64)
    expect(r.out).toBe('')
    expect(lines(r.err).length).toBe(1)
    expect(gateLines(n.paths).map((e) => [e.form, e.outcome])).toEqual([['bad', 'refused']])
  })

  test('the source-mode gate launch (gateFromSource: --no-env-file --config=/dev/null) reads no .env or bunfig.toml in the Nuance home', async () => {
    // This checks the test fixture, not src/: other source-mode gate tests run through gateFromSource() with sshd's cwd (the Nuance home),
    // so this shows the fixture behaves like the compiled binary with autoload off. The product property is pinned in Task 58
    // ('the compiled gate refuses ls with exit 64 and ignores a .env and a bunfig.toml in its home', plus the NUANCE_BUILD_FLAGS test)
    // and by Task 56's exact collab-air command= line (the compiled binary, no bun flags).
    const n = nuance()
    installForHello(n.paths)
    const marker = join(n.home, 'PRELOADED')
    writeFileSync(join(n.home, '.env'), 'SSH_ORIGINAL_COMMAND=hello\n')
    writeFileSync(join(n.home, 'planted.ts'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')\n`)
    writeFileSync(join(n.home, 'bunfig.toml'), 'preload = ["./planted.ts"]\n')
    // Control: a plain bun started there reads both, so the plant is real.
    const control = Bun.spawnSync([process.execPath, '-e', 'process.stdout.write(process.env.SSH_ORIGINAL_COMMAND ?? "")'],
      { cwd: n.home, env: { PATH: '/usr/bin:/bin', HOME: n.home } })
    expect(control.stdout.toString()).toBe('hello')
    expect(existsSync(marker)).toBe(true)
    Bun.spawnSync(['/bin/rm', marker])
    const r = await ssh(n, null)
    expect(r.code).toBe(64)
    expect(r.out).toBe('')
    expect(existsSync(marker)).toBe(false)
  })
})

/** The Air's git as the fetching client (Task 21's recordedGit: the Cellar realpath of /opt/homebrew/bin/git). */
const GIT = recordedGit().path
/** Fixture git runs with no system or global config and no prompts (as Task 21's fixtureGit). */
const GIT_ENV = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
const UNADVERTISED = /not our ref|Server does not allow request for unadvertised object/
/** pkt-line framing for a raw upload-pack conversation. */
const pkt = (s: string) => `${(4 + Buffer.byteLength(s)).toString(16).padStart(4, '0')}${s}`

/** An installed Nuance home (Task 21) whose share holds a repo with a hidden branch, behind the fake ssh and the real gate entry. */
function uploadWorld() {
  const h = installedNuanceHome({ share: join('Projects', 'collab-trial') })
  const { head, secret } = secretBranchRepo(h.share, h.home)
  const fake = makeFakeSsh({ nuanceHome: h.home, target: gateFromSource(), env: h.env })
  return { h, fake, gitdir: join(h.share, '.git'), head, secret }
}

/** The Air side: `git fetch collab-nuance:<path> <refspec>` into a fresh repo through the fake ssh, as the hub's mirror sync does. */
function fetchThrough(fake: FakeSsh, remotePath: string, refspec: string, protocol: 0 | 2) {
  const air = temp('cb-air-')
  git(['init', '-q', '-b', 'main', air], air)
  const r = Bun.spawnSync([GIT, '-C', air, '-c', `protocol.version=${protocol}`, 'fetch', '--no-tags', '--no-write-fetch-head',
    `collab-nuance:${remotePath}`, refspec], {
    cwd: '/', env: { ...GIT_ENV, HOME: air, GIT_SSH_COMMAND: `'${fake.bin}'` }, stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
  })
  return { code: r.exitCode, stderr: r.stderr.toString(), air }
}

/** One raw upload-pack conversation through an ssh: what git would send, and every byte that came back. */
function rawUploadPack(bin: string, command: string, request: string, env: Record<string, string> = {}) {
  const r = Bun.spawnSync([bin, 'collab-nuance', command], { stdin: Buffer.from(request), stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/bin:/bin', ...env } })
  return { code: r.exitCode, out: r.stdout.toString('latin1') }
}

describe('upload-pack through the fake ssh and the real gate entry (§12.1 Git transfer)', () => {
  test('a v0 fetch through the gate gets HEAD', () => {
    const w = uploadWorld()
    const r = fetchThrough(w.fake, w.gitdir, '+HEAD:refs/collab/nuance/macair/0000000000000000/incoming', 0)
    expect([r.code, r.stderr]).toEqual([0, expect.any(String)])
    expect(git(['-C', r.air, 'rev-parse', 'refs/collab/nuance/macair/0000000000000000/incoming'], r.air)).toBe(w.head)
    // The fake ssh got git's own form of the command (K48), and the gate ledgered it as served.
    expect(w.fake.calls().at(-1)!.at(-1)).toBe(`git-upload-pack '${w.gitdir}'`)
    expect(gateLines(w.h.paths).map((e) => [e.form, e.outcome])).toEqual([['upload-pack', 'served']])
  }, 30_000)

  test('a git client asking for a hidden commit gets nothing, and the raw want is refused by upload-pack (K49)', () => {
    const w = uploadWorld()
    const r = fetchThrough(w.fake, w.gitdir, w.secret, 0)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(UNADVERTISED)
    expect(Bun.spawnSync([GIT, '-C', r.air, 'cat-file', '-e', w.secret], { cwd: '/', env: { ...GIT_ENV, HOME: r.air } }).exitCode).not.toBe(0)
    // The client check above is git's own; this raw want shows the gate's upload-pack refuses it too.
    const raw = rawUploadPack(w.fake.bin, `git-upload-pack '${w.gitdir}'`, pkt(`want ${w.secret} multi_ack\n`) + '0000' + pkt('done\n'))
    expect(raw.out).toContain(' HEAD\0')                       // only HEAD is advertised (hideRefs=refs/)
    expect(raw.out).not.toMatch(/[0-9a-f]{40} refs\//)         // and no ref under refs/
    expect(raw.out).toContain(`ERR upload-pack: not our ref ${w.secret}`)
    expect(raw.code).toBe(128)                                  // the gate exits with git's code
  }, 30_000)

  test('an sshd that forwards GIT_PROTOCOL=version=2 changes nothing: the gate scrubs it and upload-pack speaks v0', () => {
    const w = uploadWorld()
    w.fake.setPassGitProtocol(true)
    // Control: the same kind of fake ssh in front of a bare upload-pack hands it GIT_PROTOCOL, and it answers in v2.
    const bare = makeFakeSsh({ nuanceHome: w.h.home, target: [GIT, 'upload-pack', '--strict', w.gitdir], env: w.h.env })
    bare.setPassGitProtocol(true)
    expect(rawUploadPack(bare.bin, 'git-upload-pack', '0000', { GIT_PROTOCOL: 'version=2' }).out.startsWith('000eversion 2\n')).toBe(true)
    // Through the gate the same request gets the v0 advertisement: upload-pack never saw GIT_PROTOCOL.
    const raw = rawUploadPack(w.fake.bin, `git-upload-pack '${w.gitdir}'`, '0000', { GIT_PROTOCOL: 'version=2' })
    expect(raw.out.startsWith('000eversion 2')).toBe(false)
    expect(raw.out).toContain(' HEAD\0')
    // A v2-asking client still cannot fetch the hidden commit, and still fetches HEAD.
    const hidden = fetchThrough(w.fake, w.gitdir, w.secret, 2)
    expect(hidden.code).not.toBe(0)
    expect(hidden.stderr).toMatch(UNADVERTISED)
    expect(fetchThrough(w.fake, w.gitdir, '+HEAD:refs/collab/t/incoming', 2).code).toBe(0)
  }, 30_000)

  test('the work-tree path is refused: shares.json lists only the gitdir', async () => {
    const w = uploadWorld()
    const r = fetchThrough(w.fake, w.h.share, '+HEAD:refs/collab/t/incoming', 0)
    expect(r.code).toBe(128)
    expect(r.stderr).toContain('remote error: not_shared')
    // git exits on the ERR line without waiting for its ssh, so the gate's ledger line may land a moment later.
    const end = Date.now() + 5_000
    while (gateLines(w.h.paths).length === 0 && Date.now() < end) await Bun.sleep(20)
    expect(gateLines(w.h.paths).map((e) => [e.form, e.outcome])).toEqual([['upload-pack', 'not_shared']])
  }, 30_000)
})

/** The code a ledger line carries, for the lines the gate appends. */
const gateTriples = (paths: NuancePaths) => gateLines(paths).map((e) => [e.form, e.outcome, e.code])

describe('gate entry: no paths (Task 63 gate-1-8)', () => {
  /** runGate in this process with a stdin that is already at its end, and what it wrote to stdout and stderr. */
  async function runBare(env: Record<string, string>) {
    const out: Buffer[] = []
    let err = ''
    const io = { stdin: new ReadableStream<Uint8Array>({ start(c) { c.close() } }),
      stdout: { write(b: Uint8Array | string) { out.push(Buffer.from(b)) } }, stderr: { write(s: string) { err += s } } }
    const code = await runGate(env, io)
    return { code, bytes: Buffer.concat(out), err }
  }

  test('an upload-pack-shaped command is still answered with a pkt-line ERR when the Nuance paths cannot be built', async () => {
    // A HOME that is not absolute: homeOf returns it and nuancePaths refuses it, before any ledger path exists.
    const r = await runBare({ HOME: 'not/absolute', SSH_ORIGINAL_COMMAND: "git-upload-pack '/Users/macair/Projects/collab-trial/.git'" })
    expect(r.code).toBe(64)
    expect(Array.from(r.bytes)).toEqual(Array.from(pktLineErr('config')))
    expect(lines(r.err)).toHaveLength(1)
    expect(r.err).toContain('refused')
  })

  test('any other command gets the one stderr line and no stdout when the paths cannot be built', async () => {
    for (const command of ['hello', `relay 1 ${NONCE}`, 'ls -la', undefined]) {
      const r = await runBare({ HOME: 'not/absolute', ...(command === undefined ? {} : { SSH_ORIGINAL_COMMAND: command }) })
      expect([command, r.code, r.bytes.byteLength, lines(r.err).length]).toEqual([command, 64, 0, 1])
    }
  })
})

describe('gate entry: a reply to a reader that has gone (Task 63 gate-1-8 round 1)', () => {
  /**
   * runGate in this process with a stdout whose every write is rejected, the way a sink reports a reader that has gone
   * (GateIo.write may return a promise). The rejections nobody handled are collected: a reply the gate does not wait for
   * must not leave one behind, or it could add a stderr line or change the exit code.
   */
  async function runGone(env: Record<string, string>) {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => { unhandled.push(e) }
    const tried: Buffer[] = []
    let err = ''
    const io = { stdin: new ReadableStream<Uint8Array>({ start(c) { c.close() } }),
      stdout: { write(b: Uint8Array | string) { tried.push(Buffer.from(b)); return Promise.reject(new Error('EPIPE')) } },
      stderr: { write(s: string) { err += s } } }
    process.on('unhandledRejection', onUnhandled)
    try {
      const code = await runGate(env, io)
      await Bun.sleep(30)                                // an unhandled rejection is reported once the microtasks have drained
      return { code, err, unhandled, tried: Buffer.concat(tried) }
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  }

  test('the pkt-line ERR for paths that cannot be built is tried, and its rejection is not left unhandled', async () => {
    const r = await runGone({ HOME: 'not/absolute', SSH_ORIGINAL_COMMAND: "git-upload-pack '/Users/macair/Projects/collab-trial/.git'" })
    expect(Array.from(r.tried)).toEqual(Array.from(pktLineErr('config')))
    expect(r.unhandled).toEqual([])
    expect(r.code).toBe(64)
    expect(lines(r.err)).toHaveLength(1)
  })

  test('the ERR bad_command, the hello answer and the ERR not_installed are the same: tried, ledgered, nothing unhandled', async () => {
    const n = nuance()
    const bad = await runGone({ ...n.env, SSH_ORIGINAL_COMMAND: "git-upload-pack 'relative/path'" })
    expect([bad.code, bad.unhandled, Array.from(bad.tried)]).toEqual([64, [], Array.from(pktLineErr('bad_command'))])
    const notInstalled = await runGone({ ...n.env, SSH_ORIGINAL_COMMAND: "git-upload-pack '/Users/macair/Projects/collab-trial/.git'" })
    expect([notInstalled.code, notInstalled.unhandled, Array.from(notInstalled.tried)]).toEqual([64, [], Array.from(pktLineErr('not_installed'))])
    installForHello(n.paths)
    const hello = await runGone({ ...n.env, SSH_ORIGINAL_COMMAND: 'hello' })
    expect([hello.code, hello.unhandled, JSON.parse(hello.tried.toString('utf8')).v]).toEqual([0, [], 1])
    expect(hello.err).toBe('')
    expect(gateTriples(n.paths)).toEqual([['bad', 'refused', expect.any(String)], ['upload-pack', 'refused', 'not_installed'], ['hello', 'ok', undefined]])
  })

  test('the ERR exception is the same: tried, ledgered, exit 70, nothing unhandled', async () => {
    const dir = temp('cb-nonexec-')
    const notGit = join(dir, 'git')
    writeFileSync(notGit, '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    const h = installedNuanceHome({ share: join('Projects', 'collab-trial'),
      git: { path: notGit, version: '2.52.0', sha256: sha256File(notGit), guard: true, apple: false } })
    secretBranchRepo(h.share, h.home)
    const r = await runGone({ ...h.env, SSH_ORIGINAL_COMMAND: `git-upload-pack '${join(h.share, '.git')}'` })
    expect(r.unhandled).toEqual([])
    expect(r.code).toBe(70)
    expect(Array.from(r.tried)).toEqual(Array.from(pktLineErr('exception')))
    expect(gateTriples(h.paths)).toEqual([['upload-pack', 'error', 'exception']])
  }, 30_000)
})

describe('gate entry: failures stay on the record (Task 24 review)', () => {
  test('a throw in the hello dispatch still appends the ledger line, and exits 70 with one stderr line', async () => {
    const n = nuance()
    installForHello(n.paths)
    // systemBin throws under the override when its knob is empty: a real throw inside the gate's own dispatch.
    const r = await ssh(n, 'hello', { COLLAB_BRIDGE_BIN_ZSH: '' })
    expect(r.code).toBe(70)
    expect(r.out).toBe('')
    expect(lines(r.err)).toHaveLength(1)
    expect(gateTriples(n.paths)).toEqual([['hello', 'error', 'exception']])
    expect(verifyLedger(n.paths.ledger).ok).toBe(true)
  })

  test('a throw in the upload-pack dispatch answers a pkt-line ERR, ledgers the line and exits 70', async () => {
    // The recorded git is a file that is not executable, with its true sha256: every check passes, and spawning it throws.
    const dir = temp('cb-nonexec-')
    const notGit = join(dir, 'git')
    writeFileSync(notGit, '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    const h = installedNuanceHome({ share: join('Projects', 'collab-trial'),
      git: { path: notGit, version: '2.52.0', sha256: sha256File(notGit), guard: true, apple: false } })
    secretBranchRepo(h.share, h.home)
    const r = await ssh({ home: h.home, env: h.env, paths: h.paths }, `git-upload-pack '${join(h.share, '.git')}'`)
    expect(r.code).toBe(70)
    expect(Array.from(r.bytes)).toEqual(Array.from(pktLineErr('exception')))
    expect(lines(r.err)).toHaveLength(1)
    expect(r.err).not.toContain(notGit)                 // a failure's message is never echoed
    expect(gateTriples(h.paths)).toEqual([['upload-pack', 'error', 'exception']])
  }, 30_000)

  test('a ledger append that fails is named once on stderr, and the answer still goes out', async () => {
    const n = nuance()
    installForHello(n.paths)
    mkdirSync(n.paths.ledger, { recursive: true })      // a directory where the ledger file belongs: every append fails with EISDIR
    const r = await ssh(n, 'hello')
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out).v).toBe(1)
    expect(lines(r.err)).toHaveLength(1)
    expect(r.err).toContain('ledger')
    expect(r.err).toContain('EISDIR')
  })

  test('a relay with a failing ledger says so once, not once per line', async () => {
    const n = nuance()
    mkdirSync(n.paths.ledger, { recursive: true })
    const up = await relayUp(n)
    up.p.stdin.end()
    expect(await up.p.exited).toBe(0)                    // start, exit and the gate's own line all failed to append
    const err = await up.err
    expect(lines(err)).toHaveLength(1)
    expect(err).toContain('EISDIR')
  }, 20_000)
})

/** The relay form behind the fake ssh, read up to its preamble; the hub's stdin and stdout are the process's. */
async function relayUp(n: ReturnType<typeof nuance>) {
  const fake = makeFakeSsh({ nuanceHome: n.home, target: gateFromSource(), env: n.env })
  const p = Bun.spawn([fake.bin, '-F', '/Users/yuai/.ssh/collab-bridge/config', 'collab-nuance', `relay 1 ${NONCE}`],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/bin:/bin' } })
  const err = new Response(p.stderr).text()
  const reader = p.stdout.getReader()
  const scanner = new PreambleScanner(NONCE)
  const deadline = Date.now() + 10_000
  for (;;) {
    if (Date.now() > deadline) throw new Error('relay: no preamble')
    const { value, done } = await reader.read()
    if (done) throw new Error('relay: stdout closed early')
    if (scanner.push(value).state === 'found') break
  }
  return { p, reader, err }
}

describe('a relay whose reader has gone (Task 23 write guard)', () => {
  test('writes after the hub side closed are no-ops: no crash, and the relay still cleans up and ledgers', async () => {
    const n = nuance()
    const up = await relayUp(n)
    await up.reader.cancel()                             // the hub's end of the ssh channel is gone: the next write meets EPIPE
    const sock = await Bun.connect({ unix: n.paths.hubSock, socket: { data() {}, close() {}, error() {} } })
    await Bun.sleep(200)                                 // the relay writes the pipe's OPEN frame toward a closed hub
    sock.end()
    await Bun.sleep(200)                                 // and its CLOSE
    up.p.stdin.end()
    expect(await up.p.exited).toBe(0)
    expect(await up.err).toBe('')
    expect(existsSync(n.paths.hubSock)).toBe(false)
    expect(existsSync(n.paths.relayStatus)).toBe(false)
    expect(readLedger(n.paths.ledger).map((e) => [e.event, e.form ?? e.outcome])).toEqual([['relay', 'start'], ['relay', 'exit'], ['gate', 'relay']])
    expect(verifyLedger(n.paths.ledger).ok).toBe(true)
  }, 20_000)
})

/** A repo whose HEAD holds `bytes` of incompressible data: a pack far beyond one pipe buffer, and git cannot shrink it. */
function noiseWorld(bytes: number) {
  const h = installedNuanceHome({ share: join('Projects', 'collab-trial') })
  mkdirSync(h.share, { recursive: true })
  git(['init', '-q', '-b', 'main', h.share], h.home)
  const noise = new Uint8Array(bytes)
  for (let off = 0; off < bytes; off += 65536) crypto.getRandomValues(noise.subarray(off, Math.min(bytes, off + 65536)))
  writeFileSync(join(h.share, 'noise.bin'), noise)
  git(['-C', h.share, 'add', 'noise.bin'], h.home)
  git(['-C', h.share, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'noise'], h.home)
  const head = git(['-C', h.share, 'rev-parse', 'HEAD'], h.home)
  const blob = git(['-C', h.share, 'rev-parse', 'HEAD:noise.bin'], h.home)
  const fake = makeFakeSsh({ nuanceHome: h.home, target: gateFromSource(), env: h.env })
  return { h, fake, gitdir: join(h.share, '.git'), head, blob, bytes }
}

const NOISE_BYTES = 6 * 1024 * 1024
/** A v0 conversation that wants HEAD and says done: the advertisement, a NAK and then the pack come back. */
const wantHead = (head: string) => pkt(`want ${head} multi_ack\n`) + '0000' + pkt('done\n')

describe('a served pack outlives the old 2 s exit cap (Task 24 review)', () => {
  test('a reader that starts 3 s late still gets every byte the gate ledgered', async () => {
    const w = noiseWorld(NOISE_BYTES)
    const dir = temp('cb-slow-')
    const [req, out, status] = [join(dir, 'request'), join(dir, 'out'), join(dir, 'status')]
    writeFileSync(req, wantHead(w.head))
    // The gate writes into a pipe whose reader sleeps first: a plain write's bytes would be dropped by the exit after 2 s.
    const p = Bun.spawn(['/bin/sh', '-c', '{ "$1" collab-nuance "$2" < "$3"; echo $? > "$4"; } | { /bin/sleep 3; /bin/cat > "$5"; }',
      'sh', w.fake.bin, `git-upload-pack '${w.gitdir}'`, req, status, out], { stdout: 'pipe', stderr: 'pipe', env: { PATH: '/usr/bin:/bin' } })
    expect(await p.exited).toBe(0)
    expect(readFileSync(status, 'utf8').trim()).toBe('0')
    const got = statSync(out).size
    expect(got).toBeGreaterThan(w.bytes)                 // the incompressible blob alone is this big
    expect(readFileSync(out).includes(Buffer.from('PACK'))).toBe(true)
    const served = gateLines(w.h.paths)
    expect(served.map((e) => [e.form, e.outcome])).toEqual([['upload-pack', 'served']])
    expect(served[0]!.bytes).toBe(got)                   // what the ledger says was written is what arrived
  }, 60_000)

  test('a real git fetch of the same multi-MiB repo through the gate gets the blob intact', () => {
    const w = noiseWorld(NOISE_BYTES)
    const r = fetchThrough(w.fake, w.gitdir, '+HEAD:refs/collab/t/incoming', 0)
    expect([r.code, r.stderr]).toEqual([0, expect.any(String)])
    expect(git(['-C', r.air, 'rev-parse', 'refs/collab/t/incoming'], r.air)).toBe(w.head)
    expect(git(['-C', r.air, 'rev-parse', 'refs/collab/t/incoming:noise.bin'], r.air)).toBe(w.blob)
    expect(git(['-C', r.air, 'cat-file', '-s', w.blob], r.air)).toBe(String(w.bytes))
    expect(git(['-C', r.air, 'fsck', '--no-dangling'], r.air)).toBe('')
  }, 60_000)

  test('a reader that never drains holds the fetch for the fetch deadline, not for ever', async () => {
    const w = uploadWorld()
    const request = new TextEncoder().encode(wantHead(w.head))
    const stdin = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(request); c.close() } })
    let writes = 0
    const io = { stdin, stdout: { write: () => { writes++; return new Promise<void>(() => {}) } }, stderr: { write() {} } }
    // The suite's time scale: 60 s of fetch deadline is 600 ms here.
    const env = { ...w.h.env, SSH_ORIGINAL_COMMAND: `git-upload-pack '${w.gitdir}'`, COLLAB_BRIDGE_TEST_TIME_SCALE: '0.01' }
    const t0 = Date.now()
    expect(await runGate(env, io)).toBe(FETCH_STOPPED_EXIT)
    const waited = Date.now() - t0
    expect(waited).toBeGreaterThanOrEqual(500)           // it did wait for the reader first
    expect(waited).toBeLessThan(15_000)                  // and then stopped waiting
    expect(writes).toBeGreaterThan(0)
    // Not 'served': the Air never received this pack (Task 63 gate-1-9).
    expect(gateLines(w.h.paths).map((e) => [e.form, e.outcome])).toEqual([['upload-pack', 'deadline']])
  }, 30_000)
})

describe('a fetch to a client that has gone or timed out stops git and says so (Task 63 gate-1-9)', () => {
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

  /** An installed home whose recorded git writes for ever (a stub that is the git process itself), and the pid it recorded. */
  function endlessWorld() {
    const dir = temp('cb-endless-')
    const stub = join(dir, 'git')
    writeFileSync(stub, `#!/bin/sh\necho $$ > '${dir}/pid'\nexec /usr/bin/yes\n`, { mode: 0o755 })
    const h = installedNuanceHome({ share: join('Projects', 'collab-trial'),
      git: { path: stub, version: '2.52.0', sha256: sha256File(stub), guard: true, apple: false } })
    secretBranchRepo(h.share, h.home)
    return { h, gitdir: join(h.share, '.git'), pid: () => Number(readFileSync(join(dir, 'pid'), 'utf8').trim()) }
  }
  const request = () => ({ stdin: new ReadableStream<Uint8Array>({ start(c) { c.close() } }), stderr: { write() {} } })

  test('a write that is rejected: git is killed, the line says client_gone, and it does not keep draining', async () => {
    const w = endlessWorld()
    let writes = 0
    const io = { ...request(), stdout: { write: () => { writes++; return Promise.reject(new Error('EPIPE')) } } }
    const env = { ...w.h.env, SSH_ORIGINAL_COMMAND: `git-upload-pack '${w.gitdir}'` }
    expect(await runGate(env, io)).toBe(FETCH_STOPPED_EXIT)
    expect(writes).toBe(1)                               // the first failure ended it; no second chunk was offered
    expect(gateLines(w.h.paths).map((e) => [e.form, e.outcome, e.code ?? '-'])).toEqual([['upload-pack', 'client_gone', '-']])
    expect(alive(w.pid())).toBe(false)
  }, 30_000)

  test('a sink that reports itself closed (main.ts\'s drainSink after an EPIPE) is a client that has gone too', async () => {
    const w = endlessWorld()
    let writes = 0
    const stdout = { write: () => { writes++ }, closed: true }      // drainSink settles at once and writes nothing once closed
    const env = { ...w.h.env, SSH_ORIGINAL_COMMAND: `git-upload-pack '${w.gitdir}'` }
    expect(await runGate(env, { ...request(), stdout })).toBe(FETCH_STOPPED_EXIT)
    expect(writes).toBe(1)
    expect(gateLines(w.h.paths).map((e) => [e.form, e.outcome, e.code ?? '-'])).toEqual([['upload-pack', 'client_gone', '-']])
    expect(alive(w.pid())).toBe(false)
  }, 30_000)

  test('past the deadline, a reader that keeps up still stops the fetch: git is killed and the line says deadline', async () => {
    const w = endlessWorld()
    let writes = 0
    const io = { ...request(), stdout: { write: () => { writes++ } } }
    // 60 s of fetch deadline is 300 ms at this scale; git writes for ever, so only the deadline can end it.
    const env = { ...w.h.env, SSH_ORIGINAL_COMMAND: `git-upload-pack '${w.gitdir}'`, COLLAB_BRIDGE_TEST_TIME_SCALE: '0.005' }
    const t0 = Date.now()
    expect(await runGate(env, io)).toBe(FETCH_STOPPED_EXIT)
    expect(Date.now() - t0).toBeLessThan(15_000)
    expect(writes).toBeGreaterThan(0)
    expect(gateLines(w.h.paths).map((e) => [e.form, e.outcome, e.code ?? '-'])).toEqual([['upload-pack', 'deadline', '-']])
    expect(alive(w.pid())).toBe(false)
  }, 30_000)
})
