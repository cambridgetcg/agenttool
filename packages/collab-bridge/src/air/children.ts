// The hub's client for one Collab child (C9): the installed Collab MCP bin, run the hub's way, spoken to with hand-rolled
// newline-delimited JSON-RPC (P3). Three rules from spec §9.3 item 4 shape it. The request timer is finite (a timer above
// 2^31−1 ms fires at once, K65). There is no abort signal and notifications/cancelled is never sent: a cancel cannot stop
// Collab's synchronous handlers and would only drop the result (K28, K65). And once the request bytes are written, every
// failure (the timer, an exit, an unparsable or oversized reply, a failed write) is `unknown`, never `error`: `error` is
// only an answer the child gave.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { monoNowMs } from '../native.ts'
import { encodeLine, LineReader, LineTooLong, parseJsonRpc, type JsonRpcResponse } from '../jsonrpc.ts'
import type { ToolDef, ToolResult } from '../link/messages.ts'
import { TIMING } from '../timing.ts'

export interface ChildSpec { bun: string; dist: string; journal: string; home: string; sessionFile?: string }

/** Every Air bun runs with --no-env-file --config=/dev/null, so no bunfig.toml or .env anywhere is ever read (R39, K66). */
export function childArgv(spec: ChildSpec): string[] {
  return [spec.bun, '--no-env-file', '--config=/dev/null', `${spec.dist}/agenttool-collab-mcp.js`]
}

/** Built from an explicit key list, never inherited (P14); the session file only to resume (§10.4). */
export function childEnv(spec: ChildSpec): Record<string, string> {
  const env: Record<string, string> = { HOME: spec.home, PATH: '/opt/homebrew/bin:/usr/bin:/bin', AGENTOOL_COLLAB_DB: spec.journal }
  if (spec.sessionFile !== undefined) env.AGENTOOL_COLLAB_SESSION_FILE = spec.sessionFile
  return env
}

export type CallOutcome =
  | { outcome: 'ok' | 'error'; result: ToolResult; ms: number; bytes: number }
  | { outcome: 'unknown'; reason: 'timeout' | 'exit' | 'unparsable' | 'oversized' | 'write_failed'; ms: number }
export interface StartFailure { failed: true; lastErrLine: string | null; exitCode: number | null }

export const CHILD_REQUEST_TIMEOUT_MS = TIMING.childRequestMs // 600000, always finite (§9.3 item 4)
/** What still fits one hub→pipe frame (4 MiB) with its envelope. */
export const CHILD_MAX_REPLY_BYTES = 4 * 1024 * 1024 - 64 * 1024
/** The largest delay a timer honours; anything above it fires at once (K65). */
const MAX_TIMER_MS = 2_147_483_647
const DEFAULT_START_TIMEOUT_MS = 60_000 // two chain passes and a resume; far above a small journal's start (K21)
const STDERR_LINE_MAX = 4096
const DRAIN_AFTER_EXIT_MS = 2_000
/** How long a distrusted child gets between SIGTERM and SIGKILL. */
const KILL_AFTER_TERM_MS = 5_000

type UnknownReason = Extract<CallOutcome, { outcome: 'unknown' }>['reason']
interface Pending {
  started: number
  timer: ReturnType<typeof setTimeout> | null
  settle(o: CallOutcome): void
  raw?: (m: JsonRpcResponse) => void // the hub's own requests (tools/list) take the reply as it came
}

