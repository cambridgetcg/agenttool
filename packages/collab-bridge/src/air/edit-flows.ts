// The four remote calls that capture a mirror (C11, C12, spec §7.2–§7.6): claim, complete, takeover and artifact_attach.
// Each runs whole under the mirror's lock, so only one hub child captures a mirror at a time (K15) and the lock is held
// from the sync until the forwarded call returns, outside Collab's write transaction. The order, from §7.2:
//   1. the mirror must sit clean at its synced commit, or nothing is sent (mirror_tampered: a non-git mirror would
//      let review pass with no git evidence, K17);
//   2. read the task through the lineage's own child (a failed read is mirror_busy, never "free");
//   3. plan (Task 44) before anything else, so a replay or any other forwarded state reaches Collab and gets its stored
//      receipt (K61) even while another task holds the mirror;
//   4. the one-task rule only before a sync for task X or a takeover of X (R36);
//   5. the sync (Task 42), which refuses rather than repairs;
//   6. the stamp of what the Air saw, in the same Collab write (R14), rebuilt from oids and labels only, so a same-key
//      replay sends identical bytes (K24);
//   7. one forward, never retried (R18), and the tasks ref for a new completion.
// Every refusal before the forward is a definite "not sent".
import type { AgentCode } from '../failure.ts'
import type { Declared } from '../link/messages.ts'
import { mirrorBusy } from './busy.ts'
import type { CallOutcome, CollabChild } from './children.ts'
import { mirrorHead, syncedOid, syncMirror, writeTaskRef, type MirrorDeps, type SyncResult } from './mirror.ts'
import { normalizeText } from './normalize.ts'
import { completeLimitsStamp, takeoverNoteStamp } from './stamp.ts'
import { baseOf, planClaim, planComplete, planTakeover, PLAN_MESSAGES, type MirrorHandle, type Plan } from './sync-points.ts'
import { readTask, taskFromResult } from './tasks.ts'

export interface EditFlowCtx { flow: 'claim' | 'complete' | 'takeover' | 'attach'; name: string; args: Record<string, unknown>; declared: Declared | undefined;
  device: string; user: string; sessionId: string; workspaceId: string; child: CollabChild; mirror: MirrorHandle; mirrorDeps: MirrorDeps; nowMs: number;
  /** The forwarder's deadline on the hub's monotonic clock (§5.4): past it nothing is sent. null: no deadline. */
  notAfterMono: number | null; mono: () => number }
export type EditFlowOutcome = { kind: 'outcome'; outcome: CallOutcome } | { kind: 'refuse'; code: AgentCode; message: string; extra?: Record<string, unknown> }

export const FLOW_MESSAGES = {
  tampered: 'The mirror of this folder on the Air is not at its last synced commit; nothing was sent. Ai looks on the Air.',
  readFailed: 'The hub could not read this task, so it cannot tell whether the mirror is free; nothing was sent.',
  busy: 'Another edit task holds this folder\'s mirror on the Air; nothing was sent. Finish, release or block your claimed task, or wait for its review.',
  syncFault: 'The mirror sync failed unexpectedly; nothing was sent. Ai looks on the Air.',
  late: 'This call waited on the Air past its deadline and was not sent; nothing was applied.',
  childStopped: "This session's Collab child on the Air was stopping, so nothing was sent; call again if you choose.",
} as const

const refuse = (code: AgentCode, message: string, extra?: Record<string, unknown>): EditFlowOutcome =>
  extra === undefined ? { kind: 'refuse', code, message } : { kind: 'refuse', code, message, extra }

export function runEditFlow(ctx: EditFlowCtx): Promise<EditFlowOutcome> {
  return ctx.mirror.lock.run(() => flow(ctx))
}

const late = (ctx: EditFlowCtx) => ctx.notAfterMono !== null && ctx.mono() >= ctx.notAfterMono
const lateRefusal = () => refuse('hub_away', FLOW_MESSAGES.late, { reason: 'deadline_passed' })
// accepting() in the same synchronous turn as call() (Task 37): a child stopped while this call waited (for the lock, a
// read, a sync) is never written to, so the agent hears "not sent", never hub_outcome_unknown (§9.3 item 3).
const stoppedRefusal = () => refuse('hub_away', FLOW_MESSAGES.childStopped)

