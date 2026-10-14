// The hub's knock read for one remote session (spec §8 items 3–4, R22). It runs C10's session-addressed read on the
// shared journal through the installed host CLI, which marks what it reports in Collab's own knock ledger beside that
// journal, so a note taps once. The hub never reads `waiting` and never trusts `from_actor`: the count is the `new`
// items, and their origins come only from the senders' session ids looked up in the hub's own session index (K31, K63).
// Every doubt is count 0, which the pipe and the tap turn into silence (§8).
import { MAX_KNOCK_COUNT, ORIGIN_RE, type HubKnockReportMsg } from '../link/messages.ts'
import { TIMING } from '../timing.ts'
import type { HostCli } from './pool.ts'

/** The knock report's protocol (KN `src/host.ts:56`): a report in any other shape is refused, never guessed at. */
export const COLLAB_KNOCK_PROTOCOL = 'agenttool.collab-knock/1'
/** The host CLI gets this much less than the pipe's budget, so the answer leaves the hub before the pipe stops waiting. */
export const KNOCK_CLI_MARGIN_MS = 200
const MAX_ORIGINS = 3

export interface CollabKnockItem { seq: number; kind: string; from_actor: string; ref_id: string; from_session_id?: string | null }
export interface CollabKnockReport { protocol: string; session_id: string; liveness: 'live' | 'resting' | 'stale' | 'ended';
  rest: { wake_on: string[] } | null; waiting: number; new: CollabKnockItem[] }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const LIVENESS: ReadonlySet<string> = new Set(['live', 'resting', 'stale', 'ended'])
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0

function parseItem(v: unknown): CollabKnockItem | null {
  if (!isObj(v) || !isCount(v.seq)) return null
  if (typeof v.kind !== 'string' || typeof v.from_actor !== 'string' || typeof v.ref_id !== 'string') return null
  const item: CollabKnockItem = { seq: v.seq, kind: v.kind, from_actor: v.from_actor, ref_id: v.ref_id }
  if (Object.hasOwn(v, 'from_session_id')) {
    if (v.from_session_id !== null && typeof v.from_session_id !== 'string') return null
    item.from_session_id = v.from_session_id
  }
  return item
}

/** The one line `knocks --session` prints, or null for silence (no line), a second line, or any field out of shape. */
export function parseKnockReport(line: string): CollabKnockReport | null {
  const text = line.trim()
  if (text === '' || text.includes('\n')) return null
  let v: unknown
  try { v = JSON.parse(text) } catch { return null }
  if (!isObj(v) || v.protocol !== COLLAB_KNOCK_PROTOCOL || typeof v.session_id !== 'string') return null
  if (typeof v.liveness !== 'string' || !LIVENESS.has(v.liveness) || !isCount(v.waiting) || !Array.isArray(v.new)) return null
  let rest: { wake_on: string[] } | null = null
  if (v.rest !== null) {
    if (!isObj(v.rest) || !Array.isArray(v.rest.wake_on) || !v.rest.wake_on.every((w) => typeof w === 'string')) return null
    rest = { wake_on: [...(v.rest.wake_on as string[])] }
  }
  const items: CollabKnockItem[] = []
  for (const x of v.new) {
    const item = parseItem(x)
    if (!item) return null
    items.push(item)
  }
  return { protocol: COLLAB_KNOCK_PROTOCOL, session_id: v.session_id, liveness: v.liveness as CollabKnockReport['liveness'],
    rest, waiting: v.waiting, new: items }
}

/** A sender the hub stamped shows as `<device>/<user>`; any other sender, or none, is `air` (§8 item 4). An index entry
 *  that would not make a valid origin is dropped, never shown as `air`, which would name the wrong Mac. */
function originOf(item: CollabKnockItem, index: Map<string, { device: string; user: string }>): string | null {
  const sender = typeof item.from_session_id === 'string' ? index.get(item.from_session_id) : undefined
  if (!sender) return 'air'
  const origin = `${sender.device}/${sender.user}`
  return ORIGIN_RE.test(origin) ? origin : null
}

/**
 * Count 0 when the report is null, when the session ended (defence only: C10 reports only active sessions), when it rests
 * without consenting to addressed wakes (every remote rest in Phase 1, R29), or when nothing is new. Otherwise count is the
 * number of `new` items (at most 999), seqs are theirs (P41), and origins come from those same items, deduplicated, at most 3.
 */
export function mapKnock(r: CollabKnockReport | null, index: Map<string, { device: string; user: string }>): { count: number; origins: string[]; seqs: number[] } {
  const none = { count: 0, origins: [] as string[], seqs: [] as number[] }
  if (r === null || r.liveness === 'ended' || r.new.length === 0) return none
  if (r.liveness === 'resting' && !(r.rest?.wake_on.includes('addressed') ?? false)) return none
  const items = r.new.slice(0, MAX_KNOCK_COUNT)
  const origins: string[] = []
  for (const item of items) {
    if (origins.length >= MAX_ORIGINS) break
    const origin = originOf(item, index)
    if (origin !== null && !origins.includes(origin)) origins.push(origin)
  }
  return { count: items.length, origins, seqs: items.map((i) => i.seq) }
}

/** C10's read (§8 item 3): the session by id, marking what it reports, with each item's sender, on the shared journal. */
export function knocksArgs(sessionId: string, journal: string): string[] {
  return ['knocks', '--session', sessionId, '--mark-tapped', '--with-sender', '--db', journal]
}

/**
 * `timeoutMs` is what remains of the pipe's knocks budget on the hub's clock. Under 1 s the read never starts, so nothing
 * is marked (§8 item 3); otherwise the host CLI gets 200 ms less, and a failed, timed-out or unparsable run, or a report
 * about another session, is count 0.
 */
export async function knockReportFor(sessionId: string, timeoutMs: number,
  o: { hostCli: HostCli; journal: string; index(): Map<string, { device: string; user: string }> }): Promise<HubKnockReportMsg> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < TIMING.knocksMinRemainingMs) return { t: 'knock_report', expired: true }
  const quiet: HubKnockReportMsg = { t: 'knock_report', count: 0, origins: [], seqs: [] }
  const budget = Math.min(timeoutMs, TIMING.knocksMaxMs) - KNOCK_CLI_MARGIN_MS
  try {
    const run = await o.hostCli(knocksArgs(sessionId, o.journal), budget)
    if (run.code !== 0) return quiet
    const report = parseKnockReport(run.stdout)
    if (report !== null && report.session_id !== sessionId) return quiet
    return { t: 'knock_report', ...mapKnock(report, o.index()) }
  } catch {
    return quiet
  }
}
