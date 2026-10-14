// The one compiled Nuance program (P20). sshd's forced command runs `collab-bridge gate`; Claude runs `collab-bridge pipe`
// and its hook `collab-bridge tap --host claude` (Tasks 31, 32); Yu runs `collab-bridge status`; the installer runs the
// hidden `install …` verbs (Tasks 55, 56). Nothing Air-side is in here.
import { monoNowMs, passwdOfSelf } from '../native.ts'
import { homeOf, nuancePaths } from '../paths.ts'
import { readPs, ttyOf } from '../proc.ts'
import { systemBin, type Env } from '../sysbin.ts'
import { scaled, TIMING } from '../timing.ts'
import { runGate, type GateIo } from './gate-main.ts'
import { readInstalled } from './installed.ts'
import { bunConnect } from './link-client.ts'
import { runPipe, type PipeDeps } from './pipe.ts'
import { nuanceStatus, renderNuanceStatus } from './status.ts'

export const NUANCE_USAGE = 'usage: collab-bridge gate | pipe | status'

/**
 * The pipe's deps from the env Claude gave it: this Mac's paths, INSTALLED, the real process table (`ps` by systemBin, so a
 * test's P43 stub), the monotonic clock that counts sleep, the passwd user name (never $USER, F3) and this process's stdio.
 * A missing or malformed INSTALLED throws: the binary is not installed, and Claude shows the server as failed.
 */
export function livePipeDeps(env: Env): PipeDeps {
  const paths = nuancePaths(homeOf(env), env)
  const installed = readInstalled(paths)
  if (!installed) throw new Error('INSTALLED is missing or malformed; run the installer again')
  const ps = systemBin('ps', env)
  return {
    paths, env, cwd: process.cwd(), selfPid: process.pid,
    table: () => readPs(ps),
    ttyOf: (pid) => ttyOf(pid, ps),
    mono: monoNowMs,
    now: () => new Date(),
    rand: Math.random,
    stdin: Bun.stdin.stream(),
    write: (line) => { try { process.stdout.write(line) } catch { /* Claude is gone */ } },
    installed,
    user: passwdOfSelf().name,
    connect: bunConnect,
  }
}

/** The part of a Node/Bun writable the sink needs; process.stdout has it, and a test can stand in. */
export interface WritableLike {
  write(chunk: Uint8Array | string, cb?: (err?: Error | null) => void): unknown
  on(event: 'error', fn: (err: unknown) => void): unknown
}

/**
 * The gate's stdout, with the three things a bare process.stdout.write lacks (Task 24 review; Task 23's write guard):
 * - A write returns a promise that settles when its bytes have reached the reader (the write's callback), so a caller that
 *   awaits it, as runFetchGate does, goes at the reader's pace instead of piling a whole pack into this process.
 * - The last real write can be waited for before process.exit (flush): on this Air, 8 MiB written and then an exit
 *   delivered 64 KiB. An empty write is skipped, because its callback fires at once and would end the wait early.
 * - A write that fails, an 'error' event, or a throw closes the sink: waiting writes settle at once and every later write
 *   is a no-op. A write never throws and its promise never rejects, so the relay can be handed it as is.
 */
export interface DrainSink {
  write(b: Uint8Array | string): Promise<void>
  /** Settles when the last real write has been delivered, the sink closed, or `ms` have passed. */
  flush(ms: number): Promise<void>
  readonly closed: boolean
}

export function drainSink(stream: WritableLike): DrainSink {
  let closed = false
  let last: Promise<void> = Promise.resolve()
  const waiting = new Set<() => void>()
  const close = () => {
    closed = true
    for (const settle of [...waiting]) settle()
  }
  stream.on('error', close)
  return {
    get closed() { return closed },
    write(b) {
      if (closed || b.length === 0) return Promise.resolve()
      const p = new Promise<void>((resolve) => {
        const settle = () => { waiting.delete(settle); resolve() }
        waiting.add(settle)
        try {
          stream.write(b, (err) => { if (err) close(); else settle() })
        } catch {
          close()
        }
      })
      last = p
      return p
    },
    flush(ms) {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        void last.then(() => { clearTimeout(timer); resolve() })
      })
    },
  }
}

/** argv is the verb and its arguments (process.argv.slice(2)); the result is the exit code. */
export async function runNuanceCli(argv: string[], env: Env, io: GateIo): Promise<number> {
  const [verb, ...rest] = argv
  switch (verb) {
    case 'gate':
      if (rest.length === 0) return runGate(env, io)
      break
    case 'pipe':
      // Claude's MCP server (§6.2): JSON-RPC on this process's stdio until stdin ends.
      if (rest.length === 0) return runPipe({ ...livePipeDeps(env), stdin: io.stdin, write: (line) => io.stdout.write(line) })
      break
    case 'status': {
      if (rest.length > 0) break
      const paths = nuancePaths(homeOf(env), env)
      const s = nuanceStatus(paths, monoNowMs, { staleMs: scaled(TIMING.staleMs, env) })
      for (const line of renderNuanceStatus(s, monoNowMs())) io.stdout.write(line + '\n')
      return 0
    }
  }
  io.stderr.write(NUANCE_USAGE + '\n')
  return 2
}

if (import.meta.main) {
  // First, before anything reads them: the gate's children and every path lookup see one locale and the system PATH (§5.2).
  process.env.LC_ALL = 'C'
  process.env.PATH = '/usr/bin:/bin'
  const stdout = drainSink(process.stdout)
  const io: GateIo = {
    stdin: Bun.stdin.stream(),
    stdout,
    stderr: { write: (s) => { process.stderr.write(s) } },
  }
  let code: number
  try {
    code = await runNuanceCli(process.argv.slice(2), process.env, io)
  } catch (e) {
    process.stderr.write(`collab-bridge: ${String(e instanceof Error ? e.message : e).replace(/[^\x20-\x7e]/g, '?').slice(0, 200)}\n`)
    code = 70
  }
  // process.exit right after a plain write loses what is still buffered, so the last write is waited for (at most 2 s: a
  // fetch has already gone at the reader's pace, up to its own deadline, inside runGate).
  await stdout.flush(2000)
  process.exit(code)
}
