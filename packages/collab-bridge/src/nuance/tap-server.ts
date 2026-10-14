// The pipe's tap socket (spec §8 items 1, 2 and 5): pipes/<host_pid>-<pipe_pid>.sock, 0600 in the 0700 pipes dir, with
// the .json record beside it so the hook can find the one pipe of its own Claude. One exchange per connection: the tap
// sends DATA {t:'knocks'}; the pipe answers DATA knock_report and then CLOSE when there is something to show, else CLOSE
// alone, which means silence. The answering side always ends the exchange (P18: under Bun a reply after a node:net
// client's end() is lost, F9). Notes the hook could not show go back to the pipe's pending set and show once, later.
import { chmodSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { encodeFrame, FRAME_TYPE, FrameDecoder } from '../link/frame.ts'
import { decodeJson, encodeMessage, MAX_HANDSHAKE_BYTES, MAX_KNOCK_COUNT, ORIGIN_RE, type TapKnockReportMsg } from '../link/messages.ts'
import { socketPathOk, type NuancePaths } from '../paths.ts'
import { pidAlive } from '../proc.ts'
import { TIMING } from '../timing.ts'
import type { HostInfo } from './lineage.ts'
import { writePipeRecord } from './pipe-record.ts'
import { listenPrivate } from './unix.ts'

/** What a tap may show: a count of distinct notes, their origins (at most 3), and the seqs, so a report can be merged again. */
export interface KnockShow { count: number; origins: string[]; seqs: number[] }

/** Knock reports the agent has not seen yet (§8 item 5): merged by seq, bounded, dropped after collab_next or cursor_ack. */
export interface PendingKnocks { add(r: { seqs: number[]; origins: string[] }): void; take(): KnockShow | null; clear(): void; size(): number }

const MAX_ORIGINS = 3

export function makePendingKnocks(maxSeqs: number = MAX_KNOCK_COUNT): PendingKnocks {
  const seqs = new Set<number>()
  let origins: string[] = []
  return {
    add(r) {
      for (const s of r.seqs) {
        if (seqs.size >= maxSeqs) break
        if (Number.isSafeInteger(s) && s >= 0) seqs.add(s)
      }
      for (const o of r.origins) if (ORIGIN_RE.test(o) && !origins.includes(o) && origins.length < MAX_ORIGINS) origins.push(o)
    },
    take() {
      if (seqs.size === 0) return null
      const out: KnockShow = { count: seqs.size, origins: [...origins], seqs: [...seqs].sort((a, b) => a - b) }
      seqs.clear()
      origins = []
      return out
    },
    clear() { seqs.clear(); origins = [] },
    size: () => seqs.size,
  }
}

export interface TapServerDeps {
  paths: NuancePaths; host: HostInfo; pipePid: number; lineage(): string | null; state(): string; refused(): string | null
  ask(budgetMs: number): Promise<{ count: number; origins: string[]; seqs?: number[] } | null>
  /** A report the hook could not be given (its connection closed, or the write failed): back into the pending set. */
  giveBack?(r: { count: number; origins: string[]; seqs?: number[] }): void
}

interface Conn { dec: FrameDecoder; asked: boolean; closed: boolean }
type Sock = { data: Conn; write(b: Uint8Array): number; end(): void }

const SOCK_NAME_RE = /^([1-9][0-9]{0,9})-([1-9][0-9]{0,9})\.(sock|json)$/

export class TapServer {
  private server: { stop(closeActive?: boolean): void } | null = null
  private readonly sockPath: string
  private readonly jsonPath: string
  private readonly onExit = () => this.unlinkFiles()
  private readonly onTerm = () => process.exit(143)   // 'exit' then runs onExit
  private readonly onInt = () => process.exit(130)

  constructor(private readonly deps: TapServerDeps) {
    this.sockPath = deps.paths.pipeSock(deps.host.pid, deps.pipePid)
    this.jsonPath = deps.paths.pipeJson(deps.host.pid, deps.pipePid)
  }

  async start(): Promise<void> {
    const { paths } = this.deps
    mkdirSync(paths.pipes, { recursive: true, mode: 0o700 })
    chmodSync(paths.pipes, 0o700)
    this.removeDeadSiblings()
    if (!socketPathOk(this.sockPath)) throw new Error('tap socket path is longer than 103 bytes')   // P16, F7
    // listenPrivate unlinks the name first (a stale file of ours would fail EADDRINUSE, F8), binds under umask 0177 and
    // chmods 0600 (P17).
    this.server = listenPrivate<Conn>(this.sockPath, {
      open: (s) => { s.data = { dec: new FrameDecoder(MAX_HANDSHAKE_BYTES), asked: false, closed: false } },
      data: (s, chunk) => this.onData(s as unknown as Sock, chunk),
      close: (s) => { if (s.data) s.data.closed = true },
      error: (s) => { if (s.data) s.data.closed = true },
    }, { replace: false }).server
    this.writeJson()
    process.on('exit', this.onExit)
    process.on('SIGTERM', this.onTerm)
    process.on('SIGINT', this.onInt)
  }

  stop(): void {
    process.off('exit', this.onExit)
    process.off('SIGTERM', this.onTerm)
    process.off('SIGINT', this.onInt)
    try { this.server?.stop(true) } catch { /* already stopped */ }
    this.server = null
    this.unlinkFiles()
  }

  /** Rewrites pipes/<host_pid>-<pipe_pid>.json with the pipe's lineage, link state and latest refusal (for status, Task 24). */
  writeJson(): void {
    if (this.server === null) return
    const { deps } = this
    try {
      writePipeRecord(deps.paths, { v: 1, host_pid: deps.host.pid, host_lstart: deps.host.lstart, pipe_pid: deps.pipePid,
        lineage: deps.lineage(), state: deps.state(), refused: deps.refused() })
    } catch { /* a record the tap cannot read only means silence */ }
  }

  /** P61: a SIGKILLed pipe of this same host left its files (F8); two records for one host would silence every tap (§8 item 2). */
  private removeDeadSiblings(): void {
    const { paths, host, pipePid } = this.deps
    let names: string[]
    try { names = readdirSync(paths.pipes) } catch { return }
    for (const name of names) {
      const m = SOCK_NAME_RE.exec(name)
      if (!m || Number(m[1]) !== host.pid) continue
      const pid = Number(m[2])
      if (pid === pipePid || pidAlive(pid)) continue
      try { unlinkSync(join(paths.pipes, name)) } catch { /* raced */ }
    }
  }

  private unlinkFiles(): void {
    for (const p of [this.sockPath, this.jsonPath]) try { unlinkSync(p) } catch { /* gone */ }
  }

  private onData(s: Sock, chunk: Uint8Array): void {
    const c = s.data
    if (c.asked) return   // one exchange per connection
    let frames
    try { frames = c.dec.push(chunk) } catch { c.asked = true; return this.close(s) }
    for (const f of frames) {
      if (f.type === FRAME_TYPE.CLOSE) { c.asked = true; return this.close(s) }
      if (f.type !== FRAME_TYPE.DATA) continue
      c.asked = true
      const m = decodeJson(f.payload)
      if (!m || m.t !== 'knocks') return this.close(s)
      void this.exchange(s)
      return
    }
  }

  private async exchange(s: Sock): Promise<void> {
    let r: { count: number; origins: string[]; seqs?: number[] } | null = null
    try { r = await this.deps.ask(TIMING.tapAskMs) } catch { r = null }
    if (r === null || r.count <= 0) return this.close(s)
    // §8 item 5: the hook's budget ran out before the answer, so the report is kept for the next tap.
    if (s.data.closed) { this.deps.giveBack?.(r); return }
    const report: TapKnockReportMsg = { t: 'knock_report', count: r.count, origins: r.origins }
    const bytes = encodeFrame(FRAME_TYPE.DATA, 0, encodeMessage(report))
    let n = -1
    try { n = s.write(bytes) } catch { n = -1 }
    if (n !== bytes.byteLength) {
      this.deps.giveBack?.(r)
      try { s.end() } catch { /* gone */ }
      return
    }
    this.close(s)
  }

  private close(s: Sock): void {
    try { s.write(encodeFrame(FRAME_TYPE.CLOSE, 0)) } catch { /* gone */ }
    try { s.end() } catch { /* gone */ }
  }
}
