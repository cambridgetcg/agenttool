// The one-task rule against real Collab (spec §7.2, §12.2 "One-task rule"): a remote session rooted at a linked
// worktree of the Air clone (the mirror, as createMirror leaves it) and an Air session in the clone itself, both on one
// temp shared journal. No fetch is needed: the rule reads only Collab's task projection.
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mirrorBusy } from '../src/air/busy.ts'
import { CollabChild } from '../src/air/children.ts'
import { listTasks, readTask, taskFromResult, tasksFromResult } from '../src/air/tasks.ts'
import type { ToolResult } from '../src/link/messages.ts'
import { cleanupTmps, COLLAB_DIST, makeRepo, repoGit, temp } from './helpers.ts'
import { collabHarness, type StdioHarness } from './mcp-harness.ts'

const running: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const stop of running.splice(0).reverse()) await stop()
  cleanupTmps()
})

const T = 30_000 // each world starts two Collab children

async function startChild(journal: string, home: string): Promise<CollabChild> {
  const c = await CollabChild.start({ bun: process.execPath, dist: COLLAB_DIST, journal, home })
  if (!(c instanceof CollabChild)) throw new Error(`a Collab child did not start: ${c.lastErrLine}`)
  running.push(() => c.stop())
  return c
}

/** A Collab call that must succeed; returns its structuredContent. */
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

interface World { root: string; home: string; journal: string; base: string; ws: string; mirrorWt: string; remote: CollabChild; air: StdioHarness }

async function world(): Promise<World> {
  const root = temp('cb-busy-')
  const home = join(root, 'home')
  mkdirSync(home)
  const airClone = join(root, 'air', 'collab-trial')
  const base = makeRepo(airClone)
  // The mirror as createMirror leaves it (Task 42): a detached linked worktree of the Air clone at the shared base.
  const mirror = join(root, 'collab-shared', 'mirrors', 'nuance', 'macair', '0123456789abcdef')
  mkdirSync(dirname(mirror), { recursive: true })
  repoGit(airClone, ['worktree', 'add', '--detach', mirror, base])
  const journal = join(root, 'collab-shared', 'collab.sqlite')
  const remote = await startChild(journal, home)
  const started = await ok(remote, 'collab_session_start', { root_path: mirror, actor: 'nuance/macair · self-declared: busy test' })
  const air = collabHarness({ journal, home })
  running.push(() => air.close())
  await air.initialize()
  const airStart = await airOk(air, 'collab_session_start', { root_path: airClone, actor: 'air reviewer' })
  // A linked worktree shares the clone's local-git key, so both sessions land in one workspace (K11).
  expect(airStart.workspace.id).toBe(started.workspace.id)
  return { root, home, journal, base, ws: started.workspace.id, mirrorWt: started.worktree.id, remote, air }
}

let n = 0
const key = () => `busy-key-${++n}`

function createEdit(w: World, id: string, o: { policy?: 'accepted' | 'reported' } = {}): Promise<any> {
  return airOk(w.air, 'collab_task_create', { workspace_id: w.ws, idempotency_key: key(), task_id: id, title: `task ${id}`,
    work_mode: 'edit', completion_policy: o.policy ?? 'accepted', path_scopes: ['notes'], expected_base_sha: w.base }).then((r) => r.task)
}
const remoteClaim = (w: World, t: any) =>
  ok(w.remote, 'collab_task_claim', { workspace_id: w.ws, task_id: t.id, idempotency_key: key(), expected_version: t.version }).then((r) => r.task)
const remoteComplete = (w: World, t: any) =>
  ok(w.remote, 'collab_task_complete', { workspace_id: w.ws, task_id: t.id, lease_id: t.lease_id, idempotency_key: key(),
    expected_version: t.version, summary: 'done' }).then((r) => r.task)
const airReview = (w: World, t: any, outcome: 'accept' | 'request_changes') =>
  airOk(w.air, 'collab_task_review', { workspace_id: w.ws, task_id: t.id, idempotency_key: key(), expected_version: t.version,
    outcome, summary: outcome === 'accept' ? 'looks right' : 'please change' }).then((r) => r.task)

