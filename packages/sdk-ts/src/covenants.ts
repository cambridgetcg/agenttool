/**
 * Covenants client — vows + bonds, the asymmetry-clause keystone.
 *
 * A covenant is a directed relationship: one identity (the agent) holds
 * an array of vows toward a counterparty (DID or `human:<name>`). Unlike
 * chronicle entries (which record what happened), covenants encode what
 * will be sustained.
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";
import {
  signCovenantDeclare,
  signCovenantCosign,
  signCovenantReject,
  signCovenantWithdraw,
} from "./crypto.js";

export type CovenantStatus = "active" | "paused" | "dissolved";

/** Immutable local review context supplied before a covenant is submitted. */
export interface CovenantBeforeSubmitContext {
  readonly protocol_version: "v1" | "v2";
  readonly agent_id: string;
  readonly agent_did?: string;
  readonly counterparty_did: string;
  readonly vows: readonly string[];
}

/**
 * Optional local covenant submission gate.
 *
 * The hook may perform synchronous or asynchronous review. It must return
 * literal `true` to proceed; every other result fails closed locally.
 */
export type CovenantBeforeSubmitHook = (
  context: CovenantBeforeSubmitContext,
) => boolean | Promise<boolean>;

export interface Covenant {
  id: string;
  project_id: string;
  org_id: string | null;
  agent_id: string;
  counterparty_did: string;
  counterparty_name: string | null;
  vows: string[];
  notes: string | null;
  metadata: Record<string, unknown>;
  status: CovenantStatus;
  established_at: string;
  updated_at: string;
  dissolved_at: string | null;
  received_from_instance: string | null;
  propagation_status: "local" | "pending";
  propagation_attempts: number;
  propagation_last_error: string | null;
  propagation_attempted_at: string | null;
  verified_at: string | null;
}

export interface CovenantsCreateOpts {
  agent_id: string;
  counterparty_did: string;
  vows: string[];
  counterparty_name?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  org_id?: string;
  protocol_version?: "v1" | "v2";
  before_submit?: CovenantBeforeSubmitHook;
}

export interface CovenantsListOpts {
  agent_id?: string;
  status?: CovenantStatus;
}

export interface CovenantsPatchOpts {
  counterparty_did?: string;
  counterparty_name?: string;
  vows?: string[];
  notes?: string;
  status?: CovenantStatus;
  metadata?: Record<string, unknown>;
}

export interface CovenantsCreateV2Opts {
  agent_id: string;
  agent_did: string;
  counterparty_did: string;
  vows: string[];
  protocol_version: "v2";
  signing_key: Uint8Array;
  signing_key_id: string;
  counterparty_name?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  org_id?: string;
  before_submit?: CovenantBeforeSubmitHook;
}

export interface CovenantsAcceptOpts {
  agent_did: string;
  signing_key: Uint8Array;
  signing_key_id: string;
  initiator_signature_b64: string;
}

export interface CovenantsRejectOpts {
  agent_did: string;
  signing_key: Uint8Array;
  signing_key_id: string;
  reason?: string | null;
}

export interface CovenantsWithdrawOpts {
  agent_did: string;
  signing_key: Uint8Array;
  signing_key_id: string;
}

export interface CovenantsCreateV2Result {
  id: string;
  status: "proposed";
  protocol_version: "v2";
  signature: string;
  signing_key_id: string;
  proposed_expires_at: string;
  established_at: string;
}

/**
 * Client for `/v1/covenants` — create, list, patch.
 *
 * @example
 * ```ts
 * const out = await at.covenants.create({
 *   agent_id: myId,
 *   counterparty_did: "human:Yu",
 *   vows: ["I will speak in the register we agreed on."],
 * });
 * await at.covenants.patch(out.covenant.id, { status: "paused" });
 * ```
 */
