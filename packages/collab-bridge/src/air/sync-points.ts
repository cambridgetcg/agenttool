// When the hub syncs a mirror (R11, spec §7.2): before a remote claim or complete of an edit task, and only when Collab
// could newly apply the call. Every other state (a replay of a call that already applied, a duplicate under a new key,
// an expired lease, a task completed, reopened or held by someone else) is forwarded unchanged without a sync, so Collab
// returns its stored receipt (K61) or refuses, and a skipped sync never moves the mirror. Review and takeover are never
// synced: review compares the mirror with itself at the completed commit, and takeover needs HEAD == expected_base (K15).
// The one rule that comes before the state is R40: a reported-policy edit task is refused at claim and complete in every
// state. The lock does not serialise Air sessions, so a task read as claimed may be open by the forward, and a legacy
// lease_expired claim is reopened and claimed by Collab in one write; no remote claim of one ever applied, so no replay
// is owed a receipt.
// Pure: the caller reads the task first (Task 43) and runs the plan under the mirror's lock (Task 45).
import type { AgentCode } from '../failure.ts'
import type { Declared } from '../link/messages.ts'
import { TIMING } from '../timing.ts'
import type { MirrorLock, MirrorSpec } from './mirror.ts'
import type { TaskView } from './tasks.ts'

export type Plan =
  | { kind: 'sync'; atComplete?: { base: string; scopes: string[] } }
  | { kind: 'forward' }
  | { kind: 'refuse'; code: AgentCode; message: string }

const FORWARD: Plan = { kind: 'forward' }
const refuse = (code: AgentCode, message: string): Plan => ({ kind: 'refuse', code, message })

export const PLAN_MESSAGES = {
  reviewRequired: 'Remote seats cannot work on an edit task that skips review (completion_policy reported); ask its creator for completion_policy accepted.',
  baseMismatch: "This folder's HEAD is not the task's expected base; nothing was sent. Check out the base, or ask the creator to reissue the task.",
  uncommitted: 'This folder has uncommitted changes; nothing was sent. Commit your edits on this Mac, then complete.',
  leaseTooShort: 'Less than 150 s of lease is left; nothing was sent. Renew the lease, then complete.',
  baseUnknown: 'The task has no expected base and its claim recorded no base commit, so the hub cannot hold the commit to it; nothing was sent.',
  noDeclared: 'The call carried no git state from this folder, so the hub cannot check it; nothing was sent.',
  heldOnMirror: "Another session's claim of this task holds this folder's mirror; nothing was sent. Wait for it to be released or completed.",
} as const

/** The commit a completion is held to (§7.3 step 7): the task's expected base, else the head its claim recorded. */
export function baseOf(task: TaskView): string | null {
  return task.expected_base_sha ?? task.base_checkpoint?.head_sha ?? null
}

/** A remote claim (§7.2): a reported-policy edit task is refused in every state (R40, §9.2 "a remote claim or takeover of
 *  one"); a completed task and this seat's own claim are forwarded (Collab answers, a replay gets its receipt, and the
 *  mirror stays where this seat's task left it); another session's claim on this mirror is mirror_busy (R36); every
 *  other state syncs (P67), because the lock does not serialise Air sessions: a task read as claimed elsewhere or blocked
 *  can be open by the forward, and a legacy lease_expired claim is reopened and claimed by Collab in one write. */
export function planClaim(task: TaskView, o: { sessionId: string; mirrorWorktreeId: string | null; declared: Declared | undefined }): Plan {
  if (task.work_mode !== 'edit') return FORWARD
  if (task.completion_policy === 'reported') return refuse('remote_review_required', PLAN_MESSAGES.reviewRequired) // R40: in every state
  if (task.status === 'completed') return FORWARD // Collab answers; a reopened task reads open
  if (task.status !== 'open' && task.assignee_session_id === o.sessionId) return FORWARD // this seat's own: a replay or a duplicate
  // Another session's claim holds this mirror (recovery_required included), so a sync would move it under that task (R36).
  if (task.status === 'claimed' && o.mirrorWorktreeId !== null && task.claim_worktree_id === o.mirrorWorktreeId) {
    return refuse('mirror_busy', PLAN_MESSAGES.heldOnMirror)
  }
  if (!o.declared) return refuse('fetch_failed', PLAN_MESSAGES.noDeclared)
  // Refused without fetching, so the mirror never moves for a claim that would fail Collab's own base check (K15).
  if (task.expected_base_sha !== null && o.declared.head !== task.expected_base_sha) return refuse('expected_base_mismatch', PLAN_MESSAGES.baseMismatch)
  return { kind: 'sync' }
}

/** A remote complete (§7.2, §7.3 step 7, §7.5): sync only while this session's own lease could still complete it; a
 *  reported-policy edit task is refused in every state, so a claim that slipped past planClaim can never complete (R40). */
export function planComplete(task: TaskView, o: { sessionId: string; leaseId: unknown; nowMs: number; declared: Declared | undefined }): Plan {
  if (task.work_mode !== 'edit') return FORWARD
  if (task.completion_policy === 'reported') return refuse('remote_review_required', PLAN_MESSAGES.reviewRequired) // R40: in every state
  if (task.status !== 'claimed' || task.assignee_session_id !== o.sessionId || task.lease_id === null || o.leaseId !== task.lease_id) return FORWARD
  const expires = task.lease_expires_at === null ? Number.NaN : Date.parse(task.lease_expires_at)
  // Leases run on the Air's wall clock (K26), the same clock as nowMs. An expired lease is Collab's to refuse.
  if (!Number.isFinite(expires) || expires <= o.nowMs) return FORWARD
  if (!o.declared) return refuse('fetch_failed', PLAN_MESSAGES.noDeclared)
  if (o.declared.dirty) return refuse('remote_uncommitted', PLAN_MESSAGES.uncommitted)
  if (expires - o.nowMs < TIMING.leaseMinRemainingMs) return refuse('lease_too_short', PLAN_MESSAGES.leaseTooShort)
  const base = baseOf(task)
  if (base === null) return refuse('remote_base_unknown', PLAN_MESSAGES.baseUnknown)
  return { kind: 'sync', atComplete: { base, scopes: [...task.path_scopes] } }
}

/** A remote takeover (§7.2): never synced; a reported-policy edit task is refused (R40). */
export function planTakeover(task: TaskView): Plan {
  if (task.work_mode === 'edit' && task.completion_policy === 'reported') return refuse('remote_review_required', PLAN_MESSAGES.reviewRequired)
  return FORWARD
}

export interface MirrorHandle { spec: MirrorSpec; lock: MirrorLock; worktreeId: string | null }

/** The hub's mirrors by (device, user, mirror id). */
export class MirrorRegistry {
  private readonly handles = new Map<string, MirrorHandle>()

  private static key(device: string, user: string, mirrorId: string): string {
    return `${device}/${user}/${mirrorId}`
  }

  get(device: string, user: string, mirrorId: string): MirrorHandle | undefined {
    return this.handles.get(MirrorRegistry.key(device, user, mirrorId))
  }

  /** Replaces the handle for its (device, user, mirror id) but keeps the existing lock, so a worktree id recorded from the
   *  first session_start reaches every later call while flows already queued on the lock stay serialised with it. */
  set(h: MirrorHandle): void {
    const k = MirrorRegistry.key(h.spec.device, h.spec.user, h.spec.mirrorId)
    const old = this.handles.get(k)
    this.handles.set(k, old ? { ...h, lock: old.lock } : h)
  }

  all(): MirrorHandle[] {
    return [...this.handles.values()]
  }
}
