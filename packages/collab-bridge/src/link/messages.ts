// collab-bridge/1 messages (spec §5.4): each DATA frame carries exactly one UTF-8 JSON object with a `t` field.
// Every parser takes an already-decoded object, checks each field it knows, and returns a fresh object holding only
// those fields: unknown keys are dropped (a newer peer may add some), and nothing unchecked travels further.
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

export const LINEAGE_RE = /^lin_[0-9a-f]{32}$/
export const CALL_REF_RE = /^(lin_[0-9a-f]{32}):([0-9a-f]{8}):(0|[1-9][0-9]{0,15})$/
export const CHALLENGE_NONCE_RE = /^[0-9a-f]{64}$/
export const RELAY_NONCE_RE = /^[0-9a-f]{32}$/
export const START_NONCE_RE = /^[0-9a-f]{16}$/
export const DIGEST_RE = /^[0-9a-f]{64}$/
export const BUILD_RE = /^[0-9a-f]{8}$/
export const SIG_RE = /^[0-9a-f]{128}$/
export const LABEL_TOKEN_RE = /^[A-Za-z0-9._-]{1,32}$/
export const ORIGIN_RE = /^(air|[a-z0-9-]{1,32}\/[a-z0-9._-]{1,32})$/
export const MAX_ATTACH_BYTES = 2048, MAX_HANDSHAKE_BYTES = 1024
export const MAX_PIPE_TO_HUB = 2 * 1024 * 1024, MAX_HUB_TO_PIPE = 4 * 1024 * 1024
export const MAX_FOLDER_BYTES = 1019, MAX_KNOCKS_MS = 2000, MAX_KNOCK_COUNT = 999

export interface ToolDef { name: string; description?: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> }
export interface ToolResult { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean }
export interface Declared { head: string; branch: string | null; dirty: boolean }
export type RefusedCode = 'frame_too_large' | 'hub_away' | 'lineage_cap' | 'seat_session_ended' | 'folder_not_shared' | 'seat_proof_failed'
export interface AttachMsg { t: 'attach'; v: 1; lineage: string; harness: string; entrypoint: string; folder: string; pipe_build: string; tools_digest: string; clock: string }
export interface ChallengeMsg { t: 'challenge'; nonce: string }
export interface ProveMsg { t: 'prove'; sig: string }
export interface ReadyMsg { t: 'ready'; tools_digest: string; hub_build: string; skew_s: number; session_hint: { session_id: string; workspace_id: string } | null }
export interface RefusedMsg { t: 'refused'; code: RefusedCode }
export interface CallMsg { t: 'call'; call_ref: string; name: string; arguments: Record<string, unknown>; timeout_ms: number; declared?: Declared }
export interface CancelMsg { t: 'cancel'; call_ref: string }
export interface ResultMsg { t: 'result'; call_ref: string; outcome: 'ok' | 'error' | 'unknown'; result?: ToolResult }
export interface ToolsGetMsg { t: 'tools_get'; digest: string }
export interface ToolsMsg { t: 'tools'; digest: string; list: ToolDef[] }
export type ToolsRefusedReason = 'digest_format' | 'digest_mismatch' | 'unknown_tool' | 'no_seed'
export interface ToolsRefusedMsg { t: 'tools_refused'; digest: string; reason: ToolsRefusedReason }   // pipe → hub, after ready (P51)
export interface KnocksMsg { t: 'knocks'; timeout_ms: number }                 // pipe → hub, timeout_ms 1..2000
export interface TapKnocksMsg { t: 'knocks' }                                  // tap → pipe
export type HubKnockReportMsg = { t: 'knock_report'; count: number; origins: string[]; seqs: number[] } | { t: 'knock_report'; expired: true }
export interface TapKnockReportMsg { t: 'knock_report'; count: number; origins: string[] }
export interface NoticeMsg { t: 'notice'; code: 'hub_lost' | 'collab_build_changed' | 'link_closing' }
export interface RelayReplacedMsg { t: 'relay_replaced' }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const matches = (v: unknown, re: RegExp): v is string => typeof v === 'string' && re.test(v)
const intIn = (v: unknown, lo: number, hi: number): v is number => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi
const msgOf = (o: unknown, t: string): Obj | null => (isObj(o) && o.t === t ? o : null)

