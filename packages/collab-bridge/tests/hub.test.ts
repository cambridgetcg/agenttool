import { afterEach, describe, expect, test } from 'bun:test'
import { createPrivateKey } from 'node:crypto'
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { updateDevice, writeDevice, type DeviceFile } from '../src/air/devices.ts'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import { distMatches, embeddedBuild, recordRefusedStart, runHub, sourceBuild, type HubDeps } from '../src/air/hub.ts'
import { LineageStore, type LineageEntry } from '../src/air/lineages.ts'
import { mirrorIdOf } from '../src/air/mirror.ts'
import { seatTools } from '../src/air/policy-table.ts'
import { readDeviceStatus, readHubStatus, writeDeviceStatus, writeHostKeyAck, writeHubStatus } from '../src/air/status.ts'
import { readLedger, type LedgerEntry } from '../src/ledger.ts'
import { newLineage, newStartNonce, type HubKnockReportMsg, type NoticeMsg, type ReadyMsg, type RefusedCode, type ResultMsg, type ToolDef } from '../src/link/messages.ts'
import { monoNowMs, tryFlock } from '../src/native.ts'
import { LinkClient } from '../src/nuance/link-client.ts'
import { generateSeatKey, signSeat } from '../src/nuance/seatkey.ts'
import { airPaths, type AirPaths } from '../src/paths.ts'
import { systemBin } from '../src/sysbin.ts'
import { toolsDigest } from '../src/tools-digest.ts'
import { gateFromSource, makeFakeSsh, type FakeSsh } from './fake-ssh.ts'
import { cleanupTmps, COLLAB_DIST, PKG, REAL_GIT, temp, testEnv } from './helpers.ts'
import { startCollabSession, tamperJournal } from './mcp-harness.ts'

const T = 60_000
const FIXTURE: ToolDef[] = JSON.parse(readFileSync(join(PKG, 'tests', 'fixtures', 'collab-tools-0.5.0.json'), 'utf8')).tools
/** The user the in-process hubs are told they run as; the real getpwuid check has its own spawned test below. */
const ME = { uid: 502, name: 'yuai' }
/** P33's scale for the linked tests: PING 150 ms, stale 200 ms, relay exit 450 ms, handshake 50 ms, backoff from 50 ms. */
const SCALE = '0.01'

interface Hub { done: Promise<number>; stop(): Promise<number> }
const hubs: Hub[] = []
const clients: LinkClient[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) c.stop()
  for (const h of hubs.splice(0)) await h.stop()
  delete process.env.COLLAB_BRIDGE_TEST_TIME_SCALE
  cleanupTmps()
})

function airHome(): AirPaths {
  return airPaths(temp('cb-hub-air-'))
}

function hubDeps(paths: AirPaths, over: Partial<HubDeps> = {}): HubDeps {
  return {
    paths, build: sourceBuild(COLLAB_DIST), collabDist: COLLAB_DIST, bun: process.execPath, ssh: systemBin('ssh'), git: REAL_GIT,
    ps: '/bin/ps', passwd: () => ME, expected: ME, mono: monoNowMs, now: () => new Date(), rand: Math.random,
    tcpProbe: async () => 'ok', deviceReloadMs: 50, distCheckMs: 50, ...over,
  }
}

/** runHub in the background with an abort signal (what `hub run` wires SIGTERM, SIGINT and SIGHUP to, Task 53). */
function startHub(deps: HubDeps): Hub {
  const ac = new AbortController()
  const done = runHub({ ...deps, signal: ac.signal })
  const h: Hub = { done, stop: async () => { ac.abort(); return done } }
  hubs.push(h)
  return h
}
async function stopHub(h: Hub): Promise<number> {
  hubs.splice(hubs.indexOf(h), 1)
  return h.stop()
}

async function until(cond: () => boolean, what: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(10)
  }
}
const running = (paths: AirPaths) => { const s = readHubStatus(paths); return s?.word === 'running' && s.detail === null }
const lines = (paths: AirPaths, event: string): LedgerEntry[] => readLedger(paths.ledger).filter((l) => l.event === event)

/** A device file as pin-device leaves it (Task 61), for a Nuance whose shared folder is `share`. */
function pairedDevice(paths: AirPaths, share: string, seatPublic: string): DeviceFile {
  const d: DeviceFile = {
    v: 1, device: 'nuance', user: 'macair', state: 'paired', host_alias: 'collab-nuance', seat_public: seatPublic,
    bundle_build: 'abcdef01', key_expiry: '20270111', trailer: 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>',
    git: { path: '/Library/Developer/CommandLineTools/usr/bin/git', version: '2.39.5', sha256: 'cd'.repeat(32), guard: true, apple: true },
    summon: { key_sha256: 'ef'.repeat(32), dropin_stat: '1234 270 1760300000000 0 600' },
    shares: [{ remote_realpath: share, remote_gitdir: join(share, '.git'), air_clone: join(paths.home, 'Projects', 'collab-trial'),
      mirror_id: mirrorIdOf(share), mirror_worktree_id: null, workspace_id: null, caps: DEFAULT_CAPS }],
    prepared_at: '2026-10-13T12:00:00.000Z', paired_at: '2026-10-13T12:30:00.000Z',
  }
  writeDevice(paths.deviceFile('nuance'), d)
  return d
}

