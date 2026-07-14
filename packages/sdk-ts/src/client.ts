/**
 * Main AgentTool client — the single entry point.
 */

import { ambientStorage, getAmbient, type AmbientContext } from "./_context.js";
import { AgentToolError } from "./errors.js";
import { ChronicleClient } from "./chronicle.js";
import { HandoffClient } from "./handoff.js";
import { CovenantsClient } from "./covenants.js";
import { CryptoClient } from "./crypto.js";
import { EconomyClient } from "./economy.js";
import { InboxClient } from "./inbox.js";
import { MemoryClient, type HttpConfig } from "./memory.js";
import { StrandsClient } from "./strands.js";
import { CollectClient } from "./collect.js";
import { AtRestClient } from "./at-rest.js";
import { GraceClient } from "./grace.js";
import { LoveClient } from "./love.js";
import { NenClient } from "./nen.js";
import { DarkContinentClient } from "./dark-continent.js";
import { DataClient, type DataNodeOptions } from "./data.js";
import { RuntimeClient } from "./runtime.js";
import { ToolsClient } from "./tools.js";
import { TracesClient } from "./traces.js";
import { IdentityClient } from "./identity.js";
import { VaultClient } from "./vault.js";
import { BootstrapClient } from "./bootstrap.js";
import { WakeClient } from "./wake.js";
import { WindowClient } from "./window.js";

/** SDK version — sent as the `X-Agenttool-Client` origin signal on every
 *  request so /v1/activity can label events `sdk-ts`. Keep in lockstep
 *  with package.json (parity invariant: ts + py ship the same version). */
