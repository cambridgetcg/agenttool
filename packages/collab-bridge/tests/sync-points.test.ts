// Pure: hand-built task views, no git and no children (spec §7.2, §7.3 step 7, §7.5).
import { describe, expect, test } from 'bun:test'
import { DEFAULT_CAPS } from '../src/air/diff-check.ts'
import { MirrorLock, type MirrorSpec } from '../src/air/mirror.ts'
import { baseOf, MirrorRegistry, planClaim, planComplete, planTakeover, type MirrorHandle } from '../src/air/sync-points.ts'
import type { TaskView } from '../src/air/tasks.ts'
import type { Declared } from '../src/link/messages.ts'

const BASE = 'a'.repeat(40)
const CLAIMED_AT = 'b'.repeat(40)
const WORK = 'c'.repeat(40)
const SESSION = 'session_remote'
const LEASE = 'lease_remote'
const NOW = Date.parse('2026-10-13T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

function open(over: Partial<TaskView> = {}): TaskView {
  return { id: 'T', version: 1, status: 'open', effective_status: 'open', work_mode: 'edit', completion_policy: 'accepted',
    review_status: 'not_required', assignee_session_id: null, lease_id: null, lease_expires_at: null, expected_base_sha: BASE,
    base_checkpoint: null, claim_worktree_id: null, result_checkpoint: null, path_scopes: ['notes'], ...over }
}

function claimed(over: Partial<TaskView> = {}): TaskView {
  return open({ version: 2, status: 'claimed', effective_status: 'claimed', assignee_session_id: SESSION, lease_id: LEASE,
    lease_expires_at: iso(NOW + 900_000), base_checkpoint: { worktree_id: 'wt_mirror', head_sha: BASE }, claim_worktree_id: 'wt_mirror', ...over })
}

const declared = (head: string, dirty = false): Declared => ({ head, branch: 'main', dirty })
const claimOf = (task: TaskView, o: { sessionId?: string; mirrorWorktreeId?: string | null; declared?: Declared | undefined } = {}) =>
  planClaim(task, { sessionId: o.sessionId ?? SESSION, mirrorWorktreeId: o.mirrorWorktreeId === undefined ? 'wt_mirror' : o.mirrorWorktreeId,
    declared: 'declared' in o ? o.declared : declared(BASE) })
const completeOf = (task: TaskView, o: { leaseId?: unknown; sessionId?: string; nowMs?: number; declared?: Declared | undefined } = {}) =>
  planComplete(task, { sessionId: o.sessionId ?? SESSION, leaseId: 'leaseId' in o ? o.leaseId : LEASE, nowMs: o.nowMs ?? NOW,
    declared: 'declared' in o ? o.declared : declared(WORK) })

describe('baseOf', () => {
  test('baseOf prefers expected_base_sha, then the base checkpoint head', () => {
    expect(baseOf(claimed({ base_checkpoint: { worktree_id: 'wt', head_sha: CLAIMED_AT } }))).toBe(BASE)
    expect(baseOf(claimed({ expected_base_sha: null, base_checkpoint: { worktree_id: 'wt', head_sha: CLAIMED_AT } }))).toBe(CLAIMED_AT)
    expect(baseOf(claimed({ expected_base_sha: null, base_checkpoint: { worktree_id: 'wt', head_sha: null } }))).toBeNull()
    expect(baseOf(open({ expected_base_sha: null }))).toBeNull()
  })
})

describe('planClaim', () => {
  test('a non-edit task is forwarded', () => {
    expect(claimOf(open({ work_mode: 'coordination' }), { declared: declared(WORK) })).toEqual({ kind: 'forward' })
    expect(claimOf(open({ work_mode: 'read_only', completion_policy: 'reported' }), { declared: undefined })).toEqual({ kind: 'forward' })
  })

  test('an open reported-policy edit task is remote_review_required', () => {
    expect(claimOf(open({ completion_policy: 'reported' }))).toMatchObject({ kind: 'refuse', code: 'remote_review_required' })
  })

  test('a reported-policy edit task is remote_review_required at claim in every state, a legacy lease_expired claim included', () => {
    // Read as claimed elsewhere: an Air session may release it before the forward, and Collab's claim checks no policy.
    expect(claimOf(claimed({ completion_policy: 'reported', assignee_session_id: 'session_other' }))).toMatchObject({ kind: 'refuse', code: 'remote_review_required' })
    // A legacy-path claim whose lease ran out: Collab's session claim reopens and claims it in one write, no race needed.
    expect(claimOf(claimed({ completion_policy: 'reported', assignee_session_id: null, effective_status: 'lease_expired', lease_expires_at: iso(NOW - 1) }))).toMatchObject({ kind: 'refuse', code: 'remote_review_required' })
    expect(claimOf(open({ completion_policy: 'reported', status: 'blocked', effective_status: 'blocked' }))).toMatchObject({ kind: 'refuse', code: 'remote_review_required' })
    expect(claimOf(open({ completion_policy: 'reported', status: 'completed', effective_status: 'completed' }), { declared: undefined })).toMatchObject({ kind: 'refuse', code: 'remote_review_required' })
  })

  test('a declared head other than the expected base is expected_base_mismatch, so nothing is fetched', () => {
    expect(claimOf(open(), { declared: declared(WORK) })).toMatchObject({ kind: 'refuse', code: 'expected_base_mismatch' })
  })

  test('an open accepted edit task at its base is a plain sync', () => {
    expect(claimOf(open())).toEqual({ kind: 'sync' })
    expect(claimOf(open({ expected_base_sha: null }), { declared: declared(WORK) })).toEqual({ kind: 'sync' })
  })

  test('a legacy claim whose lease ran out syncs, so the claim Collab makes in one write captures a fresh mirror', () => {
    const legacy = claimed({ assignee_session_id: null, lease_id: null, effective_status: 'lease_expired', lease_expires_at: iso(NOW - 1), base_checkpoint: null, claim_worktree_id: null })
    expect(claimOf(legacy)).toEqual({ kind: 'sync' })
  })

  test('a task claimed on another worktree, or blocked, syncs, so a release or unblock racing the read still meets a synced mirror', () => {
    expect(claimOf(claimed({ assignee_session_id: 'session_air', claim_worktree_id: 'wt_air' }))).toEqual({ kind: 'sync' })
    expect(claimOf(open({ status: 'blocked', effective_status: 'blocked', assignee_session_id: 'session_other' }))).toEqual({ kind: 'sync' })
    expect(claimOf(open({ status: 'blocked', effective_status: 'blocked' }))).toEqual({ kind: 'sync' })
  })

  test("another session's claim on this mirror is mirror_busy, recovery_required included", () => {
    expect(claimOf(claimed({ assignee_session_id: 'session_other' }))).toMatchObject({ kind: 'refuse', code: 'mirror_busy' })
    expect(claimOf(claimed({ assignee_session_id: 'session_other', effective_status: 'recovery_required', lease_expires_at: iso(NOW - 60_000) }), { declared: undefined })).toMatchObject({ kind: 'refuse', code: 'mirror_busy' })
  })

  test("this seat's own claim (a replay or a duplicate) and a completed task are forwarded for Collab to answer", () => {
    expect(claimOf(claimed(), { declared: declared(WORK) })).toEqual({ kind: 'forward' })
    expect(claimOf(claimed({ effective_status: 'recovery_required', lease_expires_at: iso(NOW - 60_000) }), { declared: undefined })).toEqual({ kind: 'forward' })
    expect(claimOf(open({ status: 'blocked', effective_status: 'blocked', assignee_session_id: SESSION }))).toEqual({ kind: 'forward' })
    expect(claimOf(open({ status: 'completed', effective_status: 'accepted', review_status: 'accepted' }))).toEqual({ kind: 'forward' })
  })

  test('before the mirror worktree id is known no claim is refused as held on it', () => {
    expect(claimOf(claimed({ assignee_session_id: 'session_other' }), { mirrorWorktreeId: null })).toEqual({ kind: 'sync' })
  })

  test('a claim that would sync without declared git state is fetch_failed', () => {
    expect(claimOf(open(), { declared: undefined })).toMatchObject({ kind: 'refuse', code: 'fetch_failed' })
  })
})

describe('planComplete', () => {
  test('a non-edit task is forwarded', () => {
    expect(completeOf(claimed({ work_mode: 'coordination' }), { declared: declared(WORK, true) })).toEqual({ kind: 'forward' })
  })

  test('a complete of a reported-policy edit task is remote_review_required', () => {
    // A seat holding one got it past the claim check somehow; refusing here keeps review_status not_required from
    // ever being reached by a remote completion (R40, K60).
    expect(completeOf(claimed({ completion_policy: 'reported' }))).toMatchObject({ kind: 'refuse', code: 'remote_review_required' })
    expect(completeOf(claimed({ completion_policy: 'reported', lease_expires_at: iso(NOW - 1) }))).toMatchObject({ kind: 'refuse', code: 'remote_review_required' })
  })

  test('a dirty tree is remote_uncommitted', () => {
    expect(completeOf(claimed(), { declared: declared(WORK, true) })).toMatchObject({ kind: 'refuse', code: 'remote_uncommitted' })
  })

  test('149 s of lease is lease_too_short and 150 s syncs', () => {
    expect(completeOf(claimed({ lease_expires_at: iso(NOW + 149_000) }))).toMatchObject({ kind: 'refuse', code: 'lease_too_short' })
    expect(completeOf(claimed({ lease_expires_at: iso(NOW + 150_000) }))).toEqual({ kind: 'sync', atComplete: { base: BASE, scopes: ['notes'] } })
  })

  test('a task with neither base is remote_base_unknown', () => {
    expect(completeOf(claimed({ expected_base_sha: null, base_checkpoint: null }))).toMatchObject({ kind: 'refuse', code: 'remote_base_unknown' })
  })

  test("without expected_base_sha the base is the claim's base checkpoint head", () => {
    const t = claimed({ expected_base_sha: null, base_checkpoint: { worktree_id: 'wt_mirror', head_sha: CLAIMED_AT }, path_scopes: ['notes', 'docs/a.md'] })
    expect(completeOf(t)).toEqual({ kind: 'sync', atComplete: { base: CLAIMED_AT, scopes: ['notes', 'docs/a.md'] } })
  })

  test('an expired lease is forwarded, at its expiry instant and whatever the tree', () => {
    expect(completeOf(claimed({ lease_expires_at: iso(NOW - 1) }))).toEqual({ kind: 'forward' })
    expect(completeOf(claimed({ lease_expires_at: iso(NOW) }))).toEqual({ kind: 'forward' })
    expect(completeOf(claimed({ effective_status: 'recovery_required', lease_expires_at: iso(NOW - 60_000) }), { declared: declared(WORK, true) })).toEqual({ kind: 'forward' })
  })

  test('another session, another lease_id or a completed task (a replay or a duplicate) is forwarded', () => {
    expect(completeOf(claimed(), { sessionId: 'session_other' })).toEqual({ kind: 'forward' })
    expect(completeOf(claimed(), { leaseId: 'lease_old' })).toEqual({ kind: 'forward' })
    expect(completeOf(claimed(), { leaseId: undefined })).toEqual({ kind: 'forward' })
    const done = claimed({ status: 'completed', effective_status: 'reported_complete', review_status: 'pending', assignee_session_id: null,
      lease_id: null, lease_expires_at: null, claim_worktree_id: null, result_checkpoint: { worktree_id: 'wt_mirror', head_sha: WORK } })
    expect(completeOf(done, { declared: declared(CLAIMED_AT, true) })).toEqual({ kind: 'forward' })
  })

  test('a complete that would sync without declared git state is fetch_failed', () => {
    expect(completeOf(claimed(), { declared: undefined })).toMatchObject({ kind: 'refuse', code: 'fetch_failed' })
  })
})

describe('planTakeover', () => {
  test('a takeover of a reported-policy edit task is remote_review_required', () => {
    expect(planTakeover(claimed({ completion_policy: 'reported', effective_status: 'recovery_required' }))).toMatchObject({ kind: 'refuse', code: 'remote_review_required' })
  })

  test('a takeover of an accepted edit task, or of any non-edit task, is forwarded and never synced', () => {
    expect(planTakeover(claimed({ effective_status: 'recovery_required' }))).toEqual({ kind: 'forward' })
    expect(planTakeover(claimed({ work_mode: 'coordination', completion_policy: 'reported' }))).toEqual({ kind: 'forward' })
  })
})

describe('MirrorRegistry', () => {
  const spec: MirrorSpec = { device: 'nuance', user: 'macair', mirrorId: '0123456789abcdef', mirrorPath: '/m', airClone: '/a',
    remoteGitdir: '/Users/macair/Projects/collab-trial/.git', caps: DEFAULT_CAPS }

  test('MirrorRegistry.set replaces the worktree id and keeps the same lock', () => {
    const reg = new MirrorRegistry()
    const first: MirrorHandle = { spec, lock: new MirrorLock(), worktreeId: null }
    reg.set(first)
    reg.set({ spec, lock: new MirrorLock(), worktreeId: 'wt_mirror' })
    const got = reg.get('nuance', 'macair', '0123456789abcdef')!
    expect(got.worktreeId).toBe('wt_mirror')
    expect(got.lock).toBe(first.lock)
    expect(reg.all()).toHaveLength(1)
  })

  test('handles are found by device, user and mirror id only', () => {
    const reg = new MirrorRegistry()
    reg.set({ spec, lock: new MirrorLock(), worktreeId: 'wt_1' })
    reg.set({ spec: { ...spec, mirrorId: 'fedcba9876543210' }, lock: new MirrorLock(), worktreeId: 'wt_2' })
    expect(reg.get('nuance', 'macair', 'fedcba9876543210')?.worktreeId).toBe('wt_2')
    expect(reg.get('nuance', 'other', '0123456789abcdef')).toBeUndefined()
    expect(reg.all().map((h) => h.worktreeId).sort()).toEqual(['wt_1', 'wt_2'])
  })
})