/** §5.6's config in miniature: the dialer reads HostName from it (targetOfConfig), and only the fake ssh ever sees it. */
function writeSshConfig(paths: AirPaths): void {
  mkdirSync(paths.sshDir, { recursive: true, mode: 0o700 })
  writeFileSync(paths.sshConfig, ['Host collab-nuance', '  HostName nuance.local', '  User macair', `  IdentityFile ${paths.sshKey('nuance')}`, ''].join('\n'), { mode: 0o600 })
}

interface Seat { c: LinkClient; readies: ReadyMsg[]; notices: NoticeMsg[]; results: ResultMsg[]; knocks: HubKnockReportMsg[]; refusals: (RefusedCode | 'unparsable')[]; losses(): number }
interface Linked { paths: AirPaths; nuance: string; share: string; fake: FakeSsh; sock: string; seat(lineage: string): Seat; deps(over?: Partial<HubDeps>): HubDeps }

/**
 * A paired Nuance the hub can really dial: the fake ssh runs the gate from source against a temp Nuance home, so `relay 1
 * <nonce>` starts the real relay on a short socket root, and a LinkClient (Task 29) plays the pipe on that socket with the
 * device's real seat key. Everything runs at P33's scale, in this process (the hub) and in the relay's env.
 */
function linked(): Linked {
  process.env.COLLAB_BRIDGE_TEST_TIME_SCALE = SCALE
  const paths = airHome()
  const nuance = temp('cb-hub-nuance-')
  const share = join(nuance, 'Projects', 'collab-trial')
  mkdirSync(share, { recursive: true })
  const key = generateSeatKey()
  const priv = createPrivateKey(key.privatePem)
  pairedDevice(paths, share, key.publicHex)
  writeSshConfig(paths)
  const env = testEnv(nuance, { COLLAB_BRIDGE_TEST_TIME_SCALE: SCALE })
  const fake = makeFakeSsh({ nuanceHome: nuance, target: gateFromSource(), env })
  const sock = join(env.COLLAB_BRIDGE_SOCK_ROOT!, 'run', 'hub.sock')
  const digest = toolsDigest(seatTools(FIXTURE, 'nuance', 'macair'))
  return {
    paths, nuance, share, fake, sock,
    deps: (over = {}) => hubDeps(paths, { ssh: fake.bin, ...over }),
    seat(lineage) {
      const s = { readies: [] as ReadyMsg[], notices: [] as NoticeMsg[], results: [] as ResultMsg[], knocks: [] as HubKnockReportMsg[], refusals: [] as (RefusedCode | 'unparsable')[], lost: 0 }
      const c = new LinkClient({
        sockPath: sock,
        attach: () => ({ t: 'attach', v: 1, lineage, harness: 'claude', entrypoint: 'cli', folder: share, pipe_build: 'abcdef01', tools_digest: digest, clock: new Date().toISOString() }),
        sign: (nonce) => signSeat(priv, 'nuance', 'macair', lineage, nonce),
        mono: monoNowMs, rand: Math.random, hostAlive: () => true,
        on: {
          ready: (r) => s.readies.push(r), result: (r) => s.results.push(r), tools: () => {}, knockReport: (k) => s.knocks.push(k),
          notice: (n) => s.notices.push(n), refused: (code) => s.refusals.push(code), lost: () => { s.lost++ },
        },
      })
      clients.push(c)
      c.start()
      return { c, readies: s.readies, notices: s.notices, results: s.results, knocks: s.knocks, refusals: s.refusals, losses: () => s.lost }
    },
  }
}

/** A lineage whose Collab session already exists in the shared journal, as a remote seat's would after its session_start. */
async function liveLineage(w: Linked): Promise<LineageEntry> {
  const root = temp('cb-hub-root-')
  const s = await startCollabSession({ journal: w.paths.sharedJournal, home: w.paths.home, root, actor: 'nuance/macair · self-declared: claude' })
  const e: LineageEntry = {
    lineage: newLineage(), device: 'nuance', user: 'macair', harness: 'claude', folder: w.share, state: 'live', session_id: s.sessionId,
    credential_path: s.credentialFile, past_sessions: [], mirror_id: mirrorIdOf(w.share), workspace_id: s.workspaceId, pending_start: null,
    parked: null, detached_since: null, created_at: new Date().toISOString(),
  }
  const store = new LineageStore(w.paths.lineages)
  store.load()
  store.upsert(e)
  return e
}

const freshStore = (paths: AirPaths) => { const s = new LineageStore(paths.lineages); s.load(); return s }

