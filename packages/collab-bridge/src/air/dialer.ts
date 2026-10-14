// The hub's dialer (spec §5.4 Preamble, §5.5, §9.7): one ssh per device, `ssh -F <config> collab-<device> relay 1
// <nonce>`, its stdout scanned for the relay's preamble, and a backoff that never re-keys and never stops on what may
// heal by itself. Three parts: dialOnce (one ssh and its preamble), DialPolicy (what to do after each outcome: pure,
// on an injected monotonic clock) and runDialLoop (the loop the hub runs per paired device).
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { PreambleScanner } from '../link/frame.ts'
import { newRelayNonce, RELAY_NONCE_RE } from '../link/messages.ts'
import type { LedgerFields } from '../ledger.ts'
import { monoNowMs } from '../native.ts'
import type { AirPaths } from '../paths.ts'
import { BACKOFF, scaled, TIMING } from '../timing.ts'
import type { DeviceFile } from './devices.ts'
import { classifySshFailure, targetOfConfig, type DialFailure, type SshContext } from './ssh.ts'
import { mergeSticky, type DeviceStatus, type DeviceWord, type StickyWarning } from './status.ts'

export type PreambleFailure = { kind: 'gate_refused'; detail: string } | { kind: 'login_shell_noise' } | { kind: 'preamble_timeout' }
export interface DeviceLink { send(bytes: Uint8Array): void; onData(cb: (chunk: Uint8Array) => void): void; close(): void;
  closed: Promise<{ code: number | null; stderr: string }> }
export type DialOutcome = { ok: true; link: DeviceLink } | { ok: false; failure: DialFailure | PreambleFailure }

/** The status hint after three silent dials in a row (spec §5.4). */
export const ZSHENV_HINT = 'no preamble; check ~/.zshenv'
/** How much of ssh's stderr is kept for the classifier: its own lines come last, after any remote noise. */
const STDERR_KEEP = 256 * 1024
/** How long a SIGTERMed ssh gets before SIGKILL. */
const KILL_GRACE_MS = 2_000
const ALIAS_RE = /^[a-z][a-z0-9-]{0,63}$/

/** The one command the hub ever runs on a device (spec §5.5): the -F path absolute (ssh opens it as given, never expanding ~). */
export function dialArgv(ssh: string, config: string, alias: string, nonce: string): string[] {
  if (!ssh.startsWith('/')) throw new Error('dialer: ssh must be an absolute path')
  if (!config.startsWith('/')) throw new Error('dialer: the -F config must be an absolute path')
  if (!ALIAS_RE.test(alias)) throw new Error('dialer: not an ssh Host alias')
  if (!RELAY_NONCE_RE.test(nonce)) throw new Error('dialer: the relay nonce must be 32 lowercase hex')
  return [ssh, '-F', config, alias, 'relay', '1', nonce]
}

/** One line of the gate's refusal for the status: its last stderr line, printable ASCII, clipped. */
function gateLine(stderr: string): string {
  const last = stderr.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '').at(-1) ?? ''
  return last.slice(0, 200).replace(/[^\x20-\x7e]/g, '?')
}

/**
 * One dial. An overflow (64 KiB of stdout without the preamble) or the deadline kills ssh; when ssh ends without the
 * preamble, classifyDialEnd decides in spec §5.4's order. Once the preamble is found the link is returned: later stdout
 * bytes (and any after the preamble in the same chunk) go to onData, send() writes ssh's stdin. ssh gets an env built
 * here: PATH, and HOME when given (P14).
 */
