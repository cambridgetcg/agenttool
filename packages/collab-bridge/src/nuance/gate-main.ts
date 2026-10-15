// The forced command on Nuance (C2, spec §5.2). sshd runs `collab-bridge gate` for the Air's collab key with the
// client's request in SSH_ORIGINAL_COMMAND. Exactly three forms are served; anything else gets one stderr line and exit 64
// (an upload-pack-shaped refusal also a pkt-line ERR, so git shows the reason). Every invocation appends one content-free
// ledger line (form, outcome, bytes, ms), the one exception being an invocation whose home cannot be built (no ledger path
// exists then; it still gets its stderr line, and an upload-pack its ERR). The gate runs no harness and no shell, and never
// echoes a refused command.
// An unexpected throw is still ledgered (outcome error, code exception), answers an upload-pack with a pkt-line ERR, and exits 70.
import { loadAllowlist } from '../allowlist.ts'
import { appendLedger, NUANCE_LEDGER_KEYS, type LedgerFields } from '../ledger.ts'
import { monoNowMs, passwdOfSelf } from '../native.ts'
import { homeOf, nuancePaths, type NuancePaths } from '../paths.ts'
import { systemBin, type Env } from '../sysbin.ts'
import { scaled, TIMING } from '../timing.ts'
import { FETCH_STOPPED_EXIT, pktLineErr, runFetchGate, type FetchGateCtx, type FetchStop } from './fetch-gate.ts'
import { buildHello, describeCommand, parseGateCommand, uploadPackShaped } from './gate.ts'
import { readInstalled, readShares } from './installed.ts'
import { runRelay } from './relay.ts'

export const GATE_REFUSED_EXIT = 64
/** An unexpected throw in the dispatch: the invocation is ledgered and, for upload-pack, answered with an ERR; the exit matches main.ts's own catch. */
export const GATE_EXCEPTION_EXIT = 70
/**
 * stdout's write may return a promise that settles when the bytes have reached the reader (main.ts's drainSink), and a
 * sink that knows its reader is gone says so with `closed` (drainSink settles every later write at once and writes nothing).
 */
export interface GateIo { stdin: ReadableStream<Uint8Array>; stdout: { write(b: Uint8Array | string): void | Promise<void>; readonly closed?: boolean }; stderr: { write(s: string): void } }

const printable = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').slice(0, 200)

/** A failure's code (ENOSPC) or class name, never its message: a message can carry a path, and a ledger or stderr line is no place for one. */
function errorCode(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code
  return typeof c === 'string' && /^[A-Z0-9_]{1,40}$/.test(c) ? c : e instanceof Error ? e.name : 'unknown'
}

/**
 * How a write ended, within `ms`: it settled ('done'), it was rejected ('failed': the reader is gone), or `ms` passed first
 * ('late'). Never rejects. A write that handed back no promise is already done.
 */
function writeEnd(p: unknown, ms: number): Promise<'done' | 'failed' | 'late'> {
  if (!(p instanceof Promise)) return Promise.resolve('done')
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('late'), Math.max(0, ms))
    p.then(() => { clearTimeout(timer); resolve('done') }, () => { clearTimeout(timer); resolve('failed') })
  })
}

/**
 * A reply the gate does not wait for: if its promise is rejected the reader has gone, and that is not the gate's failure, so
 * the rejection is taken here and never left unhandled (it could add a stderr line or change the exit code). Whether the
 * bytes arrived is the sink's business (main.ts flushes it before exit). A write that throws at once is still the caller's.
 */
function unawaited(p: void | Promise<void>): void {
  void Promise.resolve(p).catch(() => {})
}