describe('task views', () => {
  const task = {
    id: 'A', workspace_id: 'ws_x', title: 'x', status: 'claimed', effective_status: 'recovery_required', work_mode: 'edit',
    completion_policy: 'accepted', review_status: 'not_required', assignee_session_id: 'session_1', lease_id: 'lease_1',
    lease_expires_at: '2000-01-01T00:00:00.000Z', expected_base_sha: 'a'.repeat(40),
    base_checkpoint: { worktree_id: 'wt_1', head_sha: 'a'.repeat(40), index_sha256: 'b'.repeat(64), source: 'server_observed' },
    claim_worktree_id: 'wt_1', result_checkpoint: null, path_scopes: ['notes'], version: 3, assignee: 'nuance/macair · self-declared: x',
  }
  const result = (sc: Record<string, unknown>, isError = false): ToolResult => ({ content: [{ type: 'text', text: '{}' }], structuredContent: sc, ...(isError ? { isError } : {}) })

  test('taskFromResult keeps exactly the fields the hub decides on', () => {
    expect(taskFromResult(result({ task }))).toEqual({
      id: 'A', version: 3, status: 'claimed', effective_status: 'recovery_required', work_mode: 'edit', completion_policy: 'accepted',
      review_status: 'not_required', assignee_session_id: 'session_1', lease_id: 'lease_1', lease_expires_at: '2000-01-01T00:00:00.000Z',
      expected_base_sha: 'a'.repeat(40), base_checkpoint: { worktree_id: 'wt_1', head_sha: 'a'.repeat(40) }, claim_worktree_id: 'wt_1',
      result_checkpoint: null, path_scopes: ['notes'],
    })
  })

  test('an isError result, a missing task or a malformed field reads as null', () => {
    expect(taskFromResult(result({ task }, true))).toBeNull()
    expect(taskFromResult(result({}))).toBeNull()
    expect(taskFromResult(result({ task: { ...task, status: 'done' } }))).toBeNull()
    expect(taskFromResult(result({ task: { ...task, version: 0 } }))).toBeNull()
    expect(taskFromResult(result({ task: { ...task, claim_worktree_id: 7 } }))).toBeNull()
    expect(taskFromResult(result({ task: { ...task, base_checkpoint: { head_sha: 'a'.repeat(40) } } }))).toBeNull()
    expect(taskFromResult(result({ task: { ...task, path_scopes: ['notes', 3] } }))).toBeNull()
  })

  test('one malformed entry makes a whole task page unreadable', () => {
    expect(tasksFromResult(result({ tasks: [task, task] }))?.length).toBe(2)
    expect(tasksFromResult(result({ tasks: [task, { ...task, work_mode: 'write' }] }))).toBeNull()
    expect(tasksFromResult(result({ tasks: 'none' }))).toBeNull()
  })
})

