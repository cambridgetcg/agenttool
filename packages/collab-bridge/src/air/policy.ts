// One remote call, one decision (spec §6.3–§6.7, R7, R9, R28, R29, R40). decide() is pure: it reads only the seat's
// context and the call, never Collab, git or the clock, so a same-key replay gets the same decision and the same bytes.
// What needs Collab's state (sync points, the one-task rule, stamps with oids) is an edit flow, which Task 45 runs
// under the mirror lock; everything else is forwarded as decided here, once.
import type { AgentCode } from '../failure.ts'
import type { ToolDef } from '../link/messages.ts'
import { checkLengths } from './limits.ts'
import { normalizeLabel, normalizeText, startsReserved } from './normalize.ts'
import { classify } from './policy-table.ts'
import { actorStamp, AUTHORITY_PREFIX, roleStamp } from './stamp.ts'

export interface SeatCtx {
  device: string; user: string; harness: string; lineage: string; sessionId: string | null; workspaceId: string | null
  mirrorPath: string; sameSeatSessions: ReadonlySet<string>; startNonce: string
  /** This call's entry in the seat's tool list (seatTools, Task 35), or null when the list has none. */
  tool: ToolDef | null
}

export type Decision =
  | { kind: 'forward'; args: Record<string, unknown> }
  | { kind: 'session_start'; args: Record<string, unknown> }
  | { kind: 'edit_flow'; flow: 'claim' | 'complete' | 'takeover' | 'attach'; args: Record<string, unknown> }
  | { kind: 'refuse'; code: AgentCode; message: string }

/** Top-level fields normalised with N2 (§6.3 "all forwarded seat text", §6.4). Ids, enums, times and hashes are never rewritten: Collab refuses a non-ASCII id itself. */
export const TEXT_FIELDS: ReadonlySet<string> = new Set([
  'title', 'description', 'summary', 'message', 'blocker', 'body', 'limits', 'confidence_basis', 'evidence_refs',
  'recovery_note', 'reason', 'note', 'release_summary', 'label', 'authority_scope', 'authority_basis',
  // Collab stores these three as free Unicode (cleanText, optionalText, normalizePathScopes; KN src/store.ts:2890-2892, :6343).
  'uri', 'media_type', 'path_scopes',
])

const START = 'collab_session_start'
/** Collab's schemas nest one level (anchors); anything deeper is refused before it is walked (a 2 MiB frame fits 1M levels). */
const MAX_DEPTH = 32

export function isMutation(name: string): boolean {
  const cls = classify(name)
  return cls !== null && cls !== 'hidden' && cls !== 'pinned_read'
}

function refuse(code: AgentCode, message: string): Decision {
  return { kind: 'refuse', code, message }
}

function depthOver(v: unknown, depth: number): boolean {
  if (typeof v !== 'object' || v === null) return false
  if (depth >= MAX_DEPTH) return true
  for (const x of Array.isArray(v) ? v : Object.values(v)) if (depthOver(x, depth + 1)) return true
  return false
}

/** The path of the first forwarded string, at any depth, that would read as a hub stamp (§7.6). */
function firstReserved(v: unknown, path: string): string | null {
  if (typeof v === 'string') return startsReserved(v) ? path : null
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = firstReserved(v[i], `${path}[${i}]`)
      if (hit !== null) return hit
    }
    return null
  }
  if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      const hit = firstReserved(x, path === '' ? k : `${path}.${k}`)
      if (hit !== null) return hit
    }
  }
  return null
}

function hasProperty(tool: ToolDef, field: string): boolean {
  const props = tool.inputSchema.properties
  return typeof props === 'object' && props !== null && Object.hasOwn(props, field)
}

