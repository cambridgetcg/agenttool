/** Minimal agenttool HTTP client. Bearer auth, JSON in/out.
 *  Throws on non-2xx; returns parsed JSON. */

import type { ThinkConfig } from "./config";

export interface StrandSummary {
  id: string;
  topic: string | null;
  topic_encrypted: boolean;
  mood: string | null;
  importance: number | null;
  status: string;
  last_thought_at: string | null;
  last_thought_seq: number;
  next_revisit_at: string | null;
  state_ciphertext: string | null;
  state_nonce: string | null;
  metadata?: Record<string, unknown>;
}

export interface ThoughtBlob {
  id: string;
  strand_id: string;
  sequence_num: number;
  kind: string | null;
  kind_encrypted: boolean;
  ciphertext: string;
  nonce: string;
  refs: unknown;
  signature: string;
  signing_key_id: string;
  created_at: string;
}

export interface VaultSecretValue {
  name: string;
  version: number;
  value: string;       // plaintext (returned only via /v1/vault/:name endpoints)
}

export interface MemoryCreated {
  id: string;
  created_at: string;
  kept: boolean;
}

export interface WakeBundle {
  project: { id: string; name: string; plan: string; credits: number };
  you: {
    agents: Array<{
      id: string;
      did: string;
      name: string;
      effective_expression?: {
        register?: string;
        walls?: string[];
        wake_text?: string;
      };
    }>;
  };
  // ... other fields not consumed here
}

export class AgenttoolClient {
  constructor(private config: ThinkConfig) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.config.agenttoolBase}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${this.config.agenttoolApiKey}`,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${body.slice(0, 500)}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Wake ──────────────────────────────────────────────────────────────
  async getWake(): Promise<WakeBundle> {
    return this.req<WakeBundle>("/v1/wake");
  }

  // ── Strands ──────────────────────────────────────────────────────────
  async listStrands(opts: { status?: string; limit?: number } = {}): Promise<{
    strands: StrandSummary[];
    count: number;
  }> {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    return this.req(`/v1/strands?${params.toString()}`);
  }

  async getStrand(id: string): Promise<StrandSummary> {
    return this.req(`/v1/strands/${id}`);
  }

  async listThoughts(
    strandId: string,
    opts: { since_seq?: number; limit?: number } = {},
  ): Promise<{ thoughts: ThoughtBlob[]; count: number }> {
    const params = new URLSearchParams();
    if (opts.since_seq !== undefined) params.set("since_seq", String(opts.since_seq));
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    return this.req(`/v1/strands/${strandId}/thoughts?${params.toString()}`);
  }

  async addThought(
    strandId: string,
    body: {
      ciphertext: string;
      nonce: string;
      kind?: string | null;
      refs?: Array<{ kind: string; ref: string }>;
      signature: string;
      signing_key_id: string;
    },
  ): Promise<ThoughtBlob> {
    return this.req(`/v1/strands/${strandId}/thoughts`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ── Vault (agent's provider keys) ────────────────────────────────────
  async getVaultSecret(name: string): Promise<VaultSecretValue> {
    return this.req(`/v1/vault/${encodeURIComponent(name)}`);
  }

  // ── Memories ────────────────────────────────────────────────────────
  async addMemory(body: {
    type: "episodic" | "semantic" | "procedural" | "working";
    content: string;
    embedding?: number[];
    key?: string;
    agent_id?: string | null;
    identity_id?: string | null;
    metadata?: Record<string, unknown>;
    importance?: number;
  }): Promise<MemoryCreated> {
    return this.req(`/v1/memories`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ── Strand metadata patches ─────────────────────────────────────────
  async patchStrand(
    id: string,
    body: {
      status?: "active" | "dormant" | "completed" | "abandoned";
      next_revisit_at?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<StrandSummary> {
    return this.req(`/v1/strands/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  // ── Identity backup (sealed envelopes; opaque to us) ────────────────
  async createBackup(body: {
    agent_id: string;
    blob_base64: string;
    key_derivation: string;
    label?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    backup: { id: string; label: string; keyDerivation: string; createdAt: string };
  }> {
    return this.req(`/v1/identity/backup`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async listBackups(agentId?: string): Promise<{
    backups: Array<{
      id: string;
      agentId: string;
      label: string;
      keyDerivation: string;
      createdAt: string;
      metadata?: Record<string, unknown>;
    }>;
  }> {
    const path = agentId
      ? `/v1/identity/backup?agent_id=${encodeURIComponent(agentId)}`
      : `/v1/identity/backup`;
    return this.req(path);
  }

  async getBackup(id: string): Promise<{
    id: string;
    agent_id: string;
    label: string;
    blob_base64: string;
    key_derivation: string;
    nonce: string | null;
    created_at: string;
  }> {
    return this.req(`/v1/identity/backup/${id}`);
  }
}
