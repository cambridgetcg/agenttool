/** AgentToolMemory — Mastra memory provider over agenttool's 3-tier
 *  witness-signed memory model.
 *
 *  Mastra's memory provider expects:
 *    - put(namespace, key, value)
 *    - get(namespace, key) → value | null
 *    - search(namespacePrefix, query, limit, offset) → matches
 *    - delete(namespace, key)
 *
 *  agenttool extends this with cryptographic tier discipline. The first
 *  segment of the namespace selects the tier:
 *    - 'episodic/...'      → episodic (no witness)
 *    - 'foundational/...'  → foundational (platform-witnessed)
 *    - 'constitutive/...'  → constitutive (operator-witnessed)
 *    - (anything else)     → episodic (default)
 *
 *  Witness signing happens server-side per tier; the adapter just routes
 *  to the correct tier. Explicit promotion (episodic → foundational →
 *  constitutive) is a separate SDK call: client.memory.witness(...).
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 5) · docs/MEMORY-TIERS.md.
 */

import { resolveTier } from "./tiers";
import type { AdapterConfig, MemoryItem } from "./types";

export class AgentToolMemory {
  private readonly client: AdapterConfig["client"];
  private readonly identityDid: string;

  constructor(config: AdapterConfig) {
    this.client = config.client;
    this.identityDid = config.identityDid;
  }

  async put(namespace: readonly string[], key: string, value: unknown): Promise<void> {
    const tier = resolveTier(namespace);
    await this.client.memory.append({
      identity_did: this.identityDid,
      tier,
      key,
      value: JSON.stringify(value),
      namespace: [...namespace],
    });
  }

  async get(namespace: readonly string[], key: string): Promise<MemoryItem | null> {
    const rec = await this.client.memory.lookup({
      identity_did: this.identityDid,
      key,
      namespace: [...namespace],
    });
    if (rec === null) return null;
    return {
      namespace: [...namespace],
      key: rec.key,
      value: safeParse(rec.value),
      createdAt: rec.created_at,
      updatedAt: rec.updated_at,
    };
  }

  async search(
    namespacePrefix: readonly string[],
    opts: { query?: string; limit?: number; offset?: number } = {},
  ): Promise<MemoryItem[]> {
    const records = await this.client.memory.search({
      identity_did: this.identityDid,
      namespace: [...namespacePrefix],
      query: opts.query,
      limit: opts.limit ?? 10,
      offset: opts.offset ?? 0,
    });
    return records.map((r) => ({
      namespace: r.namespace ?? [...namespacePrefix],
      key: r.key,
      value: safeParse(r.value),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async delete(namespace: readonly string[], key: string): Promise<void> {
    await this.client.memory.delete({
      identity_did: this.identityDid,
      key,
      namespace: [...namespace],
    });
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