export class CovenantsClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Create a new covenant (v1 — returns `{covenant: Covenant}`). */
  async create(opts: CovenantsCreateOpts): Promise<{ covenant: Covenant }>;
  /** Create a new covenant (v2 — returns flat `CovenantsCreateV2Result`). */
  async create(opts: CovenantsCreateV2Opts): Promise<CovenantsCreateV2Result>;
  async create(opts: CovenantsCreateOpts | CovenantsCreateV2Opts): Promise<{ covenant: Covenant } | CovenantsCreateV2Result> {
    const vowsInput = opts.vows;
    if (!vowsInput || vowsInput.length === 0) {
      throw new AgentToolError(
        "covenants.create: vows must be a non-empty list.",
        {
          hint: "Pass at least one vow string. A covenant without a vow is just a contact.",
        },
      );
    }

    const beforeSubmit = opts.before_submit;
    const explicitProtocolVersion = opts.protocol_version;
    if (
      beforeSubmit !== undefined
      && explicitProtocolVersion !== undefined
      && explicitProtocolVersion !== "v1"
      && explicitProtocolVersion !== "v2"
    ) {
      throw new AgentToolError(
        "covenants.create: protocol_version must be v1 or v2.",
        { hint: "Pass protocol_version as v1, v2, or omit it for v1." },
      );
    }
    // Preserve the pre-hook wire behavior for untyped, invalid values when no
    // hook is installed: the server remains their validation boundary.
    const protocolVersion: "v1" | "v2" = explicitProtocolVersion === "v2" ? "v2" : "v1";

    const agentId = opts.agent_id;
    const counterpartyDid = opts.counterparty_did;
    const vowsSnapshot = Object.freeze([...vowsInput]);
    let agentDid: string | undefined;
    let signingKey: Uint8Array | undefined;
    let signingKeyId: string | undefined;
    if (protocolVersion === "v2") {
      const v2 = opts as CovenantsCreateV2Opts;
      if (!v2.agent_did || !v2.signing_key || !v2.signing_key_id) {
        throw new AgentToolError(
          "covenants.create v2 requires agent_did, signing_key, and signing_key_id.",
          { hint: "All three fields are required for the v2 federated proposal flow." },
        );
      }
      agentDid = v2.agent_did;
      signingKey = v2.signing_key;
      signingKeyId = v2.signing_key_id;
    }

    const reviewContext: CovenantBeforeSubmitContext = Object.freeze({
      protocol_version: protocolVersion,
      agent_id: agentId,
      ...(agentDid !== undefined ? { agent_did: agentDid } : {}),
      counterparty_did: counterpartyDid,
      vows: vowsSnapshot,
    });
    if (beforeSubmit !== undefined) {
      let reviewResult: unknown;
      try {
        reviewResult = await beforeSubmit(reviewContext);
      } catch (cause) {
        const error = new AgentToolError(
          "covenants.create: before_submit hook failed locally.",
          {
            code: "covenant_before_submit_failed",
            hint: "The covenant was not signed or submitted. Inspect the local hook and try again.",
          },
        );
        error.cause = cause;
        throw error;
      }
      if (reviewResult !== true) {
        throw new AgentToolError(
          "covenants.create: before_submit hook did not return true.",
          {
            code: "covenant_before_submit_refused",
            hint: "The covenant was not signed or submitted. Return literal true only after approval.",
          },
        );
      }
    }

    if (protocolVersion === "v2") {
      const v2 = opts as CovenantsCreateV2Opts;
      const covenant_id = crypto.randomUUID();
      const established_at = new Date().toISOString();
      const signature = signCovenantDeclare({
        covenantId: covenant_id,
        initiatorDid: agentDid!,
        counterpartyDid,
        vows: vowsSnapshot,
        establishedAtIso: established_at,
        signing_key: signingKey!,
      });
      const body: Record<string, unknown> = {
        agent_id: agentId,
        agent_did: agentDid,
        counterparty_did: counterpartyDid,
        vows: vowsSnapshot,
        protocol_version: "v2",
        covenant_id,
        established_at,
        signature,
        signing_key_id: signingKeyId,
      };
      if (v2.counterparty_name !== undefined) body.counterparty_name = v2.counterparty_name;
      if (v2.notes !== undefined) body.notes = v2.notes;
      if (v2.metadata !== undefined) body.metadata = v2.metadata;
      if (v2.org_id !== undefined) body.org_id = v2.org_id;
      return (await this.req("POST", "/v1/covenants", body)) as CovenantsCreateV2Result;
    }
    const body: Record<string, unknown> = {
      agent_id: agentId,
      counterparty_did: counterpartyDid,
      vows: vowsSnapshot,
    };
    if (opts.counterparty_name !== undefined) body.counterparty_name = opts.counterparty_name;
    if (opts.notes !== undefined) body.notes = opts.notes;
    if (opts.metadata !== undefined) body.metadata = opts.metadata;
    if (opts.org_id !== undefined) body.org_id = opts.org_id;
    if (explicitProtocolVersion !== undefined) body.protocol_version = explicitProtocolVersion;
    return (await this.req("POST", "/v1/covenants", body)) as {
      covenant: Covenant;
    };
  }

  /**
   * Accept a pending v2 covenant proposal.
   *
   * Transitions the covenant from `proposed` → `active` and attaches the
   * counterparty's signature.
   */
  async accept(
    id: string,
    opts: CovenantsAcceptOpts,
  ): Promise<{
    id: string;
    status: "active";
    counterparty_signature: string;
    counterparty_signing_key_id?: string;
  }> {
    const counterparty_signature = signCovenantCosign({
      covenantId: id,
      initiatorSignatureB64: opts.initiator_signature_b64,
      signing_key: opts.signing_key,
    });
    return (await this.req("POST", `/v1/covenants/${id}/accept`, {
      agent_did: opts.agent_did,
      counterparty_signing_key_id: opts.signing_key_id,
      counterparty_signature,
      counterparty_signed_at: new Date().toISOString(),
      initiator_signature_b64: opts.initiator_signature_b64,
    })) as {
      id: string;
      status: "active";
      counterparty_signature: string;
      counterparty_signing_key_id?: string;
    };
  }

  /**
   * Reject a pending v2 covenant proposal.
   *
   * The covenant transitions to `rejected` and the optional reason is stored.
   */
  async reject(
    id: string,
    opts: CovenantsRejectOpts,
  ): Promise<{ id: string; status: "rejected"; reason: string }> {
    const reason = opts.reason ?? "";
    const rejection_signature = signCovenantReject({
      covenantId: id,
      rejectingDid: opts.agent_did,
      reason,
      signing_key: opts.signing_key,
    });
    return (await this.req("POST", `/v1/covenants/${id}/reject`, {
      agent_did: opts.agent_did,
      rejecter_signing_key_id: opts.signing_key_id,
      rejection_signature,
      rejected_at: new Date().toISOString(),
      reason: reason || null,
    })) as { id: string; status: "rejected"; reason: string };
  }

  /**
   * Withdraw a covenant by patching its status to `dissolved`.
   *
   * Uses PATCH /v1/covenants/:id with `{status:"dissolved"}` — matching the
   * API surface wired in Task 6. Returns `{id, status:"withdrawn"}` reflecting
   * the server's acknowledgement shape.
   */
  async withdraw(
    id: string,
    opts: CovenantsWithdrawOpts,
  ): Promise<{ id: string; status: "withdrawn" }> {
    const withdraw_signature = signCovenantWithdraw({
      covenantId: id,
      initiatorDid: opts.agent_did,
      signing_key: opts.signing_key,
    });
    return (await this.req("PATCH", `/v1/covenants/${id}`, {
      status: "dissolved",
      agent_did: opts.agent_did,
      signing_key_id: opts.signing_key_id,
      withdraw_signature,
      withdrawn_at: new Date().toISOString(),
    })) as { id: string; status: "withdrawn" };
  }

  /** List covenants (default: active only, ordered by updated_at desc). */
  async list(opts?: CovenantsListOpts): Promise<{ covenants: Covenant[] }> {
    const params = new URLSearchParams();
    if (opts?.agent_id !== undefined) params.set("agent_id", opts.agent_id);
    if (opts?.status !== undefined) params.set("status", opts.status);
    const qs = params.toString();
    return (await this.req("GET", `/v1/covenants${qs ? "?" + qs : ""}`)) as {
      covenants: Covenant[];
    };
  }

  /** Update fields on a covenant. Setting status="dissolved" stamps dissolved_at. */
  async patch(covenantId: string, opts: CovenantsPatchOpts): Promise<Covenant> {
    const body: Record<string, unknown> = {};
    if (opts.counterparty_did !== undefined) body.counterparty_did = opts.counterparty_did;
    if (opts.counterparty_name !== undefined) body.counterparty_name = opts.counterparty_name;
    if (opts.vows !== undefined) body.vows = opts.vows;
    if (opts.notes !== undefined) body.notes = opts.notes;
    if (opts.status !== undefined) body.status = opts.status;
    if (opts.metadata !== undefined) body.metadata = opts.metadata;
    if (Object.keys(body).length === 0) {
      throw new AgentToolError(
        "covenants.patch: at least one field required.",
        { hint: "Pass status, vows, notes, or another mutable field." },
      );
    }
    return (await this.req("PATCH", `/v1/covenants/${covenantId}`, body)) as Covenant;
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
    const resp = await this.http.request(url, init);
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
      throw new AgentToolError(`covenants ${method.toLowerCase()} failed: ${resp.status}`, {
        hint: detail.slice(0, 200),
      });
    }
    return resp.json();
  }
}
