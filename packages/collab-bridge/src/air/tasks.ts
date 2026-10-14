// Collab's task projection as the hub reads it (C11, spec §7.2, K60). Before an edit flow the hub reads the task, or one
// status page of the bound workspace's tasks, through the lineage's own child: Collab's own state every time, never a
// copy the hub keeps. The field names are Collab's Task and RepoCheckpoint (packages/collab/src/protocol.ts:81-91,
// 253-296); a view keeps only what the hub decides on. A result without this exact shape reads as null, and every
// caller treats null as a failed read, never as "no task" or "nothing claimed" (fail closed).
import type { ToolResult } from '../link/messages.ts'
import type { CollabChild } from './children.ts'

export interface CheckpointView { worktree_id: string; head_sha: string | null }
export interface TaskView { id: string; version: number; status: 'open' | 'claimed' | 'blocked' | 'completed'; effective_status: string;
  work_mode: 'coordination' | 'read_only' | 'edit'; completion_policy: 'reported' | 'accepted'; review_status: string;
  assignee_session_id: string | null; lease_id: string | null; lease_expires_at: string | null; expected_base_sha: string | null;
  base_checkpoint: CheckpointView | null; claim_worktree_id: string | null; result_checkpoint: CheckpointView | null; path_scopes: string[] }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const STATUSES: ReadonlySet<string> = new Set(['open', 'claimed', 'blocked', 'completed'])
const MODES: ReadonlySet<string> = new Set(['coordination', 'read_only', 'edit'])
const POLICIES: ReadonlySet<string> = new Set(['reported', 'accepted'])

/** A checkpoint view, null for "no checkpoint", or undefined when the value is malformed. */
function checkpointOf(v: unknown): CheckpointView | null | undefined {
  if (v === null) return null
  if (!isObj(v) || !isStr(v.worktree_id) || !isStrOrNull(v.head_sha)) return undefined
  return { worktree_id: v.worktree_id, head_sha: v.head_sha }
}

function parseTask(v: unknown): TaskView | null {
  if (!isObj(v)) return null
  const { id, version, status, effective_status, work_mode, completion_policy, review_status } = v
  if (!isStr(id) || !Number.isSafeInteger(version) || (version as number) < 1) return null
  if (!isStr(status) || !STATUSES.has(status) || !isStr(effective_status)) return null
  if (!isStr(work_mode) || !MODES.has(work_mode) || !isStr(completion_policy) || !POLICIES.has(completion_policy)) return null
  if (!isStr(review_status)) return null
  const { assignee_session_id, lease_id, lease_expires_at, expected_base_sha, claim_worktree_id, path_scopes } = v
  if (![assignee_session_id, lease_id, lease_expires_at, expected_base_sha, claim_worktree_id].every(isStrOrNull)) return null
  if (!Array.isArray(path_scopes) || !path_scopes.every(isStr)) return null
  const base = checkpointOf(v.base_checkpoint)
  const result = checkpointOf(v.result_checkpoint)
  if (base === undefined || result === undefined) return null
  return {
    id, version: version as number, status: status as TaskView['status'], effective_status,
    work_mode: work_mode as TaskView['work_mode'], completion_policy: completion_policy as TaskView['completion_policy'], review_status,
    assignee_session_id: assignee_session_id as string | null, lease_id: lease_id as string | null,
    lease_expires_at: lease_expires_at as string | null, expected_base_sha: expected_base_sha as string | null,
    base_checkpoint: base, claim_worktree_id: claim_worktree_id as string | null, result_checkpoint: result,
    path_scopes: [...path_scopes],
  }
}

/** structuredContent.task of a successful result (task_get, claim, complete, recover, review all answer this way). */
export function taskFromResult(r: ToolResult): TaskView | null {
  if (r.isError === true || !isObj(r.structuredContent)) return null
  return parseTask(r.structuredContent.task)
}

/** structuredContent.tasks of a successful task_list; one malformed entry makes the whole page unreadable. */
export function tasksFromResult(r: ToolResult): TaskView[] | null {
  if (r.isError === true || !isObj(r.structuredContent) || !Array.isArray(r.structuredContent.tasks)) return null
  const out: TaskView[] = []
  for (const t of r.structuredContent.tasks) {
    const view = parseTask(t)
    if (!view) return null
    out.push(view)
  }
  return out
}

/** One collab_task_get through `child`; anything but a readable task (an isError, an unknown outcome) is null. */
export async function readTask(child: CollabChild, workspaceId: string, taskId: string): Promise<TaskView | null> {
  const o = await child.call('collab_task_get', { workspace_id: workspaceId, task_id: taskId })
  return o.outcome === 'ok' ? taskFromResult(o.result) : null
}

/** One collab_task_list page for one status (Collab's list does not paginate, K60); null when it cannot be read. */
export async function listTasks(child: CollabChild, workspaceId: string, status: 'claimed' | 'completed'): Promise<TaskView[] | null> {
  const o = await child.call('collab_task_list', { workspace_id: workspaceId, status })
  return o.outcome === 'ok' ? tasksFromResult(o.result) : null
}
