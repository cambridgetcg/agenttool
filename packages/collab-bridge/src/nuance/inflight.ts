// In-flight records (spec §9.3 item 6). Before a call is written to the link, the pipe records {call_ref, tool,
// idempotency_key, args_hash} in its lineage file, so an outcome the agent never saw (a cancelled call, a pipe that died
// mid-call) is still known to the next pipe instance of the same Claude, which reports it as prior_unknown. Only hashes
// and keys are stored: never the arguments themselves.
import { createHash } from 'node:crypto'
import { canonicalJson } from '../json.ts'
import type { NuancePaths } from '../paths.ts'
import { readLineageFile, withLineageLock, writeLineageFile } from './lineage.ts'

/** session_id: the Collab session the pipe believed was bound when it wrote the record, or null when it knew none (P66). */
export interface InflightRecord { call_ref: string; tool: string; idempotency_key: string | null; args_hash: string; at: string; session_id: string | null }

export const MAX_INFLIGHT = 64

/** Keyed tools without a CAS, where a re-send under a new key duplicates the write (K25, §9.3 item 9). */
const DUPLICATING = new Set(['collab_report_append', 'collab_task_create'])

/** sha256 of the canonical arguments without idempotency_key, so a re-send that changes only the key hashes the same. */
export function argsHash(args: Record<string, unknown>): string {
  const { idempotency_key: _key, ...rest } = args
  return createHash('sha256').update(canonicalJson(rest)).digest('hex')
}

/**
 * Whether a record belongs to another Collab session than `current`, or either is unknown. Receipts are kept per session
 * (K24), so after an end its key settles nothing: a same-key replay would run the call again (§9.6 item 5(b), P66).
 */
export function isStale(r: InflightRecord, current: string | null): boolean {
  return r.session_id === null || current === null || r.session_id !== current
}

/** Applies fn to the records under the lineage lock; fn returns null to write nothing. */
function update(paths: NuancePaths, key: string, fn: (records: InflightRecord[]) => InflightRecord[] | null): boolean {
  return withLineageLock(paths, key, () => {
    const file = readLineageFile(paths, key)
    // The pipe opened its lineage at start; a file that has gone since is never recreated here, which would fork the lineage.
    if (!file) throw new Error(`inflight: lineage file ${key} is missing or damaged`)
    const next = fn(file.inflight)
    if (next === null) return false
    writeLineageFile(paths, key, { ...file, inflight: next })
    return true
  })
}

/** Records one call before it is sent; false when 64 are still unresolved (the caller refuses the call, not sent). */
export function addInflight(paths: NuancePaths, key: string, rec: InflightRecord): boolean {
  return update(paths, key, (records) => (records.length >= MAX_INFLIGHT ? null : [...records, { ...rec }]))
}

/** Clears the record of one call whose result reached the agent. */
export function clearInflight(paths: NuancePaths, key: string, callRef: string): void {
  update(paths, key, (records) => (records.some((r) => r.call_ref === callRef) ? records.filter((r) => r.call_ref !== callRef) : null))
}

/**
 * Clears the records under one idempotency key once a later call with that key got Collab's own answer (idempotency_conflict
 * included, §9.3 item 6), but only those of the session that answered: another session's receipt settles nothing (K24, P66).
 */
export function clearByIdempotencyKey(paths: NuancePaths, key: string, idempotencyKey: string, current: string | null): void {
  if (current === null) return
  const settled = (r: InflightRecord) => r.idempotency_key === idempotencyKey && r.session_id === current
  update(paths, key, (records) => (records.some(settled) ? records.filter((r) => !settled(r)) : null))
}

/** Clears every record of one keyless tool, once Collab's answer to a later call of it settles them (§9.3 item 7, P65). */
export function clearByTool(paths: NuancePaths, key: string, tool: string): void {
  update(paths, key, (records) => (records.some((r) => r.tool === tool) ? records.filter((r) => r.tool !== tool) : null))
}

/** The unresolved records, oldest first; none for a missing lineage file. */
export function unresolved(paths: NuancePaths, key: string): InflightRecord[] {
  return readLineageFile(paths, key)?.inflight ?? []
}

/**
 * The unresolved record a new call would duplicate: only collab_report_append, and collab_task_create without its own
 * task_id, with the same args_hash under a different idempotency_key, or under any key, the same one included, when the
 * record is stale (its session's receipts are gone, so a same-key replay would run it again, P66). A reworded body gets
 * past this, which is why the instructions also say never to re-send under a new key (§6.2).
 */
export function priorConflict(records: InflightRecord[], tool: string, args: Record<string, unknown>, current: string | null): InflightRecord | null {
  if (!DUPLICATING.has(tool)) return null
  if (tool === 'collab_task_create' && typeof args.task_id === 'string' && args.task_id !== '') return null // a re-send gets task_exists
  const key = typeof args.idempotency_key === 'string' ? args.idempotency_key : null
  const hash = argsHash(args)
  return records.find((r) => r.tool === tool && r.args_hash === hash && (r.idempotency_key !== key || isStale(r, current))) ?? null
}
