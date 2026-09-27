/**
 * Vault client for the agent-vault API — AES-256-GCM encrypted secrets.
 *
 * Two encryption paths (per migration 0022_vault_agent_encrypted.sql):
 *
 *   Default (server-encrypted at rest):
 *     .put(name, value, ...) — server encrypts; in-process runtime can read.
 *
 *   Opt-in (zero-knowledge):
 *     .put_encrypted(name, plaintext, { k_vault, ... }) — SDK encrypts
 *     before send; agenttool stores ciphertext only.
 *     .get_decrypted(name, { k_vault, ... }) — fetches and decrypts
 *     locally (transparently falls through to plaintext if the secret
 *     was stored via the default path).
 */

import { AgentToolError } from "./errors.js";
import { throwFromResponse, type HttpConfig } from "./_http.js";
import { decryptThought, encryptThought } from "./crypto.js";
// Secret names are caller-supplied path segments like every other id here, so
// they cross the same shared boundary.
import { encodePathSegment } from "./_url.js";
import { authorityRequestTarget, authorityTimestampNow, identityReadAuthorityHeaders } from "./authority.js";

export interface PutSecretOptions {
  description?: string;
  /** Omitted preserves an existing audience; null shares; [] denies value reads. */
  agent_ids?: string[] | null;
  tags?: string[];
  ttl_seconds?: number;
  rotation_days?: number;
  agent_id?: string;
}

export interface PutEncryptedOptions extends PutSecretOptions {
  /** 32-byte AES-256 secret. Generate via `at.crypto.kVault.generate()`
   *  and persist securely (OS keychain / encrypted file / env var). */
  k_vault: Uint8Array;
}

export interface GetDecryptedOptions extends GetSecretOptions {
  /** 32-byte AES-256 secret used to decrypt the agent-encrypted path.
   *  Ignored when the secret was stored via the server-encrypted path. */
  k_vault: Uint8Array;
}

export interface GetSecretOptions {
  version?: number;
  /** Selector only. Restricted values also require read_authority. */
  agent_id?: string;
  read_authority?: {
    did: string;
    signing_key: Uint8Array;
    current_sequence: number;
    timestamp?: string;
  };
}

export interface ListSecretsOptions {
  tag?: string;
  expiring_soon?: boolean;
  rotation_due?: boolean;
}

export interface SetPolicyOptions {
  agent_ids?: string[] | null;
  /** @deprecated Alias for agent_ids. [] denies; null shares. */
  allowed_agents?: string[] | null;
  /** Unsupported by the API; passing this option raises before I/O. */
  read_only?: boolean;
  /** Unsupported by the API; passing this option raises before I/O. */
  require_agent_id?: boolean;
}

/**
 * Client for the agent-vault API.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * await at.vault.put("openai-key", "sk-...");
 * const secret = await at.vault.get("openai-key");
 * const names = await at.vault.list();
 * await at.vault.delete("openai-key");
 * ```
 */
