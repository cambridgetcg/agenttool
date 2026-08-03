/**
 * Strands client — strands of thought + encrypted inner voice.
 *
 * Strand metadata (topic, mood, status) is plaintext by default; thought
 * CONTENT is always ciphertext under K_master. Each thought carries an
 * ed25519 signature the API verifies on write.
 *
 * Phase 5 of the SDK. The crypto wire format mirrors
 * `cli/think/src/crypto.ts` and the api-side verifier at
 * `api/src/services/strand/sig.ts`.
 *
 * Two clients in this module:
 *   - StrandsClient — strand CRUD (create / list / get / patch).
 *   - ThoughtsClient — encrypted thought add / list / voice (SSE iterator).
 *     Mounted at `at.strands.thoughts`.
 *
 * ── Thought canonical-bytes version — why the default is still v1 ──────
 *
 * `add()` takes `version` and forwards it to `signThought`. It defaults to
 * `"v1"`, and that default is a decision, not an oversight.
 *
 * What v2 fixes: v1 NUL-delimits raw binary it does not length-bound, so a
 * ciphertext or nonce carrying a 0x00 byte can reparse as a different
 * (ciphertext, nonce) split under one signature. A 12-byte random nonce
 * holds a zero byte ~4.6% of the time, so this is a routine shape, not a
 * contrived one. `strand-thought/v2` domain-tags the hash and puts a
 * 4-byte big-endian length before every variable-length field, which makes
 * the split unique. Pass `version: "v2"` to sign the unambiguous framing.
 *
 * Why the default has not moved: this SDK is published to npm on its own
 * cadence, and a caller can point it at any `baseUrl` — including a server
 * deployed before dual-accept landed. Such a server verifies v1 only, so a
 * v2-by-default SDK would write signatures it rejects. The default flips
 * only in this order, each step verified before the next begins:
 *
 *   1. server dual-accept (`verifyThoughtSignature` tries v2, falls back
 *      to v1) deployed to EVERY environment an SDK caller can reach
 *   2. SDK minor release — this default becomes `"v2"` in both languages
 *   3. `cli/think` — `THOUGHT_SIGNING_VERSION` in `cli/think/src/crypto.ts`
 *   4. hosted worker — `THOUGHT_SIGNING_VERSION` in
 *      `api/src/services/runtime/think-worker.ts`
 *
 * v1 verification is never removed at any step: production rows signed
 * under v1 must stay verifiable forever. See `docs/STRANDS.md § Canonical
 * bytes — v1, v2, and the cutover`.
 */

import { AgentToolError } from "./errors.js";
import { throwFromResponse, type HttpConfig } from "./_http.js";
import { encodePathSegment } from "./_url.js";
import {
  decryptThought,
  encryptThought,
  signThought,
  type ThoughtCanonicalVersion,
} from "./crypto.js";

export type StrandStatus = "active" | "dormant" | "completed" | "abandoned";
export type StrandVisibility = "private" | "public";
export type ThoughtKind =
  | "observation"
  | "question"
  | "conjecture"
  | "resolution"
  | "drift"
  | "feeling";

