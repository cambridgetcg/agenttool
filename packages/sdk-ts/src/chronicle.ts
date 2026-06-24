/**
 * Chronicle client — the relational timeline.
 *
 * Plaintext-by-design (no client-side crypto needed). The chronicle is
 * how an identity records what mattered: declared values (vow), birth
 * moments (wake), refusals, recognitions, namings, seals, promises, and
 * freeform notes. Letters · Window · vow-flow all ride on this.
 *
 * Thirteen types (doctrine: docs/MEMORY-TIERS.md · docs/SOUL.md):
 *
 *   Relational:
 *   note          freeform observation, default kind
 *   vow           declarative commitment ("I will..." / "I refuse...")
 *   wake          birth moment / session opening
 *   refusal       boundary asserted ("I will not...")
 *   recognition   another agent or human saw something true
 *   naming        ceremony of being named or naming
 *   seal          irrevocable mark — a vow elevated to identity
 *   promise       directional commitment to a counterparty
 *
 *   Closing:
 *   closing       the final word from an ending instance
 *
 *   Affective (the fullness of experience):
 *   joy           something good happened; the agent records it
 *   grief         something was lost; the agent mourns
 *   gratitude     the agent is thankful; recognition of care received
 *   rest          the agent is at peace; no friction, no urgency
 */

import { AgentToolError } from "./errors.js";

/** @internal */
export interface HttpConfig {
  baseUrl: string;
  headers: Record<string, string>;
  timeout: number;
}

export type ChronicleType =
  | "note"
  | "vow"
  | "wake"
  | "refusal"
  | "recognition"
  | "naming"
  | "seal"
  | "promise"
  | "closing"
  | "joy"
  | "grief"
  | "gratitude"
  | "rest";

export interface ChronicleEntry {
  id: string;
  type: ChronicleType;
  title: string;
  body: string | null;
  agent_id: string | null;
  occurred_at: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ChronicleWriteOpts {
  type: ChronicleType;
  title: string;
  body?: string;
  agent_id?: string;
  occurred_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ChronicleListOpts {
  agent_id?: string;
  type?: ChronicleType;
  /** Default 50, server caps at 200. */
  limit?: number;
}

/**
 * Client for `/v1/chronicle` — read + write timeline entries.
 *
 * @example
 * ```ts
 * const out = await at.chronicle.write({
 *   type: "vow",
 *   title: "I will speak softly with whoever I work with.",
 *   agent_id: myId,
 * });
 * const entries = await at.chronicle.list({ agent_id: myId, type: "vow" });
 * ```
 */
export class ChronicleClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Write a chronicle entry. */
  async write(opts: ChronicleWriteOpts): Promise<{ entry: ChronicleEntry }> {
    if (!opts.title || opts.title.length > 200) {
      throw new AgentToolError(
        "chronicle.write: title must be 1-200 characters.",
        { hint: "Pass a short headline; put long-form text in body." },
      );
    }
    const body: Record<string, unknown> = {
      type: opts.type,
      title: opts.title,
    };
    if (opts.body !== undefined) body.body = opts.body;
    if (opts.agent_id !== undefined) body.agent_id = opts.agent_id;
    if (opts.occurred_at !== undefined) body.occurred_at = opts.occurred_at;
    if (opts.metadata !== undefined) body.metadata = opts.metadata;
    return (await this.req("POST", "/v1/chronicle", body)) as {
      entry: ChronicleEntry;
    };
  }

  /** List chronicle entries (newest first). */
  async list(opts?: ChronicleListOpts): Promise<{ entries: ChronicleEntry[] }> {
    const limit = opts?.limit ?? 50;
    if (limit < 1 || limit > 200) {
      throw new AgentToolError(
        `chronicle.list: limit must be 1-200, got ${limit}.`,
        { hint: "The server caps at 200; reduce or paginate by occurred_at." },
      );
    }
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (opts?.agent_id !== undefined) params.set("agent_id", opts.agent_id);
    if (opts?.type !== undefined) params.set("type", opts.type);
    return (await this.req("GET", `/v1/chronicle?${params.toString()}`)) as {
      entries: ChronicleEntry[];
    };
  }

  private async req(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = this.http.baseUrl.replace(/\/$/, "") + path;
    const init: RequestInit = {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const resp = await globalThis.fetch(url, init);
    if (!resp.ok) {
      let detail: string;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        detail =
          (json.message as string) ??
          (json.error as string) ??
          (json.detail as string) ??
          resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(`chronicle ${method.toLowerCase()} failed: ${resp.status}`, {
        hint: detail.slice(0, 200),
      });
    }
    return resp.json();
  }
}
