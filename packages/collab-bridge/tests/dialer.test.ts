import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyDialEnd, dialArgv, dialOnce, DialPolicy, liveTcpProbe, runDialLoop, type DeviceLink, type DialEndState, type PreambleFailure,
  type TcpProbe } from '../src/air/dialer.ts'
import type { DeviceFile } from '../src/air/devices.ts'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import type { DialFailure, SshContext } from '../src/air/ssh.ts'
import type { DeviceStatus } from '../src/air/status.ts'
import { AIR_LEDGER_KEYS, appendLedger, readLedger, type LedgerFields } from '../src/ledger.ts'
import { airPaths, type AirPaths } from '../src/paths.ts'
import { scaled, TIMING } from '../src/timing.ts'
import { makeFakeSsh, type FakeSsh } from './fake-ssh.ts'
import { cleanupTmps, sha256File, temp } from './helpers.ts'

afterEach(cleanupTmps)

const NONCE = '0123456789abcdef0123456789abcdef'
const FP = 'SHA256:C/JQOifBld6TAkrNhJn6UfvfParPv6E5xha7zm1I9/A'
/** P33's scale for the spawned-process cases: the 30 s preamble deadline becomes 300 ms, a 7 s connect 70 ms. */
const SCALED_ENV = { ...process.env, COLLAB_BRIDGE_TEST_TIME_SCALE: '0.01' }
const PREAMBLE_MS = scaled(TIMING.preambleMs, SCALED_ENV)

/**
 * The remote side of a dial, as the gate would run it: a bash script the fake ssh runs in a bare env. It is run as
 * `/bin/bash <script>`, because macOS checks a newly written executable on its first exec (about 100–300 ms on this Air,
 * measured for this plan), which would eat a scaled deadline; the fake ssh itself pays that once (see warm()).
 */
function remote(dir: string, name: string, body: string): string[] {
  const p = join(dir, name)
  writeFileSync(p, `${body}\n`, { mode: 0o600 })
  return ['/bin/bash', p]
}
/** A relay stand-in: the preamble for the nonce it was given, then every byte it reads, echoed back. */
const RELAY = [
  'case "${SSH_ORIGINAL_COMMAND:-}" in',
  "  'relay 1 '*) nonce=${SSH_ORIGINAL_COMMAND#relay 1 } ;;",
  "  *) echo 'collab-bridge gate: refused' >&2; exit 64 ;;",
  'esac',
  "printf '\\nCOLLAB-BRIDGE/1 %s\\n' \"$nonce\"",
  'exec /bin/cat',
].join('\n')
/** OpenSSH 9.9p2's changed-key block, ending in the verification line (Summon's C-review capture). */
const CHANGED_KEY = [
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!',
  `The fingerprint for the ED25519 key sent by the remote host is\n${FP}.`, // one message over two lines
  'Host key verification failed.',
].join('\r\n') + '\r\n'
const GATE_REFUSES = "echo 'collab-bridge gate: refused (an older bundle)' >&2\nexit 64"
const SILENT = 'exec /bin/sleep 30'
/**
 * A remote that, like OpenSSH's client loop, exits 255 on SIGTERM (the fake ssh execs the remote, so the hub's kill
 * reaches it). Its sleep is detached from the pipes, so `closed` can settle once the remote has gone.
 */
const TERM255 = "trap 'kill $p 2>/dev/null; exit 255' TERM"
const TERM255_WAIT = '/bin/sleep 30 </dev/null >/dev/null 2>&1 & p=$!\nwait $p'
/** Runs the fake ssh once with no arguments (it logs an empty call and exits 255), so a timed dial does not pay its first exec. */
function warm(fake: FakeSsh): void {
  Bun.spawnSync([fake.bin], { env: { PATH: '/usr/bin:/bin' }, stdout: 'ignore', stderr: 'ignore' })
}

