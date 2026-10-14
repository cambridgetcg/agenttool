// The hub's record of every call_ref it has received in this run (spec §9.3 item 2). A call_ref is recorded on receipt,
// before anything is forwarded, so a repeat can never run twice: it answers duplicate_call_ref. A call_ref carrying
// another lineage's prefix means the stream is not who it attached as, so the hub closes it. There is no result cache:
// settling an outcome rests on Collab's own receipts (K24) and the agent's reads.
import { CALL_REF_RE, callRefLineage } from '../link/messages.ts'

export type CallRefVerdict = 'ok' | 'foreign_prefix' | 'duplicate' | 'malformed'

export class CallRegistry {
  private readonly seen = new Set<string>()

  accept(lineage: string, callRef: string): CallRefVerdict {
    if (typeof callRef !== 'string' || !CALL_REF_RE.test(callRef)) return 'malformed'
    if (callRefLineage(callRef) !== lineage) return 'foreign_prefix'
    if (this.seen.has(callRef)) return 'duplicate'
    this.seen.add(callRef)
    return 'ok'
  }

  size(): number {
    return this.seen.size
  }
}
