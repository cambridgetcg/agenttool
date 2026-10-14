// lineages.json (spec §6.2, §4.3): every lineage the hub has seen, with its Collab session, never pruned. It holds no
// secret: credential_path names Collab's 0600 credential file beside the shared journal, never its contents. Every write
// is whole-file and durable (temp file, F_FULLFSYNC, rename, dir fsync; P13), because the session_start marker must be on
// disk before a start is forwarded (§9.3 item 8). A damaged file throws on load, and the hub then writes
// `needs Yu: config` instead of guessing which sessions exist.
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { writeFileDurable } from '../native.ts'
import { CALL_REF_RE, callRefLineage, LABEL_TOKEN_RE, LINEAGE_RE, MAX_FOLDER_BYTES, START_NONCE_RE } from '../link/messages.ts'

export type LineageState = 'pending' | 'live' | 'ended' | 'retired'
//   pending: attached, no session yet; live: a session; ended: its session ended (session_end or a host end), a new
//   session_start may begin a new session and every other call is seat_session_ended (§9.2, P53); retired: 7 days
//   detached, never used again
export interface PendingStart { nonce: string; call_ref: string; child_pid: number; child_lstart: string | null; workspace_id: string; at: string }
//   workspace_id: the workspace this start binds to, known before the first session (P55), so reconcile can always read it
export interface LineageEntry {
  lineage: string; device: string; user: string; harness: string; folder: string; state: LineageState
  session_id: string | null; credential_path: string | null; past_sessions: string[]; mirror_id: string; workspace_id: string | null
  pending_start: PendingStart | null; parked: { cause: string; details: Record<string, unknown> } | null
  detached_since: string | null; created_at: string
}
//   past_sessions: every earlier session of this lineage, so knock origins and parent_not_same_seat still know them (§8 item 4)

export const LINEAGES_FORMAT = 'agenttool.collab-bridge-lineages/1'

const KEYS = ['lineage', 'device', 'user', 'harness', 'folder', 'state', 'session_id', 'credential_path', 'past_sessions',
  'mirror_id', 'workspace_id', 'pending_start', 'parked', 'detached_since', 'created_at'] as const
const MARKER_KEYS = ['nonce', 'call_ref', 'child_pid', 'child_lstart', 'workspace_id', 'at'] as const
const STATES: ReadonlySet<string> = new Set(['pending', 'live', 'ended', 'retired'])
// device and user as they appear in a knock origin (`<device>/<user>`, ORIGIN_RE), so an index entry always makes a valid one
const DEVICE_RE = /^[a-z0-9-]{1,32}$/
const USER_RE = /^[a-z0-9._-]{1,32}$/
const COLLAB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/ // Collab's own id rule (validateId)
const MIRROR_ID_RE = /^[0-9a-f]{16}$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const isId = (v: unknown): v is string => typeof v === 'string' && COLLAB_ID_RE.test(v)
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k))