interface Air { home: string; paths: AirPaths; device: DeviceFile; ctx: SshContext; knownHosts: string }
/** A temp Air home with the §5.6 config (absolute paths under it) and a copied pin, as pin-device leaves them. */
function makeAir(): Air {
  const home = temp('cb-air-')
  const paths = airPaths(home)
  mkdirSync(paths.sshDir, { recursive: true, mode: 0o700 })
  writeFileSync(paths.sshConfig, [
    'Host collab-nuance', '  HostName nuance.local', '  AddressFamily inet', '  User macair', `  IdentityFile ${paths.sshKey('nuance')}`,
    '  IdentitiesOnly yes', '  HostKeyAlias summon-nuance', `  UserKnownHostsFile ${paths.knownHosts}`, '  BatchMode yes', '',
  ].join('\n'), { mode: 0o600 })
  writeFileSync(paths.knownHosts, 'summon-nuance ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPinnedPinnedPinnedPinnedPinnedPinnedPinned\n', { mode: 0o600 })
  const device: DeviceFile = {
    v: 1, device: 'nuance', user: 'macair', state: 'paired', host_alias: 'collab-nuance', seat_public: 'ab'.repeat(32),
    bundle_build: '5c09726b', key_expiry: '20270111', trailer: 'Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>',
    git: { path: '/Library/Developer/CommandLineTools/usr/bin/git', version: '2.39.5', sha256: 'cd'.repeat(32), guard: true, apple: true },
    summon: { key_sha256: 'ef'.repeat(32), dropin_stat: '1234 270 1760300000000 0 600' },
    shares: [{ remote_realpath: '/Users/macair/Projects/collab-trial', remote_gitdir: '/Users/macair/Projects/collab-trial/.git',
      air_clone: join(home, 'Projects', 'collab-trial'), mirror_id: '0123456789abcdef', mirror_worktree_id: null, workspace_id: null, caps: DEFAULT_CAPS }],
    prepared_at: '2026-10-13T14:00:00.000Z', paired_at: '2026-10-13T15:00:00.000Z',
  }
  return { home, paths, device, knownHosts: paths.knownHosts,
    ctx: { host: 'nuance.local', user: 'macair', identityFile: paths.sshKey('nuance'), config: paths.sshConfig } }
}
function fakeWith(body: string): FakeSsh {
  const nuance = temp('cb-nuance-')
  return makeFakeSsh({ nuanceHome: nuance, target: remote(temp('cb-remote-'), 'remote', body) })
}
const dial = (air: Air, fake: FakeSsh, preambleMs = 5_000) =>
  dialOnce({ ssh: fake.bin, config: air.paths.sshConfig, alias: 'collab-nuance', nonce: NONCE, ctx: air.ctx, preambleMs, home: air.home })
/** Reads what the link gives until `want` bytes have arrived (or 3 s pass). */
function collect(link: DeviceLink): (want: number) => Promise<string> {
  const chunks: Uint8Array[] = []
  link.onData((c) => chunks.push(c))
  return async (want) => {
    const until = Date.now() + 3_000
    while (Buffer.concat(chunks).byteLength < want && Date.now() < until) await Bun.sleep(5)
    return Buffer.concat(chunks).toString('utf8')
  }
}

/** runDialLoop with recorded status, sleeps and ledger, stopping after `sleeps` waits. */
async function loop(air: Air, fake: FakeSsh, o: { sleeps?: number; probe?: TcpProbe; configExists?: () => boolean; ledger?: (f: LedgerFields) => void;
  preambleMs?: number; onSleep?: (n: number) => void; onLink?: (link: DeviceLink) => Promise<void>; status?: (s: Partial<DeviceStatus>) => void } = {}) {
  const statuses: Array<Partial<DeviceStatus>> = []
  const ledger: LedgerFields[] = []
  const sleeps: number[] = []
  const probes: Array<[string, number, number]> = []
  const result = await runDialLoop({
    device: air.device, paths: air.paths, ssh: fake.bin,
    policy: new DialPolicy({ mono: () => performance.now(), now: () => new Date(), rand: () => 0.5 }),
    configExists: o.configExists ?? (() => true),
    onLink: o.onLink ?? (async (link) => { link.close(); await link.closed }),
    status: (s) => { statuses.push(s); o.status?.(s) },
    ledger: (f) => { ledger.push(f); o.ledger?.(f) },
    tcpProbe: async (h, p, ms) => { probes.push([h, p, ms]); return o.probe ? o.probe(h, p, ms) : 'ok' },
    stopped: () => sleeps.length >= (o.sleeps ?? 1),
    sleep: async (ms) => { sleeps.push(ms); o.onSleep?.(sleeps.length) },
    preambleMs: o.preambleMs ?? 5_000,
  })
  return { result, statuses, ledger, sleeps, probes }
}