function spawnChild(spec: ChildSpec) {
  return Bun.spawn(childArgv(spec), { cwd: '/', env: childEnv(spec), stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
}
type Proc = ReturnType<typeof spawnChild>

function timerMs(name: string, v: number): number {
  if (!Number.isInteger(v) || v < 1 || v > MAX_TIMER_MS) {
    throw new Error(`CollabChild: ${name} must be a whole number of ms from 1 to ${MAX_TIMER_MS} (K65), got ${v}`)
  }
  return v
}

/** True when `p` settles within `ms`; the timer is cleared either way, so nothing lingers. */
async function within(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms) })
  try {
    return await Promise.race([p.then(() => true as const), late])
  } finally {
    clearTimeout(timer)
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A reply the child gave, as a tool result. A JSON-RPC error (an unknown tool or a malformed request, refused by the SDK
 *  before any handler ran) becomes an isError result in Collab's two-channel shape, so nothing above ever sees one (R17). */
function resultOf(msg: JsonRpcResponse): { outcome: 'ok' | 'error'; result: ToolResult } | null {
  if (msg.error) {
    const sc = { error: 'collab_jsonrpc_error', message: msg.error.message, jsonrpc_code: msg.error.code }
    return { outcome: 'error', result: { content: [{ type: 'text', text: JSON.stringify(sc, null, 2) }], structuredContent: sc, isError: true } }
  }
  const r = msg.result
  if (!isRecord(r) || !Array.isArray(r.content)) return null
  return { outcome: r.isError === true ? 'error' : 'ok', result: r as unknown as ToolResult }
}

export class CollabChild {
  readonly pid: number
  readonly exited: Promise<number | null>
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly idle: Array<() => void> = []
  private dead = false
  private closed = false
  private stopping: Promise<void> | null = null
  private lastErr: string | null = null
  private initWaiter: ((m: JsonRpcResponse | null) => void) | null = null
  private readonly stderrDone: Promise<void>

  private constructor(private readonly proc: Proc, private readonly requestTimeoutMs: number, maxReplyBytes: number) {
    this.pid = proc.pid
    this.exited = proc.exited.then(() => {
      this.dead = true
      return proc.exitCode
    })
    this.stderrDone = this.readStderr().catch(() => {})
    // A stdout read that fails (a stream error, a throwing push or onLine) is not the child's silence: nothing would read its
    // replies again, so the child is distrusted instead of left accepting calls it would answer into the void.
    const stdoutDone = this.readStdout(new LineReader(maxReplyBytes)).catch(() => this.distrust('unparsable'))
    // What is still pending is settled only once stdout has drained: a reply written just before the exit still counts.
    void this.exited.then(() => within(stdoutDone, DRAIN_AFTER_EXIT_MS)).then(() => {
      this.initWaiter?.(null)
      this.failAll('exit')
    })
  }

  static async start(spec: ChildSpec, o: { requestTimeoutMs?: number; startTimeoutMs?: number; maxReplyBytes?: number } = {}): Promise<CollabChild | StartFailure> {
    const requestTimeoutMs = timerMs('requestTimeoutMs', o.requestTimeoutMs ?? CHILD_REQUEST_TIMEOUT_MS)
    const startTimeoutMs = timerMs('startTimeoutMs', o.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS)
    let proc: Proc
    try {
      proc = spawnChild(spec)
    } catch {
      return { failed: true, lastErrLine: null, exitCode: null } // no executable at spec.bun
    }
    const child = new CollabChild(proc, requestTimeoutMs, o.maxReplyBytes ?? CHILD_MAX_REPLY_BYTES)
    if (await child.initialize(startTimeoutMs)) return child
    if (!child.dead) proc.kill('SIGKILL')
    await child.exited
    await within(child.stderrDone, 1000)
    return { failed: true, lastErrLine: child.lastErr, exitCode: proc.exitCode }
  }

  /** initialize, then notifications/initialized; false when the child exits, refuses or stays silent first. */
  private async initialize(timeoutMs: number): Promise<boolean> {
    const id = this.nextId++
    const reply = new Promise<JsonRpcResponse | null>((resolve) => { this.initWaiter = resolve })
    const timer = setTimeout(() => this.initWaiter?.(null), timeoutMs)
    this.write(encodeLine({ jsonrpc: '2.0', id, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agenttool-collab-bridge-hub', version: '1' },
    } }))
    const m = await reply
    clearTimeout(timer)
    this.initWaiter = null
    if (!m || m.id !== id || m.error || !isRecord(m.result)) return false
    return this.write(encodeLine({ jsonrpc: '2.0', method: 'notifications/initialized' }))
  }

  /** One tools/list. Any failure throws: the hub's start probe treats it as a refusal to start. */
  async listTools(): Promise<ToolDef[]> {
    const m = await this.request('tools/list', {})
    const tools = isRecord(m.result) ? m.result.tools : undefined
    if (m.error || !Array.isArray(tools)) throw new Error('CollabChild: tools/list failed')
    return tools as ToolDef[]
  }

  /** Exactly one tools/call, written once and never cancelled. */
  call(name: string, args: Record<string, unknown>): Promise<CallOutcome> {
    if (this.dead || this.closed) return Promise.resolve({ outcome: 'unknown', reason: 'exit', ms: 0 })
    const id = this.nextId++
    return new Promise<CallOutcome>((resolve) => {
      const p: Pending = { started: monoNowMs(), timer: null, settle: resolve }
      this.pending.set(id, p)
      if (!this.write(encodeLine({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }))) {
        this.settleUnknown(id, 'write_failed')
        return
      }
      // The clock starts once the request is written, so time spent queued inside the child counts (§9.3 item 4).
      p.started = monoNowMs()
      p.timer = setTimeout(() => this.settleUnknown(id, 'timeout'), this.requestTimeoutMs)
    })
  }

  inFlight(): number {
    return this.pending.size
  }

  alive(): boolean {
    return !this.dead
  }

  /** True while call() would write: alive and not stopping. A caller that forwards an agent's call checks it in the same
   *  synchronous turn as call(), so a child stopped after it was handed out answers as not sent, never as unknown (§9.3). */
  accepting(): boolean {
    return !this.dead && !this.closed
  }

  /** Takes no new call, waits for zero in flight, closes stdin (Collab exits on EOF), then SIGTERM, then SIGKILL. */
  stop(graceMs = 5000): Promise<void> {
    if (this.stopping) return this.stopping
    this.closed = true
    this.stopping = (async () => {
      if (this.pending.size > 0) await new Promise<void>((resolve) => this.idle.push(resolve))
      try { void this.proc.stdin.end() } catch { /* already closed */ }
      if (this.dead || await within(this.exited, graceMs)) return
      this.proc.kill('SIGTERM')
      if (this.dead || await within(this.exited, graceMs)) return
      this.proc.kill('SIGKILL')
      await this.exited
    })()
    return this.stopping
  }

  /** A request the hub itself makes (tools/list); never used for tools/call. */
  private request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    if (this.dead || this.closed) return Promise.reject(new Error(`CollabChild: ${method} after exit`))
    const id = this.nextId++
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const p: Pending = {
        started: monoNowMs(), timer: null, raw: resolve,
        settle: (o) => reject(new Error(`CollabChild: ${method} ${o.outcome === 'unknown' ? o.reason : 'failed'}`)),
      }
      this.pending.set(id, p)
      if (!this.write(encodeLine({ jsonrpc: '2.0', id, method, params }))) {
        this.settleUnknown(id, 'write_failed')
        return
      }
      p.timer = setTimeout(() => this.settleUnknown(id, 'timeout'), this.requestTimeoutMs)
    })
  }

  /** One line to stdin; false when the pipe refused it. A FileSink write never throws EPIPE (air-env §13), so a dead
   *  child shows up through `exited`, never here. */
  private write(line: string): boolean {
    try {
      void this.proc.stdin.write(line)
      void this.proc.stdin.flush()
      return true
    } catch {
      return false
    }
  }

  /** Removes a pending call; the caller settles it, then calls released(). */
  private take(id: number): Pending | undefined {
    const p = this.pending.get(id)
    if (!p) return undefined
    this.pending.delete(id)
    if (p.timer) clearTimeout(p.timer)
    return p
  }

  /** After a settle: at zero in flight, a waiting stop() goes on. */
  private released(): void {
    if (this.pending.size === 0) for (const r of this.idle.splice(0)) r()
  }

  private settleUnknown(id: number, reason: UnknownReason): void {
    const p = this.take(id)
    if (!p) return
    p.settle({ outcome: 'unknown', reason, ms: Math.round(monoNowMs() - p.started) })
    this.released()
  }

  private failAll(reason: UnknownReason): void {
    for (const id of [...this.pending.keys()]) this.settleUnknown(id, reason)
  }

  /** A child whose stdout can no longer be read as replies takes no further call: closed first (accepting() is false at
   *  once), every call in flight answered `reason`, then SIGTERM, then SIGKILL if it is still there after KILL_AFTER_TERM_MS. */
  private distrust(reason: UnknownReason): void {
    this.closed = true
    this.failAll(reason)
    if (this.dead) return
    try { this.proc.kill('SIGTERM') } catch { /* already gone */ }
    void within(this.exited, KILL_AFTER_TERM_MS).then(() => {
      if (this.dead) return
      try { this.proc.kill('SIGKILL') } catch { /* already gone */ }
    })
  }

  private onLine(line: string): void {
    const parsed = parseJsonRpc(line)
    if (parsed.kind === 'invalid') {
      // A line no one can attribute: every call in flight may have been its subject, so they all become unknown, and a
      // child whose stdout carries garbage is not trusted with another call.
      this.distrust('unparsable')
      return
    }
    if (parsed.kind !== 'response') return // Collab sends its client no requests or notifications (K2)
    const msg = parsed.msg
    if (this.initWaiter) return this.initWaiter(msg)
    if (typeof msg.id !== 'number') return
    const p = this.take(msg.id)
    if (!p) return // late, after the timer: that call was already answered unknown
    const ms = Math.round(monoNowMs() - p.started)
    const r = p.raw ? null : resultOf(msg)
    if (p.raw) p.raw(msg)
    else if (!r) p.settle({ outcome: 'unknown', reason: 'unparsable', ms })
    else p.settle({ ...r, ms, bytes: Buffer.byteLength(line, 'utf8') })
    this.released()
  }

  private async readStdout(reader: LineReader): Promise<void> {
    for await (const chunk of this.proc.stdout) {
      let lines: string[]
      try {
        lines = reader.push(chunk)
      } catch (e) {
        if (!(e instanceof LineTooLong)) throw e
        // This chunk's complete lines are real replies. Then, as with garbage, every call still in flight may have been
        // the over-long one. The reader resynchronises at the next newline, so the child stays usable.
        for (const l of e.lines) this.onLine(l)
        this.failAll('oversized')
        continue
      }
      for (const l of lines) this.onLine(l)
    }
  }

  /** Keeps reading stderr so the child never blocks on it, remembering only its last `✖ ` line (K64). A line that passes
   *  STDERR_LINE_MAX before its newline is judged on its head, prefix included, and the rest of it up to the newline is dropped. */
  private async readStderr(): Promise<void> {
    const note = (line: string): void => { if (line.startsWith('✖ ')) this.lastErr = line.slice(0, STDERR_LINE_MAX) }
    const dec = new TextDecoder()
    let buf = ''
    let skipping = false // the current line is past the cap and already judged: drop its rest
    for await (const chunk of this.proc.stderr) {
      let text = dec.decode(chunk, { stream: true })
      if (skipping) {
        const nl = text.indexOf('\n')
        if (nl < 0) continue
        text = text.slice(nl + 1)
        skipping = false
      }
      buf += text
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        note(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
      if (buf.length > STDERR_LINE_MAX) {
        note(buf.slice(0, STDERR_LINE_MAX))
        buf = ''
        skipping = true
      }
    }
    note(buf)
  }
}

export type ToolProbe = { ok: true; list: ToolDef[] } | { ok: false; stage: 'start'; failure: StartFailure } | { ok: false; stage: 'list'; message: string }

/** One tools/list from a child on a throwaway journal in a fresh dir under `tmpRoot`, removed afterwards: never the shared
 *  or the private journal (§10.4 step 3). The hub's start probe and prepare-pairing both use it. */
export async function probeCollabTools(o: { bun: string; dist: string; tmpRoot: string; home?: string }): Promise<ToolProbe> {
  const dir = realpathSync(mkdtempSync(join(o.tmpRoot, 'probe-')))
  try {
    const c = await CollabChild.start({ bun: o.bun, dist: o.dist, journal: join(dir, 'probe.sqlite'), home: o.home ?? dir })
    if ('failed' in c) return { ok: false, stage: 'start', failure: c }
    try {
      return { ok: true, list: await c.listTools() }
    } catch (e) {
      return { ok: false, stage: 'list', message: e instanceof Error ? e.message : String(e) }
    } finally {
      await c.stop()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
