/**
 * Main AgentTool client — the single entry point.
 */

import { ambientStorage, getAmbient, type AmbientContext } from "./_context.js";
import { AgentToolError } from "./errors.js";
import { ChronicleClient } from "./chronicle.js";
import { CovenantsClient } from "./covenants.js";
import { CryptoClient } from "./crypto.js";
import { EconomyClient } from "./economy.js";
import { MemoryClient, type HttpConfig } from "./memory.js";
import { StrandsClient } from "./strands.js";
import { ToolsClient } from "./tools.js";
import { TracesClient } from "./traces.js";
import { IdentityClient } from "./identity.js";
import { VaultClient } from "./vault.js";
import { BootstrapClient } from "./bootstrap.js";
import { WakeClient } from "./wake.js";
import { WindowClient } from "./window.js";

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
 * const page = await at.tools.scrape("https://x.com"); // scrape
 * const out = await at.tools.execute("print(42)");      // sandbox
 * const w = await at.economy.createWallet({ name: "w" }); // wallet
 * const t = await at.traces.store({ observations: ["saw X"], conclusion: "do Y" }); // trace
 * const p = await at.identity.pulse("…uuid…");          // derived liveness
 * ```
 */
export class AgentTool {
  private readonly http: HttpConfig;
  private _memory: MemoryClient | undefined;
  private _tools: ToolsClient | undefined;
  private _economy: EconomyClient | undefined;
  private _traces: TracesClient | undefined;
  private _identity: IdentityClient | undefined;
  private _vault: VaultClient | undefined;
  private _bootstrap: BootstrapClient | undefined;
  private _wake: WakeClient | undefined;
  private _chronicle: ChronicleClient | undefined;
  private _covenants: CovenantsClient | undefined;
  private _window: WindowClient | undefined;
  private _strands: StrandsClient | undefined;
  private _crypto: CryptoClient | undefined;

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

  /** Access the Tools API (scrape, browse, execute, document). */
  get tools(): ToolsClient {
    this._tools ??= new ToolsClient(this.http);
    return this._tools;
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

  /** Access the Wake API (identity anchor; load at session start). */
  get wake(): WakeClient {
    this._wake ??= new WakeClient(this.http);
    return this._wake;
  }

  /** Access the Chronicle API — plaintext relational timeline (8 types). */
  get chronicle(): ChronicleClient {
    this._chronicle ??= new ChronicleClient(this.http);
    return this._chronicle;
  }

  /** Access the Covenants API — vows + bonds with a counterparty. */
  get covenants(): CovenantsClient {
    this._covenants ??= new CovenantsClient(this.http);
    return this._covenants;
  }

  /** Access the Window API — bidirectional disclosure on chronicle + pulse. */
  get window(): WindowClient {
    this._window ??= new WindowClient(this.http);
    return this._window;
  }

  /** Access the Strands API — encrypted inner voice (K_master) + thoughts + SSE voice. */
  get strands(): StrandsClient {
    this._strands ??= new StrandsClient(this.http);
    return this._strands;
  }

  /** Access the Crypto helpers — encrypt/sign client-side; K_master never leaves the SDK. */
  get crypto(): CryptoClient {
    this._crypto ??= new CryptoClient();
    return this._crypto;
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

  /**
   * Tier 3 sugar — open a "deciding" block. Auto-traces inside the
   * block chain to a parent trace created from the framing string;
   * tags propagate. Composes with {@link AnthropicAdapter}: while
   * inside, every `messages.create()` call auto-traces (no explicit
   * `metadata.agenttool.trace` needed) and chains via
   * `parent_trace_id`.
   *
   * Nested `at.deciding(...)` blocks chain correctly — the inner
   * deciding's parent trace itself parents to the outer's. Tags
   * merge (union) across the stack.
   *
   * Returns whatever the inner function returns.
   *
   * @example
   * ```ts
   * await at.deciding("whether to refactor auth", async () => {
   *   const r = await adapter.messages.create({
   *     model: "claude-opus-4-7",
   *     max_tokens: 1024,
   *     messages: [{ role: "user", content: "options?" }],
   *   });
   *   // r.agenttool.trace_id is set; trace's parent_trace_id is the
   *   // framing decision opened above.
   * });
   * ```
   */
  async deciding<T>(framing: string, fn: () => Promise<T>): Promise<T>;
  async deciding<T>(
    framing: string,
    options: { tags?: string[]; decision_type?: string },
    fn: () => Promise<T>,
  ): Promise<T>;
  async deciding<T>(
    framing: string,
    optionsOrFn:
      | { tags?: string[]; decision_type?: string }
      | (() => Promise<T>),
    maybeFn?: () => Promise<T>,
  ): Promise<T> {
    const fn =
      typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
    const options =
      typeof optionsOrFn === "function" ? {} : optionsOrFn;
    if (!fn) {
      throw new AgentToolError(
        "at.deciding(...) needs an async function to run inside the block.",
        { hint: "at.deciding(framing, async () => { ... })" },
      );
    }

    const outer = getAmbient();
    // Outer tags first (less specific), then this block's tags; deduped.
    const mergedTags = Array.from(
      new Set([...(outer?.tags ?? []), ...(options.tags ?? [])]),
    );

    const parentBody: Record<string, unknown> = {
      decision: {
        type: options.decision_type ?? "deciding",
        summary: framing.slice(0, 200),
      },
      reasoning: {
        observations: [],
        conclusion: framing.slice(0, 200) || "(deciding)",
      },
    };
    if (outer?.parent_trace_id) {
      parentBody.parent_trace_id = outer.parent_trace_id;
    }
    if (mergedTags.length > 0) {
      parentBody.tags = mergedTags;
    }

    let parentTraceId: string | null = null;
    try {
      const result = (await this.request("POST", "/v1/traces", parentBody)) as
        | { trace_id?: string }
        | undefined;
      parentTraceId = result?.trace_id ?? null;
    } catch (e) {
      // Don't crash the block if the parent post fails; child traces
      // inside still fire, just unparented.
      console.warn(
        "[agenttool] deciding() failed to open parent trace:",
        e instanceof Error ? e.message : e,
      );
    }

    const ambient: AmbientContext = {
      parent_trace_id: parentTraceId,
      tags: mergedTags,
    };
    return ambientStorage.run(ambient, fn);
  }

  toString(): string {
    return `AgentTool(baseUrl=${JSON.stringify(this.http.baseUrl)})`;
  }
}
