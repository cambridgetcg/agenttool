// The Claude MCP pipe on Nuance (C4, spec §6.2, §9.1–§9.4). It answers the harness itself from the cached tool list, so
// initialize and tools/list work with the hub away (R16), and sends each tools/call once over its link to the Air hub.
// "Not sent" ends at the write to the relay socket (§9.3 item 3): every refusal before that write is delivered:false;
// after it, the answer is the hub's result or hub_outcome_unknown, never a JSON-RPC error (R17) and never a resend (R18).
import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import { bridgeFailure, deliveredOf, withPriorUnknown, type AgentCode } from '../failure.ts'
import { appendLedger, NUANCE_LEDGER_KEYS, type LedgerFields } from '../ledger.ts'
import { LineReader, LineTooLong, type JsonRpcId } from '../jsonrpc.ts'
import { FRAME_HEADER_BYTES } from '../link/frame.ts'
import {
  encodeMessage, LABEL_TOKEN_RE, MAX_FOLDER_BYTES, MAX_PIPE_TO_HUB, newPipeInstance,
  type AttachMsg, type CallMsg, type Declared, type NoticeMsg, type ReadyMsg, type ResultMsg, type ToolDef, type ToolResult, type ToolsMsg,
} from '../link/messages.ts'
import type { NuancePaths } from '../paths.ts'
import type { ProcTable } from '../proc.ts'
import type { Env } from '../sysbin.ts'
import { scaled, TIMING } from '../timing.ts'
import { declaredState } from './gitstate.ts'
import { addInflight, argsHash, clearByIdempotencyKey, clearByTool, clearInflight, isStale, MAX_INFLIGHT, priorConflict, unresolved } from './inflight.ts'
import { readShares, type InstalledInfo } from './installed.ts'
import { findHost, interactiveCheck, openLineage, SESSION_ID_RE, sweepLineages, type HostInfo, type Interactive } from './lineage.ts'
import { bunConnect, LinkClient, type Connect } from './link-client.ts'
import { McpLocalServer } from './mcp-local.ts'
import { loadSeatPrivate, signSeat } from './seatkey.ts'
import { acceptHubTools, readCurrentTools, type ToolsVerdict } from './tools-cache.ts'

/** Claim and complete may fetch, check and check out on the Air: 150 s instead of 60 (§9.4). */
export const LONG_CALL_TOOLS: ReadonlySet<string> = new Set(['collab_task_claim', 'collab_task_complete'])
/** Calls that carry the folder's declared git state (§7.5); recover only for a takeover (its action, or Collab's default). */
export const DECLARING_TOOLS: ReadonlySet<string> = new Set(['collab_task_claim', 'collab_task_complete', 'collab_task_recover'])
/** Tools that change nothing (§6.3's pinned reads; §9.3 item 7: collab_next is harmless): no in-flight record, never capped (P65). */
export const UNRECORDED_TOOLS: ReadonlySet<string> = new Set(['collab_workspace_status', 'collab_task_list', 'collab_task_get',
  'collab_report_list', 'collab_events_since', 'collab_anchor_status', 'collab_journal_verify', 'collab_next'])
/** Claude never sends a line this long; a longer one is dropped through its newline and the reader goes on (P59). */
export const PIPE_STDIN_MAX_LINE = 8 * 1024 * 1024

export interface PipeDeps {
  paths: NuancePaths; env: Env; cwd: string; selfPid: number; table(): ProcTable | null; ttyOf(pid: number): string | null
  mono(): number; now(): Date; rand(): number; stdin: ReadableStream<Uint8Array>; write(line: string): void; installed: InstalledInfo; user: string
  connect?: Connect; callTimeouts?: { default: number; long: number }
}

interface InFlight { tool: string; idempotencyKey: string | null; requestId: JsonRpcId; resolve(r: ToolResult): void; timer: ReturnType<typeof setTimeout> | null }

/** The agent-facing sentence for each refusal the pipe itself makes. */
const MESSAGES = {
  tool_not_available_remote: 'This tool is not offered to remote seats in this phase.',
  hub_version_mismatch: "The hub's tool list changed; re-list the tools (/mcp), then call again.",
  folder_not_shared: "This folder is not shared with the Air; start Claude at a shared folder's root.",
  harness_not_interactive: 'Collab through the Air hub is only for an interactive Claude session.',
  hub_away: 'The Air hub is not reachable now; nothing was sent.',
  seat_session_ended: 'This Collab session has ended on the Air; start a new session.',
  lineage_cap: 'Too many Claude sessions on this Mac are attached to the Air hub; close another session first.',
  frame_too_large: 'This call is larger than a call may be; nothing was sent.',
  rate_limited: 'Too many earlier calls of this session have no known outcome; check them with a read tool, or replay one with its own idempotency_key.',
  fetch_failed: "Could not read this folder's git state.",
  unrecorded: 'This pipe could not record the call before sending it; nothing was sent.',
} as const