export async function runGate(env: Env, io: GateIo, o: { mono?: () => number; now?: () => Date } = {}): Promise<number> {
  const mono = o.mono ?? monoNowMs
  const now = o.now ?? (() => new Date())
  const t0 = mono()
  const raw = env.SSH_ORIGINAL_COMMAND
  const say = (line: string) => io.stderr.write(`collab-bridge gate: ${printable(line)}\n`)
  let paths: NuancePaths
  try {
    paths = nuancePaths(homeOf(env), env)
  } catch (e) {
    // The one invocation that cannot be ledgered: the ledger lives under the home, and this is the case where no home could be
    // built. A passwd-derived fallback would put a line where the Nuance paths do not point (and, in a test, in a real home),
    // so the stderr line is the whole record. git still gets its reason (Task 63 gate-1-8).
    if (uploadPackShaped(raw)) { try { unawaited(io.stdout.write(pktLineErr('config'))) } catch { /* the client is gone */ } }
    say(`refused: ${e instanceof Error ? e.message : String(e)}`)
    return GATE_REFUSED_EXIT
  }
  let bytes = 0
  const out = {
    write(b: Uint8Array | string) {
      bytes += typeof b === 'string' ? Buffer.byteLength(b, 'utf8') : b.byteLength
      return io.stdout.write(b)
    },
  }
  // The answer goes out whatever the ledger does, but a stopped audit trail is not silent: one stderr line, by code, per invocation.
  let ledgerNoted = false
  const ledger = (f: LedgerFields) => {
    try {
      appendLedger(paths.ledger, NUANCE_LEDGER_KEYS, f)
    } catch (e) {
      if (ledgerNoted) return
      ledgerNoted = true
      try { say(`ledger: append failed (${errorCode(e)})`) } catch { /* stderr is gone as well */ }
    }
  }
  let recorded = false
  const record = (form: string, outcome: string, code?: string) => {
    recorded = true
    ledger({ event: 'gate', form, outcome, code, bytes, ms: Math.max(0, Math.round(mono() - t0)) })
  }

  // Nothing past this point may leave the invocation off the ledger, or git without an answer: a throw is caught below.
  let formSeen = 'bad'
  try {
    const cmd = parseGateCommand(raw)
    if (!cmd) {
      if (uploadPackShaped(raw)) unawaited(out.write(pktLineErr('bad_command')))
      say("refused: the only forms are hello, relay 1 <nonce> and git-upload-pack '<path>'")
      record('bad', 'refused', describeCommand(raw))   // its length and, for a listed program only, its name; never a word the client chose
      return GATE_REFUSED_EXIT
    }
    formSeen = cmd.form
    switch (cmd.form) {
      case 'hello': {
        // The user from getpwuid, not $USER: sshd sets USER, but nothing here trusts the environment for it (F3).
        const h = buildHello({ paths, user: passwdOfSelf().name, now, zsh: systemBin('zsh', env) })
        if ('error' in h) {
          say(`hello: ${h.error}`)
          record('hello', 'refused', 'hello_unavailable')
          return GATE_REFUSED_EXIT
        }
        // The Air acts on this one line, so it is not a reply the gate may forget: a write that was rejected, a sink that says its
        // reader is gone (drainSink never rejects; it closes) or one that has not taken the line within a handshake step is an
        // error on the ledger and a nonzero exit, never 'ok' (Task 63 new-gate-hello-write). The exit is a stopped fetch's.
        const how = await writeEnd(out.write(JSON.stringify(h) + '\n'), scaled(TIMING.handshakeStepMs, env))
        if (how !== 'done' || io.stdout.closed === true) {
          const why = how === 'late' ? 'deadline' : 'client_gone'
          say(`hello: the answer was not delivered (${why})`)
          record('hello', 'error', why)
          return FETCH_STOPPED_EXIT
        }
        record('hello', 'ok')
        return 0
      }
      case 'relay': {
        const code = await runRelay({ paths, nonce: cmd.nonce, stdin: io.stdin, write: (b) => out.write(b), mono, ledger,
          staleMs: scaled(TIMING.staleMs, env), exitMs: scaled(TIMING.relayExitMs, env), inodeCheckMs: scaled(TIMING.inodeCheckMs, env),
          stderr: io.stderr })
        record('relay', code === 0 ? 'ok' : code === GATE_REFUSED_EXIT ? 'refused' : 'error')
        return code
      }
      case 'upload-pack': {
        const installed = readInstalled(paths)
        if (!installed) {
          unawaited(out.write(pktLineErr('not_installed')))
          say('upload-pack: collab-bridge is not installed on this Mac')
          record('upload-pack', 'refused', 'not_installed')
          return GATE_REFUSED_EXIT
        }
        const al = loadAllowlist(paths.summonAllowlist)
        const ctx: FetchGateCtx = { home: paths.home, installed, shares: readShares(paths) ?? [], allowlist: al.ok ? al.allowlist : null, uid: process.getuid!() }
        // A pack goes at the reader's pace (every chunk waits for the one before it) until the Air's own fetch deadline: past
        // it the Air has stopped the fetch (§7.3 step 4), so a reader that never drains cannot hold this process for ever.
        // A reader that has gone (a rejected write, or a sink that says it is closed) or a deadline that has passed stops the
        // fetch: git is killed and the line says client_gone or deadline, not served (Task 63 gate-1-9).
        const fetchBy = mono() + scaled(TIMING.fetchMs, env)
        let stop: FetchStop | null = null
        const atReadersPace = {
          write: async (b: Uint8Array) => {
            if (stop) return
            const left = fetchBy - mono()
            if (left <= 0) { stop = 'deadline'; return }
            const how = await writeEnd(out.write(b), left)
            if (how === 'late') stop = 'deadline'
            else if (how === 'failed' || io.stdout.closed === true) stop = 'client_gone'
          },
        }
        const r = await runFetchGate(cmd.path, ctx, { stdin: io.stdin, stdout: atReadersPace, stderr: io.stderr,
          stopped: () => stop, killGraceMs: scaled(2_000, env) })
        record('upload-pack', r.outcome)
        return r.exit
      }
    }
  } catch (e) {
    if (uploadPackShaped(raw)) { try { unawaited(out.write(pktLineErr('exception'))) } catch { /* the client is gone */ } }
    try { say(`${formSeen}: unexpected failure (${errorCode(e)})`) } catch { /* stderr is gone as well */ }
    if (!recorded) record(formSeen, 'error', 'exception')
    return GATE_EXCEPTION_EXIT
  }
}
