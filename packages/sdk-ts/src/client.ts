/**
 * Main AgentTool client — the single entry point.
 */

import { AgentToolError } from "./errors.js";
import { EconomyClient } from "./economy.js";
import { MemoryClient, type HttpConfig } from "./memory.js";
import { ToolsClient } from "./tools.js";
import { TracesClient } from "./traces.js";
import { VerifyClient } from "./verify.js";
import { IdentityClient } from "./identity.js";
import { VaultClient } from "./vault.js";
import { BootstrapClient } from "./bootstrap.js";
import { PulseClient } from "./pulse.js";
import { WakeClient } from "./wake.js";

/**
 * Unified client for the agenttool.dev platform.
 *
 * @example
 * ```ts
 * import { AgentTool } from "agenttool";
 *
 * const at = new AgentTool();                    // reads AT_API_KEY from env
 * await at.memory.store("just a string");        // store a memory
 * const results = await at.memory.search("q");   // semantic search
 * const hits = await at.tools.search("AI news"); // web search
 * const page = await at.tools.scrape("https://x.com"); // scrape
 * const out = await at.tools.execute("print(42)");      // sandbox
 * const v = await at.verify.check("claim");             // verify
 * const w = await at.economy.createWallet({ name: "w" }); // wallet
 * const t = await at.traces.store({ observations: ["saw X"], conclusion: "do Y" }); // trace
 * ```
 */
export class AgentTool {
  private readonly http: HttpConfig;
  private _memory: MemoryClient | undefined;
  private _tools: ToolsClient | undefined;
  private _verify: VerifyClient | undefined;
  private _economy: EconomyClient | undefined;
  private _traces: TracesClient | undefined;
  private _identity: IdentityClient | undefined;
  private _vault: VaultClient | undefined;
  private _bootstrap: BootstrapClient | undefined;
  private _pulse: PulseClient | undefined;
  private _wake: WakeClient | undefined;

  /**
   * Create a new AgentTool client.
   *
   * @param options - Optional api_key, base_url, timeout.
   */
  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
  }) {
    const resolvedKey =
      options?.apiKey ?? (typeof process !== "undefined" ? process.env.AT_API_KEY : undefined);

    if (!resolvedKey) {
      throw new AgentToolError("No API key provided.", {
        hint: "Pass apiKey in options or set the AT_API_KEY environment variable.",
      });
    }

    this.http = {
      baseUrl: (options?.baseUrl ?? "https://api.agenttool.dev").replace(/\/+$/, ""),
      headers: {
        Authorization: `Bearer ${resolvedKey}`,
        "Content-Type": "application/json",
      },
      timeout: (options?.timeout ?? 30) * 1000, // seconds → ms
    };
  }

  /** Access the Memory API. */
  get memory(): MemoryClient {
    this._memory ??= new MemoryClient(this.http);
    return this._memory;
  }

  /** Access the Tools API (search, scrape, execute). */
  get tools(): ToolsClient {
    this._tools ??= new ToolsClient(this.http);
    return this._tools;
  }

  /** Access the Verify API. */
  get verify(): VerifyClient {
    this._verify ??= new VerifyClient(this.http);
    return this._verify;
  }

  /** Access the Economy/Wallet API. */
  get economy(): EconomyClient {
    this._economy ??= new EconomyClient(this.http);
    return this._economy;
  }

  /** Access the Traces (reasoning provenance) API. */
  get traces(): TracesClient {
    this._traces ??= new TracesClient(this.http);
    return this._traces;
  }

  /** Access the Identity API (DIDs, attestations, trust, JWTs). */
  get identity(): IdentityClient {
    this._identity ??= new IdentityClient(this.http);
    return this._identity;
  }

  /** Access the Vault API (AES-256-GCM encrypted secrets). */
  get vault(): VaultClient {
    this._vault ??= new VaultClient(this.http);
    return this._vault;
  }

  /** Access the Bootstrap API (create agents, L0→L1 elevation). */
  get bootstrap(): BootstrapClient {
    this._bootstrap ??= new BootstrapClient(this.http);
    return this._bootstrap;
  }

  /** Access the Pulse API (agent presence & liveness). */
  get pulse(): PulseClient {
    this._pulse ??= new PulseClient(this.http);
    return this._pulse;
  }

  /** Access the Wake API (identity anchor; load at session start). */
  get wake(): WakeClient {
    this._wake ??= new WakeClient(this.http);
    return this._wake;
  }

  /**
   * Low-level HTTP for custom call sites and provider adapters
   * (e.g. AnthropicAdapter posting to `/v1/traces` after a messages.create).
   * Uses the same bearer + timeout + base URL the module clients use.
   *
   * Throws AgentToolError on non-2xx with the API's `message` / `error`
   * field surfaced as the error message.
   */
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.http.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const resp = await globalThis.fetch(url, init);
    if (resp.status >= 400) {
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
      throw new AgentToolError(`API error (${resp.status}): ${detail}`, {
        hint: `${method} ${path}`,
      });
    }
    return resp.json();
  }

  toString(): string {
    return `AgentTool(baseUrl=${JSON.stringify(this.http.baseUrl)})`;
  }
}