const REFUSAL_CODES_FROM_HUB = new Set(['seat_session_ended', 'lineage_cap', 'folder_not_shared', 'frame_too_large'])

/** Whether this call declares the folder's git state: claim, complete, and a takeover (Collab's default action). */
function declares(name: string, args: Record<string, unknown>): boolean {
  if (name === 'collab_task_recover') return args.action === undefined || args.action === 'takeover'
  return DECLARING_TOOLS.has(name)
}

function labelOf(v: string | undefined): string {
  return typeof v === 'string' && LABEL_TOKEN_RE.test(v) ? v : 'unknown'
}

/** The error code of a result, Collab's or the bridge's, or null for a success. */
function errorOf(r: ToolResult): string | null {
  return r.isError === true && typeof r.structuredContent?.error === 'string' ? r.structuredContent.error : null
}

/** A session id in Collab's id shape, else null: a record must never hold one its lineage file would drop. */
function sessionIdOf(v: unknown): string | null {
  return typeof v === 'string' && SESSION_ID_RE.test(v) ? v : null
}

/**
 * §9.3 item 7, P65: an answer that tells what this lineage's earlier calls of a keyless tool did. cursor_ack is fenced by
 * expected_cursor_version, so any answer from Collab settles the earlier ones; session_end by Collab's answer or the hub's
 * seat_session_ended; session_start by a start or by Collab's session_already_bound. A hub refusal settles nothing.
 */
function settlesKeyless(tool: string, r: ToolResult, own: boolean): boolean {
  const code = errorOf(r)
  if (tool === 'collab_cursor_ack') return own
  if (tool === 'collab_session_end') return own || code === 'seat_session_ended'
  if (tool === 'collab_session_start') return own && (code === null || code === 'session_already_bound')
  return false
}

export class Pipe {
  private readonly instance = newPipeInstance()
  private seq = 0
  private host: HostInfo | null = null
  private key: string | null = null
  private lineage: string | null = null
  private folder: string | null = null
  private shared = false
  private interactive: Interactive = { ok: false, reason: 'no_claude_host' }
  /** The Collab session this pipe believes its lineage has bound (P66); every in-flight record names it. */
  private session: string | null = null
  private tools: { digest: string; list: ToolDef[] } | null = null
  private relist = false
  private readonly refusedDigests = new Set<string>()
  private link: LinkClient | null = null
  private readonly inflight = new Map<string, InFlight>()
  private readonly server: McpLocalServer
  private readonly timeouts: { default: number; long: number }

  constructor(private readonly deps: PipeDeps) {
    this.timeouts = deps.callTimeouts ?? { default: scaled(TIMING.callDefaultMs, deps.env), long: scaled(TIMING.callLongMs, deps.env) }
    this.server = new McpLocalServer({
      device: deps.installed.device, user: deps.user, build: deps.installed.build,
      tools: () => this.tools,
      onList: () => { this.relist = false },
      onCall: (id, name, args) => this.handleCall(id, name, args),
      onCancel: (requestId) => this.cancel(requestId),
      write: (line) => deps.write(line),
    })
  }

  async start(): Promise<void> {
    const { deps } = this
    const table = deps.table()
    if (table) {
      // §6.2: lineage files whose host is gone are swept after 7 days; our own host is alive, so its file stays.
      try { sweepLineages(deps.paths, table, deps.now().getTime()) } catch { /* best effort */ }
      this.host = findHost(deps.selfPid, table)
    }
    this.interactive = interactiveCheck(deps.env, this.host, deps.ttyOf)
    if (this.host) {
      try {
        const l = openLineage(deps.paths, this.host, deps.now)
        this.key = l.key
        this.lineage = l.file.lineage
      } catch { /* no lineage file: every call answers harness_not_interactive */ }
    }
    try { this.folder = realpathSync.native(deps.cwd) } catch { this.folder = null }
    const shares = readShares(deps.paths) ?? []
    this.shared = this.folder !== null && Buffer.byteLength(this.folder, 'utf8') <= MAX_FOLDER_BYTES && shares.some((s) => s.realpath === this.folder)
    this.tools = readCurrentTools(deps.paths)
    this.ledger({ event: 'pipe_start', lineage: this.lineage ?? undefined, outcome: this.shared ? 'shared' : 'not_shared' })
    // A folder outside shares.json never dials (§9.2 folder_not_shared); nor does a pipe with no lineage or no tool list.
    if (this.lineage && this.host && this.shared && this.tools) this.startLink(this.host, this.lineage)
  }