describe('start-order refusals that exit 0', () => {
  test('a lock held by a live hub refuses with lock_held and exit 0', async () => {
    const paths = airHome()
    const first = startHub(hubDeps(paths))
    await until(() => running(paths), 'the first hub')
    expect(await runHub(hubDeps(paths))).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'lock_held' })
    // The first hub puts its own status back at its next reload tick.
    await until(() => running(paths), 'the first hub to re-assert its status')
    expect(await stopHub(first)).toBe(0)
    expect(readHubStatus(paths)!.runs.length).toBe(1)
  }, T)

  test('a stale lock file is taken over', async () => {
    const paths = airHome()
    mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 })
    writeFileSync(paths.hubLock, 'left by a hub that was SIGKILLed\n', { mode: 0o600 })
    const h = startHub(hubDeps(paths))
    await until(() => running(paths), 'the hub')
    expect(await stopHub(h)).toBe(0)
    expect(readHubStatus(paths)!.runs).toMatchObject([{ clean: true }])
  }, T)

  test('a wrong uid or user refuses with wrong_user and exit 0', async () => {
    const paths = airHome()
    expect(await runHub(hubDeps(paths, { passwd: () => ({ uid: 501, name: 'yuai' }) }))).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'wrong_user', runs: [] })
    expect(await runHub(hubDeps(paths, { passwd: () => ({ uid: 502, name: 'macair' }) }))).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'wrong_user', runs: [] })
  }, T)

  test('the user check reads getpwuid under an env of only HOME and PATH, and with USER=bogus', async () => {
    const real = { uid: process.getuid!(), name: Bun.spawnSync(['/usr/bin/id', '-un'], { env: { PATH: '/usr/bin:/bin' } }).stdout.toString().trim() }
    const dir = temp('cb-hub-user-')
    const script = join(dir, 'who.ts')
    writeFileSync(script, [
      `import { userInfo } from 'node:os'`,
      `import { defaultHubDeps } from ${JSON.stringify(join(PKG, 'src', 'air', 'hub.ts'))}`,
      `console.log(JSON.stringify({ hub: defaultHubDeps(process.env).passwd(), userInfo: userInfo().username }))`,
    ].join('\n'))
    const run = (env: Record<string, string>) => {
      const r = Bun.spawnSync([process.execPath, '--no-env-file', '--config=/dev/null', script], { cwd: '/', env, stdout: 'pipe', stderr: 'pipe' })
      if (r.exitCode !== 0) throw new Error(r.stderr.toString())
      return JSON.parse(r.stdout.toString())
    }
    // launchd's env: HOME and PATH only (§10.4), no USER.
    expect(run({ HOME: dir, PATH: '/usr/bin:/bin' }).hub).toEqual(real)
    const bogus = run({ HOME: dir, PATH: '/usr/bin:/bin', USER: 'bogus' })
    expect(bogus.hub).toEqual(real)
    expect(bogus.userInfo).toBe('bogus') // F3: what the hub must never read
  }, T)

  test('an unclassified tool stops the start with policy_unclassified_tool and exit 0', async () => {
    const paths = airHome()
    const dist = temp('cb-hub-dist-')
    const tools = [...FIXTURE, { name: 'collab_mystery', description: 'new in a later Collab', inputSchema: { type: 'object', properties: {} } }]
    writeFileSync(join(dist, 'agenttool-collab-mcp.js'), `
const tools = ${JSON.stringify(tools)}
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
let buf = ''
process.stdin.on('data', (c) => {
  buf += c
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (m.method === 'initialize') reply(m.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agenttool-collab', version: '0.6.0' } })
    else if (m.method === 'tools/list') reply(m.id, { tools })
  }
})
process.stdin.on('end', () => process.exit(0))
`)
    writeFileSync(join(dist, 'agenttool-collab-host.js'), '// unused\n')
    expect(await runHub(hubDeps(paths, { collabDist: dist, build: sourceBuild(dist) }))).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'policy_unclassified_tool', detail: 'collab_mystery' })
    expect(readHubStatus(paths)!.runs).toMatchObject([{ clean: true }])
  }, T)

  test('a dist other than the embedded one refuses collab_build_mismatch, and a plain restart keeps refusing', async () => {
    const paths = airHome()
    const build = { ...sourceBuild(COLLAB_DIST), mcp_sha256: 'f'.repeat(64) }
    expect(embeddedBuild()).toBeNull()
    expect(distMatches(COLLAB_DIST, build)).toBe(false)
    expect(distMatches(COLLAB_DIST, sourceBuild(COLLAB_DIST))).toBe(true)
    for (let i = 0; i < 2; i++) {
      expect(await runHub(hubDeps(paths, { build }))).toBe(0)
      expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'collab_build_mismatch' })
    }
    expect(lines(paths, 'probe')).toEqual([]) // refused before the probe child
    expect(readHubStatus(paths)!.runs).toMatchObject([{ clean: true }, { clean: true }])
  }, T)

  test('a spawned source-mode hub under the override starts; without the override it refuses collab_build_mismatch', async () => {
    const dir = temp('cb-hub-spawn-')
    const script = join(dir, 'run-hub.ts')
    writeFileSync(script, [
      `import { defaultHubDeps, runHub } from ${JSON.stringify(join(PKG, 'src', 'air', 'hub.ts'))}`,
      'const ac = new AbortController()',
      "process.on('SIGTERM', () => ac.abort())",
      'const deps = defaultHubDeps(process.env)',
      // the user check has its own test; here the hub is told to expect whoever runs the suite
      'process.exit(await runHub({ ...deps, expected: deps.passwd(), signal: ac.signal, deviceReloadMs: 50 }))',
    ].join('\n'))
    const spawnHub = (env: Record<string, string>) =>
      Bun.spawn([process.execPath, '--no-env-file', '--config=/dev/null', script], { cwd: '/', env, stdout: 'ignore', stderr: 'pipe' })
    const home = temp('cb-hub-home-')
    const paths = airPaths(home)
    const p = spawnHub(testEnv(home))
    await until(() => running(paths), 'the spawned hub')
    p.kill('SIGTERM')
    expect(await p.exited).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'stopped', build: '00000000', runs: [{ clean: true }] })

    const plain = temp('cb-hub-plain-')
    const q = spawnHub({ HOME: plain, PATH: '/usr/bin:/bin' })
    expect(await q.exited).toBe(0)
    expect(readHubStatus(airPaths(plain))).toMatchObject({ word: 'refused', code: 'collab_build_mismatch' })
  }, T)

  test('the shared journal is never opened during start', async () => {
    const paths = airHome()
    const h = startHub(hubDeps(paths))
    await until(() => running(paths), 'the hub')
    expect(existsSync(paths.sharedJournal)).toBe(false)
    expect(existsSync(paths.sharedDir)).toBe(false)
    expect(readdirSync(paths.stateDir).filter((n) => n.startsWith('probe-'))).toEqual([]) // the probe's temp dir is gone
    expect(await stopHub(h)).toBe(0)
  }, T)

  test('the probe child\'s tool list equals the committed fixture', async () => {
    const paths = airHome()
    const h = startHub(hubDeps(paths))
    await until(() => running(paths), 'the hub')
    expect(lines(paths, 'probe').map((l) => l.code)).toEqual([toolsDigest(FIXTURE)])
    await stopHub(h)
  }, T)

  test('a damaged device file or lineages.json is needs Yu: config, exit 0', async () => {
    const paths = airHome()
    mkdirSync(paths.devicesDir, { recursive: true, mode: 0o700 })
    writeFileSync(paths.deviceFile('nuance'), '{"v": 1,', { mode: 0o600 })
    expect(await runHub(hubDeps(paths))).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'needs Yu: config' })
    writeFileSync(paths.deviceFile('nuance'), '') // still damaged: an empty file is no device file
    expect(await runHub(hubDeps(paths))).toBe(0)
    expect(readHubStatus(paths)!.code).toBe('needs Yu: config')
    Bun.spawnSync(['/bin/rm', paths.deviceFile('nuance')])
    writeFileSync(paths.lineages, '{"format": "agenttool.collab-bridge-lineages/1", "lineages": [{"lineage": "nope"}]}\n', { mode: 0o600 })
    expect(await runHub(hubDeps(paths))).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'needs Yu: config' })
    expect(readHubStatus(paths)!.detail).toContain('lineages.json')
  }, T)
})