/** Why `v` is not a valid entry, or null when it is. */
function problem(v: unknown): string | null {
  if (!isRecord(v) || !exactKeys(v, KEYS)) return 'an entry does not have exactly the known keys'
  if (typeof v.lineage !== 'string' || !LINEAGE_RE.test(v.lineage)) return 'a lineage id is malformed'
  const at = v.lineage
  if (typeof v.device !== 'string' || !DEVICE_RE.test(v.device)) return `${at}: device`
  if (typeof v.user !== 'string' || !USER_RE.test(v.user)) return `${at}: user`
  if (typeof v.harness !== 'string' || !LABEL_TOKEN_RE.test(v.harness)) return `${at}: harness`
  if (typeof v.folder !== 'string' || !isAbsolute(v.folder) || Buffer.byteLength(v.folder) > MAX_FOLDER_BYTES) return `${at}: folder`
  if (typeof v.state !== 'string' || !STATES.has(v.state)) return `${at}: state`
  if (v.session_id !== null && !isId(v.session_id)) return `${at}: session_id`
  if (v.credential_path !== null && (typeof v.credential_path !== 'string' || !isAbsolute(v.credential_path))) return `${at}: credential_path`
  // A session and its credential come and go together, and only a live lineage has one.
  const live = v.state === 'live'
  if (live !== (v.session_id !== null) || live !== (v.credential_path !== null)) return `${at}: session_id and credential_path must be set exactly when live`
  if (!Array.isArray(v.past_sessions) || !v.past_sessions.every(isId)) return `${at}: past_sessions`
  if (typeof v.mirror_id !== 'string' || !MIRROR_ID_RE.test(v.mirror_id)) return `${at}: mirror_id`
  if (v.workspace_id !== null && !isId(v.workspace_id)) return `${at}: workspace_id`
  if (live && v.workspace_id === null) return `${at}: a live lineage has a workspace_id`
  if (v.pending_start !== null) {
    const m = v.pending_start
    if (!isRecord(m) || !exactKeys(m, MARKER_KEYS)) return `${at}: pending_start`
    if (typeof m.nonce !== 'string' || !START_NONCE_RE.test(m.nonce)) return `${at}: pending_start.nonce`
    if (typeof m.call_ref !== 'string' || !CALL_REF_RE.test(m.call_ref) || callRefLineage(m.call_ref) !== at) return `${at}: pending_start.call_ref`
    if (!Number.isInteger(m.child_pid) || (m.child_pid as number) < 1) return `${at}: pending_start.child_pid`
    if (m.child_lstart !== null && typeof m.child_lstart !== 'string') return `${at}: pending_start.child_lstart`
    if (!isId(m.workspace_id)) return `${at}: pending_start.workspace_id` // P55: always known before the forward
    if (!isTime(m.at)) return `${at}: pending_start.at`
  }
  if (v.parked !== null && (!isRecord(v.parked) || !exactKeys(v.parked, ['cause', 'details']) || typeof v.parked.cause !== 'string' || !isRecord(v.parked.details))) return `${at}: parked`
  if (v.detached_since !== null && !isTime(v.detached_since)) return `${at}: detached_since`
  if (!isTime(v.created_at)) return `${at}: created_at`
  return null
}

export class LineageStore {
  private entries = new Map<string, LineageEntry>()

  constructor(readonly path: string) {}

  /** A missing file is an empty store; anything that does not validate throws. */
  load(): void {
    if (!existsSync(this.path)) {
      this.entries = new Map()
      return
    }
    let doc: unknown
    try {
      doc = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      throw new Error('lineages.json is damaged: it does not parse')
    }
    if (!isRecord(doc) || doc.format !== LINEAGES_FORMAT || !Array.isArray(doc.lineages)) throw new Error('lineages.json is damaged: unknown format')
    const next = new Map<string, LineageEntry>()
    for (const e of doc.lineages) {
      const p = problem(e)
      if (p) throw new Error(`lineages.json is damaged: ${p}`)
      const entry = e as LineageEntry
      if (next.has(entry.lineage)) throw new Error(`lineages.json is damaged: ${entry.lineage} appears twice`)
      next.set(entry.lineage, entry)
    }
    this.entries = next
  }

  get(lineage: string): LineageEntry | undefined {
    const e = this.entries.get(lineage)
    return e && structuredClone(e)
  }

  /** Validates, then writes the whole file durably (0600 in a 0700 dir); memory changes only after the write. */
  upsert(e: LineageEntry): void {
    const p = problem(e)
    if (p) throw new Error(`lineages: refused entry: ${p}`)
    const next = new Map(this.entries)
    next.set(e.lineage, structuredClone(e))
    const dir = dirname(this.path)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    writeFileDurable(this.path, JSON.stringify({ format: LINEAGES_FORMAT, lineages: [...next.values()] }, null, 2) + '\n', 0o600)
    this.entries = next
  }

  all(): LineageEntry[] {
    return [...this.entries.values()].map((e) => structuredClone(e))
  }

  /** Every session the hub ever stamped, retired lineages included: knock origins come only from here (§8 item 4). */
  sessionIndex(): Map<string, { device: string; user: string }> {
    const index = new Map<string, { device: string; user: string }>()
    for (const e of this.entries.values()) {
      for (const s of [...e.past_sessions, ...(e.session_id ? [e.session_id] : [])]) index.set(s, { device: e.device, user: e.user })
    }
    return index
  }

  /** The session ids of one seat, past sessions included (parent_not_same_seat, §6.3). */
  sameSeat(device: string, user: string): Set<string> {
    const ids = new Set<string>()
    for (const e of this.entries.values()) {
      if (e.device !== device || e.user !== user) continue
      for (const s of e.past_sessions) ids.add(s)
      if (e.session_id) ids.add(e.session_id)
    }
    return ids
  }
}
