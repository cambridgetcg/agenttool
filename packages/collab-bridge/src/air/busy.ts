// The one-task rule (R36, spec §7.2): one edit task per mirror at a time, derived from Collab's own task projection at
// every check and never stored. Without it a second task's sync would move the mirror under a pending review, which
// could then never pass (K16). Because it reads Collab every time, request_changes, block, release, Air-side reviews and
// recoveries, refused claims and hub restarts need no bookkeeping here. A read that fails is busy, never free.
import type { CollabChild } from './children.ts'
import { listTasks } from './tasks.ts'

export type Busy = { busy: false } | { busy: true; holder: string | null; reason: 'claimed' | 'pending_review' | 'read_failed' | 'mirror_unknown' }

/**
 * Whether another edit task (not `taskId`) holds the mirror whose Collab worktree id is `mirrorWorktreeId`: claimed on it
 * (recovery_required included, since an expired claim keeps status `claimed` and its claim_worktree_id, K12), or completed
 * there and still waiting for review (K60). An unknown worktree id (no remote session has bound to the mirror yet) is
 * busy too, because nothing can be matched against it.
 */
export async function mirrorBusy(child: CollabChild, workspaceId: string, mirrorWorktreeId: string | null, taskId: string): Promise<Busy> {
  if (mirrorWorktreeId === null) return { busy: true, holder: null, reason: 'mirror_unknown' }
  const claimed = await listTasks(child, workspaceId, 'claimed')
  if (claimed === null) return { busy: true, holder: null, reason: 'read_failed' }
  for (const t of claimed) {
    if (t.id !== taskId && t.work_mode === 'edit' && t.claim_worktree_id === mirrorWorktreeId) return { busy: true, holder: t.id, reason: 'claimed' }
  }
  const completed = await listTasks(child, workspaceId, 'completed')
  if (completed === null) return { busy: true, holder: null, reason: 'read_failed' }
  for (const t of completed) {
    if (t.id !== taskId && t.work_mode === 'edit' && t.review_status === 'pending' && t.result_checkpoint?.worktree_id === mirrorWorktreeId) {
      return { busy: true, holder: t.id, reason: 'pending_review' }
    }
  }
  return { busy: false }
}