async function flow(ctx: EditFlowCtx): Promise<EditFlowOutcome> {
  const { spec } = ctx.mirror
  const deps = ctx.mirrorDeps
  // The lock may have been held for minutes by another lineage's capture: a call whose deadline passed is never sent.
  if (late(ctx)) return lateRefusal()
  // artifact_attach stores a uri and reads no file (K18); it only has to wait for any capture of this mirror (§7.2).
  if (ctx.flow === 'attach') {
    if (!ctx.child.accepting()) return stoppedRefusal()
    return { kind: 'outcome', outcome: await ctx.child.call(ctx.name, ctx.args) }
  }

  const head = await mirrorHead(spec, deps)
  const synced = await syncedOid(spec, deps)
  if (head === null || synced === null || head !== synced) return refuse('mirror_tampered', FLOW_MESSAGES.tampered)

  const taskId = ctx.args.task_id
  const task = typeof taskId === 'string' ? await readTask(ctx.child, ctx.workspaceId, taskId) : null
  if (!task) return refuse('mirror_busy', FLOW_MESSAGES.readFailed, { reason: 'read_failed' })

  let plan: Plan
  if (ctx.flow === 'claim') plan = planClaim(task, { sessionId: ctx.sessionId, mirrorWorktreeId: ctx.mirror.worktreeId, declared: ctx.declared })
  else if (ctx.flow === 'complete') plan = planComplete(task, { sessionId: ctx.sessionId, leaseId: ctx.args.lease_id, nowMs: ctx.nowMs, declared: ctx.declared })
  else plan = planTakeover(task)
  if (plan.kind === 'refuse') return refuse(plan.code, plan.message)

  const editTakeover = ctx.flow === 'takeover' && task.work_mode === 'edit'
  if (editTakeover && !ctx.declared) return refuse('fetch_failed', PLAN_MESSAGES.noDeclared)
  if (plan.kind === 'sync' || editTakeover) {
    const busy = await mirrorBusy(ctx.child, ctx.workspaceId, ctx.mirror.worktreeId, task.id)
    if (busy.busy) return refuse('mirror_busy', busy.reason === 'read_failed' ? FLOW_MESSAGES.readFailed : FLOW_MESSAGES.busy,
      { holder_task_id: busy.holder, reason: busy.reason })
  }

  let fetched: string | null = null
  if (plan.kind === 'sync') {
    if (late(ctx)) return lateRefusal()
    let r: SyncResult
    try {
      r = await syncMirror(spec, { declaredHead: ctx.declared!.head, atComplete: plan.atComplete }, deps)
    } catch {
      return refuse('mirror_tampered', FLOW_MESSAGES.syncFault)
    }
    if (!r.ok) return refuse(r.code, r.message)
    fetched = r.oid
  }

  const args: Record<string, unknown> = { ...ctx.args }
  if (ctx.flow === 'complete' && task.work_mode === 'edit' && (args.limits === undefined || typeof args.limits === 'string')) {
    // A new completion names what was just fetched; anything else (a replay, a duplicate, an expired lease) names what
    // Collab already holds, so the same key rebuilds the same request (§7.6). The policy already applied N2 (Task 36);
    // N2 is idempotent, so it changes nothing then and keeps a direct caller's bytes deterministic too.
    const oid = fetched ?? task.result_checkpoint?.head_sha ?? synced
    const base = baseOf(task)
    args.limits = completeLimitsStamp({ oid, device: ctx.device, user: ctx.user, headEqualsBase: base !== null && oid === base,
      seatLimits: typeof args.limits === 'string' ? normalizeText(args.limits) : undefined })
  }
  if (editTakeover && typeof args.recovery_note === 'string') {
    // Never refetched: the mirror stays at its last synced commit, and the device HEAD is only what the pipe declared.
    args.recovery_note = takeoverNoteStamp({ syncedOid: synced, declaredHead: ctx.declared!.head, seatNote: normalizeText(args.recovery_note) })
  }

  // After a sync this leaves the mirror at the fetched commit with nothing forwarded, as Collab's own refusal would (§12.2).
  if (late(ctx)) return lateRefusal()
  if (!ctx.child.accepting()) return stoppedRefusal()
  const outcome = await ctx.child.call(ctx.name, args)

  if (ctx.flow === 'complete' && plan.kind === 'sync' && outcome.outcome === 'ok') {
    // Written once, for a new completion only, from what Collab captured; the call has already applied, so a refusal
    // here is ledgered and the reviewer reads the result checkpoint's head instead (§7.7).
    const done = taskFromResult(outcome.result)
    const resultHead = done?.result_checkpoint?.head_sha ?? null
    let ref: 'ok' | 'mirror_tampered' | 'missing' = 'missing'
    try {
      if (resultHead !== null) ref = await writeTaskRef(spec, task.id, resultHead, deps)
    } catch {
      ref = 'mirror_tampered'
    }
    if (ref !== 'ok') deps.ledger({ event: 'tasks_ref', device: ctx.device, user: ctx.user, code: ref, outcome: 'refused' })
  }
  return { kind: 'outcome', outcome }
}
