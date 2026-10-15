// The knock tap (C5, spec §8 items 2 and 6): Claude's UserPromptSubmit hook on Nuance. It drains the hook input, finds
// the one pipe of its own Claude by the process table and the pipes/*.json records, asks that pipe once, and prints one
// additionalContext line or nothing. It builds the line itself, only from a count of 1–999 and origins that match
// ORIGIN_RE, so neither the pipe nor a stand-in hub can put words of its own into the prompt (T5, T10). The whole hook
// has 3 s (its timeout is 5), and every error, ambiguity or delay is silence: the prompt matters more than the tap.
import { readBoundedStdin } from '../bounded-stdin.ts'
import { encodeFrame, FRAME_TYPE, FrameDecoder } from '../link/frame.ts'
import {
  decodeJson, encodeMessage, MAX_HANDSHAKE_BYTES, MAX_KNOCK_COUNT, ORIGIN_RE, parseTapKnockReport, type TapKnockReportMsg, type TapKnocksMsg,
} from '../link/messages.ts'
import { socketPathOk, type NuancePaths } from '../paths.ts'
import { ancestry, isClaudeComm, type ProcTable } from '../proc.ts'
import { TIMING } from '../timing.ts'
import { bunConnect, type Connect, type LinkSocket } from './link-client.ts'
import { readPipeRecords, type PipeRecord } from './pipe-record.ts'

/** The hook input is read and thrown away; past this it is cut off (Claude's prompt JSON is far smaller). */
export const TAP_STDIN_MAX = 1024 * 1024
const MAX_ORIGINS = 3

/** §8 item 6: the line, from an integer count of 1–999 and 1–3 distinct origins matching ORIGIN_RE; anything else is null. */
export function knockLine(count: unknown, origins: unknown): string | null {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_KNOCK_COUNT) return null
  if (!Array.isArray(origins) || origins.length < 1 || origins.length > MAX_ORIGINS) return null
  if (!origins.every((o) => typeof o === 'string' && ORIGIN_RE.test(o)) || new Set(origins).size !== origins.length) return null
  return `Collab: ${count} note(s) addressed to you are waiting (from ${origins.join(', ')}). Read them with collab_next when you choose; nothing is required.`
}

/** The Air tap's envelope (`~/.config/sol/hooks/collab-knock-tap` hook_output): nothing else is added. */
export function hookOutput(line: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: line } })
}

export interface TapDeps { paths: NuancePaths; selfPid: number; table(): ProcTable | null; stdin: ReadableStream<Uint8Array>; mono(): number; connect?: Connect; budgetMs?: number }

/**
 * §8 item 2: walking up from the tap, the nearest claude ancestor (K68) decides: exactly one live pipe record for it by
 * {host_pid, host_lstart} is the pipe; more than one, or none, is silence, and the walk never goes on to an outer claude. A
 * record's host is always the claude its pipe found by that rule, so a nested `claude -p` whose pipe has not started (or is
 * disabled) is silent rather than shown the outer seat's knocks, which its pending report would hand to the wrong agent.
 * Records of dead pipes are already skipped (P61).
 */
function pipeFor(selfPid: number, table: ProcTable, records: PipeRecord[]): PipeRecord | null {
  for (const a of ancestry(selfPid, table).slice(1)) {
    if (!isClaudeComm(a.comm)) continue
    const matching = records.filter((r) => r.host_pid === a.pid && r.host_lstart === a.started_at)
    return matching.length === 1 ? matching[0]! : null
  }
  return null
}

/** One exchange on the pipe's socket: knocks out; then a knock_report and CLOSE, or CLOSE alone (silence). */
async function ask(path: string, connect: Connect, keep: (s: LinkSocket) => void): Promise<TapKnockReportMsg | null> {
  const dec = new FrameDecoder(MAX_HANDSHAKE_BYTES)
  let report: TapKnockReportMsg | null = null
  let bad = false
  let finish!: () => void
  const done = new Promise<void>((resolve) => { finish = resolve })
  const sock = await connect(path, {
    data: (b) => {
      let frames
      try { frames = dec.push(b) } catch { bad = true; return finish() }
      for (const f of frames) {
        if (f.type === FRAME_TYPE.CLOSE) return finish()
        if (f.type !== FRAME_TYPE.DATA) continue
        const m = decodeJson(f.payload)
        const r = m ? parseTapKnockReport(m) : null
        if (r === null || report !== null) { bad = true; return finish() }   // one report, well formed, or nothing
        report = r
      }
    },
    close: () => finish(),
  })
  keep(sock)
  const knocks: TapKnocksMsg = { t: 'knocks' }
  sock.write(encodeFrame(FRAME_TYPE.DATA, 0, encodeMessage(knocks)))
  await done
  return bad ? null : report
}

/** The hook's stdout text (the envelope and a newline), or null for silence. Never throws. */
export async function runTap(deps: TapDeps): Promise<string | null> {
  const budget = deps.budgetMs ?? TIMING.tapBudgetMs
  const deadline = deps.mono() + budget
  let sock: LinkSocket | null = null
  let over = false   // once the answer is given, a late step closes what it opened and does nothing more
  let timer: ReturnType<typeof setTimeout> | undefined
  const outOfTime = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), budget) })
  const work = (async (): Promise<string | null> => {
    await readBoundedStdin(deps.stdin, TAP_STDIN_MAX)   // drained, never kept or printed
    if (over) return null
    const table = deps.table()
    if (table === null) return null
    const pipe = pipeFor(deps.selfPid, table, readPipeRecords(deps.paths))
    if (pipe === null) return null
    const path = deps.paths.pipeSock(pipe.host_pid, pipe.pipe_pid)
    if (!socketPathOk(path) || deps.mono() >= deadline) return null
    // Any connect error is silence (F2, P12): a stale socket, a missing one or a refused one look the same.
    const r = await ask(path, deps.connect ?? bunConnect, (s) => { if (over) s.end(); else sock = s })
    return r === null ? null : knockLine(r.count, r.origins)
  })().catch(() => null)
  try {
    const line = await Promise.race([work, outOfTime])
    return line === null ? null : hookOutput(line) + '\n'
  } finally {
    over = true
    clearTimeout(timer)
    try { (sock as LinkSocket | null)?.end() } catch { /* gone */ }
  }
}