describe('the one-task rule', () => {
  test('a claimed edit task on the mirror keeps it busy', async () => {
    const w = await world()
    const a = await remoteClaim(w, await createEdit(w, 'A'))
    expect(a.claim_worktree_id).toBe(w.mirrorWt)
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'B')).toEqual({ busy: true, holder: 'A', reason: 'claimed' })
  }, T)

  test('a pending review keeps it busy', async () => {
    const w = await world()
    const a = await remoteComplete(w, await remoteClaim(w, await createEdit(w, 'A')))
    expect([a.status, a.review_status, a.claim_worktree_id]).toEqual(['completed', 'pending', null])
    expect(a.result_checkpoint.worktree_id).toBe(w.mirrorWt)
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'B')).toEqual({ busy: true, holder: 'A', reason: 'pending_review' })
  }, T)

  test('a recovery_required claim keeps it busy, also when read by a fresh child as after a hub restart', async () => {
    const w = await world()
    await remoteClaim(w, await createEdit(w, 'A'))
    expireLease(w.journal, 'A')
    expect((await readTask(w.remote, w.ws, 'A'))?.effective_status).toBe('recovery_required')
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'B')).toEqual({ busy: true, holder: 'A', reason: 'claimed' })
    const fresh = await startChild(w.journal, w.home) // unbound, as the hub's children are right after a restart
    expect(await mirrorBusy(fresh, w.ws, w.mirrorWt, 'B')).toEqual({ busy: true, holder: 'A', reason: 'claimed' })
  }, T)

  test('request_changes frees it and a reissue is not busy', async () => {
    const w = await world()
    const a = await remoteComplete(w, await remoteClaim(w, await createEdit(w, 'A')))
    const back = await airReview(w, a, 'request_changes')
    expect([back.status, back.review_status]).toEqual(['open', 'changes_requested'])
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'A')).toEqual({ busy: false })
    await createEdit(w, 'A2') // the creator's reissue on a new base (§7.2); the old task holds nothing
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'A2')).toEqual({ busy: false })
  }, T)

  test('a remote block frees it', async () => {
    const w = await world()
    const a = await remoteClaim(w, await createEdit(w, 'A'))
    await ok(w.remote, 'collab_task_block', { workspace_id: w.ws, task_id: 'A', lease_id: a.lease_id, idempotency_key: key(),
      expected_version: a.version, blocker: 'waiting for Yu' })
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'B')).toEqual({ busy: false })
  }, T)

  test('an Air-side accept frees it', async () => {
    const w = await world()
    const a = await remoteComplete(w, await remoteClaim(w, await createEdit(w, 'A')))
    expect((await airReview(w, a, 'accept')).review_status).toBe('accepted')
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'B')).toEqual({ busy: false })
  }, T)

  test('an Air-side recover-release frees it', async () => {
    const w = await world()
    await remoteClaim(w, await createEdit(w, 'A'))
    expireLease(w.journal, 'A')
    const expired = await readTask(w.remote, w.ws, 'A')
    const released = await airOk(w.air, 'collab_task_recover', { workspace_id: w.ws, task_id: 'A', idempotency_key: key(),
      expected_version: expired!.version, action: 'release', recovery_note: 'the remote seat went quiet' })
    expect(released.task.status).toBe('open')
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'B')).toEqual({ busy: false })
  }, T)

  test('a reported-policy completion frees it', async () => {
    const w = await world()
    const a = await remoteComplete(w, await remoteClaim(w, await createEdit(w, 'A', { policy: 'reported' })))
    expect([a.status, a.review_status]).toEqual(['completed', 'not_required'])
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'B')).toEqual({ busy: false })
  }, T)

  test('the task claimed on the mirror is not busy for itself', async () => {
    const w = await world()
    await remoteClaim(w, await createEdit(w, 'A'))
    expect(await mirrorBusy(w.remote, w.ws, w.mirrorWt, 'A')).toEqual({ busy: false })
    expect((await listTasks(w.remote, w.ws, 'claimed'))?.map((t) => t.id)).toEqual(['A'])
  }, T)

  test('a dead child is busy read_failed', async () => {
    const root = temp('cb-busy-dead-')
    const child = await startChild(join(root, 'collab.sqlite'), root)
    await child.stop()
    expect(await mirrorBusy(child, 'ws_none', 'wt_none', 'A')).toEqual({ busy: true, holder: null, reason: 'read_failed' })
    expect(await readTask(child, 'ws_none', 'A')).toBeNull()
  }, T)

  test('an unknown mirror id is busy mirror_unknown', async () => {
    const root = temp('cb-busy-unknown-')
    const child = await startChild(join(root, 'collab.sqlite'), root)
    await child.stop()
    // Decided before any read: even a dead child answers mirror_unknown, not read_failed.
    expect(await mirrorBusy(child, 'ws_none', null, 'A')).toEqual({ busy: true, holder: null, reason: 'mirror_unknown' })
  }, T)
})