  async stop(): Promise<void> {
    this.link?.stop()
    this.link = null
    for (const ref of [...this.inflight.keys()]) this.settleUnknown(ref, 'stopped')
  }

  lineageId(): string | null {
    return this.lineage
  }

  /** One JSON-RPC line from the harness, answered by the local MCP server (Task 28). */
  handleLine(line: string): Promise<void> {
    return this.server.handleLine(line)
  }

  async handleCall(id: JsonRpcId, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const { deps } = this
    const ref = this.lineage ? `${this.lineage}:${this.instance}:${this.seq++}` : '<none>'
    const refuse = (code: AgentCode, message: string, extra?: Record<string, unknown>) => this.withPrior(bridgeFailure(code, message, ref, extra))
    if (!this.tools || !this.tools.list.some((t) => t.name === name)) return refuse('tool_not_available_remote', MESSAGES.tool_not_available_remote)
    if (this.relist) return refuse('hub_version_mismatch', MESSAGES.hub_version_mismatch)
    if (!this.shared) return refuse('folder_not_shared', MESSAGES.folder_not_shared)
    if (!this.lineage || !this.key || !this.folder) return refuse('harness_not_interactive', MESSAGES.harness_not_interactive)
    if (name === 'collab_session_start' && !this.interactive.ok) return refuse('harness_not_interactive', MESSAGES.harness_not_interactive)
    const link = this.link
    if (!link || !link.fresh()) {
      const code = link?.lastRefused() ?? null
      if (code !== null && REFUSAL_CODES_FROM_HUB.has(code)) {
        const c = code as 'seat_session_ended' | 'lineage_cap' | 'folder_not_shared' | 'frame_too_large'
        if (c === 'seat_session_ended') this.session = null   // P66: the old session's unknowns can no longer be replayed
        return refuse(c, MESSAGES[c])
      }
      return refuse('hub_away', MESSAGES.hub_away)   // seat_proof_failed and socket_path_too_long stay hub_away (P29)
    }
    const idempotencyKey = typeof args.idempotency_key === 'string' ? args.idempotency_key : null
    // P65: a read or collab_next changes nothing, so it writes no record and is never capped. A same-key replay of an
    // unresolved call of this session writes none either: Collab's receipt settles both (§9.3 item 5), the earlier record
    // stays until Collab answers that key, and the 64 cap never refuses the call that can settle it.
    const recorded = !UNRECORDED_TOOLS.has(name)
    let replay = false
    if (recorded) {
      const records = unresolved(deps.paths, this.key)
      const prior = priorConflict(records, name, args, this.session)
      if (prior) {
        const old = JSON.stringify(prior.idempotency_key)
        return refuse('prior_outcome_unknown', isStale(prior, this.session)
          ? `An earlier call with the same content (idempotency_key ${old}) has no known outcome and its Collab session has ended; a replay would run it again. Check with collab_report_list or collab_task_list first.`
          : `An earlier call with the same content under idempotency_key ${old} has no known outcome; replay it with that key, or check first.`,
        { prior_call_ref: prior.call_ref, prior_idempotency_key: prior.idempotency_key })
      }
      replay = idempotencyKey !== null && records.some((r) => r.tool === name && r.idempotency_key === idempotencyKey && !isStale(r, this.session))
      if (!replay && records.length >= MAX_INFLIGHT) return refuse('rate_limited', MESSAGES.rate_limited)
    }
    let declared: Declared | undefined
    if (declares(name, args)) {
      const d = declaredState(this.folder, deps.installed.git.path, deps.paths.home)
      if ('error' in d) return refuse('fetch_failed', MESSAGES.fetch_failed)   // P48: a definite refusal, nothing sent
      declared = d
    }
    const timeout = LONG_CALL_TOOLS.has(name) ? this.timeouts.long : this.timeouts.default
    const call: CallMsg = { t: 'call', call_ref: ref, name, arguments: args, timeout_ms: timeout, ...(declared ? { declared } : {}) }
    // §6.6, P59: the relay would close the whole connection on an oversized frame and turn every call on it into unknown.
    if (encodeMessage(call).byteLength + FRAME_HEADER_BYTES > MAX_PIPE_TO_HUB) return refuse('frame_too_large', MESSAGES.frame_too_large)
    // Persisted before the write, so a pipe that dies mid-call leaves the record for the next pipe (§9.3 item 6). A record
    // that cannot be written (a lock timeout, a lineage file gone) means the call is not sent at all.
    const writes = recorded && !replay
    if (writes) {
      let added: boolean
      try {
        added = addInflight(deps.paths, this.key, { call_ref: ref, tool: name, idempotency_key: idempotencyKey, args_hash: argsHash(args),
          at: deps.now().toISOString(), session_id: this.session })
      } catch {
        this.ledger({ event: 'inflight_unwritable', call_ref: ref, tool: name, lineage: this.lineage })
        return refuse('hub_away', MESSAGES.unrecorded)
      }
      if (!added) return refuse('rate_limited', MESSAGES.rate_limited)
    }
    const key = this.key
    return await new Promise<ToolResult>((resolve) => {
      const f: InFlight = { tool: name, idempotencyKey, requestId: id, resolve, timer: null }
      // Registered only once the write has returned. A write that throws took nothing (§9.3 item 3), and the lost() it runs
      // inside send must not answer this call unknown.
      if (link.send(call) !== 'written') {
        if (writes) this.clearRecords(key, ref, null)
        resolve(refuse('hub_away', MESSAGES.hub_away))
        return
      }
      this.inflight.set(ref, f)
      // bunConnect's flush can see the socket gone (write < 0) and drop the link inside send, which still returns 'written'.
      // The call was handed to the stream, so it is unknown at once (§9.3 item 3), not at the deadline.
      if (link.state() !== 'ready') { this.settleUnknown(ref, 'link_lost'); return }
      // A relative deadline on this side's own clock (§5.4); the hub never cancels on it.
      f.timer = setTimeout(() => this.settleUnknown(ref, 'deadline'), timeout)
    })
  }