export function dialOnce(o: { ssh: string; config: string; alias: string; nonce: string; ctx: SshContext; preambleMs: number; home?: string }): Promise<DialOutcome> {
  const argv = dialArgv(o.ssh, o.config, o.alias, o.nonce)
  const env: Record<string, string> = { PATH: '/usr/bin:/bin', ...(o.home ? { HOME: o.home } : {}) }
  let proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
  try {
    proc = Bun.spawn(argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', cwd: '/', env })
  } catch (e) {
    const code = String((e as NodeJS.ErrnoException).code ?? 'error').replace(/[^A-Z0-9_]/g, '')
    return Promise.resolve({ ok: false, failure: { status: 'config', detail: `ssh could not be started (${code})` } })
  }
  return new Promise<DialOutcome>((resolve) => {
    const scanner = new PreambleScanner(o.nonce)
    let state: DialEndState | 'found' = 'waiting'
    let consumer: ((chunk: Uint8Array) => void) | null = null
    const pending: Uint8Array[] = []
    let stderrText = ''
    let ended = false
    const deliver = (chunk: Uint8Array) => {
      if (chunk.byteLength === 0) return
      if (consumer) consumer(chunk)
      else pending.push(chunk)
    }
    const kill = () => {
      if (ended) return
      try { proc.kill('SIGTERM') } catch { /* already gone */ }
      setTimeout(() => { if (!ended) try { proc.kill('SIGKILL') } catch { /* gone */ } }, KILL_GRACE_MS).unref?.()
    }
    const timer = setTimeout(() => { if (state === 'waiting') { state = 'timeout'; kill() } }, o.preambleMs)
    let settle!: (v: { code: number | null; stderr: string }) => void
    const closed = new Promise<{ code: number | null; stderr: string }>((r) => { settle = r })
    const link: DeviceLink = {
      send(bytes) {
        if (ended) return
        try { proc.stdin.write(bytes); proc.stdin.flush() } catch { /* the exit is seen through closed */ }
      },
      onData(cb) {
        consumer = cb
        for (const c of pending.splice(0)) cb(c)
      },
      close() {
        try { proc.stdin.end() } catch { /* already closed */ }
        kill()
      },
      closed,
    }
    const stdoutDone = (async () => {
      const reader = proc.stdout.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (state === 'found') { deliver(value); continue }
          if (state !== 'waiting') continue // killed: the rest is discarded
          const r = scanner.push(value)
          if (r.state === 'found') {
            state = 'found'
            clearTimeout(timer)
            deliver(r.rest)
            resolve({ ok: true, link })
          } else if (r.state === 'overflow') {
            state = 'overflow'
            clearTimeout(timer)
            kill()
          }
        }
      } catch { /* the pipe broke: the exit decides */ }
    })()
    const stderrDone = (async () => {
      const dec = new TextDecoder()
      try {
        for await (const chunk of proc.stderr) {
          stderrText += dec.decode(chunk, { stream: true })
          if (stderrText.length > STDERR_KEEP) stderrText = stderrText.slice(-STDERR_KEEP)
        }
      } catch { /* the pipe broke: keep what came */ }
    })()
    void Promise.all([proc.exited, stdoutDone, stderrDone]).then(() => {
      ended = true
      settle({ code: proc.exitCode, stderr: stderrText })
    })
    void closed.then(({ code, stderr }) => {
      clearTimeout(timer)
      if (state === 'found') return
      resolve({ ok: false, failure: classifyDialEnd({ code, state, stderr }, o.ctx) })
    })
  })
}

/** Where dialOnce stood when ssh ended without the preamble: still waiting, or killed by the hub for an overflow or the deadline. */
export type DialEndState = 'waiting' | 'overflow' | 'timeout'

/**
 * How a dial that never saw the preamble ended, in spec §5.4's order. ssh's 255 goes to the copied classifier, but once
 * the hub has killed ssh itself (an overflow or the deadline) a 255 decides only when the classifier names a line ssh is
 * known to print: OpenSSH's client loop exits 255 on the hub's own SIGTERM (clientloop.c: received_signal, then
 * cleanup_exit(255)) with no line of its own at the default LogLevel, and that 255 is the hub's kill, not a failure of
 * ssh's. Only the gate exits 64. Any other end before the preamble is unknown, which backs off.
 */
