// The pool tests' world: a temp Air home whose shared journal and lineages.json are temp files, with real Collab children
// on the tracked dist (P35). Every pool test file calls cleanupPools() in its afterEach.
import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { AIR_LEDGER_KEYS, appendLedger, readLedger, type LedgerEntry } from '../src/ledger.ts'
import { airPaths, type AirPaths } from '../src/paths.ts'
import type { CollabChild } from '../src/air/children.ts'
import { LineageStore, type LineageEntry } from '../src/air/lineages.ts'
import { ChildPool, liveLstartOf, liveProcAlive, makeHostCli, type HostCli, type PoolDeps } from '../src/air/pool.ts'
import { rolePrefix } from '../src/air/stamp.ts'
import { newLineage, newStartNonce } from '../src/link/messages.ts'
import { COLLAB_DIST, cleanupTmps, temp } from './helpers.ts'
import { collabHarness, startCollabSession } from './mcp-harness.ts'

const pools: ChildPool[] = []

/** Stops every pool's children, then removes the temp dirs. */
export async function cleanupPools(): Promise<void> {
  for (const p of pools.splice(0)) await p.stopAll()
  cleanupTmps()
}

/** Collab's K11 rule for a plain (non-git) root: `ws_` + sha256(`local-path:` + sha256(realpath))[:24]. */
export function pathWorkspaceId(root: string): string {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  return `ws_${sha(`local-path:${sha(realpathSync(root))}`).slice(0, 24)}`
}

export interface World {
  home: string; paths: AirPaths; mirror: string; workspaceId: string; store: LineageStore
  clock: { mono: number; now: number }; statuses: Array<[string, string | null]>; hostCalls: string[][]
  build: { changed: boolean }; deps(over?: Partial<PoolDeps>): PoolDeps
}

export function world(): World {
  const home = temp('cb-pool-')
  const paths = airPaths(home)
  const mirror = join(home, 'mirror')
  mkdirSync(mirror)
  const store = new LineageStore(paths.lineages)
  store.load()
  const clock = { mono: 1_000, now: Date.parse('2026-10-13T12:00:00.000Z') }
  const statuses: Array<[string, string | null]> = []
  const hostCalls: string[][] = []
  const build = { changed: false }
  // The real host CLI on the tracked dist, run the children's way, recording each argv.
  const real = makeHostCli({ bun: process.execPath, dist: COLLAB_DIST, journal: paths.sharedJournal, home })
  const hostCli: HostCli = async (args, ms) => { hostCalls.push(args); return real(args, ms) }
  const w: World = {
    home, paths, mirror, workspaceId: pathWorkspaceId(mirror), store, clock, statuses, hostCalls, build,
    deps: (over = {}) => ({
      spec: { bun: process.execPath, dist: COLLAB_DIST, journal: paths.sharedJournal, home },
      store: w.store, paths, hostCli,
      mono: () => clock.mono, now: () => new Date(clock.now),
      ledger: (f) => { appendLedger(paths.ledger, AIR_LEDGER_KEYS, f) },
      procAlive: liveProcAlive('/bin/ps'), lstartOf: liveLstartOf('/bin/ps'),
      status: (l, n) => { statuses.push([l, n]) },
      buildChanged: () => build.changed,
      childWindowMs: 1_000,
      ...over,
    }),
  }
  return w
}

export function pool(w: World, over: Partial<PoolDeps> = {}): ChildPool {
  const p = new ChildPool(w.deps(over))
  pools.push(p)
  return p
}

export function entry(w: World, over: Partial<LineageEntry> = {}): LineageEntry {
  const e: LineageEntry = {
    lineage: newLineage(), device: 'nuance', user: 'macair', harness: 'claude', folder: '/Users/macair/Projects/collab-trial',
    state: 'pending', session_id: null, credential_path: null, past_sessions: [], mirror_id: '0123456789abcdef',
    workspace_id: null, pending_start: null, parked: null, detached_since: null, created_at: new Date(w.clock.now).toISOString(), ...over,
  }
  w.store.upsert(e)
  return e
}

/** Makes `e` live on a real session, as if an earlier hub run had started it: one collab_session_start through a separate
 *  hub-way harness, with root_path injected and the hub role stamp, which is that session's generation 1. Returns its id. */
export async function seedLive(w: World, e: LineageEntry): Promise<string> {
  const nonce = newStartNonce()
  const s = await startCollabSession({
    journal: w.paths.sharedJournal, home: w.home, root: w.mirror,
    actor: `${e.device}/${e.user} · self-declared: claude`, role: `${rolePrefix(e.device, e.user, nonce, 'claude')}tester`,
  })
  w.store.upsert({ ...w.store.get(e.lineage)!, state: 'live', session_id: s.sessionId, credential_path: s.credentialFile, workspace_id: s.workspaceId })
  return s.sessionId
}

export async function childOf(p: ChildPool, lineage: string, forStart = false): Promise<CollabChild> {
  const got = await p.childFor(lineage, { forStart })
  if (!got.ok) throw new Error(`childFor: ${got.code}`)
  return got.child
}

/** The active sessions of the shared journal's workspace, read through a separate hub-way harness. */
export async function activeSessions(w: World): Promise<Array<{ id: string; role: string | null; generation: number }>> {
  const h = collabHarness({ journal: w.paths.sharedJournal, home: w.home })
  try {
    await h.initialize()
    const r = await h.callTool('collab_workspace_status', { workspace_id: w.workspaceId })
    return r.isError ? [] : r.structuredContent.active_sessions
  } finally {
    await h.close()
  }
}

export const events = (w: World, event: string): LedgerEntry[] => readLedger(w.paths.ledger).filter((l) => l.event === event)
export const fresh = (w: World): LineageStore => { const s = new LineageStore(w.paths.lineages); s.load(); return s }
