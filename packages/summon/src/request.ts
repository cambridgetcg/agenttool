import { randomBytes } from 'node:crypto'

export const MAX_PROMPT_BYTES = 128 * 1024
export const MAX_START_STDIN_BYTES = 160 * 1024
export const CLOCK_SKEW_MS = 5 * 60_000
export const MAX_ADMISSION_MS = 24 * 3_600_000
export const ID_RE = /^smn_[0-9a-f]{32}$/
export const DEVICE_RE = /^[a-z][a-z0-9-]{0,31}$/
const TOKEN_RE = /^[A-Za-z0-9._:-]{1,64}$/
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
export const RUNTIMES = ['claude', 'codex', 'hermes'] as const
/** What `claude --help` (2.1.296) lists for `--effort <level>`. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Runtime = (typeof RUNTIMES)[number]
export type Access = 'review' | 'edit'

export interface SummonOrigin { harness?: string; pid?: number; started_at?: string }
export interface SummonRequest {
  v: 1
  id: string
  from_device: string
  to_device: string
  issued_at: string
  expires_at: string
  runtime: Runtime
  mode: 'job'
  model?: string
  provider?: string
  effort?: string
  cwd: string
  access: Access
  timeout_s: number
  label?: string
  origin?: SummonOrigin
  prompt: string
}

const KEYS = new Set(['v', 'id', 'from_device', 'to_device', 'issued_at', 'expires_at', 'runtime', 'mode',
  'model', 'provider', 'effort', 'cwd', 'access', 'timeout_s', 'label', 'origin', 'prompt'])
const ORIGIN_KEYS = new Set(['harness', 'pid', 'started_at'])

export type Invalid = { ok: false; reason: 'malformed' | 'too_large'; detail: string }
export type Valid = { ok: true; request: SummonRequest }
const bad = (reason: Invalid['reason'], detail: string): Invalid => ({ ok: false, reason, detail })

/** smn_ + 32 hex: 48-bit ms timestamp, version 7, variant 10xx, random. */
export function newRequestId(nowMs: number = Date.now()): string {
  const ts = nowMs.toString(16).padStart(12, '0').slice(-12)
  const r = randomBytes(10).toString('hex')
  const variant = ((parseInt(r[3]!, 16) & 0x3) | 0x8).toString(16)
  return `smn_${ts}7${r.slice(0, 3)}${variant}${r.slice(4, 19)}`
}

/** RFC 3339 UTC; a calendar date that Date would roll over (2026-02-31) is refused, not normalised. */
export const isIsoUtc = (s: unknown): s is string => {
  if (typeof s !== 'string' || !ISO_UTC_RE.test(s)) return false
  const ms = Date.parse(s)
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === s.slice(0, 19)
}
const hasControl = (s: string) => /[\u0000-\u001f\u007f]/.test(s)

export function validateRequest(raw: string): Valid | Invalid {
  if (Buffer.byteLength(raw, 'utf8') > MAX_START_STDIN_BYTES) return bad('too_large', 'request exceeds 160 KiB')
  let j: any
  try { j = JSON.parse(raw) } catch { return bad('malformed', 'not JSON') }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return bad('malformed', 'not an object')
  for (const k of Object.keys(j)) if (!KEYS.has(k)) return bad('malformed', `unknown field: ${k.slice(0, 40)}`)
  if (j.v !== 1) return bad('malformed', 'v must be 1')
  if (typeof j.id !== 'string' || !ID_RE.test(j.id)) return bad('malformed', 'id')
  if (typeof j.from_device !== 'string' || !DEVICE_RE.test(j.from_device)) return bad('malformed', 'from_device')
  if (typeof j.to_device !== 'string' || !DEVICE_RE.test(j.to_device)) return bad('malformed', 'to_device')
  if (!isIsoUtc(j.issued_at) || !isIsoUtc(j.expires_at)) return bad('malformed', 'issued_at/expires_at must be RFC 3339 UTC')
  if (!(RUNTIMES as readonly string[]).includes(j.runtime)) return bad('malformed', 'runtime')
  if (j.mode !== 'job') return bad('malformed', 'mode must be job in Phase 0')
  for (const k of ['model', 'provider', 'effort'] as const) {
    if (j[k] !== undefined && (typeof j[k] !== 'string' || !TOKEN_RE.test(j[k]))) return bad('malformed', k)
  }
  if (typeof j.cwd !== 'string' || j.cwd.length === 0 || j.cwd.length > 1024 || hasControl(j.cwd)
    || !(j.cwd === '~' || j.cwd.startsWith('~/') || j.cwd.startsWith('/'))) return bad('malformed', 'cwd')
  if (j.access !== 'review' && j.access !== 'edit') return bad('malformed', 'access')
  if (!Number.isInteger(j.timeout_s) || j.timeout_s < 1 || j.timeout_s > 86_400) return bad('malformed', 'timeout_s')
  if (j.label !== undefined && (typeof j.label !== 'string' || j.label.length > 120 || hasControl(j.label))) return bad('malformed', 'label')
  if (j.origin !== undefined) {
    const o = j.origin
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return bad('malformed', 'origin')
    for (const k of Object.keys(o)) if (!ORIGIN_KEYS.has(k)) return bad('malformed', 'origin field')
    if (o.harness !== undefined && (typeof o.harness !== 'string' || !TOKEN_RE.test(o.harness))) return bad('malformed', 'origin.harness')
    if (o.pid !== undefined && !Number.isInteger(o.pid)) return bad('malformed', 'origin.pid')
    if (o.started_at !== undefined && (typeof o.started_at !== 'string' || o.started_at.length > 64)) return bad('malformed', 'origin.started_at')
  }
  if (typeof j.prompt !== 'string' || j.prompt.length === 0 || j.prompt.includes('\u0000')) return bad('malformed', 'prompt')
  if (Buffer.byteLength(j.prompt, 'utf8') > MAX_PROMPT_BYTES) return bad('too_large', 'prompt exceeds 128 KiB')
  return { ok: true, request: j as SummonRequest }
}

export type TimingOk = { ok: true; expiresAtMs: number; timeoutS: number }
export type TimingBad = { ok: false; reason: 'expired' | 'clock'; detail: string }

/** Expiry, ±5 min skew, admission clamped to 24 h, job timeout clamped to the allowlist's max. */
export function checkTiming(req: SummonRequest, nowMs: number, jobTimeoutMaxS: number): TimingOk | TimingBad {
  const issued = Date.parse(req.issued_at)
  const expires = Date.parse(req.expires_at)
  const clocks = `target ${new Date(nowMs).toISOString()}, request issued ${req.issued_at}`
  if (issued - nowMs > CLOCK_SKEW_MS) return { ok: false, reason: 'clock', detail: clocks }
  const effective = Math.min(expires, issued + MAX_ADMISSION_MS)
  if (effective <= issued || nowMs > effective + CLOCK_SKEW_MS) {
    return { ok: false, reason: 'expired', detail: `expired at ${new Date(effective).toISOString()}; ${clocks}` }
  }
  return { ok: true, expiresAtMs: effective, timeoutS: Math.min(req.timeout_s, jobTimeoutMaxS) }
}