export function classifyDialEnd(end: { code: number | null; state: DialEndState; stderr: string }, ctx: SshContext): DialFailure | PreambleFailure {
  if (end.code === 255) {
    const f = classifySshFailure(end.stderr, ctx)
    if (end.state === 'waiting' || f.status !== 'unknown') return f
  } else if (end.code === 64) return { kind: 'gate_refused', detail: gateLine(end.stderr) }
  if (end.state === 'overflow') return { kind: 'login_shell_noise' }
  if (end.state === 'timeout') return { kind: 'preamble_timeout' }
  return { status: 'unknown', detail: `ssh exited ${end.code === null ? 'on a signal' : end.code} before the preamble` }
}

export type DialDecision =
  | { action: 'wait'; delayMs: number; word: DeviceWord; reason: string | null; hint: string | null }
  | { action: 'stop'; word: 'needs_yu'; reason: 'auth_refused' | 'config' | 'login_shell_noise' }

/**
 * What the loop does after each dial (spec §5.4, §5.5). Every age is read from `mono` (CLOCK_MONOTONIC in the hub,
 * Review Focus 4); `now` stamps the sticky warnings; `rand` is the jitter. One policy per device lives across links, so
 * the 10-minute windows (the immediate redial, relay_replaced) and the sticky warnings span them.
 */
export class DialPolicy {
  private failures = 0
  private lastBaseMs = 0
  private failingSince: number | null = null
  private upSince: number | null = null
  private lastImmediate: number | null = null
  private silentInRow = 0
  private hostKeyAt: number[] = []
  private relayReplacedAt: number[] = []
  private warnings: StickyWarning[]

  constructor(private readonly o: { mono(): number; now(): Date; rand(): number; sticky?: StickyWarning[] }) {
    this.warnings = mergeSticky([], o.sticky ?? []) // seeded from the status file (P52)
  }

  onUp(): void {
    this.upSince = this.o.mono()
    this.failingSince = null
    this.silentInRow = 0
  }

  /** A link that was up dropped: once per 10 minutes redial at once; the backoff resets after 60 s of uptime. */
  onDrop(): DialDecision {
    const t = this.o.mono()
    if (this.upSince !== null && t - this.upSince >= BACKOFF.resetAfterUpMs) { this.failures = 0; this.lastBaseMs = 0 }
    this.upSince = null
    this.failingSince = t
    if (this.lastImmediate === null || t - this.lastImmediate >= BACKOFF.redialOncePerMs) {
      this.lastImmediate = t
      return { action: 'wait', delayMs: 0, word: 'connecting', reason: 'link_dropped', hint: null }
    }
    return this.backoff('link_dropped', null)
  }

  onFailure(f: DialFailure | PreambleFailure): DialDecision {
    if (this.failingSince === null) this.failingSince = this.o.mono()
    if ('kind' in f) {
      if (f.kind === 'gate_refused') return { action: 'stop', word: 'needs_yu', reason: 'config' } // a malformed form or an older bundle (§5.4)
      if (f.kind === 'login_shell_noise') return { action: 'stop', word: 'needs_yu', reason: 'login_shell_noise' }
      this.silentInRow++
      return this.backoff('preamble_timeout', this.silentInRow >= BACKOFF.preambleHintAfter ? ZSHENV_HINT : null)
    }
    this.silentInRow = 0
    switch (f.status) {
      case 'auth_refused': return { action: 'stop', word: 'needs_yu', reason: 'auth_refused' } // never re-key (§5.5)
      case 'config': return { action: 'stop', word: 'needs_yu', reason: 'config' }
      case 'host_key_mismatch': return this.hostKeyMismatch(f.fingerprint)
      case 'unreachable': return this.backoff(f.reason, null)
      case 'unknown': return this.backoff('unknown', null)
    }
  }