describe('dialOnce', () => {
  test('links after zshenv junk', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setNoise('zshenv: hello from macair\nlast login noise\n')
    const out = await dial(air, fake)
    if (!out.ok) throw new Error(JSON.stringify(out.failure))
    const read = collect(out.link)
    out.link.send(new TextEncoder().encode('frame bytes\n'))
    expect(await read(12)).toBe('frame bytes\n') // bytes after the preamble go to onData; the noise never does
    out.link.close() // stdin ends (the stand-in's cat exits 0 on EOF) and ssh gets SIGTERM, whichever comes first
    const closed = await out.link.closed
    expect([0, null]).toContain(closed.code)
    out.link.send(new TextEncoder().encode('after close\n')) // a send after the end is dropped, never thrown
  }, 10_000)

  test('the ssh stub got an absolute -F path', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    const out = await dial(air, fake)
    if (out.ok) { out.link.close(); await out.link.closed }
    expect(fake.calls()).toEqual([['-F', air.paths.sshConfig, 'collab-nuance', 'relay', '1', NONCE]])
    expect(air.paths.sshConfig.startsWith('/')).toBe(true)
    expect(dialArgv('/usr/bin/ssh', '/Users/yuai/.ssh/collab-bridge/config', 'collab-nuance', NONCE))
      .toEqual(['/usr/bin/ssh', '-F', '/Users/yuai/.ssh/collab-bridge/config', 'collab-nuance', 'relay', '1', NONCE])
    expect(() => dialArgv('/usr/bin/ssh', '~/.ssh/collab-bridge/config', 'collab-nuance', NONCE)).toThrow('absolute')
    expect(() => dialArgv('/usr/bin/ssh', air.paths.sshConfig, '-oProxyCommand=x', NONCE)).toThrow('alias')
    expect(() => dialArgv('/usr/bin/ssh', air.paths.sshConfig, 'collab-nuance', NONCE.toUpperCase())).toThrow('nonce')
  }, 10_000)

  test('a silent link times out', async () => {
    const air = makeAir()
    const t0 = performance.now()
    const out = await dial(air, fakeWith(SILENT), PREAMBLE_MS)
    expect(out).toEqual({ ok: false, failure: { kind: 'preamble_timeout' } })
    const ms = performance.now() - t0
    expect(ms).toBeGreaterThanOrEqual(PREAMBLE_MS)
    expect(ms).toBeLessThan(3_000) // the silent remote was killed, not waited for
  }, 10_000)

  test('a 6–8 s connect still links', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    warm(fake)
    fake.setDelayMs(scaled(7_000, SCALED_ENV))
    const out = await dial(air, fake, PREAMBLE_MS)
    expect(out.ok).toBe(true)
    if (out.ok) { out.link.close(); await out.link.closed }
  }, 10_000)

  test("the gate's exit 64 before the preamble is gate_refused with the gate's line", async () => {
    const air = makeAir()
    const fake = fakeWith(GATE_REFUSES)
    fake.setNoise('zshenv junk\n')
    expect(await dial(air, fake)).toEqual({ ok: false, failure: { kind: 'gate_refused', detail: 'collab-bridge gate: refused (an older bundle)' } })
  }, 10_000)

  test('noise then an ssh 255 loss is unknown, which backs off', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setNoise('zshenv junk\n')
    fake.setFail255('Connection to nuance.local closed by remote host.\r\n')
    expect(await dial(air, fake)).toEqual({ ok: false, failure: { status: 'unknown', detail: 'Connection to nuance.local closed by remote host.' } })
  }, 10_000)

  test('64 KiB of noise is login_shell_noise', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setNoise('x'.repeat(65_536))
    expect(await dial(air, fake)).toEqual({ ok: false, failure: { kind: 'login_shell_noise' } })
  }, 10_000)

  test('an ssh that cannot be started is config', async () => {
    const air = makeAir()
    expect(await dialOnce({ ssh: '/nonexistent/ssh', config: air.paths.sshConfig, alias: 'collab-nuance', nonce: NONCE, ctx: air.ctx, preambleMs: 5_000 }))
      .toEqual({ ok: false, failure: { status: 'config', detail: 'ssh could not be started (ENOENT)' } })
  }, 10_000)

  test('any other exit before the preamble is unknown', async () => {
    const air = makeAir()
    expect(await dial(air, fakeWith('echo junk\nexit 3'))).toEqual({ ok: false, failure: { status: 'unknown', detail: 'ssh exited 3 before the preamble' } })
  }, 10_000)

  test("ssh's 255 on the hub's own SIGTERM after a silent wait is still preamble_timeout", async () => {
    const air = makeAir()
    const fake = fakeWith(`${TERM255}\n${TERM255_WAIT}`)
    warm(fake)
    expect(await dial(air, fake, PREAMBLE_MS)).toEqual({ ok: false, failure: { kind: 'preamble_timeout' } })
  }, 10_000)

  test("ssh's 255 on the hub's own SIGTERM after 64 KiB of noise is still login_shell_noise", async () => {
    const air = makeAir()
    // 70000 x's on stdout, no preamble: the hub kills ssh on the overflow, and the remote answers the kill with 255.
    const out = await dial(air, fakeWith(`${TERM255}\nhead -c 70000 /dev/zero | tr '\\0' x\n${TERM255_WAIT}`))
    expect(out).toEqual({ ok: false, failure: { kind: 'login_shell_noise' } })
  }, 10_000)
})