describe('runs that never ended cleanly', () => {
  test('five unexpected exits in 10 minutes write needs Yu: config and exit 0', async () => {
    const paths = airHome()
    pairedDevice(paths, '/Users/macair/Projects/collab-trial', 'ab'.repeat(32))
    writeSshConfig(paths)
    // A fault inside a dial loop is a hub bug: the run ends unclean and launchd would restart it after 10 s.
    const faulty = hubDeps(paths, { tcpProbe: () => { throw new Error('probe fault') } })
    for (let i = 0; i < 5; i++) expect(await runHub(faulty)).toBe(1)
    const after = readHubStatus(paths)!
    expect(after.runs.map((r) => r.clean)).toEqual([false, false, false, false, false])
    expect(after.runs.every((r) => r.ended_at !== null)).toBe(true)
    expect(after.unexpected_exits.length).toBe(5)
    expect(await runHub(hubDeps(paths))).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'needs Yu: config' })
    expect(lines(paths, 'probe').length).toBe(5) // the sixth start stopped before anything else
  }, T)

  test('five starts without a clean exit, simulated by writing start records only, give needs Yu: config and exit 0', async () => {
    const paths = airHome()
    const now = Date.now()
    const crashed = (n: number) => Array.from({ length: n }, (_, i) => ({ started_at: new Date(now - (i + 1) * 60_000).toISOString(), ended_at: null, clean: false }))
    const record = (n: number) => writeHubStatus(paths, { word: 'running', code: null, detail: null, at: new Date(now).toISOString(), build: '00000000',
      unexpected_exits: [], runs: crashed(n), seats: [] })
    record(4) // four crashes are not yet five: the hub starts
    const h = startHub(hubDeps(paths))
    await until(() => running(paths), 'the hub')
    expect(await stopHub(h)).toBe(0)
    record(5)
    expect(await runHub(hubDeps(paths))).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'needs Yu: config' })
    expect(readHubStatus(paths)!.runs.at(-1)).toMatchObject({ clean: true })
  }, T)
})

