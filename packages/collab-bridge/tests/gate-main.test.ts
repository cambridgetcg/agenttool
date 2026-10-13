import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readLedger, verifyLedger } from '../src/ledger.ts'
import { encodeFrame, FRAME_TYPE, FrameDecoder, PreambleScanner, type Frame } from '../src/link/frame.ts'
import { MAX_PIPE_TO_HUB } from '../src/link/messages.ts'
import { pktLineErr } from '../src/nuance/fetch-gate.ts'
import { nuancePaths, type NuancePaths } from '../src/paths.ts'
import { gateFromSource, makeFakeSsh, type FakeSsh } from './fake-ssh.ts'
import { cleanupTmps, temp, testEnv } from './helpers.ts'
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
async function ssh(n: ReturnType<typeof nuance>, command: string | null) {
  const fake = makeFakeSsh({ nuanceHome: n.home, target: gateFromSource(), env: n.env })
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