describe('dialOnce: the ssh stdin pipe breaking under a pending write', () => {
  /** A relay stand-in that prints the preamble, then closes its stdin and stays up, as ssh does when it stops reading (Task 63 relay-1-4). */
  const STDIN_GONE = RELAY.replace('exec /bin/cat', 'exec 0<&-\nexec /bin/sleep 0.5')

  test('a rejected stdin write or flush is not left as an unhandled rejection, and later sends and the close stay quiet (Task 63 relay-1-4)', async () => {
    const air = makeAir()
    const fake = fakeWith(STDIN_GONE)
    const rejected: unknown[] = []
    const note = (r: unknown) => { rejected.push(r) }
    process.on('unhandledRejection', note)
    try {
      const out = await dial(air, fake)
      if (!out.ok) throw new Error(JSON.stringify(out.failure))
      await Bun.sleep(150) // the stand-in has exec'd and closed its stdin
      // 4 MiB is a hub-to-pipe frame at its limit. Bun's FileSink answers a write it cannot finish with a promise, and rejects
      // it with EPIPE once the pipe has no reader; the try/catch around the call only sees a throw at once.
      out.link.send(new Uint8Array(4 * 1024 * 1024))
      await Bun.sleep(100)
      out.link.send(new Uint8Array(64 * 1024))
      out.link.close() // stdin.end() is a sink call too
      await out.link.closed
      await Bun.sleep(300)
    } finally {
      process.off('unhandledRejection', note)
    }
    expect(rejected).toEqual([])
  }, 10_000)
})

