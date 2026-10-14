// Unpair a device, Air side first (spec §9.10, R30): it works with the device unreachable, because nothing here dials it.
// 1. The device file goes `unpaired` without its seat key, and a running hub (Task 52) closes the link, stops that
//    device's children and refuses its attaches at its next reload. 2. The device's pending reviews are listed for an Air
//    session to review; unpair decides none. 3. Every remote session of the device is ended through Collab's own host CLI
//    with --release-leases, so its scopes are free again (K12); one without a credential file is reported, never skipped.
// 4. The hub ledger is archived, and the device's Host block and key files are removed. 5. Revocation stays incomplete
//    until the ` collab-air` line is gone on the device or expires (T5), and the output says so.
// lineages.json is only read here: the running hub owns its writes, and it moves a session whose credential is gone
// to `ended` itself (P53).
import { chmodSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { AIR_LEDGER_KEYS, appendLedger, withLock, type LedgerFields } from '../ledger.ts'
import { writeFileDurable } from '../native.ts'
import type { AirPaths } from '../paths.ts'
import { CollabChild, type StartFailure } from './children.ts'
import { updateDevice, type DeviceFile } from './devices.ts'
import { LineageStore } from './lineages.ts'
import { makeHostCli, type HostCli } from './pool.ts'

export interface UnpairDeps { paths: AirPaths; store: LineageStore; hostCli: HostCli; unboundChild(): Promise<CollabChild | StartFailure>; out(line: string): void; now(): Date }

export const UNPAIR_REASON = 'device unpaired'
/** One host end: a resume and an end on the shared journal, two chain passes at most (K21); far above what it takes. */
export const HOST_END_TIMEOUT_MS = 60_000
const DEVICE_RE = /^[a-z][a-z0-9-]{0,31}$/
const TITLE_MAX = 120

interface ActiveSession { id: string; worktree_id: string; role: string | null }
interface PendingReview { id: string; title: string; reported_by_session_id: string | null }
interface WorkspaceView { pending_reviews: PendingReview[]; active_sessions: ActiveSession[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const message = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0]!

/** Seat text shown on Ai's terminal: no control, bidi or line-separator character survives, and it is cut short. */
export function displayText(s: string): string {
  const clean = s.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '?')
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX)}…` : clean
}

/** `ledger.<UTC stamp>.jsonl` beside the ledger, never over an earlier archive. */
export function archiveName(stateDir: string, now: Date, exists: (p: string) => boolean = existsSync): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  for (let n = 1; ; n++) {
    const p = join(stateDir, n === 1 ? `ledger.${stamp}.jsonl` : `ledger.${stamp}-${n}.jsonl`)
    if (!exists(p)) return p
  }
}

/** The ssh config without the single-pattern `Host <alias>` block (up to the next Host or Match line). */
export function withoutHostBlock(config: string, alias: string): { text: string; removed: boolean } {
  const kept: string[] = []
  let skipping = false
  let removed = false
  for (const line of config.split('\n')) {
    const head = /^\s*(Host|Match)\s+(.+?)\s*$/i.exec(line)
    if (head) skipping = head[1]!.toLowerCase() === 'host' && head[2] === alias
    if (skipping) removed = true
    else kept.push(line)
  }
  return { text: kept.join('\n'), removed }
}

function workspaceView(sc: unknown): WorkspaceView | null {
  if (!isRecord(sc) || !Array.isArray(sc.pending_reviews) || !Array.isArray(sc.active_sessions)) return null
  const reviews = sc.pending_reviews.filter(isRecord).filter((t) => typeof t.id === 'string').map((t) => ({
    id: t.id as string, title: typeof t.title === 'string' ? t.title : '', reported_by_session_id: typeof t.reported_by_session_id === 'string' ? t.reported_by_session_id : null,
  }))
  const sessions = sc.active_sessions.filter(isRecord).filter((s) => typeof s.id === 'string' && typeof s.worktree_id === 'string').map((s) => ({
    id: s.id as string, worktree_id: s.worktree_id as string, role: typeof s.role === 'string' ? s.role : null,
  }))
  return { pending_reviews: reviews, active_sessions: sessions }
}

/** Each bound workspace's status, read once through one fresh unbound child on the shared journal (its caller stops it). */
async function readWorkspaces(ids: string[], deps: UnpairDeps, problems: string[]): Promise<Map<string, WorkspaceView>> {
  const views = new Map<string, WorkspaceView>()
  if (ids.length === 0) return views
  const child = await deps.unboundChild()
  if ('failed' in child) {
    problems.push(`Collab did not start on the shared journal (${child.lastErrLine ?? `exit ${child.exitCode}`}): pending reviews and journal sessions were not read`)
    return views
  }
  try {
    for (const id of ids) {
      const r = await child.call('collab_workspace_status', { workspace_id: id })
      const view = r.outcome === 'ok' ? workspaceView(r.result.structuredContent) : null
      if (view) views.set(id, view)
      else {
        const code = r.outcome === 'unknown' ? r.reason : String(r.result.structuredContent?.error ?? 'error')
        problems.push(`workspace ${id} could not be read (${code})`)
      }
    }
  } finally {
    await child.stop()
  }
  return views
}

export async function unpairDevice(device: string, deps: UnpairDeps): Promise<number> {
  const { paths, out } = deps
  if (!DEVICE_RE.test(device)) {
    out(`✗ ${JSON.stringify(device).slice(0, 40)} is not a device name; nothing was changed`)
    return 1
  }
  const ledger = (f: LedgerFields) => appendLedger(paths.ledger, AIR_LEDGER_KEYS, f, deps.now().getTime())
  const problems: string[] = []
  const report = (line: string) => { problems.push(line); out(line) }

  // 1. The device file: through updateDevice, so a hub writing the same file never puts the seat key back.
  let d: DeviceFile | null
  try {
    d = updateDevice(paths.deviceFile(device), (cur) => ({ ...cur, state: 'unpaired', seat_public: null }))
  } catch (e) {
    out(`✗ ${device}: the device file could not be updated (${message(e)}); nothing was changed`)
    return 1
  }
  if (d === null) {
    out(`✗ ${device}: no device file at ${paths.deviceFile(device)}; nothing was changed`)
    return 1
  }
  const user = d.user
  out(`1. ${device} is marked unpaired on the Air and its seat key is dropped; a running hub closes its link and stops its children at its next reload.`)

  // What the Air knows of the device's sessions: its lineages (read only) and the workspaces they and its shares bound.
  let mine: ReturnType<LineageStore['all']> = []
  try {
    deps.store.load()
    mine = deps.store.all().filter((e) => e.device === device)
  } catch (e) {
    report(`   lineages.json could not be read (${message(e)}): sessions are found from the journal only`)
  }
  const workspaces = [...new Set([...d.shares.map((s) => s.workspace_id), ...mine.map((e) => e.workspace_id), ...mine.map((e) => e.pending_start?.workspace_id ?? null)]
    .filter((w): w is string => typeof w === 'string'))].sort()
  const mirrorWorktrees = new Set(d.shares.map((s) => s.mirror_worktree_id).filter((w): w is string => w !== null))
  const readProblems: string[] = []
  const views = await readWorkspaces(workspaces, deps, readProblems)

  // The sessions to end: every lineage's session, and every active session the hub stamped for this seat in its mirror.
  const rolePrefix = `remote(${device}/${user};`
  const toEnd = new Map<string, string>()
  for (const e of mine) if (e.session_id !== null && e.credential_path !== null) toEnd.set(e.session_id, e.credential_path)
  const leftAlone: string[] = []
  for (const view of views.values()) {
    for (const s of view.active_sessions) {
      if (s.role === null || !s.role.startsWith(rolePrefix)) continue
      if (mirrorWorktrees.has(s.worktree_id)) { if (!toEnd.has(s.id)) toEnd.set(s.id, paths.credentialFile(s.id)) }
      else if (!toEnd.has(s.id)) leftAlone.push(s.id) // an Air session can write any role; only the mirror is the seat's
    }
  }
  const deviceSessions = new Set([...mine.flatMap((e) => [...e.past_sessions, ...(e.session_id ? [e.session_id] : [])]), ...toEnd.keys()])

  // 2. Pending reviews: listed, never decided.
  if (workspaces.length === 0) out(`2. No workspace is recorded for ${device}, so there is no pending review to list.`)
  else {
    const reviews = [...views.entries()].flatMap(([ws, v]) => v.pending_reviews
      .filter((t) => t.reported_by_session_id !== null && deviceSessions.has(t.reported_by_session_id)).map((t) => ({ ws, t })))
    if (reviews.length === 0 && readProblems.length === 0) out(`2. No pending review from ${device}.`)
    else {
      out(`2. Pending reviews from ${device}, left for an Air session (accept only while the mirror is still at the completed commit, else request_changes; unpair decides none):`)
      for (const { ws, t } of reviews) out(`   - ${t.id} in ${ws}: ${displayText(t.title)} (reported by ${t.reported_by_session_id})`)
    }
    for (const p of readProblems) report(`   ${p}`)
  }

  // 3. End each session with its leases released (spec §9.10 step 3).
  if (toEnd.size === 0 && leftAlone.length === 0) out(`3. No remote session of ${device} is active.`)
  else out(`3. Ending ${device}'s remote sessions with --release-leases:`)
  for (const [id, credential] of [...toEnd.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!existsSync(credential)) {
      report(`   - ${id}: no credential file (${credential}); it cannot be ended from the Air, and its expired claims wait for recovery from an Air session`)
      ledger({ event: 'unpair_end', device, user, session_id: id, outcome: 'no_credential' })
      continue
    }
    const r = await deps.hostCli(['end', '--session-file', credential, '--reason', UNPAIR_REASON, '--release-leases', '--db', paths.sharedJournal], HOST_END_TIMEOUT_MS)
    let receipt: Record<string, unknown> | null = null
    try { const v = JSON.parse(r.stdout.split('\n')[0] ?? ''); receipt = isRecord(v) ? v : null } catch { receipt = null }
    const status = typeof receipt?.status === 'string' ? receipt.status : null
    if (r.code === 0 && status === 'ended') {
      const released = Array.isArray(receipt?.released) ? receipt.released.length : 0
      out(`   - ended ${id} (${released} lease(s) released)`)
    } else if (r.code === 0 && status === 'already_ended') {
      out(`   - ${id} had already ended`)
    } else {
      const code = typeof receipt?.error === 'string' ? receipt.error : r.code === null ? 'timeout' : `exit ${r.code}`
      report(`   - ${id}: the host end failed (${code}); the session may still be active`)
    }
    ledger({ event: 'unpair_end', device, user, session_id: id, outcome: status ?? 'failed', code: typeof receipt?.error === 'string' ? receipt.error : undefined })
  }
  for (const id of leftAlone.sort()) out(`   - ${id} has a remote-looking role but is not in ${device}'s mirror; left alone`)

  // 4. The Air's files: the hub ledger archived whole, then this device's Host block and key files.
  out('4. Air files:')
  ledger({ event: 'unpair', device, user, outcome: problems.length === 0 ? 'ok' : 'incomplete', code: `${toEnd.size} session(s)` })
  const archive = archiveName(paths.stateDir, deps.now())
  withLock(paths.ledger, () => renameSync(paths.ledger, archive)) // the hub appends under the same lock
  chmodSync(archive, 0o600)
  ledger({ event: 'ledger_archived', device, code: basename(archive) })
  out(`   - the hub ledger is archived as ${archive}`)
  if (existsSync(paths.sshConfig)) {
    const { text, removed } = withoutHostBlock(readFileSync(paths.sshConfig, 'utf8'), d.host_alias)
    if (!removed) out(`   - no Host ${d.host_alias} block in ${paths.sshConfig}`)
    else {
      if (text.trim() === '') rmSync(paths.sshConfig)
      else writeFileDurable(paths.sshConfig, text.endsWith('\n') ? text : `${text}\n`, 0o600)
      out(`   - removed the Host ${d.host_alias} block from ${paths.sshConfig}`)
    }
  }
  for (const f of [paths.sshKey(device), `${paths.sshKey(device)}.pub`]) {
    if (existsSync(f)) { rmSync(f); out(`   - removed ${f}`) }
  }
  out(`   - a running hub stops ${device}'s children at its next reload; with the hub off there are none`)

  // 5. What the Air cannot do on its own.
  const expiry = `${d.key_expiry.slice(0, 4)}-${d.key_expiry.slice(4, 6)}-${d.key_expiry.slice(6, 8)}`
  out(`5. Revocation is incomplete until the " collab-air" line is removed from ~/.ssh/authorized_keys on ${device} (there: sed -i '' '/ collab-air$/d' ~/.ssh/authorized_keys) or the key expires on ${expiry}.`)
  if (problems.length === 0) {
    out(`✓ ${device} is unpaired on the Air.`)
    return 0
  }
  out(`✗ ${device} is unpaired on the Air, with ${problems.length} item(s) above for Ai.`)
  return 1
}

/** The live wiring `collab-bridge unpair` uses: Collab's own host CLI and a fresh unbound child, both the hub's way. */
export function liveUnpairDeps(o: { paths: AirPaths; bun: string; dist: string; out(line: string): void }): UnpairDeps {
  return {
    paths: o.paths,
    store: new LineageStore(o.paths.lineages),
    hostCli: makeHostCli({ bun: o.bun, dist: o.dist, journal: o.paths.sharedJournal, home: o.paths.home }),
    unboundChild: () => CollabChild.start({ bun: o.bun, dist: o.dist, journal: o.paths.sharedJournal, home: o.paths.home }),
    out: o.out,
    now: () => new Date(),
  }
}
