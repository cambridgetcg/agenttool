// The hub's status files (spec §9.2, P30, P52, P58): `devices/<device>.status.json` for each device's link,
// `hub.status.json` for the hub itself, and `devices/<device>.host-key-ack`, the stamp `hub doctor --ack-host-key`
// writes. `collab-bridge hub status` and `hub doctor` are other processes, so these files, not the hub's memory, are
// what they show. A status file is advisory: one that does not parse reads as none, and the next write replaces it.
import { readFileSync } from 'node:fs'
import { writeFileDurable } from '../native.ts'
import { mkdirPrivate } from '../private-dir.ts'
import type { AirPaths } from '../paths.ts'

export interface StickyWarning { kind: 'host_key_mismatch'; at: string; fingerprint: string | null }
export type DeviceWord = 'up' | 'connecting' | 'away' | 'host_key_mismatch' | 'needs_yu' | 'unpaired'
export interface DeviceStatus { device: string; word: DeviceWord; reason: string | null; since: string; hint: string | null;
  relay_contested: boolean; sticky: StickyWarning[]; refused_tools: string | null; skew_s: number | null }
export interface SeatNote { lineage: string; device: string; user: string; session_id: string | null; note: string }   // needs Ai: seat_recovery <id>, orphan_session <id>, journal_invalid, child_start_failed
export interface HubRun { started_at: string; ended_at: string | null; clean: boolean }
export interface HubStatus { word: 'running' | 'refused' | 'stopped'; code: string | null; detail: string | null; at: string;
  build: string | null; unexpected_exits: string[]; runs: HubRun[]; seats: SeatNote[] }

/** How many sticky warnings a device keeps (one per presented key), and how many hub runs and exits the hub status keeps (P58). */
export const STICKY_MAX = 8
export const HUB_RECORDS_KEPT = 20

const WORDS: ReadonlySet<string> = new Set(['up', 'connecting', 'away', 'host_key_mismatch', 'needs_yu', 'unpaired'])
const HUB_WORDS: ReadonlySet<string> = new Set(['running', 'refused', 'stopped'])

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v
const strOrNull = (v: unknown) => v === null || typeof v === 'string'
const isoOrNull = (v: unknown) => v === null || isIso(v)

function stickyOk(v: unknown): v is StickyWarning {
  return isObj(v) && v.kind === 'host_key_mismatch' && isIso(v.at) && strOrNull(v.fingerprint)
}

function parseDeviceStatus(text: string, device: string): DeviceStatus | null {
  let o: unknown
  try { o = JSON.parse(text) } catch { return null }
  if (!isObj(o) || o.device !== device || typeof o.word !== 'string' || !WORDS.has(o.word)) return null
  if (!strOrNull(o.reason) || !isIso(o.since) || !strOrNull(o.hint) || typeof o.relay_contested !== 'boolean') return null
  if (!Array.isArray(o.sticky) || !o.sticky.every(stickyOk) || !strOrNull(o.refused_tools)) return null
  if (!(o.skew_s === null || (typeof o.skew_s === 'number' && Number.isFinite(o.skew_s)))) return null
  return {
    device, word: o.word as DeviceWord, reason: o.reason as string | null, since: o.since, hint: o.hint as string | null,
    relay_contested: o.relay_contested, sticky: o.sticky as StickyWarning[], refused_tools: o.refused_tools as string | null,
    skew_s: o.skew_s as number | null,
  }
}

function seatNoteOk(v: unknown): v is SeatNote {
  return isObj(v) && typeof v.lineage === 'string' && typeof v.device === 'string' && typeof v.user === 'string'
    && strOrNull(v.session_id) && typeof v.note === 'string'
}

function runOk(v: unknown): v is HubRun {
  return isObj(v) && isIso(v.started_at) && isoOrNull(v.ended_at) && typeof v.clean === 'boolean'
}

function parseHubStatus(text: string): HubStatus | null {
  let o: unknown
  try { o = JSON.parse(text) } catch { return null }
  if (!isObj(o) || typeof o.word !== 'string' || !HUB_WORDS.has(o.word)) return null
  if (!strOrNull(o.code) || !strOrNull(o.detail) || !isIso(o.at) || !strOrNull(o.build)) return null
  if (!Array.isArray(o.unexpected_exits) || !o.unexpected_exits.every(isIso)) return null
  if (!Array.isArray(o.runs) || !o.runs.every(runOk) || !Array.isArray(o.seats) || !o.seats.every(seatNoteOk)) return null
  return {
    word: o.word as HubStatus['word'], code: o.code as string | null, detail: o.detail as string | null, at: o.at,
    build: o.build as string | null, unexpected_exits: o.unexpected_exits as string[], runs: o.runs as HubRun[], seats: o.seats as SeatNote[],
  }
}

function readText(path: string): string | null {
  try { return readFileSync(path, 'utf8') } catch { return null }
}

/**
 * One warning per presented key (a null fingerprint is its own key), at its latest time, newest last, at most
 * STICKY_MAX: a host that keeps presenting the same wrong key every minute is one warning, and an ack only covers
 * what was seen up to it (spec §5.5).
 */