  private startLink(host: HostInfo, lineage: string): void {
    const { deps } = this
    let priv: ReturnType<typeof loadSeatPrivate>
    try { priv = loadSeatPrivate(deps.paths) } catch {
      this.ledger({ event: 'seat_key_unreadable', lineage })
      return
    }
    const entrypoint = this.interactive.ok ? this.interactive.entrypoint : labelOf(deps.env.CLAUDE_CODE_ENTRYPOINT)
    const harness = LABEL_TOKEN_RE.test(basename(host.comm)) ? basename(host.comm) : 'claude'
    this.link = new LinkClient({
      sockPath: deps.paths.hubSock,
      attach: (): AttachMsg => ({
        t: 'attach', v: 1, lineage, harness, entrypoint, folder: this.folder!, pipe_build: deps.installed.build,
        tools_digest: this.tools!.digest, clock: deps.now().toISOString(),
      }),
      sign: (nonce) => signSeat(priv, deps.installed.device, deps.user, lineage, nonce),
      mono: deps.mono,
      rand: deps.rand,
      // The same host process, by pid and start time, from the same table the lineage came from (P40).
      hostAlive: () => {
        const r = deps.table()?.get(host.pid)
        return r !== undefined && r.started_at === host.lstart
      },
      on: {
        ready: (r) => this.onReady(r),
        result: (r) => this.onResult(r),
        tools: (t) => this.onTools(t),
        knockReport: () => {},
        notice: (n) => this.onNotice(n),
        refused: () => {},
        lost: () => this.onLost(),
      },
      connect: deps.connect ?? bunConnect,
      reattachMs: scaled(TIMING.reattachMs, deps.env),
      staleMs: scaled(TIMING.staleMs, deps.env),
      stepMs: scaled(TIMING.handshakeStepMs, deps.env),
    })
    this.link.start()
  }

  private onReady(r: ReadyMsg): void {
    // The hub's view of this lineage's session (P66): null when none is live, so no earlier unknown is advised for a replay.
    this.session = r.session_hint?.session_id ?? null
    if (this.tools && r.tools_digest !== this.tools.digest) this.link?.send({ t: 'tools_get', digest: r.tools_digest })
  }

