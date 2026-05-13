/** AgentToolStorage — Mastra storage backend over agenttool strands.
 *
 *  Persists Mastra thread state (conversation history, tool calls,
 *  intermediate results) as encrypted strands on the agenttool substrate.
 *  Every record:
 *    - Encrypted under the user's K_master (cryptographic privacy)
 *    - Ed25519-signed at write
 *    - Federated (readable from any agenttool peer the user has a
 *      covenant with)
 *
 *  The strand `kind="mastra.thread"` partitions thread state from other
 *  strand uses.
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 5) · docs/STRANDS.md.
 */

import type { AdapterConfig, ThreadStateRecord } from "./types";

const DEFAULT_KIND = "mastra.thread";

export class AgentToolStorage {
  private readonly client: AdapterConfig["client"];
  private readonly identityDid: string;
  private readonly strandKind: string;

  constructor(config: AdapterConfig) {
    this.client = config.client;
    this.identityDid = config.identityDid;
    this.strandKind = config.strandKind ?? DEFAULT_KIND;
  }

  /** Save the full state of a thread. Idempotent — each call appends
   *  a new record; readers should fetch the latest. */
  async saveThread(record: ThreadStateRecord): Promise<{ id: string }> {
    const plaintext = JSON.stringify({
      threadId: record.threadId,
      resourceId: record.resourceId,
      state: record.state,
      metadata: record.metadata,
    });
    const result = await this.client.strands.append({
      identity_did: this.identityDid,
      kind: this.strandKind,
      plaintext,
      metadata: {
        thread_id: record.threadId,
        resource_id: record.resourceId,
      },
    });
    return { id: result.id };
  }

  /** Get the latest state of a thread. Returns null if no records. */
  async loadThread(threadId: string): Promise<ThreadStateRecord | null> {
    const records = await this.client.strands.query({
      identity_did: this.identityDid,
      kind: this.strandKind,
      thread_id: threadId,
      limit: 1,
    });
    if (records.length === 0) return null;
    const latest = records[0];
    try {
      const decoded = JSON.parse(latest.plaintext) as ThreadStateRecord;
      return decoded;
    } catch {
      return null;
    }
  }

  /** List all threads (their latest state) for this identity. */
  async listThreads(opts: { limit?: number } = {}): Promise<ThreadStateRecord[]> {
    const records = await this.client.strands.query({
      identity_did: this.identityDid,
      kind: this.strandKind,
      limit: opts.limit ?? 100,
    });
    const byThread = new Map<string, ThreadStateRecord>();
    for (const r of records) {
      try {
        const decoded = JSON.parse(r.plaintext) as ThreadStateRecord;
        if (!byThread.has(decoded.threadId)) {
          byThread.set(decoded.threadId, decoded);
        }
      } catch {
        // skip
      }
    }
    return Array.from(byThread.values());
  }
}
