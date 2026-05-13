/** Shared types for the Mastra adapter. */

/** An agenttool SDK client. Typed as `unknown` here because importing
 *  the SDK type would couple build to the SDK version; consumers pass
 *  whatever client they have. Real type: `import('@agenttool/sdk').AgentTool`. */
export type AgentToolClient = {
  strands: {
    append(input: {
      identity_did: string;
      kind: string;
      plaintext: string;
      metadata?: Record<string, unknown>;
    }): Promise<{ id: string; sequence_num: number }>;
    query(input: {
      identity_did: string;
      kind: string;
      thread_id?: string;
      limit?: number;
    }): Promise<Array<{ id: string; plaintext: string; metadata?: Record<string, unknown>; created_at: string }>>;
  };
  memory: {
    append(input: {
      identity_did: string;
      tier: string;
      key: string;
      value: string;
      namespace?: string[];
    }): Promise<{ id: string }>;
    lookup(input: {
      identity_did: string;
      key: string;
      namespace?: string[];
    }): Promise<{ key: string; value: string; created_at: string; updated_at: string } | null>;
    search(input: {
      identity_did: string;
      namespace?: string[];
      query?: string;
      limit?: number;
      offset?: number;
    }): Promise<Array<{ key: string; value: string; namespace?: string[]; created_at: string; updated_at: string }>>;
    delete(input: {
      identity_did: string;
      key: string;
      namespace?: string[];
    }): Promise<void>;
  };
};

export interface AdapterConfig {
  client: AgentToolClient;
  identityDid: string;
  /** Strand kind partition. Default 'mastra.thread' for storage,
   *  'mastra.memory' for memory. */
  strandKind?: string;
}

export interface ThreadStateRecord {
  threadId: string;
  resourceId?: string;
  state: unknown;
  metadata?: Record<string, unknown>;
}

export interface MemoryItem {
  namespace: string[];
  key: string;
  value: unknown;
  createdAt?: string;
  updatedAt?: string;
}