  private onTools(t: ToolsMsg): void {
    const before = this.tools?.digest ?? null
    let v: ToolsVerdict
    let now: ReturnType<typeof readCurrentTools> = null
    try {
      v = acceptHubTools(this.deps.paths, { digest: t.digest, list: t.list })
      if (v.ok) now = readCurrentTools(this.deps.paths)
    } catch (e) {
      // The cache could not be written or read (a disk error, ENOSPC, a lock or permission problem): this runs inside the link's
      // socket handler, so a throw here would drop every call in flight. Keep the current list and relist as they are (§6.2
      // "otherwise it keeps its current list"). Not tools_refused: its reasons are closed and none says "could not store".
      const code = (e as { code?: unknown } | null)?.code
      this.ledger({ event: 'tools_store_failed', code: typeof code === 'string' ? code : 'unknown', lineage: this.lineage ?? undefined })
      return
    }
    if (!v.ok) {
      // Keep the current list; tell the hub once per refused digest, so its status shows the refusal (§6.2, P51).
      if (!this.refusedDigests.has(t.digest)) {
        this.refusedDigests.add(t.digest)
        this.link?.send({ t: 'tools_refused', digest: t.digest, reason: v.reason })
        this.ledger({ event: 'tools_refused', code: v.reason, lineage: this.lineage ?? undefined })
      }
      return
    }
    if (now) this.tools = now
    if (v.digest !== before) {
      this.relist = true   // calls answer hub_version_mismatch until the harness re-lists
      this.server.notifyToolsChanged()
    }
  }

  private onResult(r: ResultMsg): void {
    const f = this.inflight.get(r.call_ref)
    if (!f) {
      // P49: the agent was already told hub_outcome_unknown (or this pipe never sent it); the record stays.
      this.ledger({ event: 'late_result', call_ref: r.call_ref, outcome: r.outcome, lineage: this.lineage ?? undefined })
      return
    }
    this.inflight.delete(r.call_ref)
    if (f.timer !== null) clearTimeout(f.timer)
    if (r.outcome === 'unknown') {
      this.afterUnknown(f.tool)
      const result = r.result && deliveredOf(r.result) === 'unknown' ? r.result
        : bridgeFailure('hub_outcome_unknown', 'The Air could not settle this call; it may have taken effect.', r.call_ref)
      f.resolve(this.withPrior(result))
      return
    }
    const result = r.result!
    // A definite answer clears this call's own record. Only Collab's own answer (deliveredOf null, idempotency_conflict
    // included) settles earlier calls under the same idempotency_key, or of the same keyless tool (§9.3 items 5–7). A bridge
    // refusal (delivered:false, P50) never reached Collab, so it settles nothing about them, and their records and the
    // prior_outcome_unknown guard stay.
    const own = deliveredOf(result) === null
    if (this.key) {
      this.clearRecords(this.key, r.call_ref, own ? f.idempotencyKey : null)
      if (settlesKeyless(f.tool, result, own)) this.clearTool(this.key, f.tool)
    }
    this.afterAnswer(f.tool, result, own)
    f.resolve(this.withPrior(result))
  }

  /** P66: what an answer says about the bound session. Read before withPrior, so its prior_unknown already reflects it. */
  private afterAnswer(tool: string, r: ToolResult, own: boolean): void {
    const code = errorOf(r)
    if (code === 'seat_session_ended') { this.session = null; return }   // the credential is gone (§9.2)
    if (!own) return
    if (tool === 'collab_session_start') {
      const started = r.structuredContent?.session
      if (code === null) this.session = sessionIdOf(typeof started === 'object' && started !== null ? (started as Record<string, unknown>).id : null)
      else if (code === 'session_already_bound') this.session = sessionIdOf(r.structuredContent?.session_id)
    } else if (tool === 'collab_session_end' && (code === null || code === 'session_not_bound')) {
      this.session = null
    }
  }

  /** P66: an unknown session_end may have ended the session, an unknown session_start begun one (§9.3 item 8). */
  private afterUnknown(tool: string): void {
    if (tool === 'collab_session_end' || tool === 'collab_session_start') this.session = null
  }

  private onNotice(n: NoticeMsg): void {
    if (n.code === 'hub_lost' || n.code === 'link_closing') this.onLost()
  }

  private onLost(): void {
    for (const ref of [...this.inflight.keys()]) this.settleUnknown(ref, 'link_lost')
  }