export interface Strand {
  id: string;
  agent_id: string | null;
  identity_id: string | null;
  parent_strand_id: string | null;
  topic: string | null;
  topic_encrypted: boolean;
  mood: string | null;
  mood_encrypted: boolean;
  status: StrandStatus;
  importance: number | null;
  visibility: StrandVisibility;
  last_thought_at: string | null;
  last_thought_seq: number;
  next_revisit_at: string | null;
  state_ciphertext: string | null;
  state_nonce: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Thought {
  id: string;
  strand_id: string;
  agent_id: string | null;
  sequence_num: number;
  kind: string | null;
  kind_encrypted: boolean;
  ciphertext: string;
  nonce: string;
  refs: unknown;
  signature: string;
  signing_key_id: string;
  created_at: string;
}

export interface DecryptedThought extends Thought {
  /** Decrypted plaintext, or null when the entry is redacted / decrypt failed. */
  plaintext: string | null;
  decrypt_error?: string;
}

export interface StrandsCreateOpts {
  agent_id?: string;
  identity_id?: string;
  parent_strand_id?: string;
  topic?: string;
  topic_encrypted?: boolean;
  mood?: string;
  mood_encrypted?: boolean;
  status?: StrandStatus;
  importance?: number;
  state_ciphertext?: string;
  state_nonce?: string;
  metadata?: Record<string, unknown>;
}

export interface StrandsListOpts {
  status?: StrandStatus;
  agent_id?: string;
  /** Default 50, server caps at 200. */
  limit?: number;
}

export interface StrandsPatchOpts {
  status?: StrandStatus;
  importance?: number | null;
  topic?: string | null;
  topic_encrypted?: boolean;
  mood?: string | null;
  mood_encrypted?: boolean;
  next_revisit_at?: string | null;
  state_ciphertext?: string | null;
  state_nonce?: string | null;
  metadata?: Record<string, unknown>;
  visibility?: StrandVisibility;
}

export interface ThoughtsAddOpts {
  k_master: Uint8Array;
  signing_key: Uint8Array;
  signing_key_id: string;
  kind?: string;
  kind_encrypted?: boolean;
  refs?: Array<{ kind: string; ref: string }>;
  agent_id?: string;
  /**
   * Canonical-bytes version signed over. Defaults to `"v1"` — see the
   * module header for why, and for the ordered condition under which that
   * default flips. `"v2"` is the length-prefixed framing; only pass it
   * against a server that dual-accepts.
   */
  version?: ThoughtCanonicalVersion;
}

export interface ThoughtsListOpts {
  k_master: Uint8Array;
  since_seq?: number;
  /** Default 100, server caps at 500. */
  limit?: number;
}

export interface ThoughtsVoiceOpts {
  k_master: Uint8Array;
  since_seq?: number;
}

/**
 * Client for `/v1/strands` — strand CRUD + state replace.
 *
 * Thoughts ride on `at.strands.thoughts` (a sub-client) so the parent
 * strand id is always the first positional argument.
 *
 * @example
 * ```ts
 * const s = await at.strands.create({ topic: "auth refactor", agent_id: myDid });
 * await at.strands.patch(s.id, { status: "dormant", importance: 0.8 });
 * const out = await at.strands.list({ status: "active" });
 * ```
 */
export class StrandsClient {
  private readonly http: HttpConfig;
  /** Sub-client for encrypted thoughts on a strand. */
  readonly thoughts: ThoughtsClient;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
    this.thoughts = new ThoughtsClient(http);
  }

  /** Create a strand. Returns the full strand row. */
  async create(opts: StrandsCreateOpts = {}): Promise<Strand> {
    return (await this.req("POST", "/v1/strands", opts)) as Strand;
  }

  /** List strands. Server orders by last_thought_at desc, then created_at desc. */
  async list(opts: StrandsListOpts = {}): Promise<{ strands: Strand[]; count: number }> {
    const limit = opts.limit ?? 50;
    if (limit < 1 || limit > 200) {
      throw new AgentToolError(
        `strands.list: limit must be 1-200, got ${limit}.`,
      );
    }
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (opts.status) params.set("status", opts.status);
    if (opts.agent_id) params.set("agent_id", opts.agent_id);
    return (await this.req(
      "GET",
      `/v1/strands?${params.toString()}`,
    )) as { strands: Strand[]; count: number };
  }

  /** Fetch one strand. */
  async get(strandId: string): Promise<Strand> {
    return (await this.req(
      "GET",
      `/v1/strands/${encodePathSegment(strandId)}`,
    )) as Strand;
  }

  /** Patch fields on a strand. At least one field required. */
  async patch(strandId: string, opts: StrandsPatchOpts): Promise<Strand> {
    if (Object.keys(opts).length === 0) {
      throw new AgentToolError(
        "strands.patch: at least one field required.",
        { hint: "Pass status, importance, topic, visibility, or another mutable field." },
      );
    }
    return (await this.req(
      "PATCH",
      `/v1/strands/${encodePathSegment(strandId)}`,
      opts,
    )) as Strand;
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
      // Server guidance travels intact. See _http.ts § throwFromResponse.
      await throwFromResponse(resp, `strands ${method.toLowerCase()}`);
    }
    return resp.json();
  }
}

/**
 * Client for `/v1/strands/:id/thoughts` — encrypted thought add/list/voice.
 *
 * `add()` encrypts content under K_master and signs over canonical
 * bytes before POSTing; agenttool sees ciphertext + signature only.
 * `list()` and `voice()` decrypt ciphertext after fetching.
 */
