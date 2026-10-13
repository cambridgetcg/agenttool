// The pipe's lineage (spec §6.2): one 128-bit id per Claude process, kept in ~/.local/state/collab-bridge/lineages/<key>.json,
// so a /mcp reconnect or a respawn under the same Claude reuses it and the hub resumes the same Collab session (R4). The same
// file holds the in-flight records of §9.3 item 6 (inflight.ts). Every change rewrites the file whole (writeFileDurable) under
// its lock file, so two pipe instances of one host never tear the file or fork the lineage.
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { withLock } from '../ledger.ts'
import { CALL_REF_RE, LABEL_TOKEN_RE, LINEAGE_RE, newLineage } from '../link/messages.ts'
import { writeFileDurable } from '../native.ts'
import type { NuancePaths } from '../paths.ts'
import { lineageKey, nearestClaude, type ProcTable } from '../proc.ts'
import type { Env } from '../sysbin.ts'
import { TIMING } from '../timing.ts'
import type { InflightRecord } from './inflight.ts'

export interface HostInfo { pid: number; lstart: string; comm: string }

/** The harness process this pipe serves: the nearest ancestor whose basename(comm) is claude (K68). */
export function findHost(selfPid: number, table: ProcTable): HostInfo | null {
  const r = nearestClaude(selfPid, table)
  return r ? { pid: r.pid, lstart: r.started_at, comm: r.comm } : null
}

export interface LineageFile { v: 1; lineage: string; host_pid: number; host_lstart: string; created_at: string; inflight: InflightRecord[] }

const KEY_RE = /^[0-9a-f]{32}$/
const FILE_RE = /^([0-9a-f]{32})\.json$/
const HASH_RE = /^[0-9a-f]{64}$/
/** Collab's id shape, as ready's session_hint is checked (Task 15): an in-flight record's session_id is null or one of these. */
export const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700) // a dir that already existed keeps its old mode otherwise
}

/** Whether the read path would keep `v` as an in-flight record: addInflight checks the same thing before it writes one. */
export function isRecord(v: unknown): v is InflightRecord {
  return isObj(v) && typeof v.call_ref === 'string' && CALL_REF_RE.test(v.call_ref) && typeof v.tool === 'string' && v.tool !== ''
    && (v.idempotency_key === null || typeof v.idempotency_key === 'string') && typeof v.args_hash === 'string'
    && HASH_RE.test(v.args_hash) && typeof v.at === 'string'
    && (v.session_id === null || (typeof v.session_id === 'string' && SESSION_ID_RE.test(v.session_id)))
}

function parseLineageFile(text: string): LineageFile | null {
  let v: unknown
  try { v = JSON.parse(text) } catch { return null }
  if (!isObj(v) || v.v !== 1 || typeof v.lineage !== 'string' || !LINEAGE_RE.test(v.lineage)) return null
  if (!Number.isInteger(v.host_pid) || (v.host_pid as number) < 2 || typeof v.host_lstart !== 'string' || v.host_lstart === '') return null
  if (typeof v.created_at !== 'string' || !Array.isArray(v.inflight)) return null
  // A record that does not parse is dropped, never the lineage: the id is what keeps the agent's Collab session.
  const inflight = v.inflight.filter(isRecord).map((r) => ({ call_ref: r.call_ref, tool: r.tool, idempotency_key: r.idempotency_key, args_hash: r.args_hash, at: r.at, session_id: r.session_id }))
  return { v: 1, lineage: v.lineage, host_pid: v.host_pid as number, host_lstart: v.host_lstart, created_at: v.created_at, inflight }
}

/**
 * The lineage file of `key`, or null when it is missing (ENOENT) or does not parse. Any other read error (EACCES, EMFILE,
 * EIO) is thrown, never taken for a missing file: that would fork the lineage, delete a live host's file or hide the
 * unresolved calls. Callers sit before anything is written to the link, so they can answer a throw as not sent.
 */
export function readLineageFile(paths: NuancePaths, key: string): LineageFile | null {
  if (!KEY_RE.test(key)) return null
  let text: string
  try { text = readFileSync(paths.lineageFile(key), 'utf8') } catch (e) {
    if ((e as { code?: unknown }).code === 'ENOENT') return null
    throw e
  }
  return parseLineageFile(text)
}

