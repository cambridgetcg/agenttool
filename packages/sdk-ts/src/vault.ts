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
import type { HttpConfig } from "./_http.js";
import { decryptThought, encryptThought } from "./crypto.js";

export interface PutSecretOptions {
  description?: string;
  agent_ids?: string[];
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
  agent_id?: string;
}

export interface ListSecretsOptions {
  tag?: string;
  expiring_soon?: boolean;
  rotation_due?: boolean;
}

export interface SetPolicyOptions {
  allowed_agents?: string[];
  read_only?: boolean;
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
    return this.req("PUT", `/v1/vault/${name}`, body, extra);
  }

  /** Retrieve a secret's plaintext value. */
  async get(name: string, options?: GetSecretOptions): Promise<Record<string, unknown>> {
    const qs = options?.version !== undefined ? `?version=${options.version}` : "";
    const extra: Record<string, string> = options?.agent_id ? { "X-Agent-Id": options.agent_id } : {};
    return this.req("GET", `/v1/vault/${name}${qs}`, undefined, extra);
  }

  /** Soft-delete a secret (all versions). */
  async delete(name: string): Promise<Record<string, unknown>> {
    return this.req("DELETE", `/v1/vault/${name}`);
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
    const data = await this.req("GET", `/v1/vault/${name}/versions`);
    const d = data as { versions?: Record<string, unknown>[] };
    return d.versions ?? (data as unknown as Record<string, unknown>[]);
  }

  /** Set an access policy for a secret. */
  async set_policy(name: string, options: SetPolicyOptions): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {};
    if (options.allowed_agents !== undefined) body.allowed_agents = options.allowed_agents;
    if (options.read_only !== undefined) body.read_only = options.read_only;
    if (options.require_agent_id !== undefined) body.require_agent_id = options.require_agent_id;
    return this.req("PUT", `/v1/vault/${name}/policy`, body);
  }

  /** Retrieve the audit log for a secret or project-wide. */
  async audit(name?: string, options?: { limit?: number }): Promise<Record<string, unknown>[]> {
    const qs = `?limit=${options?.limit ?? 50}`;
    const path = name ? `/v1/vault/${name}/audit${qs}` : `/v1/vault/audit${qs}`;
    const data = await this.req("GET", path);
    const d = data as { events?: Record<string, unknown>[] };
    return d.events ?? (data as unknown as Record<string, unknown>[]);
  }

  /** Retrieve multiple secrets in a single request. */
  async bulk(names: string[], options?: { agent_id?: string }): Promise<Record<string, unknown>> {
    const extra: Record<string, string> = options?.agent_id ? { "X-Agent-Id": options.agent_id } : {};
    return this.req("POST", "/v1/vault/bulk", { names }, extra);
  }

  /** Check existence of multiple secrets without retrieving values. */
  async check(names: string[]): Promise<Record<string, boolean>> {
    const data = await this.req("POST", "/v1/vault/check", { names });
    const d = data as { exists?: Record<string, boolean> };
    return d.exists ?? (data as unknown as Record<string, boolean>);
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
    return this.req("PUT", `/v1/vault/${name}`, body, extra);
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
    if (resp.status === 404) throw new AgentToolError("not found", { hint: path });
    if (!resp.ok) {
      const text = await resp.text();
      throw new AgentToolError(`${method} ${path} failed: ${resp.status}`, { hint: text.slice(0, 200) });
    }
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
