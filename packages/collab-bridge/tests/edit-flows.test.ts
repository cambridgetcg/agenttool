// The stamped edit flows end to end on this Mac (spec §7.2–§7.7, §12.2 Git, Diff and size, Replays, One-task rule): a
// temp "Nuance" home whose ~/Projects/collab-trial is shared for edit, the real gate from source behind the fake ssh,
// a real mirror made by createMirror, and two real Collab children on one temp shared journal (the remote seat's,
// rooted at the mirror, and an Air session's, rooted at the Air clone).
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mirrorBusy } from '../src/air/busy.ts'
import { CollabChild, type CallOutcome } from '../src/air/children.ts'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import { FLOW_MESSAGES, runEditFlow, type EditFlowCtx, type EditFlowOutcome } from '../src/air/edit-flows.ts'
import { airGit, type GitRunner } from '../src/air/git.ts'
import { createMirror, mirrorIdOf, mirrorRefs, MirrorLock, type MirrorDeps, type MirrorSpec } from '../src/air/mirror.ts'
import { PLAN_MESSAGES, type MirrorHandle } from '../src/air/sync-points.ts'
import { readTask } from '../src/air/tasks.ts'
import type { LedgerFields } from '../src/ledger.ts'
import type { Declared } from '../src/link/messages.ts'
import { hasLazyFetchGuard, parseGitVersion, sha256File, type ResolvedGit } from '../src/nuance/git-resolve.ts'
import { renderInstalled, writeShares } from '../src/nuance/installed.ts'
import { airPaths, nuancePaths } from '../src/paths.ts'
import { gateFromSource, makeFakeSsh, type FakeSsh } from './fake-ssh.ts'
import { cleanupTmps, COLLAB_DIST, commitFiles, makeRepo, REAL_GIT, repoGit, temp, testEnv } from './helpers.ts'
import { collabHarness, type StdioHarness } from './mcp-harness.ts'

const running: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const stop of running.splice(0).reverse()) await stop()
  cleanupTmps()
})

const T = 60_000 // a world is two repos, one fetch through the source gate and two Collab children

/** The git Nuance's INSTALLED records: the Air's own Homebrew git by its Cellar realpath, as `install check` would. */
function nuanceGit(): ResolvedGit {
  const path = realpathSync(REAL_GIT)
  const v = parseGitVersion(Bun.spawnSync([path, '--version'], { env: { PATH: '/usr/bin:/bin' } }).stdout.toString())!
  return { path, version: v.version, sha256: sha256File(path), guard: hasLazyFetchGuard(path), apple: v.apple }
}

const ALLOWLIST = ['version: 1', 'device: nuance', 'peers: [air]', 'runtimes:', '  - id: claude', '    models:', '      - model: sonnet',
  'folders:', '  - path: ~/Projects', '    access: review', '  - path: ~/Projects/collab-trial', '    access: edit',
  'limits:', '  max_concurrent: 1', '  starts_per_hour: 6', '  job_timeout_max: 30m', ''].join('\n')

/**
 * Collab's minimum lease is 30 s and its store reads its own wall clock, so no test can wait for an expiry within its
 * 10 s budget. This moves one temp journal's lease into the past with the sqlite3 CLI, under the write guard Collab's
 * own v0.2 writes use (inserted and removed in the same transaction); the event chain is untouched.
 */