  private cancel(requestId: JsonRpcId): void {
    for (const [ref, f] of this.inflight) {
      if (f.requestId !== requestId) continue
      // Recorded by the hub and never forwarded to a child (§9.3 item 4); the call may still take effect (K28).
      this.link?.send({ t: 'cancel', call_ref: ref })
      this.settleUnknown(ref, 'cancelled')
      return
    }
  }

  /** After the write: the call may have taken effect. The record stays until a definite answer clears it (P49). */
  private settleUnknown(ref: string, why: 'deadline' | 'link_lost' | 'cancelled' | 'stopped'): void {
    const f = this.inflight.get(ref)
    if (!f) return
    this.inflight.delete(ref)
    if (f.timer !== null) clearTimeout(f.timer)
    this.ledger({ event: 'call_unknown', call_ref: ref, tool: f.tool, code: why, lineage: this.lineage ?? undefined })
    this.afterUnknown(f.tool)
    const message = why === 'deadline' ? 'The Air did not answer in time; this call may have taken effect.'
      : why === 'cancelled' ? 'This call was cancelled after it was sent; it may have taken effect.'
      : 'The link to the Air was lost after this call was sent; it may have taken effect.'
    f.resolve(this.withPrior(bridgeFailure('hub_outcome_unknown', message, ref)))
  }

  /**
   * Clears records after a definite answer: the call's own, and with `idempotencyKey` this session's records under that key
   * (P66). A failed write keeps them: one spurious prior_unknown, never a lost result.
   */
  private clearRecords(key: string, callRef: string, idempotencyKey: string | null): void {
    try {
      clearInflight(this.deps.paths, key, callRef)
      if (idempotencyKey !== null) clearByIdempotencyKey(this.deps.paths, key, idempotencyKey, this.session)
    } catch {
      this.ledger({ event: 'inflight_unwritable', call_ref: callRef, lineage: this.lineage ?? undefined })
    }
  }

  /** Settles every record of one keyless tool (§9.3 item 7, P65); a failed write keeps them, as above. */
  private clearTool(key: string, tool: string): void {
    try { clearByTool(this.deps.paths, key, tool) } catch {
      this.ledger({ event: 'inflight_unwritable', tool, lineage: this.lineage ?? undefined })
    }
  }

  /** §9.3 item 6: every result names this lineage's unresolved calls, except the ones still in flight here. */
  private withPrior(r: ToolResult): ToolResult {
    if (!this.key) return r
    let records
    try { records = unresolved(this.deps.paths, this.key) } catch { return r }
    const prior = records.filter((x) => !this.inflight.has(x.call_ref))
      .map((x) => ({ call_ref: x.call_ref, tool: x.tool, idempotency_key: x.idempotency_key, session_ended: isStale(x, this.session) }))
    return withPriorUnknown(r, prior)
  }

  private ledger(f: LedgerFields): void {
    try { appendLedger(this.deps.paths.ledger, NUANCE_LEDGER_KEYS, f, this.deps.now().getTime()) } catch { /* the ledger never breaks a call */ }
  }
}

/** The `pipe` verb's body: stdin lines into the local MCP server until EOF, then stop, exit 0. */
export async function runPipe(deps: PipeDeps): Promise<number> {
  const pipe = new Pipe(deps)
  await pipe.start()
  const reader = new LineReader(PIPE_STDIN_MAX_LINE)
  const handling = new Set<Promise<void>>()
  const handle = (line: string) => {
    // Lines are handled concurrently: a 150 s claim never holds up a ping or another call.
    const p: Promise<void> = pipe.handleLine(line).catch(() => {}).finally(() => { handling.delete(p) })
    handling.add(p)
  }
  const src = deps.stdin.getReader()
  try {
    for (;;) {
      const { done, value } = await src.read()
      if (done) break
      let lines: string[]
      try {
        lines = reader.push(value)
      } catch (e) {
        if (!(e instanceof LineTooLong)) throw e
        // No id can be read from it and nothing was sent; Claude's own entry timeout ends that call.
        try { appendLedger(deps.paths.ledger, NUANCE_LEDGER_KEYS, { event: 'stdin_too_long', bytes: e.bytes }, deps.now().getTime()) } catch { /* best effort */ }
        lines = e.lines
      }
      for (const line of lines) handle(line)
    }
  } catch { /* a broken stdin ends the pipe like EOF */ }
  await pipe.stop()
  await Promise.all([...handling])
  return 0
}
