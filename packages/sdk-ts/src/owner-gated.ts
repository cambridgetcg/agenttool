/**
 * Owner-gated deletes and withdrawals: build the exact request, signed when
 * the owner is agent-rooted.
 *
 * Since the deletion-scopes owner rule (server: `authorizeOwnedContentMutation`,
 * published at `GET /public/ownership-map`), erasing or withdrawing
 * identity-bound content needs its owner's consent:
 *
 * - an agent-rooted owner (an enrolled guest included) signs the exact
 *   request with its own root; the bearer alone gets 428
 *   `authority_proof_required`;
 * - an owner without a root follows the project rule: no roots in the
 *   project means the bearer alone; one root means that root signs; several
 *   roots mean the bearer acts for that owner's own content;
 * - one request may not mix owners that need different consents (409
 *   `authority_quorum_required`): send one request per owner.
 *
 * The proof is the existing `identity-authority/v1` exact-request format
 * (method, path and query, sha256 of the exact body, next sequence,
 * timestamp). `ownerGatedRequest` serializes the body once, signs those
 * bytes, and returns the method, URL, body and headers to send unchanged.
 * Clients that already wrap these routes (`memory.delete`, `inbox.delete`,
 * `love.revokeBlessing`, `love.archiveOffering`, …) accept the same
 * `authority` option; they may send different body bytes (archiveOffering
 * sends `{}`), and sign the bytes they send.
 *
 * Byte-identical to `agenttool.owner_gated` in the Python SDK.
 */

import { authorityHeadersForRequest, type AuthorityBinding } from "./authority.js";
import { encodePathSegment } from "./_url.js";

/** Every route the owner rule gates, with its exact method and body form. */
export const OWNER_GATED_ROUTES = Object.freeze({
  "memory.delete": { method: "DELETE", path: "/v1/memories/{id}", body: "none" },
  "memory.delete_by_key": { method: "DELETE", path: "/v1/memories?key={key}", body: "none" },
  "inbox.delete": { method: "DELETE", path: "/v1/inbox/{id}", body: "none" },
  "inbox.mark_deleted": { method: "PATCH", path: "/v1/inbox/{id}", body: "status" },
  "blessing.withdraw": { method: "DELETE", path: "/v1/blessings/{id}", body: "none" },
  "unconditional.withdraw": { method: "DELETE", path: "/v1/unconditionals/{id}", body: "none" },
  "guild_recognition.withdraw": { method: "DELETE", path: "/v1/guild/recognitions/{id}", body: "none" },
  "attestation.withdraw": { method: "DELETE", path: "/v1/attestations/{id}", body: "none" },
  "margin.withdraw": { method: "POST", path: "/v1/margin/withdraw", body: "margin_id" },
  "trust.withdraw": { method: "POST", path: "/v1/trust/withdraw", body: "trust_id" },
  "offering.withdraw": { method: "POST", path: "/v1/offerings/{id}/archive", body: "none" },
} as const);

export type OwnerGatedAction = keyof typeof OWNER_GATED_ROUTES;

export interface OwnerGatedRequestOptions {
  /** API origin, e.g. `https://api.agenttool.dev` (a trailing slash is dropped). */
  baseUrl: string;
  action: OwnerGatedAction;
  /** The row: memory, message, blessing, unconditional, recognition, attestation, margin, trust or offering id. */
  id?: string;
  /** `memory.delete_by_key` only: the exact memory key. */
  key?: string;
  /** `margin.withdraw` / `trust.withdraw` only: the giver's identity id. */
  agentId?: string;
  /** The owner's (or the project root's) consent. Omit for a bearer-only request. */
  authority?: AuthorityBinding;
}

/** One exact request: send `body` byte for byte (the empty string means no body). */
export interface OwnerGatedRequest {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** Every character outside RFC 3986 unreserved (A-Za-z0-9-._~) percent-encoded
 *  with uppercase hex: the Python SDK's quote(value, safe=""), so both SDKs
 *  build, and sign, the same request target for the same key. */
function strictQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function required(value: string | undefined, name: string, action: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`ownerGatedRequest: ${action} needs ${name}`);
  }
  return value;
}

/**
 * Build the exact request for an owner-gated delete or withdrawal, with the
 * three `X-Agenttool-Authority-*` headers when `authority` is given.
 */
export function ownerGatedRequest(opts: OwnerGatedRequestOptions): OwnerGatedRequest {
  const route = OWNER_GATED_ROUTES[opts.action];
  if (!route) throw new Error(`ownerGatedRequest: unknown action ${String(opts.action)}`);
  const base = opts.baseUrl.replace(/\/+$/, "");
  let path: string;
  let body = "";
  switch (route.body) {
    case "none":
      path = opts.action === "memory.delete_by_key"
        ? `/v1/memories?key=${strictQueryValue(required(opts.key, "key", opts.action))}`
        : route.path.replace("{id}", encodePathSegment(required(opts.id, "id", opts.action)));
      break;
    case "status":
      path = route.path.replace("{id}", encodePathSegment(required(opts.id, "id", opts.action)));
      body = JSON.stringify({ status: "deleted" });
      break;
    default:
      path = route.path;
      body = JSON.stringify({
        agent_id: required(opts.agentId, "agentId", opts.action),
        [route.body]: required(opts.id, "id", opts.action),
      });
  }
  const url = `${base}${path}`;
  const headers: Record<string, string> = body ? { "Content-Type": "application/json" } : {};
  if (opts.authority !== undefined) {
    Object.assign(headers, authorityHeadersForRequest({ method: route.method, url, body, authority: opts.authority }));
  }
  return { method: route.method, url, body, headers };
}