describe('a fault before the supervised start (Task 63 launcher-1-1)', () => {
  test('hub.lock that cannot be opened is an unclean run each time, and five of them give needs Yu: config and exit 0', async () => {
    const paths = airHome()
    mkdirSync(paths.hubLock, { recursive: true, mode: 0o700 }) // a directory where the lock file belongs: openSync throws EISDIR
    for (let i = 0; i < 5; i++) expect(await runHub(hubDeps(paths))).toBe(1)
    const after = readHubStatus(paths)!
    expect(after.word).toBe('stopped')
    expect(after.detail).toContain('unexpected fault')
    expect(after.runs.map((r) => r.clean)).toEqual([false, false, false, false, false])
    expect(after.runs.every((r) => r.ended_at !== null)).toBe(true)
    expect(after.unexpected_exits.length).toBe(5)
    // the sixth start counts them, as a fault inside the supervised start would: needs Yu, exit 0, launchd stops restarting it
    expect(await runHub(hubDeps(paths))).toBe(0)
    expect(readHubStatus(paths)).toMatchObject({ word: 'refused', code: 'needs Yu: config' })
    expect(readHubStatus(paths)!.runs.at(-1)).toMatchObject({ clean: true })
  }, T)

  test('a refused start is recorded as a clean run beside the earlier records, and only while no hub holds hub.lock', () => {
    const paths = airHome()
    const at = '2026-10-13T11:05:00.000Z'
    const crashed = { started_at: '2026-10-13T11:04:00.000Z', ended_at: null, clean: false }
    mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 })
    writeHubStatus(paths, { word: 'stopped', code: null, detail: null, at, build: '00000000', unexpected_exits: [at], runs: [crashed], seats: [] })
    const deps = { paths, build: sourceBuild(COLLAB_DIST), now: () => new Date('2026-10-13T11:10:00.000Z') }
    const fd = openSync(paths.hubLock, 'a', 0o600)
    try {
      expect(tryFlock(fd)).toBe('locked') // a live hub
      const before = readFileSync(paths.hubStatus, 'utf8')
      recordRefusedStart(deps, 'start_refused', 'claude is an ancestor')
      expect(readFileSync(paths.hubStatus, 'utf8')).toBe(before)
    } finally {
      closeSync(fd)
    }
    recordRefusedStart(deps, 'start_refused', 'claude is an ancestor')
    expect(readHubStatus(paths)).toMatchObject({
      word: 'refused', code: 'start_refused', detail: 'claude is an ancestor', at: '2026-10-13T11:10:00.000Z', build: '00000000', unexpected_exits: [at],
      runs: [crashed, { started_at: '2026-10-13T11:10:00.000Z', ended_at: '2026-10-13T11:10:00.000Z', clean: true }],
    })
  })
})