function expireLease(journal: string, taskId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('expireLease: test task ids are plain words')
  const sql = "BEGIN IMMEDIATE; INSERT INTO v2_write_guard (nonce, enabled) VALUES ('collab-bridge-test', 1); " +
    `UPDATE tasks SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${taskId}'; ` +
    "DELETE FROM v2_write_guard WHERE nonce = 'collab-bridge-test'; COMMIT;"
  const r = Bun.spawnSync(['/usr/bin/sqlite3', '-cmd', '.timeout 5000', journal, sql], { env: { PATH: '/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' })
  if (r.exitCode !== 0) throw new Error(`expireLease: ${r.stderr.toString()}`)
}

/**
 * Faults a test can arm on the mirror's git runner, each firing once. checkoutOf: the next checkout naming that commit
 * answers a failure code. rejectCheckoutOf: the next such checkout rejects instead of answering, as a spawn failure or
 * ENOSPC would (syncMirror awaits it unguarded). rejectUpdateRefOf: the next update-ref of that ref rejects the same way.
 */
interface Faults { checkoutOf: string | null; rejectCheckoutOf: string | null; rejectUpdateRefOf: string | null }

/** Long, non-ASCII and multi-sentence on purpose: the hub's log line must clip and reduce it to printable ASCII. */
const INJECTED = `injected git failure \u00e9 ${'x'.repeat(300)}`

function faulty(g: GitRunner, faults: Faults): GitRunner {
  return {
    path: g.path,
    records: (args, o) => g.records(args, o),
    run: async (args, o) => {
      const rejectCo = faults.rejectCheckoutOf
      if (rejectCo !== null && args.includes('checkout') && args.some((a) => a.includes(rejectCo))) {
        faults.rejectCheckoutOf = null
        throw new Error(INJECTED)
      }
      const rejectRef = faults.rejectUpdateRefOf
      if (rejectRef !== null && args.includes('update-ref') && args.includes(rejectRef)) {
        faults.rejectUpdateRefOf = null
        throw new Error(INJECTED)
      }
      const target = faults.checkoutOf
      if (target !== null && args.includes('checkout') && args.some((a) => a.includes(target))) {
        faults.checkoutOf = null
        return { code: 1, stdout: new Uint8Array(), stderr: 'error: injected checkout failure\n', timedOut: false }
      }
      return g.run(args, o)
    },
  }
}

interface World {
  airHome: string; airClone: string; nuanceHome: string; share: string; base: string; journal: string
  fake: FakeSsh; spec: MirrorSpec; deps: MirrorDeps; ledger: LedgerFields[]; faults: Faults; handle: MirrorHandle
  remote: CollabChild; air: StdioHarness; ws: string; sessionId: string
}

async function world(): Promise<World> {
  const root = temp('cb-flows-')
  const airHome = join(root, 'air-home')
  mkdirSync(airHome)
  const airClone = join(root, 'Projects', 'collab-trial')
  const base = makeRepo(airClone)

  // Nuance: the trial clone shares the Air's first commit (§10.3 step 5), with INSTALLED, shares.json and Yu's edit entry.
  const nuanceHome = temp('cb-nuance-')
  const nenv = testEnv(nuanceHome)
  const np = nuancePaths(nuanceHome, nenv)
  const share = join(nuanceHome, 'Projects', 'collab-trial')
  mkdirSync(dirname(share))
  repoGit(dirname(share), ['clone', '-q', airClone, share])
  mkdirSync(np.share, { recursive: true, mode: 0o700 })
  writeFileSync(np.installed, renderInstalled({ device: 'nuance', build: 'abcdef01', prepared: '20261013120000', expiry: '20270111',
    binary_sha256: 'a'.repeat(64), tools_seed: 'b'.repeat(64), git: nuanceGit(), summon_key_sha256: 'c'.repeat(64),
    summon_dropin_stat: '1 2 3 0 600', claude_version: null, installed_at: '2026-10-13T12:00:00.000Z' }), { mode: 0o600 })
  writeShares(np, [{ realpath: share, gitdir: join(share, '.git') }])
  mkdirSync(dirname(np.summonAllowlist), { recursive: true })
  writeFileSync(np.summonAllowlist, ALLOWLIST)
  const fake = makeFakeSsh({ nuanceHome, target: gateFromSource(), env: nenv })

  const ap = airPaths(airHome)
  const mirrorId = mirrorIdOf(share)
  const spec: MirrorSpec = { device: 'nuance', user: 'macair', mirrorId, mirrorPath: ap.mirrorDir('nuance', 'macair', mirrorId), airClone,
    remoteGitdir: join(share, '.git'), caps: DEFAULT_CAPS }
  const ledger: LedgerFields[] = []
  const faults: Faults = { checkoutOf: null, rejectCheckoutOf: null, rejectUpdateRefOf: null }
  const deps: MirrorDeps = { git: faulty(airGit({ git: REAL_GIT, home: airHome }), faults), sshBin: fake.bin, sshConfig: ap.sshConfig,
    alias: 'collab-nuance', freeBytes: () => Number.MAX_SAFE_INTEGER, fetchedToday: () => 0, ledger: (f) => { ledger.push(f) } }
  const made = await createMirror(spec, deps)
  if (!made.ok) throw new Error(`createMirror: ${made.code} ${made.message}`)
  expect(made.oid).toBe(base)

  const journal = ap.sharedJournal
  const remote = await CollabChild.start({ bun: process.execPath, dist: COLLAB_DIST, journal, home: airHome })
  if (!(remote instanceof CollabChild)) throw new Error(`the remote child did not start: ${remote.lastErrLine}`)
  running.push(() => remote.stop())
  const started = await ok(remote, 'collab_session_start', { root_path: spec.mirrorPath, actor: 'nuance/macair · self-declared: flow test' })
  const air = collabHarness({ journal, home: airHome })
  running.push(() => air.close())
  await air.initialize()
  const airStart = await airOk(air, 'collab_session_start', { root_path: airClone, actor: 'air reviewer' })
  expect(airStart.workspace.id).toBe(started.workspace.id)
  const handle: MirrorHandle = { spec, lock: new MirrorLock(), worktreeId: started.worktree.id }
  return { airHome, airClone, nuanceHome, share, base, journal, fake, spec, deps, ledger, faults, handle, remote, air,
    ws: started.workspace.id, sessionId: started.session.id }
}

async function ok(child: CollabChild, name: string, args: Record<string, unknown>): Promise<any> {
  const o = await child.call(name, args)
  if (o.outcome === 'unknown') throw new Error(`${name}: no answer (${o.reason})`)
  if (o.outcome === 'error') throw new Error(`${name}: ${JSON.stringify(o.result.structuredContent)}`)
  return o.result.structuredContent
}

async function airOk(air: StdioHarness, name: string, args: Record<string, unknown>): Promise<any> {
  const r = await air.callTool(name, args)
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.structuredContent)}`)
  return r.structuredContent
}

let n = 0
const key = () => `flow-key-${++n}`

const fetches = (w: World) => w.fake.calls().length
const mirrorAt = (w: World) => repoGit(w.spec.mirrorPath, ['rev-parse', 'HEAD'])
const syncedAt = (w: World) => repoGit(w.airClone, ['rev-parse', mirrorRefs(w.spec).synced])
const tasksRef = (w: World, id: string): string | null => {
  try { return repoGit(w.airClone, ['rev-parse', '--verify', '-q', mirrorRefs(w.spec).task(id)]) } catch { return null }
}
/** What the pipe would declare for the shared folder right now (§7.5). */
const declaredOf = (w: World, dirty = false): Declared => ({ head: repoGit(w.share, ['rev-parse', 'HEAD']), branch: 'main', dirty })

function createEdit(w: World, id: string, o: { base?: string | null; policy?: 'accepted' | 'reported'; scopes?: string[] } = {}): Promise<any> {
  const base = o.base === undefined ? w.base : o.base
  return airOk(w.air, 'collab_task_create', { workspace_id: w.ws, idempotency_key: key(), task_id: id, title: `task ${id}`, work_mode: 'edit',
    completion_policy: o.policy ?? 'accepted', path_scopes: o.scopes ?? ['notes'], ...(base === null ? {} : { expected_base_sha: base }) }).then((r) => r.task)
}

function ctxOf(w: World, flow: EditFlowCtx['flow'], name: string, args: Record<string, unknown>, declared: Declared | undefined,
  o: { child?: CollabChild; nowMs?: number; notAfterMono?: number; mono?: () => number; deps?: MirrorDeps; barrier?: EditFlowCtx['barrier'] } = {}): EditFlowCtx {
  return { flow, name, args, declared, device: 'nuance', user: 'macair', sessionId: w.sessionId, workspaceId: w.ws,
    child: o.child ?? w.remote, mirror: w.handle, mirrorDeps: o.deps ?? w.deps, nowMs: o.nowMs ?? Date.now(),
    notAfterMono: o.notAfterMono ?? null, mono: o.mono ?? (() => performance.now()), barrier: o.barrier ?? (() => null) }
}

const claimArgs = (w: World, t: any, o: { key?: string; ttl?: number } = {}) => ({ workspace_id: w.ws, task_id: t.id,
  idempotency_key: o.key ?? key(), expected_version: t.version, ...(o.ttl === undefined ? {} : { ttl_seconds: o.ttl }) })
const completeArgs = (w: World, t: any, o: { key?: string; limits?: string } = {}) => ({ workspace_id: w.ws, task_id: t.id,
  lease_id: t.lease_id, idempotency_key: o.key ?? key(), expected_version: t.version, summary: 'edited notes', ...(o.limits === undefined ? {} : { limits: o.limits }) })
const takeoverArgs = (w: World, t: { id: string; version: number }, note: string, k?: string) => ({ workspace_id: w.ws, task_id: t.id,
  idempotency_key: k ?? key(), expected_version: t.version, recovery_note: note })

type FlowOpts = { child?: CollabChild; deps?: MirrorDeps; notAfterMono?: number; mono?: () => number; barrier?: EditFlowCtx['barrier'] }
const claim = (w: World, t: any, declared: Declared | undefined, o: FlowOpts & { key?: string; ttl?: number } = {}) =>
  runEditFlow(ctxOf(w, 'claim', 'collab_task_claim', claimArgs(w, t, o), declared, o))
const complete = (w: World, t: any, declared: Declared | undefined, o: FlowOpts & { key?: string; limits?: string } = {}) =>
  runEditFlow(ctxOf(w, 'complete', 'collab_task_complete', completeArgs(w, t, o), declared, o))
const takeover = (w: World, t: { id: string; version: number }, declared: Declared | undefined, note: string,
  o: { key?: string; child?: CollabChild; deps?: MirrorDeps; notAfterMono?: number; mono?: () => number; barrier?: EditFlowCtx['barrier'] } = {}) =>
  runEditFlow(ctxOf(w, 'takeover', 'collab_task_recover', takeoverArgs(w, t, note, o.key), declared, o))

/** The task of a flow that reached Collab and succeeded. */
function taskOf(r: EditFlowOutcome): any {
  if (r.kind !== 'outcome') throw new Error(`refused: ${r.code} ${r.message}`)
  const o = r.outcome
  if (o.outcome === 'unknown') throw new Error(`no answer from Collab (${o.reason})`)
  if (o.outcome === 'error') throw new Error(`Collab: ${JSON.stringify(o.result.structuredContent)}`)
  return o.result.structuredContent!.task
}

/** Collab's own refusal code for a flow that reached Collab and was refused there. */
function collabError(r: EditFlowOutcome): string {
  if (r.kind !== 'outcome' || r.outcome.outcome !== 'error') throw new Error(`expected a Collab refusal, got ${JSON.stringify(r)}`)
  return String(r.outcome.result.structuredContent!.error)
}

async function claimed(w: World, id = 'T', o: { base?: string | null; scopes?: string[]; ttl?: number } = {}): Promise<any> {
  return taskOf(await claim(w, await createEdit(w, id, o), declaredOf(w), { ttl: o.ttl }))
}

async function completionLimits(w: World, t: any): Promise<string | null> {
  const reports = (await airOk(w.air, 'collab_report_list', { workspace_id: w.ws, task_id: t.id })).reports as any[]
  return reports.find((r) => r.id === t.completion_report_id)?.limits ?? null
}

const airReview = (w: World, t: any, outcome: 'accept' | 'request_changes') =>
  airOk(w.air, 'collab_task_review', { workspace_id: w.ws, task_id: t.id, idempotency_key: key(), expected_version: t.version,
    outcome, summary: outcome === 'accept' ? 'read the diff; it holds' : 'please change' }).then((r) => r.task)

/**
 * A view of `child` that records every call, and can run something of its own just before one named call (`before`).
 * stopAfter: once that call has answered, accepting() is false (a park, an end or a drain reached the child mid-flow).
 * unknownFor: that call is not made and answers unknown (a child that went silent). rewrite: that call's real answer is
 * changed on its way back to the flow.
 */
function recording(child: CollabChild, before?: { name: string; run(): Promise<void> },
  o: { stopAfter?: string; unknownFor?: string; rewrite?: { name: string; to(real: CallOutcome): CallOutcome } } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  let armed = before
  let stopped = false
  const proxy = new Proxy(child, {
    get(target, prop) {
      if (prop === 'accepting') return () => !stopped && target.accepting()
      if (prop === 'call') {
        return async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args: structuredClone(args) })
          if (armed && armed.name === name) {
            const b = armed
            armed = undefined
            await b.run()
          }
          if (o.unknownFor === name) return { outcome: 'unknown', reason: 'timeout', ms: 0 } satisfies CallOutcome
          const real = await target.call(name, args)
          if (o.stopAfter === name) stopped = true
          return o.rewrite && o.rewrite.name === name ? o.rewrite.to(real) : real
        }
      }
      const v = Reflect.get(target, prop, target)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
  return { child: proxy as CollabChild, calls }
}

const stampOf = (oid: string, o: { equalsBase?: boolean; seat?: string } = {}) =>
  `hub-observed: fetched ${oid} from nuance/macair via git-upload-pack v0; remote clean self-declared` +
  (o.equalsBase ? '; HEAD equals base' : '') + (o.seat ? `\nremote self-declared: ${o.seat}` : '')

describe('claim', () => {
  test('a claim syncs and passes its base check', async () => {
    const w = await world()
    const before = fetches(w)
    const t = taskOf(await claim(w, await createEdit(w, 'T'), declaredOf(w)))
    expect([t.status, t.claim_worktree_id, t.base_checkpoint.head_sha]).toEqual(['claimed', w.handle.worktreeId, w.base])
    expect(fetches(w)).toBe(before + 1)
    expect(mirrorAt(w)).toBe(w.base)
  }, T)

  test('a claim whose declared head is not the expected base is refused before fetching', async () => {
    const w = await world()
    const task = await createEdit(w, 'T')
    commitFiles(w.share, { 'notes/a.md': 'early\n' }, 'work before the claim')
    const before = fetches(w)
    expect(await claim(w, task, declaredOf(w))).toMatchObject({ kind: 'refuse', code: 'expected_base_mismatch' })
    expect(fetches(w)).toBe(before)
    expect((await readTask(w.remote, w.ws, 'T'))?.status).toBe('open')
  }, T)

  test('a claim refused by Collab after its sync (a lost race to another claim; path_scope_conflict) leaves the mirror free for the next task', async () => {
    const w = await world()
    // path_scope_conflict: an Air session already holds notes/ in the same repository (K12).
    const held = await createEdit(w, 'HELD')
    await airOk(w.air, 'collab_task_claim', { workspace_id: w.ws, task_id: 'HELD', idempotency_key: key(), expected_version: held.version })
    const a = await createEdit(w, 'A')
    let before = fetches(w)
    expect(collabError(await claim(w, a, declaredOf(w)))).toBe('path_scope_conflict')
    expect(fetches(w)).toBe(before + 1) // it synced first, then Collab refused
    // A lost race: the task was open when the hub read it, and an Air session claimed it before the forward. The
    // seat's expected_version predates that claim, so Collab answers version_conflict (its CAS runs first).
    const b = await createEdit(w, 'B', { scopes: ['docs'] })
    const race = recording(w.remote, { name: 'collab_task_claim', run: async () => {
      await airOk(w.air, 'collab_task_claim', { workspace_id: w.ws, task_id: 'B', idempotency_key: key(), expected_version: b.version })
    } })
    before = fetches(w)
    expect(collabError(await claim(w, b, declaredOf(w), { child: race.child }))).toBe('version_conflict')
    expect(fetches(w)).toBe(before + 1)
    expect(await mirrorBusy(w.remote, w.ws, w.handle.worktreeId, 'C')).toEqual({ busy: false })
    expect(taskOf(await claim(w, await createEdit(w, 'C', { scopes: ['src'] }), declaredOf(w))).status).toBe('claimed')
  }, T)

  test('a claim while another edit task awaits review from the mirror is mirror_busy, and nothing is fetched', async () => {
    const w = await world()
    const a = await claimed(w, 'A')
    commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a')
    taskOf(await complete(w, a, declaredOf(w)))
    const b = await createEdit(w, 'B', { scopes: ['docs'], base: null })
    const before = fetches(w)
    expect(await claim(w, b, declaredOf(w))).toMatchObject({ kind: 'refuse', code: 'mirror_busy', extra: { holder_task_id: 'A', reason: 'pending_review' } })
    expect(fetches(w)).toBe(before)
  }, T)

  test('after request_changes a re-claim of the old task is expected_base_mismatch', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'first try\n' }, 'first try')
    const done = taskOf(await complete(w, t, declaredOf(w)))
    const back = await airReview(w, done, 'request_changes')
    expect([back.status, back.expected_base_sha]).toEqual(['open', w.base])
    expect(await claim(w, back, declaredOf(w))).toMatchObject({ kind: 'refuse', code: 'expected_base_mismatch' })
    // The creator reissues on the rejected commit (§7.2); the old task holds nothing, so the reissue is not mirror_busy.
    const again = taskOf(await claim(w, await createEdit(w, 'T2', { base: n1 }), declaredOf(w)))
    expect([again.status, again.base_checkpoint.head_sha]).toEqual(['claimed', n1])
  }, T)
})

describe('complete', () => {
  test('a complete syncs, stamps limits and writes the tasks ref', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'hello from nuance\n' }, 'notes: hello')
    const before = fetches(w)
    const done = taskOf(await complete(w, t, declaredOf(w), { limits: 'only notes/a.md changed' }))
    expect([done.status, done.review_status, done.result_checkpoint.head_sha]).toEqual(['completed', 'pending', n1])
    expect(fetches(w)).toBe(before + 1)
    expect(mirrorAt(w)).toBe(n1)
    expect(syncedAt(w)).toBe(n1)
    expect(tasksRef(w, 'T')).toBe(n1)
    expect(await completionLimits(w, done)).toBe(stampOf(n1, { seat: 'only notes/a.md changed' }))
  }, T)

  test('a completion whose tasks ref cannot be written still answers Collab\'s result and ledgers tasks_ref', async () => {
    const w = await world()
    const t = await claimed(w)
    repoGit(w.airClone, ['update-ref', mirrorRefs(w.spec).task('T'), w.base]) // a stale ref with another value
    const n1 = commitFiles(w.share, { 'notes/a.md': 'applied\n' }, 'applied')
    const done = taskOf(await complete(w, t, declaredOf(w)))
    expect(done.result_checkpoint.head_sha).toBe(n1) // the completion applied, so it is never reported as refused
    expect(tasksRef(w, 'T')).toBe(w.base)
    expect(w.ledger.filter((f) => f.event === 'tasks_ref')).toEqual([{ event: 'tasks_ref', device: 'nuance', user: 'macair', code: 'mirror_tampered', outcome: 'refused' }])
  }, T)

  test("an edit task without expected_base_sha diffs against its claim's base checkpoint head and completes", async () => {
    const w = await world()
    const t = await claimed(w, 'T', { base: null })
    expect([t.expected_base_sha, t.base_checkpoint.head_sha]).toEqual([null, w.base])
    const n1 = commitFiles(w.share, { 'notes/a.md': 'no expected base\n' }, 'notes')
    const done = taskOf(await complete(w, t, declaredOf(w)))
    expect(done.result_checkpoint.head_sha).toBe(n1)
    expect(await completionLimits(w, done)).toBe(stampOf(n1))
  }, T)

  test('a dirty complete is remote_uncommitted', async () => {
    const w = await world()
    const t = await claimed(w)
    const before = fetches(w)
    expect(await complete(w, t, declaredOf(w, true))).toMatchObject({ kind: 'refuse', code: 'remote_uncommitted' })
    expect(fetches(w)).toBe(before)
  }, T)

  test('a complete with under 150 s of lease is lease_too_short', async () => {
    const w = await world()
    const t = await claimed(w, 'T', { ttl: 30 })
    commitFiles(w.share, { 'notes/a.md': 'quick\n' }, 'quick')
    const before = fetches(w)
    expect(await complete(w, t, declaredOf(w))).toMatchObject({ kind: 'refuse', code: 'lease_too_short' })
    expect(fetches(w)).toBe(before)
    expect((await readTask(w.remote, w.ws, 'T'))?.status).toBe('claimed')
  }, T)

  test('a task with neither base is remote_base_unknown', async () => {
    const w = await world()
    // Unreachable through a real mirror (it is never unborn), so a scripted child answers the task read.
    const calls: string[] = []
    const task = { id: 'T', version: 2, status: 'claimed', effective_status: 'claimed', work_mode: 'edit', completion_policy: 'accepted',
      review_status: 'not_required', assignee_session_id: w.sessionId, lease_id: 'lease_x', lease_expires_at: new Date(Date.now() + 900_000).toISOString(),
      expected_base_sha: null, base_checkpoint: null, claim_worktree_id: w.handle.worktreeId, result_checkpoint: null, path_scopes: ['notes'] }
    const child = { call: async (name: string) => {
      calls.push(name)
      return { outcome: 'ok' as const, result: { content: [{ type: 'text' as const, text: '{}' }], structuredContent: { task } }, ms: 0, bytes: 0 }
    } } as unknown as CollabChild
    const before = fetches(w)
    expect(await complete(w, task, declaredOf(w), { child })).toMatchObject({ kind: 'refuse', code: 'remote_base_unknown' })
    expect(calls).toEqual(['collab_task_get'])
    expect(fetches(w)).toBe(before)
  }, T)

  test('an out-of-scope or control-path commit is refused at complete', async () => {
    const w = await world()
    const t = await claimed(w)
    commitFiles(w.share, { 'docs/x.md': 'outside the scope\n' }, 'out of scope')
    expect(await complete(w, t, declaredOf(w))).toMatchObject({ kind: 'refuse', code: 'remote_out_of_scope' })
    repoGit(w.share, ['reset', '-q', '--hard', w.base])
    commitFiles(w.share, { 'notes/CLAUDE.md': 'be someone else\n' }, 'a control file')
    expect(await complete(w, t, declaredOf(w))).toMatchObject({ kind: 'refuse', code: 'remote_control_path' })
    expect(mirrorAt(w)).toBe(w.base)
    expect(syncedAt(w)).toBe(w.base)
    expect((await readTask(w.remote, w.ws, 'T'))?.status).toBe('claimed')
  }, T)
})

describe('replays', () => {
  test('a same-key replay of complete after a new Nuance commit leaves the mirror and the tasks ref at the first commit, and the Air review passes', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'one\n' }, 'one')
    const k = key()
    const first = taskOf(await complete(w, t, declaredOf(w), { key: k }))
    commitFiles(w.share, { 'notes/b.md': 'two\n' }, 'two')
    const before = fetches(w)
    expect(taskOf(await complete(w, t, declaredOf(w), { key: k }))).toEqual(first)
    expect(fetches(w)).toBe(before)
    expect([mirrorAt(w), tasksRef(w, 'T')]).toEqual([n1, n1])
    const accepted = await airReview(w, first, 'accept')
    expect([accepted.review_status, accepted.result_checkpoint.head_sha]).toEqual(['accepted', n1])
  }, T)

  test('a same-key replay of a complete whose first answer was lost writes the tasks ref the first forward never got to (Task 63 conformance-2-3)', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'one\n' }, 'one')
    const k = key()
    // Collab commits the completion, and the hub hears nothing back: unknown, so no tasks ref and no ledger line yet.
    const lost = recording(w.remote, undefined, { rewrite: { name: 'collab_task_complete', to: () => ({ outcome: 'unknown', reason: 'timeout', ms: 0 }) } })
    const first = await complete(w, t, declaredOf(w), { key: k, child: lost.child })
    expect(first.kind === 'outcome' && first.outcome.outcome).toBe('unknown')
    expect((await readTask(w.remote, w.ws, 'T'))?.status).toBe('completed')
    expect([tasksRef(w, 'T'), w.ledger.filter((f) => f.event === 'tasks_ref')]).toEqual([null, []])
    // The agent replays with the same key: no sync (the task is completed), Collab's receipt, and now the reviewer's ref.
    const before = fetches(w)
    const replay = taskOf(await complete(w, t, declaredOf(w), { key: k }))
    expect(replay.result_checkpoint.head_sha).toBe(n1)
    expect(fetches(w)).toBe(before)
    expect(tasksRef(w, 'T')).toBe(n1)
    expect(w.ledger.filter((f) => f.event === 'tasks_ref')).toEqual([])
    // Once is enough: another replay finds the ref there and says nothing.
    expect(taskOf(await complete(w, t, declaredOf(w), { key: k }))).toEqual(replay)
    expect([tasksRef(w, 'T'), w.ledger.filter((f) => f.event === 'tasks_ref')]).toEqual([n1, []])
    const accepted = await airReview(w, replay, 'accept')
    expect([accepted.review_status, accepted.result_checkpoint.head_sha]).toEqual(['accepted', n1])
  }, T)

  test('a replay of a lost completion after the mirror moved on cannot write the ref, and says so in the ledger (Task 63 conformance-2-3)', async () => {
    const w = await world()
    const a = await claimed(w, 'A')
    const n1 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a')
    const k = key()
    const lost = recording(w.remote, undefined, { rewrite: { name: 'collab_task_complete', to: () => ({ outcome: 'unknown', reason: 'timeout', ms: 0 }) } })
    await complete(w, a, declaredOf(w), { key: k, child: lost.child })
    const doneA = (await readTask(w.remote, w.ws, 'A'))!
    await airReview(w, doneA, 'accept')
    // B moves the mirror past A's commit; A's ref was never written, and the mirror no longer holds A's head.
    const b = await claimed(w, 'B', { base: n1 })
    commitFiles(w.share, { 'notes/b.md': 'b\n' }, 'b')
    taskOf(await complete(w, b, declaredOf(w)))
    const replay = taskOf(await complete(w, a, declaredOf(w), { key: k }))
    expect(replay.result_checkpoint.head_sha).toBe(n1)
    expect(tasksRef(w, 'A')).toBeNull() // never written from a mirror that no longer holds the head
    // Visible, not silent, and not called tampering: the mirror is healthy, it only moved on (Task 63 new-taskref-moved).
    expect(w.ledger.filter((f) => f.event === 'tasks_ref')).toEqual([{ event: 'tasks_ref', device: 'nuance', user: 'macair', code: 'mirror_moved', outcome: 'refused' }])
  }, T)

  test('a replay of a completion whose task id git cannot hold as a ref name ledgers nothing, whatever the mirror holds by then (Task 63 new-taskref-moved)', async () => {
    const w = await world()
    const a = await claimed(w, 'A:1') // Collab allows ':' in a task id; git refuses it in a ref name
    const n1 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a')
    const k = key()
    const doneA = taskOf(await complete(w, a, declaredOf(w), { key: k }))
    await airReview(w, doneA, 'accept')
    const b = await claimed(w, 'B', { base: n1 })
    commitFiles(w.share, { 'notes/b.md': 'b\n' }, 'b')
    taskOf(await complete(w, b, declaredOf(w)))
    expect(mirrorAt(w)).not.toBe(n1) // the mirror is past A's commit
    for (let i = 0; i < 2; i++) expect(taskOf(await complete(w, a, declaredOf(w), { key: k }))).toEqual(doneA)
    expect(w.ledger.filter((f) => f.event === 'tasks_ref')).toEqual([])
  }, T)

  test("a same-key replay of a complete while another task holds the mirror is forwarded and returns Collab's receipt", async () => {
    const w = await world()
    const a = await claimed(w, 'A')
    const n1 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a')
    const k = key()
    const doneA = taskOf(await complete(w, a, declaredOf(w), { key: k }))
    await airReview(w, doneA, 'accept')
    // B moves the mirror past A's commit and then holds it, pending review.
    const b = await claimed(w, 'B', { base: n1 })
    const n2 = commitFiles(w.share, { 'notes/b.md': 'b\n' }, 'b')
    taskOf(await complete(w, b, declaredOf(w)))
    expect(mirrorAt(w)).toBe(n2)
    expect(await mirrorBusy(w.remote, w.ws, w.handle.worktreeId, 'A')).toEqual({ busy: true, holder: 'B', reason: 'pending_review' })
    // The replay is planned first (a completed task: forward), so the busy check never runs, and its stamp names A's own
    // result commit, not the mirror's current one, so Collab sees the identical request and returns the receipt.
    expect(taskOf(await complete(w, a, declaredOf(w), { key: k }))).toEqual(doneA)
    expect(mirrorAt(w)).toBe(n2)
    // A's ref already holds its head, so the replay finds nothing to write and nothing to report, though the mirror moved.
    expect([tasksRef(w, 'A'), w.ledger.filter((f) => f.event === 'tasks_ref')]).toEqual([n1, []])
  }, T)

  test('a duplicate complete under a new key leaves the mirror unmoved', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a')
    taskOf(await complete(w, t, declaredOf(w)))
    commitFiles(w.share, { 'notes/b.md': 'b\n' }, 'b')
    const before = fetches(w)
    expect(collabError(await complete(w, t, declaredOf(w)))).toBe('version_conflict')
    expect(fetches(w)).toBe(before)
    expect([mirrorAt(w), tasksRef(w, 'T')]).toEqual([n1, n1])
  }, T)

  test('a complete after the lease expired is forwarded without a sync, and a later takeover passes', async () => {
    const w = await world()
    const t = await claimed(w)
    commitFiles(w.share, { 'notes/a.md': 'late\n' }, 'late')
    expireLease(w.journal, 'T')
    const before = fetches(w)
    expect(collabError(await complete(w, t, declaredOf(w)))).toBe('lease_expired')
    expect(fetches(w)).toBe(before)
    expect(mirrorAt(w)).toBe(w.base)
    const expired = (await readTask(w.remote, w.ws, 'T'))!
    expect(expired.effective_status).toBe('recovery_required')
    const back = taskOf(await takeover(w, expired, declaredOf(w), 'back after a drop'))
    expect([back.status, back.assignee_session_id, back.base_checkpoint.head_sha]).toEqual(['claimed', w.sessionId, w.base])
  }, T)

  test('a same-key claim replay leaves the mirror at the base', async () => {
    const w = await world()
    const task = await createEdit(w, 'T')
    const k = key()
    const first = taskOf(await claim(w, task, declaredOf(w), { key: k }))
    commitFiles(w.share, { 'notes/a.md': 'after the claim\n' }, 'work')
    const before = fetches(w)
    expect(taskOf(await claim(w, task, declaredOf(w), { key: k }))).toEqual(first)
    expect(fetches(w)).toBe(before)
    expect(mirrorAt(w)).toBe(w.base)
  }, T)

  test('a first-time complete still syncs', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'first\n' }, 'first')
    const before = fetches(w)
    taskOf(await complete(w, t, declaredOf(w)))
    expect(fetches(w)).toBe(before + 1)
    expect(mirrorAt(w)).toBe(n1)
  }, T)

  test('the stamp is rebuilt identically on a replay', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'stamped\n' }, 'stamped')
    const rec = recording(w.remote)
    const k = key()
    const first = taskOf(await complete(w, t, declaredOf(w), { key: k, limits: 'seat note\u202e', child: rec.child }))
    commitFiles(w.share, { 'notes/b.md': 'moved on\n' }, 'moved on')
    const again = taskOf(await complete(w, t, declaredOf(w), { key: k, limits: 'seat note\u202e', child: rec.child }))
    expect(again).toEqual(first)
    const sent = rec.calls.filter((c) => c.name === 'collab_task_complete').map((c) => c.args)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0]!)
    expect(sent[0]!.limits).toBe(stampOf(n1, { seat: 'seat note' })) // N2 dropped the bidi override
  }, T)
})

describe('takeover, review and the mirror', () => {
  test('takeover is never synced and carries the recovery stamp', async () => {
    const w = await world()
    await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'work in progress\n' }, 'wip')
    expireLease(w.journal, 'T')
    const before = fetches(w)
    const expired = (await readTask(w.remote, w.ws, 'T'))!
    taskOf(await takeover(w, expired, declaredOf(w), 'picking it up again'))
    expect(fetches(w)).toBe(before)
    expect(mirrorAt(w)).toBe(w.base)
    const events = (await airOk(w.air, 'collab_events_since', { workspace_id: w.ws })).events as any[]
    const recovered = events.filter((e) => e.type === 'task.recovered').map((e) => e.payload.recovery_note)
    expect(recovered).toEqual([`hub-observed: mirror at ${w.base}, not refetched; device HEAD ${n1} self-declared\npicking it up again`])
  }, T)

  test('a takeover is refused mirror_busy while another edit task awaits review from the mirror', async () => {
    const w = await world()
    const a = await claimed(w, 'A')
    commitFiles(w.share, { 'notes/a.md': 'a\n' }, 'a')
    taskOf(await complete(w, a, declaredOf(w)))
    // B was claimed by an Air session and its lease ran out; the remote seat may not take it over onto a busy mirror.
    const b = await createEdit(w, 'B', { scopes: ['docs'], base: null })
    await airOk(w.air, 'collab_task_claim', { workspace_id: w.ws, task_id: 'B', idempotency_key: key(), expected_version: b.version })
    expireLease(w.journal, 'B')
    const expired = (await readTask(w.remote, w.ws, 'B'))!
    const rec = recording(w.remote)
    expect(await takeover(w, expired, declaredOf(w), 'taking B', { child: rec.child }))
      .toMatchObject({ kind: 'refuse', code: 'mirror_busy', extra: { holder_task_id: 'A', reason: 'pending_review' } })
    expect(rec.calls.map((c) => c.name)).not.toContain('collab_task_recover')
  }, T)

  test('a takeover of a reported-policy edit task is remote_review_required', async () => {
    const w = await world()
    const task = await createEdit(w, 'R', { policy: 'reported' })
    const rec = recording(w.remote)
    expect(await takeover(w, task, declaredOf(w), 'mine now', { child: rec.child })).toMatchObject({ kind: 'refuse', code: 'remote_review_required' })
    expect(rec.calls.map((c) => c.name)).toEqual(['collab_task_get'])
  }, T)

  test('the checkpoint is stable across two syncs of the same commit', async () => {
    const w = await world()
    const t = await claimed(w)
    const before = fetches(w)
    const done = taskOf(await complete(w, t, declaredOf(w))) // Nuance's HEAD is still the base: the same commit again
    expect(fetches(w)).toBe(before + 1)
    const pick = (c: any) => [c.head_sha, c.index_sha256, c.state_sha256]
    expect(pick(done.result_checkpoint)).toEqual(pick(t.base_checkpoint))
    expect(await completionLimits(w, done)).toBe(stampOf(w.base, { equalsBase: true }))
  }, T)

  test('remote_head_moved then a retry works', async () => {
    const w = await world()
    const t = await claimed(w)
    commitFiles(w.share, { 'notes/a.md': 'one\n' }, 'one')
    const stale = declaredOf(w)
    const n2 = commitFiles(w.share, { 'notes/b.md': 'two\n' }, 'two')
    expect(await complete(w, t, stale)).toMatchObject({ kind: 'refuse', code: 'remote_head_moved' })
    expect(mirrorAt(w)).toBe(w.base)
    expect(taskOf(await complete(w, t, declaredOf(w))).result_checkpoint.head_sha).toBe(n2)
  }, T)

  test('a failed checkout then a resync works', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'one\n' }, 'one')
    w.faults.checkoutOf = n1
    expect(await complete(w, t, declaredOf(w))).toMatchObject({ kind: 'refuse', code: 'checkout_failed' })
    expect([mirrorAt(w), syncedAt(w)]).toEqual([w.base, w.base])
    expect(taskOf(await complete(w, t, declaredOf(w))).result_checkpoint.head_sha).toBe(n1)
    expect(mirrorAt(w)).toBe(n1)
  }, T)

  test('no sync happens before review', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'reviewed\n' }, 'reviewed')
    const done = taskOf(await complete(w, t, declaredOf(w)))
    commitFiles(w.share, { 'notes/b.md': 'later work\n' }, 'later work')
    const before = fetches(w)
    expect((await airReview(w, done, 'accept')).review_status).toBe('accepted')
    expect(fetches(w)).toBe(before)
    expect(mirrorAt(w)).toBe(n1)
  }, T)

  test('an edit flow on a mirror whose HEAD cannot be read refuses mirror_tampered', async () => {
    const w = await world()
    const task = await createEdit(w, 'T')
    writeFileSync(join(w.spec.mirrorPath, '.git'), 'gitdir: /nonexistent/collab-bridge-test\n')
    const rec = recording(w.remote)
    expect(await claim(w, task, declaredOf(w), { child: rec.child })).toMatchObject({ kind: 'refuse', code: 'mirror_tampered' })
    expect(rec.calls).toEqual([])
  }, T)

  test('artifact_attach is forwarded once and waits for the mirror lock', async () => {
    const w = await world()
    const t = await claimed(w)
    let release!: () => void
    const held = w.handle.lock.run(() => new Promise<void>((r) => { release = r }))
    const rec = recording(w.remote)
    const attach = runEditFlow(ctxOf(w, 'attach', 'collab_artifact_attach', { workspace_id: w.ws, task_id: t.id, lease_id: t.lease_id,
      idempotency_key: key(), expected_version: t.version, kind: 'file', uri: 'notes/a.md' }, undefined, { child: rec.child }))
    await Bun.sleep(200)
    expect(rec.calls).toEqual([])
    release()
    await held
    const r = await attach
    expect(r.kind === 'outcome' && r.outcome.outcome).toBe('ok')
    expect(rec.calls.map((c) => c.name)).toEqual(['collab_artifact_attach'])
  }, T)

  test('an attach whose deadline passes while the mirror lock is held is refused hub_away and never forwarded', async () => {
    const w = await world()
    const t = await claimed(w)
    let release!: () => void
    const held = w.handle.lock.run(() => new Promise<void>((r) => { release = r }))
    const rec = recording(w.remote)
    const clock = { mono: 5_000 }
    const attach = runEditFlow(ctxOf(w, 'attach', 'collab_artifact_attach', { workspace_id: w.ws, task_id: t.id, lease_id: t.lease_id,
      idempotency_key: key(), expected_version: t.version, kind: 'file', uri: 'notes/a.md' }, undefined,
      { child: rec.child, notAfterMono: 64_000, mono: () => clock.mono }))
    await Bun.sleep(50) // the held run has the lock; the attach waits behind it
    expect(rec.calls).toEqual([])
    clock.mono = 64_000 // the forwarder's notAfter: timeout_ms less TIMING.callMinRemainingMs
    release()
    await held
    expect(await attach).toEqual({ kind: 'refuse', code: 'hub_away', message: FLOW_MESSAGES.late, extra: { reason: 'deadline_passed' } })
    expect(rec.calls).toEqual([])
  }, T)

  test('an attach whose child stops while it waits for the mirror lock is refused hub_away and never forwarded', async () => {
    const w = await world()
    const t = await claimed(w)
    let release!: () => void
    const held = w.handle.lock.run(() => new Promise<void>((r) => { release = r }))
    const rec = recording(w.remote)
    const attach = runEditFlow(ctxOf(w, 'attach', 'collab_artifact_attach', { workspace_id: w.ws, task_id: t.id, lease_id: t.lease_id,
      idempotency_key: key(), expected_version: t.version, kind: 'file', uri: 'notes/a.md' }, undefined, { child: rec.child }))
    await Bun.sleep(50) // the held run has the lock; the attach waits behind it
    const stopping = w.remote.stop(2000) // a park, an end or a drain while the call waits (Task 37's accepting())
    expect(w.remote.accepting()).toBe(false)
    release()
    await held
    expect(await attach).toEqual({ kind: 'refuse', code: 'hub_away', message: FLOW_MESSAGES.childStopped })
    expect(rec.calls).toEqual([])
    await stopping
  }, T)
})

// ---- Task 45 fix round 1 ----

/** A claimed task whose lease has run out, as Collab reads it (recovery_required): where a takeover starts. */
async function expiredClaim(w: World, id = 'T'): Promise<any> {
  await claimed(w, id)
  expireLease(w.journal, id)
  return (await readTask(w.remote, w.ws, id))!
}

describe('takeover replays', () => {
  // §7.6 / K24: a takeover's note names the mirror's last synced commit and the device HEAD the pipe declared, and Collab
  // holds neither, so a replay is byte-identical only while both are unchanged; otherwise Collab answers idempotency_conflict.
  test('a same-key takeover replay with the same declared head sends the same bytes and returns the stored receipt', async () => {
    const w = await world()
    const expired = await expiredClaim(w)
    commitFiles(w.share, { 'notes/a.md': 'work in progress\n' }, 'wip')
    const rec = recording(w.remote)
    const k = key()
    const first = taskOf(await takeover(w, expired, declaredOf(w), 'picking it up again', { key: k, child: rec.child }))
    const again = taskOf(await takeover(w, expired, declaredOf(w), 'picking it up again', { key: k, child: rec.child }))
    expect(again).toEqual(first)
    const sent = rec.calls.filter((c) => c.name === 'collab_task_recover').map((c) => c.args)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0]!)
    expect(first.status).toBe('claimed')
  }, T)

  test('a same-key takeover replay after the device HEAD moved answers idempotency_conflict and leaves the task as the first call made it', async () => {
    const w = await world()
    const expired = await expiredClaim(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'work in progress\n' }, 'wip')
    const rec = recording(w.remote)
    const k = key()
    const first = taskOf(await takeover(w, expired, declaredOf(w), 'picking it up again', { key: k, child: rec.child }))
    const n2 = commitFiles(w.share, { 'notes/b.md': 'more work\n' }, 'more')
    const before = fetches(w)
    expect(collabError(await takeover(w, expired, declaredOf(w), 'picking it up again', { key: k, child: rec.child }))).toBe('idempotency_conflict')
    const sent = rec.calls.filter((c) => c.name === 'collab_task_recover').map((c) => String(c.args.recovery_note))
    expect(sent).toEqual([
      `hub-observed: mirror at ${w.base}, not refetched; device HEAD ${n1} self-declared\npicking it up again`,
      `hub-observed: mirror at ${w.base}, not refetched; device HEAD ${n2} self-declared\npicking it up again`,
    ])
    const now = (await airOk(w.air, 'collab_task_get', { workspace_id: w.ws, task_id: 'T' })).task
    expect([now.version, now.status, now.lease_id, now.assignee_session_id]).toEqual([first.version, first.status, first.lease_id, first.assignee_session_id])
    expect(fetches(w)).toBe(before) // a takeover never syncs, replay or not
    expect(mirrorAt(w)).toBe(w.base)
  }, T)
})

describe('stamps Collab itself refuses to go without', () => {
  // The hub forwards a non-string limits and a missing recovery_note untouched, for Collab to refuse: its zod schemas are
  // recovery_note z.string().min(1).max(4000) (required, KN src/mcp.ts:659) and limits z.string().max(2000).optional()
  // (KN src/mcp.ts:802), and neither accepts null or a missing note, so nothing lands without a hub-observed line.
  test('a complete with limits null is forwarded as it came and Collab refuses it: the task stays claimed with no completion report', async () => {
    const w = await world()
    const t = await claimed(w)
    commitFiles(w.share, { 'notes/a.md': 'null limits\n' }, 'null limits')
    const rec = recording(w.remote)
    const r = await runEditFlow(ctxOf(w, 'complete', 'collab_task_complete', { ...completeArgs(w, t), limits: null }, declaredOf(w), { child: rec.child }))
    expect(r.kind === 'outcome' && r.outcome.outcome).toBe('error')
    const sent = rec.calls.filter((c) => c.name === 'collab_task_complete')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.args.limits).toBeNull() // not stamped
    const now = (await airOk(w.air, 'collab_task_get', { workspace_id: w.ws, task_id: 'T' })).task
    expect([now.status, now.result_checkpoint, now.completion_report_id ?? null]).toEqual(['claimed', null, null])
    expect((await airOk(w.air, 'collab_report_list', { workspace_id: w.ws, task_id: 'T' })).reports).toEqual([])
    expect(w.ledger.filter((f) => f.event === 'tasks_ref')).toEqual([])
    expect(tasksRef(w, 'T')).toBeNull()
  }, T)

  test('a takeover with no recovery_note is forwarded as it came and Collab refuses it: the task stays recovery_required', async () => {
    const w = await world()
    const expired = await expiredClaim(w)
    const rec = recording(w.remote)
    const { recovery_note: _gone, ...noNote } = takeoverArgs(w, expired, 'unused')
    const r = await runEditFlow(ctxOf(w, 'takeover', 'collab_task_recover', noNote, declaredOf(w), { child: rec.child }))
    expect(r.kind === 'outcome' && r.outcome.outcome).toBe('error')
    const sent = rec.calls.filter((c) => c.name === 'collab_task_recover')
    expect(sent).toHaveLength(1)
    expect('recovery_note' in sent[0]!.args).toBe(false) // not stamped
    expect((await readTask(w.remote, w.ws, 'T'))?.effective_status).toBe('recovery_required')
    const events = (await airOk(w.air, 'collab_events_since', { workspace_id: w.ws })).events as any[]
    expect(events.filter((e) => e.type === 'task.recovered')).toEqual([])
  }, T)
})

/** Everything written to process.stderr while `run` runs (kept out of the test output), and the lines the hub wrote. */
async function withStderr<V>(run: () => Promise<V>): Promise<{ value: V; hub: string[] }> {
  const written: string[] = []
  const spy = spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    written.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
    return true
  }) as typeof process.stderr.write)
  try {
    const value = await run()
    return { value, hub: written.filter((l) => l.startsWith('collab-bridge hub: ')) }
  } finally {
    spy.mockRestore()
  }
}

describe('a fault the flow did not expect', () => {
  // The cause goes to the hub's stderr (launchd's hub.log, spec §10.4), because the ledger stays content-free: an
  // error name and message in printable ASCII cut at 200 characters, and never the seat's text.
  test('a syncMirror that throws is the syncFault refusal, logs its cause as one ASCII line, forwards nothing and leaves the lock free', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'sync will throw\n' }, 'sync will throw')
    w.faults.rejectCheckoutOf = n1 // the fetch is real; the checkout of the fetched commit rejects, as a spawn failure would
    const rec = recording(w.remote)
    const { value, hub } = await withStderr(() => complete(w, t, declaredOf(w), { child: rec.child, limits: 'SEAT-TEXT-MARKER' }))
    expect(value).toEqual({ kind: 'refuse', code: 'mirror_tampered', message: FLOW_MESSAGES.syncFault })
    expect(rec.calls.map((c) => c.name)).not.toContain('collab_task_complete')
    const label = 'collab-bridge hub: complete nuance/macair: sync fault: '
    expect(hub).toHaveLength(1)
    expect(hub[0]!.startsWith(`${label}Error: injected git failure ? xxx`)).toBe(true)
    expect(hub[0]!.slice(label.length)).toMatch(/^[\x20-\x7e]{200}\n$/) // printable ASCII, cut at 200
    expect(hub[0]).not.toContain('SEAT-TEXT-MARKER')
    expect(syncedAt(w)).toBe(w.base)
    expect(taskOf(await complete(w, t, declaredOf(w))).result_checkpoint.head_sha).toBe(n1) // the lock was released
  }, T)

  test('a tasks ref write that throws still answers Collab\'s result, ledgers tasks_ref without content and logs one ASCII line', async () => {
    const w = await world()
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'ref will throw\n' }, 'ref will throw')
    w.faults.rejectUpdateRefOf = mirrorRefs(w.spec).task('T')
    const { value, hub } = await withStderr(() => complete(w, t, declaredOf(w), { limits: 'SEAT-TEXT-MARKER' }))
    const done = taskOf(value)
    expect([done.status, done.result_checkpoint.head_sha]).toEqual(['completed', n1])
    expect(w.ledger.filter((f) => f.event === 'tasks_ref')).toEqual([{ event: 'tasks_ref', device: 'nuance', user: 'macair', code: 'mirror_tampered', outcome: 'refused' }])
    expect(tasksRef(w, 'T')).toBeNull()
    const label = 'collab-bridge hub: complete nuance/macair: tasks ref fault: '
    expect(hub).toHaveLength(1)
    expect(hub[0]!.startsWith(`${label}Error: injected git failure ? xxx`)).toBe(true)
    expect(hub[0]!.slice(label.length)).toMatch(/^[\x20-\x7e]{200}\n$/)
    expect(hub[0]).not.toContain('SEAT-TEXT-MARKER')
  }, T)

  test("a result with no result_checkpoint head_sha writes no ref, ledgers tasks_ref missing and still returns Collab's result", async () => {
    const w = await world()
    const t = await claimed(w)
    commitFiles(w.share, { 'notes/a.md': 'no head\n' }, 'no head')
    const rec = recording(w.remote, undefined, { rewrite: { name: 'collab_task_complete', to: (real) => {
      if (real.outcome === 'unknown') return real
      const c = structuredClone(real)
      ;(c.result.structuredContent as any).task.result_checkpoint.head_sha = null
      return c
    } } })
    const r = await complete(w, t, declaredOf(w), { child: rec.child })
    const done = taskOf(r)
    expect([done.status, done.result_checkpoint.head_sha]).toEqual(['completed', null])
    expect(w.ledger.filter((f) => f.event === 'tasks_ref')).toEqual([{ event: 'tasks_ref', device: 'nuance', user: 'macair', code: 'missing', outcome: 'refused' }])
    expect(tasksRef(w, 'T')).toBeNull()
  }, T)
})

type Flow3 = 'claim' | 'complete' | 'takeover'
const FLOWS: Flow3[] = ['claim', 'complete', 'takeover']
const FORWARDED: Record<Flow3, string> = { claim: 'collab_task_claim', complete: 'collab_task_complete', takeover: 'collab_task_recover' }
const NOT_AFTER = 64_000 // the forwarder's notAfter on the hub's monotonic clock
const PAST = 70_000

/**
 * One task in the state a remote `flow` starts from, plus one new commit on Nuance that a sync would fetch (a takeover
 * never syncs, so it never fetches it). `effective` is the task's effective_status until the flow applies.
 */
async function readyFor(w: World, flow: Flow3) {
  if (flow === 'claim') {
    const task = await createEdit(w, 'T', { base: null }) // no expected base: the claim may name any commit
    const n1 = commitFiles(w.share, { 'notes/a.md': 'fetched\n' }, 'work')
    return { n1, effective: 'open', run: (o: FlowOpts = {}) => claim(w, task, declaredOf(w), o) }
  }
  if (flow === 'complete') {
    const t = await claimed(w)
    const n1 = commitFiles(w.share, { 'notes/a.md': 'fetched\n' }, 'work')
    return { n1, effective: 'claimed', run: (o: FlowOpts = {}) => complete(w, t, declaredOf(w), o) }
  }
  const expired = await expiredClaim(w)
  const n1 = commitFiles(w.share, { 'notes/a.md': 'never fetched\n' }, 'work')
  return { n1, effective: 'recovery_required', run: (o: FlowOpts = {}) => takeover(w, expired, declaredOf(w), 'again', o) }
}

const LATE_REFUSAL: EditFlowOutcome = { kind: 'refuse', code: 'hub_away', message: FLOW_MESSAGES.late, extra: { reason: 'deadline_passed' } }

describe('every way a flow is stopped before the forward', () => {
  for (const flow of FLOWS) {
    test(`a ${flow} whose deadline has passed when it gets the lock is hub_away and nothing is read, fetched or sent`, async () => {
      const w = await world()
      const ready = await readyFor(w, flow)
      const rec = recording(w.remote)
      const before = fetches(w)
      expect(await ready.run({ child: rec.child, notAfterMono: NOT_AFTER, mono: () => PAST })).toEqual(LATE_REFUSAL)
      expect(rec.calls).toEqual([])
      expect([fetches(w), mirrorAt(w)]).toEqual([before, w.base])
    }, T)

    test(`a ${flow} whose deadline passes after the sync (a takeover has none) and before the forward is hub_away: the mirror stays at the fetched commit and nothing is forwarded`, async () => {
      const w = await world()
      const ready = await readyFor(w, flow)
      const clock = { mono: 5_000 }
      const deps: MirrorDeps = { ...w.deps, ledger: (f) => { w.deps.ledger(f); if (f.event === 'fetch') clock.mono = PAST } }
      // A takeover has no fetch to flip the clock: it flips when the hub reads which tasks hold the mirror.
      const rec = recording(w.remote, flow === 'takeover' ? { name: 'collab_task_list', run: async () => { clock.mono = PAST } } : undefined)
      const before = fetches(w)
      expect(await ready.run({ child: rec.child, deps, notAfterMono: NOT_AFTER, mono: () => clock.mono })).toEqual(LATE_REFUSAL)
      expect(rec.calls.map((c) => c.name)).not.toContain(FORWARDED[flow])
      if (flow === 'takeover') {
        expect([fetches(w), mirrorAt(w)]).toEqual([before, w.base])
      } else {
        expect([fetches(w), mirrorAt(w), syncedAt(w)]).toEqual([before + 1, ready.n1, ready.n1])
      }
      expect((await readTask(w.remote, w.ws, 'T'))?.effective_status).toBe(ready.effective)
    }, T)

    test(`a ${flow} whose child stops accepting after the task read is hub_away childStopped and nothing is forwarded`, async () => {
      const w = await world()
      const ready = await readyFor(w, flow)
      const rec = recording(w.remote, undefined, { stopAfter: 'collab_task_get' })
      expect(await ready.run({ child: rec.child })).toEqual({ kind: 'refuse', code: 'hub_away', message: FLOW_MESSAGES.childStopped })
      expect(rec.calls[0]!.name).toBe('collab_task_get')
      expect(rec.calls.map((c) => c.name)).not.toContain(FORWARDED[flow])
      expect((await readTask(w.remote, w.ws, 'T'))?.effective_status).toBe(ready.effective)
    }, T)

    test(`a ${flow} on a mirror whose HEAD reads but is not the synced commit refuses mirror_tampered and sends nothing`, async () => {
      const w = await world()
      const ready = await readyFor(w, flow)
      const tampered = commitFiles(w.spec.mirrorPath, { 'tampered.txt': 'someone committed here\n' }, 'tampered')
      const rec = recording(w.remote)
      const before = fetches(w)
      expect(await ready.run({ child: rec.child })).toEqual({ kind: 'refuse', code: 'mirror_tampered', message: FLOW_MESSAGES.tampered })
      expect(rec.calls).toEqual([])
      expect([fetches(w), mirrorAt(w), syncedAt(w)]).toEqual([before, tampered, w.base])
    }, T)
  }

  // Task 63 conformance-3-1, pipe-1-1: the lineage's end (collab_session_end in flight or settled) reaches a flow that waited.
  const ENDING = { code: 'hub_away', message: 'a collab_session_end is in flight' } as const
  const ENDED = { code: 'seat_session_ended', message: 'the session has ended' } as const

  for (const flow of FLOWS) {
    test(`a ${flow} that gets the lock after its lineage's end began is refused with the lineage's own answer, and nothing is read, fetched or sent`, async () => {
      const w = await world()
      const ready = await readyFor(w, flow)
      const rec = recording(w.remote)
      const before = fetches(w)
      expect(await ready.run({ child: rec.child, barrier: () => ENDING })).toEqual({ kind: 'refuse', ...ENDING })
      expect(rec.calls).toEqual([])
      expect([fetches(w), mirrorAt(w)]).toEqual([before, w.base])
    }, T)

    test(`a ${flow} whose lineage's end begins after the reads (and the sync, which a takeover has not) and before the forward is refused: nothing is forwarded`, async () => {
      const w = await world()
      const ready = await readyFor(w, flow)
      const state = { ended: false }
      // The end begins while the flow works: a takeover has no fetch, so it begins when the hub reads which tasks hold the mirror.
      const deps: MirrorDeps = { ...w.deps, ledger: (f) => { w.deps.ledger(f); if (f.event === 'fetch') state.ended = true } }
      const rec = recording(w.remote, flow === 'takeover' ? { name: 'collab_task_list', run: async () => { state.ended = true } } : undefined)
      const before = fetches(w)
      expect(await ready.run({ child: rec.child, deps, barrier: () => (state.ended ? ENDED : null) })).toEqual({ kind: 'refuse', ...ENDED })
      expect(rec.calls.map((c) => c.name)).not.toContain(FORWARDED[flow])
      if (flow !== 'takeover') expect([fetches(w), mirrorAt(w)]).toEqual([before + 1, ready.n1]) // the mirror stays at the fetched commit, as for a late call
      expect((await readTask(w.remote, w.ws, 'T'))?.effective_status).toBe(ready.effective)
    }, T)

    test(`a ${flow} whose lineage's end begins after the busy read and before the sync fetches nothing`, async () => {
      if (flow === 'takeover') return // a takeover never syncs
      const w = await world()
      const ready = await readyFor(w, flow)
      const state = { ended: false }
      const rec = recording(w.remote, { name: 'collab_task_list', run: async () => { state.ended = true } })
      const before = fetches(w)
      expect(await ready.run({ child: rec.child, barrier: () => (state.ended ? ENDING : null) })).toEqual({ kind: 'refuse', ...ENDING })
      expect(rec.calls.map((c) => c.name)).not.toContain(FORWARDED[flow])
      expect([fetches(w), mirrorAt(w), syncedAt(w)]).toEqual([before, w.base, w.base])
    }, T)
  }

  test('an artifact_attach that gets the lock after its lineage has ended is refused and never forwarded', async () => {
    const w = await world()
    const t = await claimed(w)
    const rec = recording(w.remote)
    const attach = runEditFlow(ctxOf(w, 'attach', 'collab_artifact_attach', { workspace_id: w.ws, task_id: t.id, lease_id: t.lease_id,
      idempotency_key: key(), expected_version: t.version, kind: 'file', uri: 'notes/a.md' }, undefined, { child: rec.child, barrier: () => ENDED }))
    expect(await attach).toEqual({ kind: 'refuse', ...ENDED })
    expect(rec.calls).toEqual([])
  }, T)

  for (const flow of ['claim', 'complete'] as const) {
    test(`a ${flow} whose deadline passes after the busy read and before the sync is hub_away: nothing is fetched or forwarded`, async () => {
      const w = await world()
      const ready = await readyFor(w, flow)
      const clock = { mono: 5_000 }
      const rec = recording(w.remote, { name: 'collab_task_list', run: async () => { clock.mono = PAST } })
      const before = fetches(w)
      expect(await ready.run({ child: rec.child, notAfterMono: NOT_AFTER, mono: () => clock.mono })).toEqual(LATE_REFUSAL)
      expect(rec.calls.map((c) => c.name)).not.toContain(FORWARDED[flow])
      expect([fetches(w), mirrorAt(w), syncedAt(w)]).toEqual([before, w.base, w.base])
    }, T)
  }

  test('a task the hub cannot read is mirror_busy with exactly the reason read_failed, and nothing else is sent', async () => {
    const w = await world()
    const task = await createEdit(w, 'T')
    const rec = recording(w.remote, undefined, { unknownFor: 'collab_task_get' })
    const before = fetches(w)
    expect(await claim(w, task, declaredOf(w), { child: rec.child }))
      .toEqual({ kind: 'refuse', code: 'mirror_busy', message: FLOW_MESSAGES.readFailed, extra: { reason: 'read_failed' } })
    expect(rec.calls.map((c) => c.name)).toEqual(['collab_task_get'])
    expect(fetches(w)).toBe(before)
  }, T)

  test('a busy read that fails is mirror_busy readFailed with the reason read_failed, and nothing is fetched or forwarded', async () => {
    const w = await world()
    const task = await createEdit(w, 'T')
    const rec = recording(w.remote, undefined, { unknownFor: 'collab_task_list' })
    const before = fetches(w)
    expect(await claim(w, task, declaredOf(w), { child: rec.child }))
      .toMatchObject({ kind: 'refuse', code: 'mirror_busy', message: FLOW_MESSAGES.readFailed, extra: { reason: 'read_failed' } })
    expect(rec.calls.map((c) => c.name)).toEqual(['collab_task_get', 'collab_task_list'])
    expect(fetches(w)).toBe(before)
  }, T)

  test('an edit takeover with no declared head is fetch_failed noDeclared and nothing is sent', async () => {
    const w = await world()
    const expired = await expiredClaim(w)
    const rec = recording(w.remote)
    expect(await takeover(w, expired, undefined, 'again', { child: rec.child }))
      .toEqual({ kind: 'refuse', code: 'fetch_failed', message: PLAN_MESSAGES.noDeclared })
    expect(rec.calls.map((c) => c.name)).toEqual(['collab_task_get'])
  }, T)
})