  /** Per device, across links: true once more than 3 relay_replaced arrive within 10 minutes (§5.3, T5). */
  noteRelayReplaced(): boolean {
    const t = this.o.mono()
    this.relayReplacedAt = this.relayReplacedAt.filter((x) => t - x < BACKOFF.relayContestedWindowMs)
    this.relayReplacedAt.push(t)
    return this.relayReplacedAt.length > BACKOFF.relayContestedAbove
  }

  sticky(): StickyWarning[] {
    return [...this.warnings]
  }

  private away(): boolean {
    return this.failingSince !== null && this.o.mono() - this.failingSince >= BACKOFF.awayAfterMs
  }

  private jittered(baseMs: number): number {
    return Math.round(baseMs * (1 - BACKOFF.jitter + 2 * BACKOFF.jitter * this.o.rand()))
  }

  /** 5, 10, 20, 40, then 60 s; once away (10 minutes of failures) doubling up to the 15-minute cap. */
  private backoff(reason: string, hint: string | null): DialDecision {
    const steps = BACKOFF.stepsMs
    const away = this.away()
    const last = steps[steps.length - 1]!
    const base = this.failures < steps.length ? steps[this.failures]! : away ? Math.min(BACKOFF.awayCapMs, Math.max(this.lastBaseMs, last) * 2) : last
    this.failures++
    this.lastBaseMs = base
    return { action: 'wait', delayMs: this.jittered(base), word: away ? 'away' : 'connecting', reason, hint }
  }

  /** Refuses this attempt only: the pin is never touched; retry at the 60 s cap (the away cap once away); escalate at 3 in 30 minutes. */
  private hostKeyMismatch(fingerprint: string | null): DialDecision {
    const t = this.o.mono()
    this.hostKeyAt = this.hostKeyAt.filter((x) => t - x < BACKOFF.hostKeyWindowMs)
    this.hostKeyAt.push(t)
    this.warnings = mergeSticky(this.warnings, [{ kind: 'host_key_mismatch', at: this.o.now().toISOString(), fingerprint }])
    const steps = BACKOFF.stepsMs
    this.failures = Math.max(this.failures + 1, steps.length) // a later plain failure stays at the cap
    const base = this.away() ? BACKOFF.awayCapMs : steps[steps.length - 1]!
    this.lastBaseMs = base
    const escalated = this.hostKeyAt.length >= BACKOFF.hostKeyEscalateAt
    return { action: 'wait', delayMs: this.jittered(base), word: escalated ? 'needs_yu' : 'host_key_mismatch', reason: 'host_key_mismatch', hint: null }
  }
}

export type TcpProbe = (host: string, port: number, timeoutMs: number) => Promise<'ok' | string>   // string: the error code

/**
 * A TCP connect from the hub process itself, closed at once (spec §13 S1, P56): a long-lived process making the Local
 * Network operation is what lets macOS show its alert, which a short-lived ssh child that fails and exits may never get.
 */
export const liveTcpProbe: TcpProbe = (host, port, timeoutMs) => new Promise((resolve) => {
  let done = false
  const s = connect({ host, port, family: 4 })
  const finish = (r: string) => {
    if (done) return
    done = true
    clearTimeout(timer)
    s.destroy()
    resolve(r)
  }
  const timer = setTimeout(() => finish('ETIMEDOUT'), timeoutMs)
  s.once('connect', () => finish('ok'))
  s.once('error', (e: NodeJS.ErrnoException) => finish(typeof e.code === 'string' ? e.code : 'error'))
})

function failureCode(f: DialFailure | PreambleFailure): string {
  if ('kind' in f) return f.kind
  return f.status === 'unreachable' ? f.reason : f.status
}

/**
 * The loop for one paired device, until `stopped()` or a stop that needs Yu. A missing config file stops before any
 * dial. Before the first dial of the loop, and after each no_route failure while no link has come up in it, the hub
 * makes one TCP connect to the config's HostName:22 (P56); it is ledgered and never stops the loop. Every dial appends
 * {event:'dial', device, outcome, code, ms} (the §9.7 wake check compares their times) and each host-key mismatch
 * {event:'host_key_mismatch', device, fingerprint}. `onLink` runs for as long as a link is up. Statuses carry the
 * policy's sticky warnings; `since` is when the current word began, and for connecting and away when the link was
 * last lost (or the loop started).
 */