describe('reconcile', () => {
  test('with a pending_start and a tampered journal, start keeps running, writes journal_invalid, keeps the marker and spawns no further child', async () => {
    const paths = airHome()
    const s = await startCollabSession({ journal: paths.sharedJournal, home: paths.home, root: temp('cb-hub-root-'), actor: 'air' })
    tamperJournal(paths.sharedJournal)
    const dead = Bun.spawn(['/usr/bin/true'], { stdio: ['ignore', 'ignore', 'ignore'] })
    await dead.exited
    const lineage = newLineage()
    const store = new LineageStore(paths.lineages)
    store.load()
    store.upsert({ lineage, device: 'nuance', user: 'macair', harness: 'claude', folder: '/Users/macair/Projects/collab-trial', state: 'pending',
      session_id: null, credential_path: null, past_sessions: [], mirror_id: mirrorIdOf('/Users/macair/Projects/collab-trial'), workspace_id: null,
      pending_start: { nonce: newStartNonce(), call_ref: `${lineage}:0000abcd:0`, child_pid: dead.pid, child_lstart: null, workspace_id: s.workspaceId, at: new Date().toISOString() },
      parked: null, detached_since: null, created_at: new Date().toISOString() })
    const h = startHub(hubDeps(paths))
    await until(() => running(paths), 'the hub')
    expect(readHubStatus(paths)!.code).toBe('journal_invalid')
    expect(readHubStatus(paths)!.seats).toMatchObject([{ lineage, note: 'journal_invalid' }])
    expect(freshStore(paths).get(lineage)!.pending_start).not.toBeNull()
    await Bun.sleep(300) // six reload ticks
    expect(lines(paths, 'child_start').map((l) => [l.outcome, l.code])).toEqual([['failed', 'journal_invalid']])
    expect(await stopHub(h)).toBe(0)
  }, T)

  test('an unpark request is applied on the next reload and its file removed', async () => {
    const paths = airHome()
    const store = new LineageStore(paths.lineages)
    store.load()
    const parked = (): LineageEntry => ({ lineage: newLineage(), device: 'nuance', user: 'macair', harness: 'claude',
      folder: '/Users/macair/Projects/collab-trial', state: 'pending', session_id: null, credential_path: null, past_sessions: [],
      mirror_id: mirrorIdOf('/Users/macair/Projects/collab-trial'), workspace_id: null, pending_start: null,
      parked: { cause: 'cursor_reset_required', details: {} }, detached_since: null, created_at: new Date().toISOString() })
    const a = parked()
    const b = parked()
    store.upsert(a)
    store.upsert(b)
    mkdirSync(paths.requestsDir, { recursive: true, mode: 0o700 })
    writeFileSync(paths.unparkRequest(a.lineage), '{}\n', { mode: 0o600 }) // written before the start: applied at it
    const h = startHub(hubDeps(paths))
    await until(() => running(paths), 'the hub')
    expect(existsSync(paths.unparkRequest(a.lineage))).toBe(false)
    expect(freshStore(paths).get(a.lineage)!.parked).toBeNull()
    expect(readHubStatus(paths)!.seats.map((n) => n.lineage)).toEqual([b.lineage])
    writeFileSync(paths.unparkRequest(b.lineage), '{}\n', { mode: 0o600 }) // written while it runs: applied at a reload
    await until(() => !existsSync(paths.unparkRequest(b.lineage)), 'the reload to apply the request')
    expect(freshStore(paths).get(b.lineage)!.parked).toBeNull()
    expect(lines(paths, 'unpark_request').map((l) => [l.lineage, l.outcome])).toEqual([[a.lineage, 'ok'], [b.lineage, 'ok']])
    expect(readHubStatus(paths)!.seats).toEqual([])
    await stopHub(h)
  }, T)
})