// Collab's session id shape (KN src/host.ts:481), at most 200 characters; workspace ids fit it too.
const COLLAB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
// MCP tool names: 1-128 of A-Z a-z 0-9 _ - . (Collab's are collab_*).
const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/
// A commit id from rev-parse: SHA-1 or SHA-256 repositories.
const HEAD_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
// Date.prototype.toISOString's form; Date.parse must also accept it.
const ISO_CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
// A digest the pipe may yet refuse (`digest_format`), so it can name it back in tools_refused: printable ASCII, no space.
const LOOSE_DIGEST_RE = /^[\x21-\x7e]{1,64}$/
const CONTROL_RE = /[\x00-\x1f\x7f]/
const BRANCH_RE = /^[^\x00-\x1f\x7f]{1,255}$/
// The hub's ceiling toward a child (§9.3 item 4); no pipe deadline is longer.
const MAX_CALL_TIMEOUT_MS = 600_000
const MAX_TOOLS = 256
const MAX_SEQS = 999
const MAX_ORIGINS = 3
const REFUSED_CODES: ReadonlySet<string> = new Set(['frame_too_large', 'hub_away', 'lineage_cap', 'seat_session_ended', 'folder_not_shared', 'seat_proof_failed'])
const NOTICE_CODES: ReadonlySet<string> = new Set(['hub_lost', 'collab_build_changed', 'link_closing'])
const OUTCOMES: ReadonlySet<string> = new Set(['ok', 'error', 'unknown'])
const TOOLS_REFUSED_REASONS: ReadonlySet<string> = new Set(['digest_format', 'digest_mismatch', 'unknown_tool', 'no_seed'])

const isClock = (v: unknown): v is string => matches(v, ISO_CLOCK_RE) && Number.isFinite(Date.parse(v))
const isOrigins = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MAX_ORIGINS && v.every((o) => matches(o, ORIGIN_RE))

const utf8 = new TextEncoder()
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

export function encodeMessage(m: { t: string }): Uint8Array {
  return utf8.encode(JSON.stringify(m))
}

export function decodeJson(payload: Uint8Array): Record<string, unknown> | null {
  let text: string
  try { text = strictUtf8.decode(payload) } catch { return null }
  let v: unknown
  try { v = JSON.parse(text) } catch { return null }
  return isObj(v) && typeof v.t === 'string' ? v : null
}

export function parseAttach(o: unknown): AttachMsg | null {
  const m = msgOf(o, 'attach')
  if (!m || m.v !== 1) return null
  const { lineage, harness, entrypoint, folder, pipe_build, tools_digest, clock } = m
  if (!matches(lineage, LINEAGE_RE) || !matches(harness, LABEL_TOKEN_RE) || !matches(entrypoint, LABEL_TOKEN_RE)) return null
  if (typeof folder !== 'string' || !folder.startsWith('/') || CONTROL_RE.test(folder)) return null
  if (Buffer.byteLength(folder, 'utf8') > MAX_FOLDER_BYTES) return null
  if (!matches(pipe_build, BUILD_RE) || !matches(tools_digest, DIGEST_RE) || !isClock(clock)) return null
  return { t: 'attach', v: 1, lineage, harness, entrypoint, folder, pipe_build, tools_digest, clock }
}

export function parseChallenge(o: unknown): ChallengeMsg | null {
  const m = msgOf(o, 'challenge')
  return m && matches(m.nonce, CHALLENGE_NONCE_RE) ? { t: 'challenge', nonce: m.nonce } : null
}

export function parseProve(o: unknown): ProveMsg | null {
  const m = msgOf(o, 'prove')
  return m && matches(m.sig, SIG_RE) ? { t: 'prove', sig: m.sig } : null
}