export function mergeSticky(a: StickyWarning[], b: StickyWarning[]): StickyWarning[] {
  const byKey = new Map<string, StickyWarning>()
  for (const w of [...a, ...b]) {
    const key = w.fingerprint ?? ''
    const had = byKey.get(key)
    if (!had || Date.parse(w.at) > Date.parse(had.at)) byKey.set(key, { kind: 'host_key_mismatch', at: w.at, fingerprint: w.fingerprint })
  }
  return [...byKey.values()].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).slice(-STICKY_MAX)
}

/** The warnings not covered by the ack: those seen after it. With no ack, all of them. */
export function activeSticky(sticky: StickyWarning[], ackAt: string | null): StickyWarning[] {
  if (ackAt === null) return [...sticky]
  const ack = Date.parse(ackAt)
  return sticky.filter((w) => Date.parse(w.at) > ack)
}

export function readDeviceStatus(paths: AirPaths, device: string): DeviceStatus | null {
  const text = readText(paths.deviceStatus(device))
  return text === null ? null : parseDeviceStatus(text, device)
}

/**
 * Writes the device's status whole. Its sticky warnings are the union of those already in the file and those given,
 * minus every one at or before the device's ack stamp, so no writer can drop a warning Yu has not acknowledged, and none
 * can bring back one he has (spec §5.5, P52). Refuses a status that would not read back.
 */
export function writeDeviceStatus(paths: AirPaths, s: DeviceStatus): void {
  const previous = readDeviceStatus(paths, s.device)
  const sticky = activeSticky(mergeSticky(previous?.sticky ?? [], s.sticky), readHostKeyAck(paths, s.device))
  const next: DeviceStatus = { ...s, sticky }
  const text = JSON.stringify(next, null, 2) + '\n'
  if (!parseDeviceStatus(text, s.device)) throw new Error('status: refusing to write an invalid device status')
  mkdirPrivate(paths.deviceStatusDir)
  writeFileDurable(paths.deviceStatus(s.device), text, 0o600)
}

export function readHubStatus(paths: AirPaths): HubStatus | null {
  const text = readText(paths.hubStatus)
  return text === null ? null : parseHubStatus(text)
}

/** Writes the hub's status whole, keeping the last HUB_RECORDS_KEPT runs and unexpected exits (P58). */
export function writeHubStatus(paths: AirPaths, s: HubStatus): void {
  const next: HubStatus = { ...s, runs: s.runs.slice(-HUB_RECORDS_KEPT), unexpected_exits: s.unexpected_exits.slice(-HUB_RECORDS_KEPT) }
  const text = JSON.stringify(next, null, 2) + '\n'
  if (!parseHubStatus(text)) throw new Error('status: refusing to write an invalid hub status')
  mkdirPrivate(paths.stateDir)
  writeFileDurable(paths.hubStatus, text, 0o600)
}

/** The ISO time in `devices/<device>.host-key-ack`, or null when there is none or it does not parse. */
export function readHostKeyAck(paths: AirPaths, device: string): string | null {
  const text = readText(paths.hostKeyAck(device))
  if (text === null) return null
  const at = text.trim()
  return isIso(at) ? at : null
}

/** `hub doctor --ack-host-key`: every warning at or before `at` is acknowledged (P52). */
export function writeHostKeyAck(paths: AirPaths, device: string, at: string): void {
  if (!isIso(at)) throw new Error('status: an ack time must be an ISO time')
  mkdirPrivate(paths.deviceStatusDir)
  writeFileDurable(paths.hostKeyAck(device), at + '\n', 0o600)
}

/** Runs that started inside the window ending at nowMs and did not end clean (a crash never records its end, P58). */
export function uncleanRunsWithin(runs: HubRun[], nowMs: number, windowMs: number): number {
  return runs.filter((r) => {
    const t = Date.parse(r.started_at)
    return !r.clean && t >= nowMs - windowMs && t <= nowMs
  }).length
}

function wordText(d: DeviceStatus): string {
  switch (d.word) {
    case 'up': return 'up'
    case 'connecting': return d.hint ? `connecting (${d.hint})` : 'connecting'
    case 'away': return `away since ${d.since}`
    case 'host_key_mismatch': return `host_key_mismatch (retrying since ${d.since})`
    case 'needs_yu': return `needs Yu: ${d.reason ?? 'config'}`
    case 'unpaired': return 'unpaired'
  }
}

/** What `collab-bridge hub status` prints: the hub's line, then each device's lines, then the seat notes, in §9.2's words. */
export function statusLines(hub: HubStatus | null, devices: DeviceStatus[]): string[] {
  const out: string[] = []
  out.push(hub === null ? 'hub: not running' : `hub: ${hub.code ?? hub.word}${hub.detail ? ` (${hub.detail})` : ''}`)
  for (const d of devices) {
    out.push(`${d.device}: ${wordText(d)}`)
    if (d.relay_contested) out.push(`${d.device}: relay_contested`)
    for (const w of d.sticky) out.push(`${d.device}: host key mismatch seen at ${w.at}, presented ${w.fingerprint ?? 'unknown'}`)
    if (d.skew_s !== null && Math.abs(d.skew_s) > 60) out.push(`${d.device}: clock skew ${d.skew_s} s (warn)`)
    if (d.refused_tools) out.push(`${d.device}: hub tool list refused: ${d.refused_tools}`)
  }
  for (const n of hub?.seats ?? []) out.push(`${n.device}/${n.user} ${n.lineage}: ${n.note}`)
  return out
}