export async function runDialLoop(o: { device: DeviceFile; paths: AirPaths; ssh: string; policy: DialPolicy; configExists(): boolean;
  onLink(link: DeviceLink): Promise<void>; status(s: Partial<DeviceStatus>): void; ledger(f: LedgerFields): void;
  tcpProbe: TcpProbe; stopped(): boolean; sleep(ms: number): Promise<void>; preambleMs?: number }): Promise<'stopped' | 'needs_yu'> {
  const device = o.device.device
  const alias = o.device.host_alias
  const config = o.paths.sshConfig
  const preambleMs = o.preambleMs ?? scaled(TIMING.preambleMs)
  let lastWord: DeviceWord | null = null
  let since = new Date().toISOString()
  let downSince: string | null = null
  const report = (word: DeviceWord, reason: string | null, hint: string | null) => {
    const t = new Date().toISOString()
    if (word === 'up') downSince = null
    else downSince ??= t
    if (word !== lastWord) {
      since = word === 'connecting' || word === 'away' ? downSince! : t
      lastWord = word
    }
    o.status({ word, reason, since, hint, sticky: o.policy.sticky() })
  }
  const needsYu = (reason: string): 'needs_yu' => {
    report('needs_yu', reason, null)
    return 'needs_yu'
  }

  if (!o.configExists()) {
    o.ledger({ event: 'dial', device, outcome: 'refused', code: 'config', ms: 0 })
    return needsYu('config')
  }
  let target: ReturnType<typeof targetOfConfig> = null
  try { target = targetOfConfig(readFileSync(config, 'utf8'), alias) } catch { target = null }
  if (!target?.host) {
    o.ledger({ event: 'dial', device, outcome: 'refused', code: 'config', ms: 0 })
    return needsYu('config')
  }
  const ctx: SshContext = { ...target, config }
  report('connecting', null, null)

  let linked = false
  let probeNext = true
  while (!o.stopped()) {
    if (probeNext && !linked) {
      probeNext = false
      const t0 = monoNowMs()
      const r = await o.tcpProbe(target.host, 22, 5_000).catch(() => 'error')
      o.ledger({ event: 'tcp_probe', device, outcome: r === 'ok' ? 'ok' : 'failed', code: r === 'ok' ? undefined : r, ms: Math.round(monoNowMs() - t0) })
      if (o.stopped()) break
    }
    const t0 = monoNowMs()
    const out = await dialOnce({ ssh: o.ssh, config, alias, nonce: newRelayNonce(), ctx, preambleMs, home: o.paths.home })
    const ms = Math.round(monoNowMs() - t0)
    let decision: DialDecision
    if (out.ok) {
      o.ledger({ event: 'dial', device, outcome: 'up', ms })
      o.policy.onUp()
      linked = true
      report('up', null, null)
      try { await o.onLink(out.link) } catch { /* the session ended: a drop like any other */ }
      out.link.close()
      await out.link.closed
      decision = o.policy.onDrop()
    } else {
      const f = out.failure
      o.ledger({ event: 'dial', device, outcome: 'failed', code: failureCode(f), ms })
      if ('status' in f && f.status === 'host_key_mismatch') o.ledger({ event: 'host_key_mismatch', device, fingerprint: f.fingerprint ?? undefined })
      decision = o.policy.onFailure(f)
      if ('status' in f && f.status === 'unreachable' && f.reason === 'no_route') probeNext = true
    }
    if (decision.action === 'stop') return needsYu(decision.reason)
    report(decision.word, decision.reason, decision.hint)
    if (o.stopped()) break
    await o.sleep(decision.delayMs)
  }
  return 'stopped'
}