describe('a linked device', () => {
  test('the hub dials through the fake ssh and the source relay, and a seat attaches', async () => {
    const w = linked()
    const h = startHub(w.deps())
    const s = w.seat(newLineage())
    await until(() => s.readies.length === 1, 'the seat to be ready')
    expect(s.readies[0]).toMatchObject({ t: 'ready', tools_digest: toolsDigest(seatTools(FIXTURE, 'nuance', 'macair')), hub_build: '00000000', session_hint: null })
    expect(readDeviceStatus(w.paths, 'nuance')!.word).toBe('up')
    const events = readLedger(w.paths.ledger).map((l) => l.event)
    expect(events.indexOf('tcp_probe')).toBeLessThan(events.indexOf('dial'))
    expect(lines(w.paths, 'attach').map((l) => [l.device, l.user, l.code])).toEqual([['nuance', 'macair', 'cli']])
    const dial = w.fake.calls().at(-1)!
    expect(dial.slice(0, 5)).toEqual(['-F', w.paths.sshConfig, 'collab-nuance', 'relay', '1'])
    expect(dial[5]).toMatch(/^[0-9a-f]{32}$/)
    expect(await stopHub(h)).toBe(0)
  }, T)

  test('a SIGTERM records the run clean and sends link_closing, and the pipe reattaches when the hub returns', async () => {
    const w = linked()
    const lineage = newLineage()
    const s = w.seat(lineage)
    const first = startHub(w.deps())
    await until(() => s.readies.length === 1, 'the first ready')
    expect(await stopHub(first)).toBe(0)
    expect(s.notices).toContainEqual({ t: 'notice', code: 'link_closing' })
    const runs = readHubStatus(w.paths)!.runs
    expect(runs.length).toBe(1)
    expect(runs[0]!.clean).toBe(true)
    expect(runs[0]!.ended_at).not.toBeNull()
    const second = startHub(w.deps())
    await until(() => s.readies.length === 2, 'the pipe to reattach on its own')
    expect(lines(w.paths, 'attach').map((l) => l.lineage)).toEqual([lineage, lineage])
    expect(await stopHub(second)).toBe(0)
  }, T)

  test('an unpaired device\'s link closes and is never dialled again', async () => {
    const w = linked()
    const h = startHub(w.deps())
    const s = w.seat(newLineage())
    await until(() => s.readies.length === 1, 'the seat to be ready')
    updateDevice(w.paths.deviceFile('nuance'), (d) => ({ ...d, state: 'unpaired', seat_public: null }))
    await until(() => s.losses() === 1, 'the link to close')
    await until(() => readDeviceStatus(w.paths, 'nuance')?.word === 'unpaired', 'the unpaired status')
    const dials = w.fake.calls().length
    await Bun.sleep(600) // longer than the relay's 450 ms exit and many backoff steps
    expect(w.fake.calls().length).toBe(dials)
    expect(s.readies.length).toBe(1)
    expect(lines(w.paths, 'unpaired').map((l) => l.device)).toEqual(['nuance'])
    expect(await stopHub(h)).toBe(0)
  }, T)

  test('unpair while the hub runs stops that device\'s children and refuses its attaches', async () => {
    const w = linked()
    const e = await liveLineage(w)
    const h = startHub(w.deps())
    const s = w.seat(e.lineage)
    await until(() => s.readies.length === 1, 'the seat to be ready')
    expect(s.readies[0]!.session_hint).toEqual({ session_id: e.session_id!, workspace_id: e.workspace_id! })
    expect(s.c.send({ t: 'call', call_ref: `${e.lineage}:0000abcd:0`, name: 'collab_next', arguments: {}, timeout_ms: 60_000 })).toBe('written')
    await until(() => s.results.length === 1, 'the collab_next result')
    expect(s.results[0]!.outcome).toBe('ok')
    expect(lines(w.paths, 'child_start').map((l) => [l.lineage, l.code])).toEqual([[e.lineage, 'resume']])
    updateDevice(w.paths.deviceFile('nuance'), (d) => ({ ...d, state: 'unpaired', seat_public: null }))
    await until(() => lines(w.paths, 'child_exit').some((l) => l.lineage === e.lineage), 'the child to stop')
    await until(() => s.losses() === 1, 'the link to close')
    await Bun.sleep(600)
    expect(s.readies.length).toBe(1) // the pipe keeps redialing; nothing on Nuance answers for the hub any more
    expect(await stopHub(h)).toBe(0)
  }, T)

  test('a Collab reinstall after start refuses new children with collab_build_changed', async () => {
    const w = linked()
    const e = await liveLineage(w)
    const dist = temp('cb-hub-dist-')
    for (const f of ['agenttool-collab-mcp.js', 'agenttool-collab-host.js']) copyFileSync(join(COLLAB_DIST, f), join(dist, f))
    const h = startHub(w.deps({ collabDist: dist, build: sourceBuild(dist) }))
    const s = w.seat(e.lineage)
    await until(() => s.readies.length === 1, 'the seat to be ready')
    appendFileSync(join(dist, 'agenttool-collab-mcp.js'), '\n// reinstalled\n') // a Collab reinstall under the running hub
    await until(() => readHubStatus(w.paths)?.code === 'collab_build_changed', 'the dist check')
    await until(() => s.notices.some((n) => n.code === 'collab_build_changed'), 'the notice')
    s.c.send({ t: 'call', call_ref: `${e.lineage}:0000abcd:0`, name: 'collab_next', arguments: {}, timeout_ms: 60_000 })
    await until(() => s.results.length === 1, 'the result')
    expect(s.results[0]!.result?.structuredContent).toMatchObject({ error: 'collab_build_changed', delivered: false })
    expect(lines(w.paths, 'child_start')).toEqual([])
    expect(await stopHub(h)).toBe(0)
  }, T)
})