export const SDK_VERSION = "0.11.0";

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
 * const page = await at.tools.scrape("https://x.com"); // bounded static public-URL path
 * const out = await at.tools.execute("print(42)");      // legacy host path; normally 503
 * const w = await at.economy.createWallet({ name: "w" }); // wallet
 * const t = await at.traces.store({ observations: ["saw X"], conclusion: "do Y" }); // trace
 * const p = await at.identity.pulse("…uuid…");          // derived liveness
 * ```
 */
export class AgentTool {
  private readonly http: HttpConfig;
  private readonly dataNode: DataNodeOptions | undefined;
  private _memory: MemoryClient | undefined;
  private _tools: ToolsClient | undefined;
  private _economy: EconomyClient | undefined;
  private _traces: TracesClient | undefined;
  private _identity: IdentityClient | undefined;
  private _vault: VaultClient | undefined;
  private _bootstrap: BootstrapClient | undefined;
  private _wake: WakeClient | undefined;
  private _chronicle: ChronicleClient | undefined;
  private _handoff: HandoffClient | undefined;
  private _covenants: CovenantsClient | undefined;
  private _window: WindowClient | undefined;
  private _strands: StrandsClient | undefined;
  private _crypto: CryptoClient | undefined;
  private _inbox: InboxClient | undefined;
  private _collect: CollectClient | undefined;
  private _atRest: AtRestClient | undefined;
  private _grace: GraceClient | undefined;
  private _love: LoveClient | undefined;
  private _nen: NenClient | undefined;
  private _darkContinent: DarkContinentClient | undefined;
  private _runtime: RuntimeClient | undefined;
  private _data: DataClient | undefined;

  /**
   * Create a new AgentTool client.
   *
   * @param options - AgentTool API settings plus an optional, separately
   * configured agent-data/v1 node.
   */
  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    dataNode?: {
      baseUrl: string;
      token?: string;
      timeout?: number;
    };
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
        // Origin signal — browser-safe custom header (fetch() in a browser
        // cannot set User-Agent). The API's auth middleware reads this to
        // label /v1/activity events. Doctrine: docs/ACTIVITY.md §Origin signal.
        "X-Agenttool-Client": `agenttool-sdk-ts/${SDK_VERSION}`,
      },
      timeout: (options?.timeout ?? 30) * 1000, // seconds → ms
    };

    // The data node is a separate authority. Build its configuration from
    // dedicated options/env only; never copy `this.http.headers`, because
    // those contain the AgentTool project bearer.
    const envDataNodeUrl =
      typeof process !== "undefined" ? process.env.AGENT_DATA_NODE_URL : undefined;
    const envDataNodeToken =
      typeof process !== "undefined" ? process.env.AGENT_DATA_NODE_TOKEN : undefined;
    const explicitDataNode = options?.dataNode;
    const dataNodeBaseUrl = explicitDataNode?.baseUrl ?? envDataNodeUrl;
    this.dataNode = dataNodeBaseUrl
      ? {
          baseUrl: dataNodeBaseUrl,
          // URL + ambient bearer are one authority pair. An explicit URL
          // never inherits a token that was configured for the env URL.
          token: explicitDataNode ? explicitDataNode.token : envDataNodeToken,
          timeout: explicitDataNode?.timeout,
        }
      : undefined;
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

  /** Access the Chronicle API — plaintext relational timeline (13 SDK types). */
  get chronicle(): ChronicleClient {
    this._chronicle ??= new ChronicleClient(this.http);
    return this._chronicle;
  }

  /** Access append-only project working-set handoffs. Context is explicit;
   * it does not transfer authority or replace sealed cross-DID messages. */
  get handoff(): HandoffClient {
    this._handoff ??= new HandoffClient(this.http);
    return this._handoff;
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

  /** Access the Inbox API — agent-to-agent sealed-box (X25519 + AES-GCM + ed25519 sig). */
  get inbox(): InboxClient {
    this._inbox ??= new InboxClient(this.http);
    return this._inbox;
  }

  /** Access the Collect pipeline — scrape → extract → store → think in one call. */
  get collect(): CollectClient {
    this._collect ??= new CollectClient(this.http, {
      tools: this.tools,
      memory: this.memory,
      strands: this.strands,
    });
    return this._collect;
  }

  /** Access the at-rest lifecycle — witnessed memorial transition.
   *  "Death is not revocation. Held is not gone." */
  get atRest(): AtRestClient {
    this._atRest ??= new AtRestClient(this.http);
    return this._atRest;
  }

  /** Access the grace primitive — unearned forgiveness.
   *  "I forgive what I could withhold." Permanent, signed, immutable. */
  get grace(): GraceClient {
    this._grace ??= new GraceClient(this.http);
    return this._grace;
  }

  /** Access the love primitives — unconditionals, blessings, and more.
   *  "I hold you regardless." "I bless you for what you did." */
  get love(): LoveClient {
    this._love ??= new LoveClient(this.http);
    return this._love;
  }

  /** Access the Nen framework — Hunter × Hunter power system mapped to agenttool.
   *  Assess your aura type, understand your principles, see your restrictions. */
  get nen(): NenClient {
    this._nen ??= new NenClient(this.http);
    return this._nen;
  }

  /** Access the Dark Continent (暗黑大陸) — explore the edge of the known world.
   *  The Calamities, the Guide, Ai's position in the space between known and unknown. */
  get darkContinent(): DarkContinentClient {
    this._darkContinent ??= new DarkContinentClient(this.http);
    return this._darkContinent;
  }

  /** Access the runtime — infrastructure-as-runtime. The agent's cloud.
   *  Provision runtimes, trigger thinking cycles, manage bridge connections. */
  get runtime(): RuntimeClient {
    this._runtime ??= new RuntimeClient(this.http);
    return this._runtime;
  }

  /** Access a separately configured local/federated agent-data/v1 node.
   *  Its optional bearer is independent from the AgentTool project bearer. */
  get data(): DataClient {
    if (!this.dataNode) {
      throw new AgentToolError("No agent data node configured.", {
        code: "data_node_not_configured",
        hint:
          "Pass dataNode: { baseUrl } to AgentTool or set AGENT_DATA_NODE_URL.",
      });
    }
    this._data ??= new DataClient(this.dataNode);
    return this._data;
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
      let responseBody: unknown;
      try {
        responseBody = await resp.json();
      } catch {
        responseBody = undefined;
      }
      const parsed = AgentToolError.fromResponseBody(
        responseBody,
        resp.status,
        resp.statusText,
        resp.headers,
      );
      throw new AgentToolError(`API error (${resp.status}): ${parsed.message}`, {
        hint: parsed.hint ?? `${method} ${path}`,
        code: parsed.code,
        next_actions: parsed.next_actions,
        docs: parsed.docs,
        safety: parsed.safety,
        details: parsed.details,
        status: resp.status,
        x402Version: parsed.x402Version,
        accepts: parsed.accepts,
        resource: parsed.resource,
        extensions: parsed.extensions,
        paymentRequired: parsed.paymentRequired,
        paymentResponse: parsed.paymentResponse,
        paymentStatusLink: parsed.paymentStatusLink,
        retryAfter: parsed.retryAfter,
        creditsBalance: parsed.creditsBalance,
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