describe('runDialLoop', () => {
  test('links after zshenv junk, and redials at once after the drop', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setNoise('zshenv junk\n')
    const r = await loop(air, fake)
    expect(r.result).toBe('stopped')
    expect(r.statuses.map((s) => s.word)).toEqual(['connecting', 'up', 'connecting'])
    expect(r.sleeps).toEqual([0])
  }, 10_000)

  test('a silent link times out, backs off and does not stop', async () => {
    const air = makeAir()
    const r = await loop(air, fakeWith(SILENT), { sleeps: 2, preambleMs: PREAMBLE_MS })
    expect(r.result).toBe('stopped')
    expect(r.sleeps).toEqual([5_000, 10_000])
    expect(r.ledger.filter((l) => l.event === 'dial').map((l) => l.code)).toEqual(['preamble_timeout', 'preamble_timeout'])
  }, 10_000)

  test("noise then the gate's exit 64 is gate_refused and stops as config", async () => {
    const air = makeAir()
    const fake = fakeWith(GATE_REFUSES)
    fake.setNoise('junk\n')
    const r = await loop(air, fake)
    expect(r.result).toBe('needs_yu')
    expect(r.ledger.filter((l) => l.event === 'dial')).toEqual([expect.objectContaining({ outcome: 'failed', code: 'gate_refused' })])
    expect(r.statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'config' })
    expect(r.sleeps).toEqual([])
  }, 10_000)

  test('noise then an ssh 255 loss backs off', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setNoise('junk\n')
    fake.setFail255('client_loop: send disconnect: Broken pipe\r\n')
    const r = await loop(air, fake)
    expect(r.result).toBe('stopped')
    expect(r.sleeps).toEqual([5_000])
    expect(r.statuses.at(-1)).toMatchObject({ word: 'connecting', reason: 'unknown' })
  }, 10_000)

  test('64 KiB of noise stops as needs Yu: login_shell_noise', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setNoise('x'.repeat(70_000))
    const r = await loop(air, fake)
    expect(r.result).toBe('needs_yu')
    expect(r.statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'login_shell_noise' })
  }, 10_000)

  test("Can't open user config file stops as config", async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setFail255(`Can't open user config file ${air.paths.sshConfig}: No such file or directory\r\n`)
    const r = await loop(air, fake)
    expect(r.result).toBe('needs_yu')
    expect(r.statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'config' })
    expect(r.ledger.filter((l) => l.event === 'dial')).toEqual([expect.objectContaining({ outcome: 'failed', code: 'config' })])
  }, 10_000)

  test('a missing config file stops before any dial', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    const r = await loop(air, fake, { configExists: () => false })
    expect(r.result).toBe('needs_yu')
    expect(r.statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'config' })
    expect(fake.calls()).toEqual([])
    expect(r.probes).toEqual([])
  }, 10_000)

  test('an ssh that cannot be started stops as needs Yu: config', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    const r = await loop(air, { ...fake, bin: '/nonexistent/ssh' })
    expect(r.result).toBe('needs_yu')
    expect(r.statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'config' })
    expect(r.ledger.filter((l) => l.event === 'dial')).toEqual([expect.objectContaining({ outcome: 'failed', code: 'config' })])
  }, 10_000)

  test('the loop probes TCP before the first ssh', async () => {
    const air = makeAir()
    const r = await loop(air, fakeWith(RELAY))
    expect(r.probes).toEqual([['nuance.local', 22, 5_000]]) // the config's HostName, from the hub process itself (P56)
    expect(r.ledger.map((l) => l.event).slice(0, 2)).toEqual(['tcp_probe', 'dial'])
    expect(r.ledger[0]).toMatchObject({ event: 'tcp_probe', device: 'nuance', outcome: 'ok' })
  }, 10_000)

  test('a failed probe does not stop the loop, and a no_route failure probes again', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setFail255('ssh: connect to host nuance.local port 22: No route to host\r\n')
    const r = await loop(air, fake, { sleeps: 2, probe: async () => 'EHOSTUNREACH' })
    expect(r.result).toBe('stopped')
    expect(r.ledger.map((l) => [l.event, l.outcome, l.code])).toEqual([
      ['tcp_probe', 'failed', 'EHOSTUNREACH'], ['dial', 'failed', 'no_route'],
      ['tcp_probe', 'failed', 'EHOSTUNREACH'], ['dial', 'failed', 'no_route'],
    ])
    // A timeout is not a reason to probe again: only no_route is.
    const fake2 = fakeWith(RELAY)
    fake2.setFail255('ssh: connect to host nuance.local port 22: Operation timed out\r\n')
    const r2 = await loop(air, fake2, { sleeps: 2 })
    expect(r2.ledger.filter((l) => l.event === 'tcp_probe').length).toBe(1)
  }, 10_000)

  test('every dial appends one dial ledger line', async () => {
    const air = makeAir()
    const fake = fakeWith(SILENT)
    fake.setFail255('ssh: connect to host nuance.local port 22: Operation timed out\r\n')
    await loop(air, fake, { sleeps: 3, ledger: (f) => { appendLedger(air.paths.ledger, AIR_LEDGER_KEYS, f) } })
    const dials = readLedger(air.paths.ledger).filter((e) => e.event === 'dial')
    expect(fake.calls().length).toBe(3)
    expect(dials.length).toBe(3)
    for (const e of dials) {
      expect(Object.keys(e).sort()).toEqual(['code', 'device', 'event', 'hash', 'ms', 'outcome', 'prev', 'ts'])
      expect(e).toMatchObject({ device: 'nuance', outcome: 'failed', code: 'timeout' })
    }
  }, 10_000)

  test('a host-key mismatch through the fake ssh appends one ledger line with the presented fingerprint', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setFail255(CHANGED_KEY)
    const r = await loop(air, fake)
    expect(r.result).toBe('stopped') // a mismatch refuses that attempt only
    expect(r.sleeps).toEqual([60_000])
    expect(r.ledger.filter((l) => l.event === 'host_key_mismatch')).toEqual([{ event: 'host_key_mismatch', device: 'nuance', fingerprint: FP }])
    expect(r.ledger.filter((l) => l.event === 'dial')).toEqual([expect.objectContaining({ outcome: 'failed', code: 'host_key_mismatch' })])
    expect(r.statuses.at(-1)).toMatchObject({ word: 'host_key_mismatch', reason: 'host_key_mismatch', sticky: [expect.objectContaining({ fingerprint: FP })] })
  }, 10_000)

  test('a good dial after a mismatch is up and keeps the sticky warning', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setFail255(CHANGED_KEY)
    // The pinned key verifies again by the second dial: the fake stops failing while the loop waits.
    const r = await loop(air, fake, { sleeps: 2, onSleep: (n) => { if (n === 1) fake.setFail255(null) } })
    expect(r.result).toBe('stopped')
    expect(r.ledger.filter((l) => l.event === 'dial').map((l) => l.outcome)).toEqual(['failed', 'up'])
    const up = r.statuses.find((s) => s.word === 'up')!
    expect(up.sticky).toEqual([expect.objectContaining({ kind: 'host_key_mismatch', fingerprint: FP })])
    expect(r.statuses.at(-1)).toMatchObject({ word: 'connecting', sticky: [expect.objectContaining({ fingerprint: FP })] })
  }, 10_000)

  test('the pin is never written', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setFail255(CHANGED_KEY)
    const pin = sha256File(air.knownHosts)
    const config = readFileSync(air.paths.sshConfig, 'utf8')
    const r = await loop(air, fake, { sleeps: 3 })
    expect(r.result).toBe('stopped') // never stops on a mismatch, even once it needs Yu
    expect(r.sleeps).toEqual([60_000, 60_000, 60_000])
    expect(r.statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'host_key_mismatch' })
    // Neither the copied known_hosts nor the config changes, whatever the host presents.
    expect(sha256File(air.knownHosts)).toBe(pin)
    expect(readFileSync(air.paths.sshConfig, 'utf8')).toBe(config)
  }, 10_000)
})