describe('after collab_build_changed the hub runs no host CLI it has not verified (Task 63 conformance-3-2)', () => {
  test('a knock read spawns the installed host.js before a Collab reinstall and not after, and answers count 0 then', async () => {
    const w = linked()
    const e = await liveLineage(w)
    const dist = temp('cb-hub-dist-')
    for (const f of ['agenttool-collab-mcp.js', 'agenttool-collab-host.js']) copyFileSync(join(COLLAB_DIST, f), join(dist, f))
    // the installed host.js is a stub that records each run; the build the hub verifies is made from it
    const marker = join(temp('cb-hub-marker-'), 'runs')
    writeFileSync(join(dist, 'agenttool-collab-host.js'), `require('node:fs').appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2)[0] + '\\n')\n`)
    const runs = () => (existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').filter(Boolean) : [])
    const h = startHub(w.deps({ collabDist: dist, build: sourceBuild(dist) }))
    const s = w.seat(e.lineage)
    await until(() => s.readies.length === 1, 'the seat to be ready')
    expect(s.c.send({ t: 'knocks', timeout_ms: 2_000 })).toBe('written')
    await until(() => s.knocks.length === 1, 'the first knock report')
    expect(runs()).toEqual(['knocks'])
    appendFileSync(join(dist, 'agenttool-collab-mcp.js'), '\n// reinstalled\n') // a Collab reinstall under the running hub
    await until(() => readHubStatus(w.paths)?.code === 'collab_build_changed', 'the dist check')
    await Bun.sleep(1_100) // knock reads are at least 1 s apart per lineage
    expect(s.c.send({ t: 'knocks', timeout_ms: 2_000 })).toBe('written')
    await until(() => s.knocks.length === 2, 'the second knock report')
    expect(s.knocks[1]).toMatchObject({ t: 'knock_report', count: 0, origins: [], seqs: [] })
    expect(runs()).toEqual(['knocks']) // the changed build was never run
    expect(await stopHub(h)).toBe(0)
  }, T)
})

describe('reloads', () => {
  test('a device file damaged while the hub runs keeps the last good view, and the hub keeps dialling', async () => {
    const w = linked()
    w.fake.setFail255('ssh: connect to host nuance.local port 22: No route to host\r\n')
    const h = startHub(w.deps())
    await until(() => lines(w.paths, 'dial').length >= 1, 'a dial')
    const good = readFileSync(w.paths.deviceFile('nuance'), 'utf8')
    writeFileSync(w.paths.deviceFile('nuance'), '{"v": 1,') // a half-written file, as an editor might leave it
    const seen = lines(w.paths, 'dial').length
    await until(() => lines(w.paths, 'dial').length >= seen + 3, 'three more dials')
    expect(lines(w.paths, 'unpaired')).toEqual([])
    writeFileSync(w.paths.deviceFile('nuance'), good)
    expect(await stopHub(h)).toBe(0)
  }, T)
})

describe('the sticky host-key warning', () => {
  const NO_ROUTE = 'ssh: connect to host nuance.local port 22: No route to host\r\n'
  const STICKY = { kind: 'host_key_mismatch' as const, at: '2026-10-13T10:00:00.000Z', fingerprint: 'SHA256:C/JQOifBld6TAkrNhJn6UfvfParPv6E5xha7zm1I9/A' }
  const seedSticky = (paths: AirPaths) => writeDeviceStatus(paths, { device: 'nuance', word: 'up', reason: null, since: '2026-10-13T10:00:00.000Z',
    hint: null, relay_contested: false, sticky: [STICKY], refused_tools: null, skew_s: null })

  test('an ack while the hub runs clears the sticky warning and it does not return on the next status write', async () => {
    const w = linked()
    w.fake.setFail255(NO_ROUTE) // every dial fails, so the loop keeps writing the device status
    seedSticky(w.paths)
    const h = startHub(w.deps())
    await until(() => lines(w.paths, 'dial').length >= 1, 'a dial')
    expect(readDeviceStatus(w.paths, 'nuance')!.sticky).toEqual([STICKY])
    writeHostKeyAck(w.paths, 'nuance', new Date().toISOString())
    await until(() => readDeviceStatus(w.paths, 'nuance')!.sticky.length === 0, 'the next status write to drop the warning')
    const seen = lines(w.paths, 'dial').length
    await until(() => lines(w.paths, 'dial').length >= seen + 2, 'two more dials')
    expect(readDeviceStatus(w.paths, 'nuance')!.sticky).toEqual([])
    expect(await stopHub(h)).toBe(0)
  }, T)

  test('an unacknowledged sticky survives a hub restart', async () => {
    const w = linked()
    w.fake.setFail255(NO_ROUTE)
    seedSticky(w.paths)
    for (let i = 1; i <= 2; i++) {
      const h = startHub(w.deps())
      await until(() => lines(w.paths, 'hub_start').length === i && lines(w.paths, 'dial').length >= 2 * i, `run ${i} to dial`)
      expect(readDeviceStatus(w.paths, 'nuance')!.sticky).toEqual([STICKY])
      expect(await stopHub(h)).toBe(0)
    }
    expect(readDeviceStatus(w.paths, 'nuance')!.sticky).toEqual([STICKY])
  }, T)
})

describe('the lock itself', () => {
  test('the lock is a real flock that a test process can see held while the hub runs', async () => {
    const paths = airHome()
    const h = startHub(hubDeps(paths))
    await until(() => running(paths), 'the hub')
    const fd = openSync(paths.hubLock, 'a', 0o600)
    try {
      expect(tryFlock(fd)).toBe('busy')
    } finally {
      closeSync(fd)
    }
    await stopHub(h)
    const again = openSync(paths.hubLock, 'a', 0o600)
    try {
      expect(tryFlock(again)).toBe('locked') // released by the hub's exit path
    } finally {
      closeSync(again)
    }
  }, T)
})

describe('an unwritable hub ledger', () => {
  test('the first failed append writes one stderr line naming the error code, and the next ones in the run write none', async () => {
    const paths = airHome()
    mkdirSync(paths.ledger, { recursive: true, mode: 0o700 }) // a directory where the ledger file goes: every append fails
    const said: string[] = []
    const write = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => { said.push(String(chunk)); return true }) as typeof process.stderr.write
    try {
      const h = startHub(hubDeps(paths))
      await until(() => running(paths), 'the hub')
      expect(await stopHub(h)).toBe(0) // the probe's append failed before the forwarder was built; hub_start's and hub_stop's after it
    } finally {
      process.stderr.write = write
    }
    const failed = said.join('').split('\n').filter((l) => l.includes('ledger append failed'))
    expect(failed).toEqual(['collab-bridge hub: ledger append failed (EISDIR; 1 so far)']) // not one line per failed append
    expect(readHubStatus(paths)).toMatchObject({ word: 'stopped', runs: [{ clean: true }] })
  }, T)
})
