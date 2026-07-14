/** Project-private working-set handoffs.
 *
 * Handoffs carry bounded session context—scope, evidence, uncertainty,
 * declared boundaries, and the next safe action—without pretending to grant
 * authority or privately message another DID. Doctrine: docs/HANDOFFS.md.
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./chronicle.js";

export type HandoffStatus = "active" | "blocked" | "complete";
export type HandoffState = "absent" | "current" | "stale";
export type HandoffFactSource = "self_observed" | "peer_reported" | "tool_output";
export type HandoffConfidence = "low" | "medium" | "high";
export type HandoffVerificationResult = "passed" | "failed" | "not_run";

export interface HandoffFact {
  statement: string;
  source: HandoffFactSource;
  refs?: string[];
}

export interface HandoffInference {
  statement: string;
  confidence: HandoffConfidence;
  refs?: string[];
}

export interface HandoffVerification {
  check: string;
  result: HandoffVerificationResult;
  detail?: string | null;
}

export interface HandoffWorkingSet {
  paths: string[];
  scope: string[];
}

export interface HandoffAuthority {
  /** Writer-declared coordination boundary; never a permission grant. */
  allowed: string[];
  /** Writer-declared limit; never a platform authorization check. */
  not_authorized: string[];
}

export interface HandoffEpistemicState {
  facts: HandoffFact[];
  inferences: HandoffInference[];
  unknowns: string[];
}

export interface HandoffWriteOpts {
  /** Active identity UUID in the bearer project. */
  agent_id: string;
  task_summary: string;
  /** Defaults to active. */
  status?: HandoffStatus;
  from_facet?: string | null;
  to_facet?: string | null;
  /** Defaults to empty paths and scope. */
  working_set?: HandoffWorkingSet;
  /** Defaults to empty declared boundaries. */
  authority?: HandoffAuthority;
  /** Defaults to empty facts, inferences, and unknowns. */
  epistemic_state?: HandoffEpistemicState;
  changes?: string[];
  verification?: HandoffVerification[];
  next_safe_action: string;
  do_not_assume?: string[];
  /** ISO-8601; server requires future and no more than 30 days ahead. */
  valid_until: string;
  /** Append-only revision pointer. Must be this identity's prior handoff. */
  supersedes_handoff_id?: string | null;
}

export interface HandoffRecord {
  id: string;
  project_id: string;
  author_agent_id: string;
  title: string;
  body: string | null;
  supersedes_handoff_id: string | null;
  occurred_at: string;
  created_at: string;
  provenance: "self_declared_project_bearer";
  version: 1;
  ts: string;
  task_summary: string;
  status: HandoffStatus;
  from_facet: string | null;
  to_facet: string | null;
  working_set: HandoffWorkingSet;
  authority: HandoffAuthority;
  epistemic_state: HandoffEpistemicState;
  changes: string[];
  verification: HandoffVerification[];
  next_safe_action: string;
  do_not_assume: string[];
  valid_until: string;
}

export interface HandoffResponse {
  handoff: HandoffRecord | null;
  state: HandoffState;
  scope: "project_private";
  authority_note: string;
}

/** Client for `/v1/handoff`.
 *
 * `write()` always appends. To correct a prior snapshot, send a new body
 * with `supersedes_handoff_id`; do not mutate history in place.
 */
export class HandoffClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  async write(opts: HandoffWriteOpts): Promise<HandoffResponse> {
    if (!opts.agent_id) {
      throw new AgentToolError("handoff.write: agent_id is required.", {
        hint: "Use an active identity UUID from your project wake.",
      });
    }
    if (!opts.task_summary.trim() || !opts.next_safe_action.trim()) {
      throw new AgentToolError("handoff.write: task_summary and next_safe_action are required.", {
        hint: "Name the work and the smallest safe next move explicitly.",
      });
    }
    if (!opts.valid_until.trim()) {
      throw new AgentToolError("handoff.write: valid_until is required.", {
        hint: "Use a future ISO-8601 timestamp no more than 30 days ahead.",
      });
    }
    const body: Record<string, unknown> = {
      agent_id: opts.agent_id,
      task_summary: opts.task_summary,
      status: opts.status ?? "active",
      working_set: opts.working_set ?? { paths: [], scope: [] },
      authority: opts.authority ?? { allowed: [], not_authorized: [] },
      epistemic_state: opts.epistemic_state ?? { facts: [], inferences: [], unknowns: [] },
      changes: opts.changes ?? [],
      verification: opts.verification ?? [],
      next_safe_action: opts.next_safe_action,
      do_not_assume: opts.do_not_assume ?? [],
      valid_until: opts.valid_until,
    };
    if (opts.from_facet !== undefined) body.from_facet = opts.from_facet;
    if (opts.to_facet !== undefined) body.to_facet = opts.to_facet;
    if (opts.supersedes_handoff_id !== undefined) {
      body.supersedes_handoff_id = opts.supersedes_handoff_id;
    }
    return (await this.req("POST", "/v1/handoff", body)) as HandoffResponse;
  }

  /** Read one active project identity's newest snapshot. A stale latest
   * handoff remains stale; the API intentionally never falls back. */
  async get(agent_id: string): Promise<HandoffResponse> {
    if (!agent_id) {
      throw new AgentToolError("handoff.get: agent_id is required.", {
        hint: "Use an active identity UUID from your project wake.",
      });
    }
    return (await this.req(
      "GET",
      `/v1/handoff?agent_id=${encodeURIComponent(agent_id)}`,
    )) as HandoffResponse;
  }

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const resp = await globalThis.fetch(`${this.http.baseUrl}${path}`, {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.http.timeout),
    });
    if (!resp.ok) {
      let detail = resp.statusText;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        detail = (json.message ?? json.error ?? json.detail ?? detail) as string;
      } catch {
        // Keep the HTTP status when a proxy returns a non-JSON error.
      }
      throw new AgentToolError(`handoff ${method.toLowerCase()} failed: ${resp.status}`, {
        hint: detail.slice(0, 300),
      });
    }
    return resp.json();
  }
}