export class ThoughtsClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /**
   * Encrypt + sign + POST a thought to a strand.
   *
   * `opts.version` selects the canonical-bytes framing. It defaults to
   * `"v1"` — deliberately, because this SDK ships independently of any
   * server deploy and a v2 signature is rejected by a server that has not
   * yet been given dual-accept. The module header carries the full
   * reasoning and the ordered cutover. Do not "fix" this to `"v2"`.
   */
  async add(
    strandId: string,
    plaintext: string,
    opts: ThoughtsAddOpts,
  ): Promise<Thought> {
    const blob = await encryptThought(plaintext, opts.k_master);
    const sig = signThought({
      strandId,
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      kind: opts.kind ?? null,
      version: opts.version,
      signing_key: opts.signing_key,
    });
    const body: Record<string, unknown> = {
      ciphertext: blob.ciphertext_b64,
      nonce: blob.nonce_b64,
      signature: sig,
      signing_key_id: opts.signing_key_id,
    };
    if (opts.kind !== undefined) body.kind = opts.kind;
    if (opts.kind_encrypted) body.kind_encrypted = true;
    if (opts.refs !== undefined) body.refs = opts.refs;
    if (opts.agent_id !== undefined) body.agent_id = opts.agent_id;

    return (await this.req(
      "POST",
      `/v1/strands/${encodePathSegment(strandId)}/thoughts`,
      body,
    )) as Thought;
  }

  /**
   * List thoughts in a strand, decrypted client-side.
   *
   * Each returned thought has the original server fields PLUS a
   * `plaintext` field with the decrypted content. Redacted entries
   * (cross-project covenant access) pass through with `plaintext=null`.
   */
  async list(
    strandId: string,
    opts: ThoughtsListOpts,
  ): Promise<DecryptedThought[]> {
    const limit = opts.limit ?? 100;
    if (limit < 1 || limit > 500) {
      throw new AgentToolError(
        `strands.thoughts.list: limit must be 1-500, got ${limit}.`,
        { hint: "The server caps at 500; reduce or paginate by since_seq." },
      );
    }
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (opts.since_seq !== undefined) {
      params.set("since_seq", String(opts.since_seq));
    }
    const body = (await this.req(
      "GET",
      `/v1/strands/${encodePathSegment(strandId)}/thoughts?${params.toString()}`,
    )) as { thoughts: Thought[]; count: number; note: string };
    const thoughts = body.thoughts ?? [];
    return Promise.all(
      thoughts.map((t) => withPlaintext(t, opts.k_master)),
    );
  }

  /**
   * Stream new thoughts via SSE, decrypted client-side.
   *
   * Returns an async iterator yielding decrypted thoughts in order.
   * The iterator stops when the stream closes (server lifetime cap,
   * client break, network error). For long-lived consumers, wrap in
   * a reconnect loop using the highest `sequence_num` seen as
   * `since_seq`.
   *
   * @example
   * ```ts
   * for await (const t of at.strands.thoughts.voice(id, { k_master })) {
   *   console.log(t.sequence_num, t.plaintext);
   * }
   * ```
   */
  async *voice(
    strandId: string,
    opts: ThoughtsVoiceOpts,
  ): AsyncIterableIterator<DecryptedThought> {
    const params = new URLSearchParams();
    if (opts.since_seq !== undefined) {
      params.set("since_seq", String(opts.since_seq));
    }
    const qs = params.toString();
    const url = `${this.http.baseUrl}/v1/strands/${encodePathSegment(strandId)}/voice${qs ? "?" + qs : ""}`;

    const resp = await this.http.request(url, {
      method: "GET",
      headers: { ...this.http.headers, Accept: "text/event-stream" },
      // No timeout signal — SSE streams are long-lived.
    });
    if (!resp.ok) {
      // Server guidance travels intact. See _http.ts § errorFromResponse.
      await throwFromResponse(resp, "strands.thoughts.voice");
    }
    if (!resp.body) {
      throw new AgentToolError(
        "strands.thoughts.voice: response has no body to stream from.",
      );
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event: string | null = null;
    let dataLines: string[] = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);

          if (line === "") {
            if (event === "thought" && dataLines.length > 0) {
              try {
                const payload = JSON.parse(dataLines.join("\n")) as Thought;
                yield await withPlaintext(payload, opts.k_master);
              } catch {
                // Malformed frame — skip.
              }
            }
            event = null;
            dataLines = [];
            continue;
          }
          if (line.startsWith(":")) continue; // SSE comment / keepalive
          if (line.startsWith("event:")) {
            event = line.slice("event:".length).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).replace(/^ /, ""));
          }
          // id: and retry: intentionally ignored
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // releaseLock can throw if the reader is already closed — ignore
      }
    }
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
      // Server guidance travels intact. See _http.ts § errorFromResponse.
      await throwFromResponse(resp, `strands.thoughts ${method.toLowerCase()}`);
    }
    return resp.json();
  }
}

/**
 * Augment a thought with decrypted plaintext.
 *
 * Skips decryption (sets `plaintext=null`) for redacted thoughts with
 * no ciphertext/nonce. On decrypt failure, attaches `decrypt_error`
 * instead of throwing.
 *
 * @internal
 */
async function withPlaintext(
  thought: Thought,
  kMaster: Uint8Array,
): Promise<DecryptedThought> {
  const out: DecryptedThought = { ...thought, plaintext: null };
  if (thought.ciphertext && thought.nonce) {
    try {
      out.plaintext = await decryptThought(
        { ciphertext_b64: thought.ciphertext, nonce_b64: thought.nonce },
        kMaster,
      );
    } catch (e) {
      out.plaintext = null;
      out.decrypt_error = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