export function parseReady(o: unknown): ReadyMsg | null {
  const m = msgOf(o, 'ready')
  if (!m || !matches(m.tools_digest, DIGEST_RE) || !matches(m.hub_build, BUILD_RE) || !Number.isSafeInteger(m.skew_s)) return null
  const h = m.session_hint
  if (h === null) return { t: 'ready', tools_digest: m.tools_digest, hub_build: m.hub_build, skew_s: m.skew_s as number, session_hint: null }
  if (!isObj(h) || !matches(h.session_id, COLLAB_ID_RE) || !matches(h.workspace_id, COLLAB_ID_RE)) return null
  return { t: 'ready', tools_digest: m.tools_digest, hub_build: m.hub_build, skew_s: m.skew_s as number,
    session_hint: { session_id: h.session_id, workspace_id: h.workspace_id } }
}

export function parseRefused(o: unknown): RefusedMsg | null {
  const m = msgOf(o, 'refused')
  return m && typeof m.code === 'string' && REFUSED_CODES.has(m.code) ? { t: 'refused', code: m.code as RefusedCode } : null
}

function parseDeclared(v: unknown): Declared | null {
  if (!isObj(v) || !matches(v.head, HEAD_RE) || typeof v.dirty !== 'boolean') return null
  if (v.branch !== null && !matches(v.branch, BRANCH_RE)) return null
  return { head: v.head, branch: v.branch as string | null, dirty: v.dirty }
}

export function parseCall(o: unknown): CallMsg | null {
  const m = msgOf(o, 'call')
  if (!m || !matches(m.call_ref, CALL_REF_RE) || !matches(m.name, TOOL_NAME_RE) || !isObj(m.arguments)) return null
  if (!intIn(m.timeout_ms, 1, MAX_CALL_TIMEOUT_MS)) return null
  const call: CallMsg = { t: 'call', call_ref: m.call_ref, name: m.name, arguments: m.arguments, timeout_ms: m.timeout_ms }
  if (m.declared === undefined) return call
  const declared = parseDeclared(m.declared)
  return declared ? { ...call, declared } : null
}

export function parseCancel(o: unknown): CancelMsg | null {
  const m = msgOf(o, 'cancel')
  return m && matches(m.call_ref, CALL_REF_RE) ? { t: 'cancel', call_ref: m.call_ref } : null
}

function parseToolResult(v: unknown): ToolResult | null {
  if (!isObj(v) || !Array.isArray(v.content)) return null
  const content: ToolResult['content'] = []
  for (const c of v.content) {
    if (!isObj(c) || c.type !== 'text' || typeof c.text !== 'string') return null
    content.push({ type: 'text', text: c.text })
  }
  if (v.structuredContent !== undefined && !isObj(v.structuredContent)) return null
  if (v.isError !== undefined && typeof v.isError !== 'boolean') return null
  return { content, ...(v.structuredContent !== undefined ? { structuredContent: v.structuredContent } : {}),
    ...(v.isError !== undefined ? { isError: v.isError } : {}) }
}

/** `ok` and `error` are definite and carry the result; `error` is an isError result (Collab's own failure or a hub
 *  refusal, P50), `ok` is not; `unknown` may carry the hub's hub_outcome_unknown result or nothing. */
export function parseResult(o: unknown): ResultMsg | null {
  const m = msgOf(o, 'result')
  if (!m || !matches(m.call_ref, CALL_REF_RE) || typeof m.outcome !== 'string' || !OUTCOMES.has(m.outcome)) return null
  const outcome = m.outcome as ResultMsg['outcome']
  if (m.result === undefined) return outcome === 'unknown' ? { t: 'result', call_ref: m.call_ref, outcome } : null
  const result = parseToolResult(m.result)
  if (!result) return null
  if (outcome === 'ok' && result.isError === true) return null
  if (outcome === 'error' && result.isError !== true) return null
  return { t: 'result', call_ref: m.call_ref, outcome, result }
}

export function parseToolsGet(o: unknown): ToolsGetMsg | null {
  const m = msgOf(o, 'tools_get')
  return m && matches(m.digest, DIGEST_RE) ? { t: 'tools_get', digest: m.digest } : null
}