describe('runDialLoop: a dial that cannot be built, a session that throws, the login_shell_noise stop', () => {
  /** What a dial that never ran leaves (spec §5.5, Task 48): one refused/config line with ms 0, needs Yu, no probe and no ssh. */
  function expectRefusedAsConfig(r: Awaited<ReturnType<typeof loop>>, fake: FakeSsh): void {
    expect(r.result).toBe('needs_yu')
    expect(r.ledger).toEqual([{ event: 'dial', device: 'nuance', outcome: 'refused', code: 'config', ms: 0 }])
    expect(r.statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'config' })
    expect(r.probes).toEqual([])
    expect(fake.calls()).toEqual([])
    expect(r.sleeps).toEqual([])
  }

  test('an ssh path that is not absolute stops as needs Yu: config instead of rejecting the loop', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    expectRefusedAsConfig(await loop(air, { ...fake, bin: 'ssh' }), fake)
  }, 10_000)

  test('a Host alias ssh would take for something else stops as needs Yu: config instead of rejecting the loop', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    // A config whose Host line is `Collab-Nuance` matches targetOfConfig, but dialArgv takes lowercase aliases only.
    writeFileSync(air.paths.sshConfig, readFileSync(air.paths.sshConfig, 'utf8').replace('Host collab-nuance', 'Host Collab-Nuance'), { mode: 0o600 })
    const odd: Air = { ...air, device: { ...air.device, host_alias: 'Collab-Nuance' } }
    expectRefusedAsConfig(await loop(odd, fake), fake)
  }, 10_000)

  test('an alias that could be an ssh option stops as needs Yu: config instead of rejecting the loop', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    writeFileSync(air.paths.sshConfig, readFileSync(air.paths.sshConfig, 'utf8').replace('Host collab-nuance', 'Host -oProxyCommand=x'), { mode: 0o600 })
    const odd: Air = { ...air, device: { ...air.device, host_alias: '-oProxyCommand=x' } }
    expectRefusedAsConfig(await loop(odd, fake), fake)
  }, 10_000)

  test('an onLink that throws is ledgered as session_error with no message text, and the link is still closed before the policy decides', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    let link: DeviceLink | null = null
    const r = await loop(air, fake, { onLink: async (l) => { link = l; throw new Error('hunter2-secret-token exploded in the framer') } })
    expect(r.result).toBe('stopped')
    expect(r.ledger.map((l) => l.event)).toEqual(['tcp_probe', 'dial', 'link_end'])
    expect(r.ledger.at(-1)).toEqual({ event: 'link_end', device: 'nuance', user: 'macair', code: 'session_error' })
    expect(JSON.stringify(r.ledger)).not.toContain('hunter2')
    // The link was closed and awaited, and the policy then decided as for any drop: the immediate redial.
    expect(await Promise.race([link!.closed.then(() => 'closed'), Bun.sleep(2_000).then(() => 'open')])).toBe('closed')
    expect(r.statuses.map((s) => s.word)).toEqual(['connecting', 'up', 'connecting'])
    expect(r.statuses.at(-1)).toMatchObject({ word: 'connecting', reason: 'link_dropped' })
    expect(r.sleeps).toEqual([0])
  }, 10_000)

  test('a ledger that fails on the session_error line cannot skip the close', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    let link: DeviceLink | null = null
    const r = await loop(air, fake, {
      onLink: async (l) => { link = l; throw new Error('boom') },
      ledger: (f) => { if (f.event === 'link_end') throw new Error('disk full') },
    })
    expect(r.result).toBe('stopped')
    expect(await Promise.race([link!.closed.then(() => 'closed'), Bun.sleep(2_000).then(() => 'open')])).toBe('closed')
    expect(r.statuses.at(-1)).toMatchObject({ word: 'connecting', reason: 'link_dropped' })
    expect(r.sleeps).toEqual([0])
  }, 10_000)

  test('an onLink that returns normally appends no link_end line', async () => {
    const air = makeAir()
    const r = await loop(air, fakeWith(RELAY))
    expect(r.ledger.filter((l) => l.event === 'link_end')).toEqual([])
  }, 10_000)

  test("login_shell_noise's stop names ~/.zshenv in the status hint; the other stops carry no hint", async () => {
    const air = makeAir()
    const noisy = fakeWith(RELAY)
    noisy.setNoise('x'.repeat(70_000))
    const r = await loop(air, noisy)
    expect(r.result).toBe('needs_yu')
    expect(r.statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'login_shell_noise', hint: 'noise before the preamble; check ~/.zshenv' })
    // config (a gate refusal, a missing file) and auth_refused say nothing about ~/.zshenv.
    const gate = fakeWith(GATE_REFUSES)
    expect((await loop(air, gate)).statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'config', hint: null })
    expect((await loop(air, fakeWith(RELAY), { configExists: () => false })).statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'config', hint: null })
    const auth = fakeWith(RELAY)
    auth.setFail255('macair@nuance.local: Permission denied (publickey).\r\n')
    expect((await loop(air, auth)).statuses.at(-1)).toMatchObject({ word: 'needs_yu', reason: 'auth_refused', hint: null })
  }, 20_000)
})