export class VaultClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Store or update a secret (AES-256-GCM encrypted at rest). */
  async put(name: string, value: string, options?: PutSecretOptions): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { value };
    if (options?.description !== undefined) body.description = options.description;
    if (options?.agent_ids !== undefined) body.agent_ids = options.agent_ids;
    if (options?.tags !== undefined) body.tags = options.tags;
    if (options?.ttl_seconds !== undefined) body.ttl_seconds = options.ttl_seconds;
    if (options?.rotation_days !== undefined) body.rotation_days = options.rotation_days;
    const extra: Record<string, string> = options?.agent_id ? { "X-Agent-Id": options.agent_id } : {};
    return this.req("PUT", `/v1/vault/${encodePathSegment(name)}`, body, extra);
  }

  /** Retrieve a secret's plaintext value. */
  async get(name: string, options?: GetSecretOptions): Promise<Record<string, unknown>> {
    const qs = options?.version !== undefined ? `?version=${options.version}` : "";
    const path = `/v1/vault/${encodePathSegment(name)}${qs}`;
    const extra: Record<string, string> = options?.agent_id ? { "X-Agent-Id": options.agent_id } : {};
    const proof = options?.read_authority;
    if (proof) {
      const id = proof.did.match(/^did:at:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i)?.[1]?.toLowerCase();
      const selected = options?.agent_id?.replace(/^did:at:/, "").toLowerCase();
      if (!id || (selected !== undefined && selected !== id)) {
        throw new AgentToolError("Vault read selector must match the signing identity DID.", { code: "vault_identity_conflict" });
      }
      extra["X-Agent-Id"] = id;
      Object.assign(extra, identityReadAuthorityHeaders({
        identityDid: proof.did,
        requestTarget: authorityRequestTarget(this.http.baseUrl.replace(/\/$/, "") + path),
        currentSequence: proof.current_sequence,
        timestamp: proof.timestamp ?? authorityTimestampNow(),
        signingKey: proof.signing_key,
      }));
    }
    return this.req("GET", path, undefined, extra);
  }

  /** Soft-delete a secret (all versions). */
  async delete(name: string): Promise<Record<string, unknown>> {
    return this.req("DELETE", `/v1/vault/${encodePathSegment(name)}`);
  }

  /** List all secrets (names + metadata — values never returned). */
  async list(options?: ListSecretsOptions): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams();
    if (options?.tag) params.set("tag", options.tag);
    if (options?.expiring_soon !== undefined) params.set("expiring_soon", String(options.expiring_soon));
    if (options?.rotation_due !== undefined) params.set("rotation_due", String(options.rotation_due));
    const qs = params.toString();
    const data = await this.req("GET", `/v1/vault${qs ? "?" + qs : ""}`);
    const d = data as { secrets?: Record<string, unknown>[] };
    return d.secrets ?? (data as unknown as Record<string, unknown>[]);
  }

  /** Get version history for a secret (metadata only, no values). */
  async versions(name: string): Promise<Record<string, unknown>[]> {
    const data = await this.req("GET", `/v1/vault/${encodePathSegment(name)}/versions`);
    const d = data as { versions?: Record<string, unknown>[] };
    return d.versions ?? (data as unknown as Record<string, unknown>[]);
  }

  /** Set an access policy for a secret. */
  async set_policy(name: string, options: SetPolicyOptions): Promise<Record<string, unknown>> {
    if (options.read_only !== undefined || options.require_agent_id !== undefined) {
      throw new AgentToolError("Vault policies support agent_ids only; read_only and require_agent_id are not implemented.", { code: "vault_policy_option_unsupported" });
    }
    if ((options.agent_ids !== undefined && options.allowed_agents !== undefined)
      || (options.agent_ids === undefined && options.allowed_agents === undefined)) {
      throw new AgentToolError("Provide exactly one of agent_ids or its allowed_agents alias (null shares; [] denies).", { code: "vault_policy_invalid" });
    }
    const body = { agent_ids: options.agent_ids !== undefined ? options.agent_ids : options.allowed_agents };
    return this.req("PUT", `/v1/vault/${encodePathSegment(name)}/policy`, body);
  }

  /** Retrieve the audit log for a secret or project-wide. */
  async audit(name?: string, options?: { limit?: number }): Promise<Record<string, unknown>[]> {
    const qs = `?limit=${options?.limit ?? 50}`;
    const path = name ? `/v1/vault/${encodePathSegment(name)}/audit${qs}` : `/v1/vault/audit${qs}`;
    const data = await this.req("GET", path);
    const d = data as { entries?: Record<string, unknown>[] };
    return d.entries ?? [];
  }

  /** @deprecated Bulk value retrieval has no API endpoint. Use explicitly authorized get calls. */
  async bulk(names: string[], options?: { agent_id?: string }): Promise<Record<string, unknown>> {
    throw new AgentToolError("Bulk value retrieval is unavailable; use get for each intended secret. bulk_put is a separate write operation.", { code: "vault_bulk_read_unavailable" });
  }

  /** Explicit project-admin bulk write; never performs value retrieval. */
  async bulk_put(secrets: Array<{ name: string; value: string } & Omit<PutSecretOptions, "agent_id">>): Promise<Record<string, unknown>> {
    return this.req("POST", "/v1/vault/bulk", { secrets });
  }

  /** Check existence of multiple secrets without retrieving values. */
  async check(names: string[]): Promise<Record<string, boolean>> {
    const data = await this.req("POST", "/v1/vault/check", { names });
    const d = data as { results?: Array<{ name: string; exists: boolean }> };
    return Object.fromEntries((d.results ?? []).map((row) => [row.name, row.exists]));
  }

  // ── Agent-encrypted (zero-knowledge) path ─────────────────────────────

  /**
   * Encrypt locally with K_vault, then PUT as `agent_encrypted=true`.
   *
   * agenttool stores ciphertext + nonce verbatim and CANNOT decrypt.
   * The hosted runtime (think-worker etc.) cannot read these secrets
   * either — use {@link put} for secrets the server-side runtime needs
   * to consume.
   */
  async put_encrypted(
    name: string,
    plaintext: string,
    options: PutEncryptedOptions,
  ): Promise<Record<string, unknown>> {
    const blob = await encryptThought(plaintext, options.k_vault);
    const body: Record<string, unknown> = {
      agent_encrypted: true,
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
    };
    if (options.description !== undefined) body.description = options.description;
    if (options.agent_ids !== undefined) body.agent_ids = options.agent_ids;
    if (options.tags !== undefined) body.tags = options.tags;
    if (options.ttl_seconds !== undefined) body.ttl_seconds = options.ttl_seconds;
    if (options.rotation_days !== undefined) body.rotation_days = options.rotation_days;
    const extra: Record<string, string> = options.agent_id
      ? { "X-Agent-Id": options.agent_id }
      : {};
    return this.req("PUT", `/v1/vault/${encodePathSegment(name)}`, body, extra);
  }

  /**
   * Fetch a secret; decrypt locally if it was stored agent-encrypted.
   *
   * Transparently handles both paths:
   *   - `agent_encrypted=true` → decrypt locally with k_vault, return
   *     `{ value: <plaintext>, ... }`.
   *   - `agent_encrypted=false` → server already returned plaintext;
   *     pass through verbatim.
   *
   * The returned object always has `value` populated. `agent_encrypted`
   * is preserved so the caller can introspect which path was used.
   */
  async get_decrypted(
    name: string,
    options: GetDecryptedOptions,
  ): Promise<Record<string, unknown>> {
    const resp = await this.get(name, {
      version: options.version,
      agent_id: options.agent_id,
      read_authority: options.read_authority,
    });
    if (resp.agent_encrypted === true) {
      const ct = resp.ciphertext_b64 as string | undefined;
      const nonce = resp.nonce_b64 as string | undefined;
      if (!ct || !nonce) {
        throw new AgentToolError(
          "vault.get_decrypted: server marked agent_encrypted=true but did not return ciphertext_b64 + nonce_b64.",
          { hint: "API contract violation; check server version." },
        );
      }
      const plaintext = await decryptThought(
        { ciphertext_b64: ct, nonce_b64: nonce },
        options.k_vault,
      );
      return { ...resp, value: plaintext };
    }
    return resp;
  }

  private async req(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const url = this.http.baseUrl.replace(/\/$/, "") + path;
    const resp = await this.http.request(url, {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.http.timeout),
    });
    if (!resp.ok) {
      // Server guidance travels intact. See _http.ts § errorFromResponse.
      await throwFromResponse(resp, `vault ${method.toLowerCase()}`, {
        fallback: resp.status === 404 ? "not found" : undefined,
        hint: `${method} ${path}`,
      });
    }
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