/** Replaces the lineage file whole (0600, in 0700 dirs). Callers hold withLineageLock. */
export function writeLineageFile(paths: NuancePaths, key: string, file: LineageFile): void {
  ensureDir(paths.state)
  ensureDir(paths.lineages)
  writeFileDurable(paths.lineageFile(key), JSON.stringify(file, null, 2) + '\n', 0o600)
}

/** Runs fn holding `<lineage file>.lock` (the ledger's O_EXCL lock file), so a read-modify-write is never interleaved. */
export function withLineageLock<T>(paths: NuancePaths, key: string, fn: () => T): T {
  if (!KEY_RE.test(key)) throw new Error('lineage: not a lineage key')
  ensureDir(paths.state)
  ensureDir(paths.lineages)
  return withLock(paths.lineageFile(key), fn)
}

/** The lineage of this Claude process: created on first use, reused by every later pipe instance of the same host. */
export function openLineage(paths: NuancePaths, host: HostInfo, now: () => Date): { key: string; file: LineageFile } {
  const key = lineageKey(host.pid, host.lstart)
  return withLineageLock(paths, key, () => {
    const found = readLineageFile(paths, key)
    if (found && found.host_pid === host.pid && found.host_lstart === host.lstart) return { key, file: found }
    // None yet, or a file that no longer parses (a read error was thrown above): a new lineage. The old one's Collab session, if any, is the hub's to
    // retire after 7 days detached (§6.2); the agent's next call answers session_required and it starts a new session.
    const file: LineageFile = { v: 1, lineage: newLineage(), host_pid: host.pid, host_lstart: host.lstart, created_at: now().toISOString(), inflight: [] }
    writeLineageFile(paths, key, file)
    return { key, file }
  })
}

/**
 * Removes the lineage files whose host process is gone (no process in `table` with that pid and lstart) and that were
 * last written more than `maxAgeMs` ago (§6.2: 7 days). A file whose host still runs, the caller's own included, always
 * stays; one that no longer parses has no host to ask about and goes at the same age. A file that cannot be read at all
 * stays too, and the rest are still swept. Returns how many were removed.
 */
export function sweepLineages(paths: NuancePaths, table: ProcTable, nowMs: number, maxAgeMs: number = TIMING.lineageSweepMs): number {
  let names: string[]
  try { names = readdirSync(paths.lineages) } catch { return 0 }
  let removed = 0
  for (const name of names) {
    const m = FILE_RE.exec(name)
    if (!m) continue
    const key = m[1]!
    const path = paths.lineageFile(key)
    let mtimeMs: number
    try { mtimeMs = statSync(path).mtimeMs } catch { continue }
    if (nowMs - mtimeMs <= maxAgeMs) continue
    let file: LineageFile | null
    try { file = readLineageFile(paths, key) } catch { continue } // unreadable is not unparsable: it may be a live host's file
    if (file) {
      const host = table.get(file.host_pid)
      if (host && host.started_at === file.host_lstart) continue
    }
    try {
      withLineageLock(paths, key, () => unlinkSync(path))
      removed++
    } catch { /* gone already, or its lock is held: the next start looks again */ }
  }
  return removed
}

export type Interactive = { ok: true; entrypoint: string } | { ok: false; reason: 'sdk_entrypoint' | 'no_claude_host' | 'no_tty' }

/**
 * §6.2 "Interactive only": a Claude ancestor is required; an `sdk-*` entrypoint (`claude -p` sets `sdk-cli`, K54) is refused;
 * with no entrypoint at all, the host must have a controlling tty. The value is a label, never proof (K54): an odd one is
 * accepted and shown as `unknown`.
 */
export function interactiveCheck(env: Env, host: HostInfo | null, ttyOf: (pid: number) => string | null): Interactive {
  if (host === null) return { ok: false, reason: 'no_claude_host' }
  const raw = env.CLAUDE_CODE_ENTRYPOINT
  if (raw === undefined || raw === '') return ttyOf(host.pid) !== null ? { ok: true, entrypoint: 'unknown' } : { ok: false, reason: 'no_tty' }
  if (raw.startsWith('sdk-')) return { ok: false, reason: 'sdk_entrypoint' }
  return { ok: true, entrypoint: LABEL_TOKEN_RE.test(raw) ? raw : 'unknown' }
}