describe('runDialLoop: a ledger or status write that throws', () => {
  test('a ledger that throws on every line (a held lock, ENOSPC) neither skips the session nor the close nor the next dial (Task 63 relay-1-3)', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    let link: DeviceLink | null = null
    let served = 0
    const r = await loop(air, fake, {
      ledger: () => { throw new Error('ledger lock timeout') },
      onLink: async (l) => { served++; link = l; l.close(); await l.closed },
    })
    expect(r.result).toBe('stopped')
    expect(served).toBe(1)
    expect(await Promise.race([link!.closed.then(() => 'closed'), Bun.sleep(2_000).then(() => 'open')])).toBe('closed')
    expect(r.statuses.map((s) => s.word)).toEqual(['connecting', 'up', 'connecting'])
    expect(r.sleeps).toEqual([0])
  }, 10_000)

  test('a status write that throws on up cannot leave the live link unserved', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    let served = 0
    const r = await loop(air, fake, {
      status: (s) => { if (s.word === 'up') throw new Error('ENOSPC') },
      onLink: async (l) => { served++; l.close(); await l.closed },
    })
    expect(r.result).toBe('stopped')
    expect(served).toBe(1)
    expect(r.sleeps).toEqual([0])
  }, 10_000)

  test('failed dials, a host-key mismatch and a stop still run when the ledger and the status throw', async () => {
    const air = makeAir()
    const fake = fakeWith(RELAY)
    fake.setFail255(CHANGED_KEY)
    const down = () => { throw new Error('EROFS') }
    const r = await loop(air, fake, { sleeps: 2, ledger: down, status: down })
    expect(r.result).toBe('stopped')
    expect(r.sleeps).toEqual([60_000, 60_000])
    expect(fake.calls().length).toBe(2)
    // A stop that needs Yu still returns its word when the status that would show it cannot be written.
    const gate = fakeWith(GATE_REFUSES)
    expect((await loop(air, gate, { ledger: down, status: down })).result).toBe('needs_yu')
    expect((await loop(air, fakeWith(RELAY), { configExists: () => false, ledger: down, status: down })).result).toBe('needs_yu')
  }, 20_000)
})