export function decide(ctx: SeatCtx, name: string, rawArgs: Record<string, unknown>): Decision {
  const cls = classify(name)
  if (cls === null || cls === 'hidden') return refuse('tool_not_available_remote', `${name} is not available to remote seats in this phase`)
  if (ctx.tool === null || ctx.tool.name !== name) return refuse('tool_not_available_remote', `${name} is not in this hub's seat tool list`)
  if (ctx.sessionId === null && name !== START) return refuse('session_required', 'Call collab_session_start first; remote seats have no legacy mode')

  const args: Record<string, unknown> = typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs) ? { ...rawArgs } : {}
  // A bound Collab ignores a legacy actor, so it could only carry unstamped text (P26).
  if (name !== START) delete args.actor

  // One rule for every tool with a workspace_id, mutations included (P28).
  if (hasProperty(ctx.tool, 'workspace_id')) {
    if (ctx.workspaceId === null) return refuse('workspace_not_shared', 'This seat has no bound workspace yet')
    if (args.workspace_id === undefined) args.workspace_id = ctx.workspaceId
    else if (args.workspace_id !== ctx.workspaceId) return refuse('workspace_not_shared', `Remote seats may use only their bound workspace, ${ctx.workspaceId}`)
  } else if (cls === 'pinned_read') {
    // Collab checks no binding on a pinned read (K4), so the pin is the hub's alone: a read with no workspace_id to pin would
    // go through unpinned. All seven of Collab 0.5.0's have one; the table fails closed for the day one does not (§6.3).
    return refuse('workspace_not_shared', `${name} cannot be pinned to this seat's workspace, so remote seats may not use it`)
  }

  if (depthOver(args, 0)) return refuse('field_too_long', `The arguments nest deeper than ${MAX_DEPTH} levels`)

  for (const [key, v] of Object.entries(args)) {
    if (name === START && (key === 'actor' || key === 'role')) {
      if (typeof v === 'string') args[key] = normalizeLabel(v)
    } else if (TEXT_FIELDS.has(key)) {
      if (typeof v === 'string') args[key] = normalizeText(v)
      else if (Array.isArray(v)) args[key] = v.map((x) => (typeof x === 'string' ? normalizeText(x) : x))
    }
  }

  // Every forwarded field, not only the text fields: §6.3 "all forwarded seat text", §7.6 "every forwarded field".
  const reserved = firstReserved(args, '')
  if (reserved !== null) return refuse('reserved_prefix', `${reserved} starts with hub-observed:, which only the hub may write`)

  const length = checkLengths(ctx.tool, args)
  if (!length.ok) return refuse('field_too_long', `${length.field} is ${length.length} UTF-16 units after normalisation; remote seats may send at most ${length.max}`)

  switch (name) {
    case START: {
      const parent = args.parent_session_id
      if (parent !== undefined && (typeof parent !== 'string' || !ctx.sameSeatSessions.has(parent))) {
        return refuse('parent_not_same_seat', `parent_session_id must name a session of ${ctx.device}/${ctx.user}`)
      }
      // Built from scratch: root_path is the mirror, repository_key and anything else the seat sent are dropped.
      const out: Record<string, unknown> = {
        root_path: ctx.mirrorPath,
        actor: actorStamp(ctx.device, ctx.user, typeof args.actor === 'string' ? args.actor : '', ctx.harness),
        role: roleStamp(ctx.device, ctx.user, ctx.startNonce, ctx.harness, typeof args.role === 'string' ? args.role : undefined),
      }
      if (parent !== undefined) out.parent_session_id = parent
      return { kind: 'session_start', args: out }
    }
    case 'collab_session_rest': {
      // Collab has no default for mode: it is a required enum (`z.enum(["resting", "ready"])`, KN src/mcp.ts:372) and
      // anything else is invalid_mode (validateRestMode, KN src/store.ts:2050, :6199), so a call without mode never
      // reaches Collab as resting, and only an exact 'resting' can be a rest that wake_on matters to (R9, R28, R29).
      if (args.mode !== 'resting') return { kind: 'forward', args }   // a return is never rewritten (K62, R29)
      const wake = args.wake_on
      if ((Array.isArray(wake) && wake.includes('addressed')) || wake === 'addressed') {
        return refuse('tool_not_available_remote', 'Nothing can wake a remote seat in this phase, so wake_on ["addressed"] is not available')
      }
      // [] hashes the same as an omitted wake_on (K62).
      return { kind: 'forward', args: { ...args, wake_on: [] } }
    }
    case 'collab_report_append': {
      if (args.kind === 'decision') return refuse('tool_not_available_remote', 'Remote seats record no decisions in this phase: propose, and an Air session decides')
      for (const field of ['authority_scope', 'authority_basis']) {
        const v = args[field]
        if (typeof v === 'string' && v.trim() !== '') args[field] = AUTHORITY_PREFIX + v
      }
      return { kind: 'forward', args }
    }
    case 'collab_task_review':
      // Collab has no default for outcome either: it is a required enum (`z.enum(["accept", "request_changes"])`, KN
      // src/mcp.ts:847; invalid_review_outcome, KN src/store.ts:3470-3471), so no omitted outcome arrives as accept.
      if (args.outcome === 'accept') return refuse('remote_review_blind', 'Remote seats accept no work in this phase: request changes or report, and an Air session accepts')
      return { kind: 'forward', args }
    case 'collab_task_create': {
      // An omitted work_mode is Collab's edit (`input.work_mode ?? "edit"`, KN src/store.ts:2380), and an omitted
      // completion_policy is accepted for an edit task (`?? (work_mode === "edit" ? "accepted" : "reported")`, KN
      // src/store.ts:2395-2396), so only an explicit reported is the bypass and the hub adds no completion_policy.
      const mode = args.work_mode
      if ((mode === undefined || mode === null || mode === 'edit') && args.completion_policy === 'reported') {
        return refuse('remote_review_required', 'Edit tasks from remote seats need review: use completion_policy accepted')
      }
      return { kind: 'forward', args }
    }
    case 'collab_task_claim':
      return { kind: 'edit_flow', flow: 'claim', args }
    case 'collab_task_complete':
      return { kind: 'edit_flow', flow: 'complete', args }
    case 'collab_task_recover':
      // Collab's default action is takeover (`const action = input.action ?? "takeover"`, KN src/store.ts:2575), so an
      // omitted action is a takeover; any value but release or block also goes the takeover way, so no takeover can
      // reach Collab unstamped and Collab answers an invalid action itself.
      if (args.action === 'release' || args.action === 'block') return { kind: 'forward', args }
      return { kind: 'edit_flow', flow: 'takeover', args }
    case 'collab_artifact_attach':
      return { kind: 'edit_flow', flow: 'attach', args }
    default:
      return { kind: 'forward', args }
  }
}
