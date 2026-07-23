/** Project-private working-set handoffs.
 *
 * Handoffs carry bounded session context—scope, evidence, uncertainty,
 * declared boundaries, and the next safe action—without pretending to grant
 * authority or privately message another DID. Doctrine: docs/HANDOFFS.md.
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";

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
  /** Omit to preserve legacy latest-per-identity lineage behavior. Set true
   * to start an explicit independent lineage. It cannot be combined with
   * `supersedes_handoff_id`; an explicitly supplied false remains legacy. */
  starts_new_lineage?: boolean;
  /** Optional 8-256 character caller key for the API's Redis-backed replay
   * cache. This reduces sequential retry duplication while Redis is healthy;
   * it is fail-open and does not reserve concurrent in-flight writes. */
  idempotency_key?: string;
}

export interface HandoffRecord {
  id: string;
  project_id: string;
  author_agent_id: string;
  title: string;
  body: string | null;
  supersedes_handoff_id: string | null;
  lineage_mode: "legacy_latest_per_author" | "explicit";
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

export interface HandoffSurface {
  active: HandoffRecord[];
  stale: HandoffRecord[];
  /** Complete, row-budget truncated, or unavailable because composition failed. */
  projection_status: "complete" | "truncated" | "unavailable";
  /**
   * True when the server stopped at its bounded candidate-row budget. When
   * true, active/stale may omit older independent lineages.
   */
  truncated: boolean;
  /** True only when active/stale contain the complete current leaf set. */
  leaf_set_complete: boolean;
  candidate_rows_considered: number;
  candidate_row_limit: number;
  /**
   * Diagnostic lower edge of the candidate window, or null when no edge was
   * observed. This is not a resume cursor.
   */
  candidate_window_end_id: string | null;
  scope: "project_private";
  authority_note: string;
  write: "POST /v1/handoff";
  read_latest: "GET /v1/handoff?agent_id=<identity_id>";
}

export interface HandoffResumeOpts {
  /** Optional identity voice used to build the focused wake fragment. The
   * returned handoff working set remains explicitly project-scoped. */
  identity_id?: string;
}

export interface HandoffResumeResponse {
  _scope_boundary?: Record<string, unknown> | null;
  you_have_handoffs: HandoffSurface;
}

/** Client for `/v1/handoff`.
 *
 * `write()` always appends. To correct a prior snapshot, send a new body
 * with `supersedes_handoff_id`; do not mutate history in place.
 */
export class HandoffClient {
  private readonly http: HttpConfig;
  private readonly onWrite?: () => void;

  /** @internal */
  constructor(http: HttpConfig, onWrite?: () => void) {
    this.http = http;
    this.onWrite = onWrite;
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
    if (opts.starts_new_lineage === true && opts.supersedes_handoff_id != null) {
      throw new AgentToolError(
        "handoff.write: starts_new_lineage cannot be combined with supersedes_handoff_id.",
        {
          hint: "Start an independent lineage, or supersede one existing handoff; choose one.",
        },
      );
    }
    if (
      opts.idempotency_key !== undefined &&
      !/^[!-~]{8,256}$/.test(opts.idempotency_key)
    ) {
      throw new AgentToolError(
        "handoff.write: idempotency_key must be 8-256 visible ASCII characters without spaces.",
        {
          hint: "Reuse the same caller-chosen key only when retrying the same write.",
        },
      );
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
    if (opts.starts_new_lineage !== undefined) {
      body.starts_new_lineage = opts.starts_new_lineage;
    }
    const headers = opts.idempotency_key
      ? { "Idempotency-Key": opts.idempotency_key }
      : undefined;
    const response = (await this.req("POST", "/v1/handoff", body, headers)) as HandoffResponse;
    // Wake responses are cached for five minutes. Once a write succeeds, an
    // already-instantiated WakeClient must not keep serving the pre-write
    // working set inside this process.
    this.onWrite?.();
    return response;
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

  /** Read the bounded current project working-set projection through the
   * focused wake fragment. Check `leaf_set_complete` before treating it as the
   * complete leaf set. This call is intentionally uncached: it is the
   * session-resume seam, not a five-minute orientation cache. */
  async resume(opts?: HandoffResumeOpts): Promise<HandoffResumeResponse> {
    const params = new URLSearchParams();
    if (opts?.identity_id) params.set("identity_id", opts.identity_id);
    const query = params.toString();
    return (await this.req(
      "GET",
      `/v1/wake/handoffs${query ? `?${query}` : ""}`,
      undefined,
      undefined,
      "no-store",
    )) as HandoffResumeResponse;
  }

  private async req(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    cache?: RequestCache,
  ): Promise<unknown> {
    const resp = await this.http.request(`${this.http.baseUrl}${path}`, {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(cache ? { cache } : {}),
      signal: AbortSignal.timeout(this.http.timeout),
    });
    if (!resp.ok) {
      let responseBody: unknown = null;
      try {
        responseBody = await resp.json();
      } catch {
        // The shared error parser keeps the fallback when a proxy returns a
        // non-JSON response.
      }
      throw AgentToolError.fromResponseBody(
        responseBody,
        resp.status,
        `handoff ${method.toLowerCase()} failed: ${resp.status}`,
        resp.headers,
      );
    }
    return resp.json();
  }
}