describe('classifyDialEnd', () => {
  test("decides in spec §5.4's order; a 255 after the hub's own kill decides only with a line ssh is known to print", () => {
    const { ctx } = makeAir()
    const AUTH = 'macair@nuance.local: Permission denied (publickey).\r\n'
    const LOSS = 'Connection to nuance.local closed by remote host.\r\n'
    const authRefused: DialFailure = { status: 'auth_refused', detail: 'macair@nuance.local: Permission denied (publickey).' }
    const gateRefused: PreambleFailure = { kind: 'gate_refused', detail: 'collab-bridge gate: refused' }
    const rows: Array<[number | null, DialEndState, string, DialFailure | PreambleFailure]> = [
      [255, 'waiting', AUTH, authRefused],
      [255, 'overflow', AUTH, authRefused],
      [255, 'timeout', AUTH, authRefused],
      [255, 'waiting', LOSS, { status: 'unknown', detail: 'Connection to nuance.local closed by remote host.' }],
      [255, 'waiting', '', { status: 'unknown', detail: 'ssh exited 255 without a line it is known to print' }],
      [255, 'overflow', '', { kind: 'login_shell_noise' }],
      [255, 'timeout', '', { kind: 'preamble_timeout' }],
      [255, 'timeout', 'zshenv: hello\n', { kind: 'preamble_timeout' }],
      [64, 'waiting', 'junk\ncollab-bridge gate: refused\n', gateRefused],
      [64, 'timeout', 'collab-bridge gate: refused\n', gateRefused],
      [null, 'overflow', '', { kind: 'login_shell_noise' }],
      [null, 'timeout', '', { kind: 'preamble_timeout' }],
      [null, 'waiting', '', { status: 'unknown', detail: 'ssh exited on a signal before the preamble' }],
      [3, 'waiting', '', { status: 'unknown', detail: 'ssh exited 3 before the preamble' }],
    ]
    for (const [code, state, stderr, want] of rows) {
      expect([code, state, classifyDialEnd({ code, state, stderr }, ctx)]).toEqual([code, state, want])
    }
  })
})

describe('liveTcpProbe', () => {
  test('connects to a loopback listener and names a refused port by its code', async () => {
    const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, open(s) { s.end() } } })
    const port = server.port
    try {
      expect(await liveTcpProbe('127.0.0.1', port, 2_000)).toBe('ok')
    } finally {
      server.stop(true)
    }
    expect(await liveTcpProbe('127.0.0.1', port, 2_000)).toBe('ECONNREFUSED')
  }, 10_000)
})