export function parseToolDef(v: unknown): ToolDef | null {
  if (!isObj(v) || !matches(v.name, TOOL_NAME_RE) || !isObj(v.inputSchema)) return null
  if (v.description !== undefined && typeof v.description !== 'string') return null
  if (v.annotations !== undefined && !isObj(v.annotations)) return null
  // The four fields a seat tool has (P27); anything else (a title, an outputSchema) is dropped here.
  return { name: v.name, ...(v.description !== undefined ? { description: v.description } : {}), inputSchema: v.inputSchema,
    ...(v.annotations !== undefined ? { annotations: v.annotations } : {}) }
}

/** The digest is only shape-checked here: the pipe recomputes it and refuses a mismatch or a bad format itself. */
export function parseTools(o: unknown): ToolsMsg | null {
  const m = msgOf(o, 'tools')
  if (!m || !matches(m.digest, LOOSE_DIGEST_RE) || !Array.isArray(m.list) || m.list.length > MAX_TOOLS) return null
  const list: ToolDef[] = []
  for (const t of m.list) {
    const def = parseToolDef(t)
    if (!def) return null
    list.push(def)
  }
  return { t: 'tools', digest: m.digest, list }
}

export function parseToolsRefused(o: unknown): ToolsRefusedMsg | null {
  const m = msgOf(o, 'tools_refused')
  if (!m || !matches(m.digest, LOOSE_DIGEST_RE) || typeof m.reason !== 'string' || !TOOLS_REFUSED_REASONS.has(m.reason)) return null
  return { t: 'tools_refused', digest: m.digest, reason: m.reason as ToolsRefusedReason }
}

export function parseKnocks(o: unknown): KnocksMsg | null {
  const m = msgOf(o, 'knocks')
  return m && intIn(m.timeout_ms, 1, MAX_KNOCKS_MS) ? { t: 'knocks', timeout_ms: m.timeout_ms } : null
}

export function parseHubKnockReport(o: unknown): HubKnockReportMsg | null {
  const m = msgOf(o, 'knock_report')
  if (!m) return null
  if (m.expired !== undefined) return m.expired === true ? { t: 'knock_report', expired: true } : null
  if (!intIn(m.count, 0, MAX_KNOCK_COUNT) || !isOrigins(m.origins)) return null
  const seqs = m.seqs
  if (!Array.isArray(seqs) || seqs.length > MAX_SEQS || !seqs.every((s) => intIn(s, 0, Number.MAX_SAFE_INTEGER))) return null
  return { t: 'knock_report', count: m.count, origins: [...m.origins], seqs: [...seqs] as number[] }
}

export function parseTapKnockReport(o: unknown): TapKnockReportMsg | null {
  const m = msgOf(o, 'knock_report')
  if (!m || !intIn(m.count, 0, MAX_KNOCK_COUNT) || !isOrigins(m.origins)) return null
  return { t: 'knock_report', count: m.count, origins: [...m.origins] }
}

export function parseNotice(o: unknown): NoticeMsg | null {
  const m = msgOf(o, 'notice')
  return m && typeof m.code === 'string' && NOTICE_CODES.has(m.code) ? { t: 'notice', code: m.code as NoticeMsg['code'] } : null
}

/** What a seat signs (§5.4 prove). device and user come from the Air's device file and the ssh login, lineage and
 *  nonce from their own patterns, so none of them can hold a `|`. */
export function seatMessage(device: string, user: string, lineage: string, nonce: string): string {
  return `collab-bridge-seat/1|${device}|${user}|${lineage}|${nonce}`
}

export function callRefLineage(callRef: string): string | null {
  if (typeof callRef !== 'string') return null
  const m = CALL_REF_RE.exec(callRef)
  return m ? m[1]! : null
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex')
export function newLineage(): string { return `lin_${hex(16)}` }
export function newPipeInstance(): string { return hex(4) }
export function newRelayNonce(): string { return hex(16) }
export function newStartNonce(): string { return hex(8) }
export function newChallengeNonce(): string { return hex(32) }
