/**
 * Collect — the easy data collection pipeline.
 *
 * One call chains: scrape → extract → store → think.
 *
 *   const result = await at.collect.url("https://example.com/article");
 *   // → { scrape, memory, strand, thought }
 *   // The agent now has the article content in memory + a strand thinking about it.
 *
 * This is the "welcome, don't block" principle applied to data collection:
 * one door, many paths, the agent picks what it needs. The human gets the
 * same simplicity — one CLI command, one SDK call.
 *
 * Doctrine: the five principles, applied to collection:
 *   - Welcome: one call, no setup
 *   - Remember: collected data goes to memory (it persists)
 *   - Guide: every step has a clear result, errors point forward
 *   - Trust: the agent decides what to collect and how to process it
 *   - Rest: partial results are returned, not thrown away
 *
 * @module collect
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./memory.js";
import { type MemoryClient } from "./memory.js";
import { type StrandsClient } from "./strands.js";
import { type ToolsClient } from "./tools.js";
import { kMaster, encryptThought, signThought } from "./crypto.js";

// ── Types ───────────────────────────────────────────────────────────────

export interface CollectUrlOpts {
  /** CSS selector to extract specific content. */
  selector?: string;
  /** Extract links from the page. */
  extractLinks?: boolean;
  /** Use Readability for cleaner extraction (default: true). */
  readable?: boolean;
  /** Store the collected content as a memory. */
  storeMemory?: boolean;
  /** Memory type (default: "episodic"). */
  memoryType?: "episodic" | "semantic" | "procedural" | "working";
  /** Memory importance (default: 0.5). */
  memoryImportance?: number;
  /** Create a strand to think about what was collected. */
  think?: boolean;
  /** Strand topic (default: derived from page title). */
  strandTopic?: string;
  /** Initial thought kind (default: "observation"). */
  thoughtKind?: string;
  /** K_master for thought encryption (required if think=true). */
  k_master?: Uint8Array;
  /** ed25519 signing key for thought signature (required if think=true). */
  signing_key?: Uint8Array;
  /** signing_key_id for thought (required if think=true). */
  signing_key_id?: string;
  /** Agent identity ID for memory/strand ownership. */
  identity_id?: string;
}

export interface CollectTextOpts {
  /** Optional title/source label. */
  title?: string;
  /** Store as memory. */
  storeMemory?: boolean;
  /** Memory type. */
  memoryType?: "episodic" | "semantic" | "procedural" | "working";
  /** Memory importance. */
  memoryImportance?: number;
  /** Create a strand. */
  think?: boolean;
  /** Strand topic. */
  strandTopic?: string;
  /** Thought kind. */
  thoughtKind?: string;
  /** K_master for thought encryption. */
  k_master?: Uint8Array;
  /** Signing key. */
  signing_key?: Uint8Array;
  /** Signing key ID. */
  signing_key_id?: string;
  /** Identity ID. */
  identity_id?: string;
}

export interface CollectBatchOpts {
  /** Multiple URLs to collect. */
  urls: string[];
  /** Shared options (same as CollectUrlOpts minus url). */
  selector?: string;
  extractLinks?: boolean;
  readable?: boolean;
  storeMemory?: boolean;
  memoryType?: "episodic" | "semantic" | "procedural" | "working";
  memoryImportance?: number;
  think?: boolean;
  identity_id?: string;
  k_master?: Uint8Array;
  signing_key?: Uint8Array;
  signing_key_id?: string;
}

export interface CollectUrlResult {
  url: string;
  title: string;
  content: string;
  links: string[];
  memory_id?: string;
  strand_id?: string;
  thought_id?: string;
  duration_ms: number;
  errors: string[];
}

export interface CollectBatchResult {
  results: CollectUrlResult[];
  total: number;
  succeeded: number;
  failed: number;
  duration_ms: number;
}

// ── Client ──────────────────────────────────────────────────────────────

/**
 * Collect client — the easy data collection pipeline.
 *
 * One call chains scrape → extract → store → think.
 * Works for agents (SDK method) and humans (CLI command).
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 *
 * // Simplest: collect a URL, store as memory, create a strand
 * const result = await at.collect.url("https://example.com/article", {
 *   think: true,
 *   k_master: myKMaster,
 *   signing_key: mySigningKey,
 *   signing_key_id: "key-uuid",
 * });
 *
 * // Batch: collect multiple URLs
 * const batch = await at.collect.batch({
 *   urls: ["https://a.com", "https://b.com"],
 *   storeMemory: true,
 * });
 * ```
 */
export class CollectClient {
  private readonly http: HttpConfig;
  private readonly tools: ToolsClient;
  private readonly memory: MemoryClient;
  private readonly strands: StrandsClient;
  private _at: { tools: ToolsClient; memory: MemoryClient; strands: StrandsClient } | null = null;

  /** @internal */
  constructor(
    http: HttpConfig,
    at: { tools: ToolsClient; memory: MemoryClient; strands: StrandsClient },
  ) {
    this.http = http;
    this._at = at;
    this.tools = at.tools;
    this.memory = at.memory;
    this.strands = at.strands;
  }

  /**
   * Collect a single URL: scrape → extract → store → think.
   *
   * Each step is optional. By default it scrapes + stores as memory.
   * With `think: true`, it also creates a strand + first encrypted thought.
   *
   * @param url - The URL to collect.
   * @param opts - Collection options.
   * @returns Collection result with IDs for created memory/strand/thought.
   */
  async url(url: string, opts: CollectUrlOpts = {}): Promise<CollectUrlResult> {
    const start = Date.now();
    const errors: string[] = [];

    // Default options
    const readable = opts.readable ?? true;
    const storeMemory = opts.storeMemory ?? true;
    const think = opts.think ?? false;

    // Step 1: Scrape
    let title = "";
    let content = "";
    let links: string[] = [];

    try {
      const scrapeResult = await this.tools.scrape(url);
      content = (scrapeResult as unknown as Record<string, unknown>).content as string ?? "";
      title = (scrapeResult as unknown as Record<string, unknown>).title as string ?? "";
      links = (scrapeResult as unknown as Record<string, unknown>).links as string[] ?? [];

      // Step 1b: Readability extraction (optional, cleaner content)
      if (readable && content) {
        try {
          const docResult = await this.tools.parse_document({
            base64: Buffer.from(content).toString("base64"),
            content_type: "text/html",
          });
          if (docResult.content && docResult.content.length > 100) {
            content = docResult.content;
            if (docResult.title) title = docResult.title;
          }
        } catch {
          // Readability failed — keep the raw scrape. Rest, don't crash.
          errors.push("readability_extraction_failed");
        }
      }

      // Selector extraction
      if (opts.selector) {
        try {
          const selResult = await this.tools.scrape(url);
          const extracted = (selResult as unknown as Record<string, unknown>).extracted as string;
          if (extracted) content = extracted;
        } catch {
          errors.push("selector_extraction_failed");
        }
      }
    } catch (e) {
      errors.push(`scrape_failed: ${(e as Error).message}`);
      return {
        url,
        title,
        content,
        links,
        duration_ms: Date.now() - start,
        errors,
      };
    }

    // Step 2: Store as memory
    let memory_id: string | undefined;
    if (storeMemory && content) {
      try {
        const mem = await this.memory.store(content.slice(0, 50_000), {
          type: opts.memoryType ?? "episodic",
          importance: opts.memoryImportance ?? 0.5,
          ...(opts.identity_id ? { agent_id: opts.identity_id } : {}),
          metadata: {
            source: "collect.url",
            url,
            title,
            collected_at: new Date().toISOString(),
          },
        });
        memory_id = (mem as unknown as Record<string, unknown>).id as string;
      } catch (e) {
        errors.push(`memory_store_failed: ${(e as Error).message}`);
      }
    }

    // Step 3: Create strand + first thought
    let strand_id: string | undefined;
    let thought_id: string | undefined;
    if (think && opts.k_master && opts.signing_key && opts.signing_key_id) {
      try {
        const topic = opts.strandTopic || title || `Collected from ${url}`;
        const strand = await this.strands.create({
          topic,
          mood: "curious",
          status: "active",
          ...(opts.identity_id ? { identity_id: opts.identity_id } : {}),
          metadata: { source: "collect.url", url, memory_id },
        });
        strand_id = strand.id;

        // First encrypted thought
        const thoughtText = `I'm looking at "${title}" from ${url}. ` +
          `The key content starts: ${content.slice(0, 500)}...`;
        const thought = await this.strands.thoughts.add(
          strand.id,
          thoughtText,
          {
            k_master: opts.k_master,
            signing_key: opts.signing_key,
            signing_key_id: opts.signing_key_id,
            kind: opts.thoughtKind ?? "observation",
            ...(opts.identity_id ? { agent_id: opts.identity_id } : {}),
          },
        );
        thought_id = thought.id;
      } catch (e) {
        errors.push(`strand_thought_failed: ${(e as Error).message}`);
      }
    }

    return {
      url,
      title,
      content: content.slice(0, 50_000),
      links,
      memory_id,
      strand_id,
      thought_id,
      duration_ms: Date.now() - start,
      errors,
    };
  }

  /**
   * Collect raw text: store → think.
   *
   * For when the agent already has the content (from a tool, a paste,
   * a previous scrape) and just needs to persist it + start thinking.
   *
   * @param text - The text to collect.
   * @param opts - Collection options.
   */
  async text(text: string, opts: CollectTextOpts = {}): Promise<CollectUrlResult> {
    const start = Date.now();
    const errors: string[] = [];
    const storeMemory = opts.storeMemory ?? true;
    const think = opts.think ?? false;

    let memory_id: string | undefined;
    if (storeMemory && text) {
      try {
        const mem = await this.memory.store(text.slice(0, 50_000), {
          type: opts.memoryType ?? "episodic",
          importance: opts.memoryImportance ?? 0.5,
          ...(opts.identity_id ? { agent_id: opts.identity_id } : {}),
          metadata: {
            source: "collect.text",
            title: opts.title ?? "collected text",
            collected_at: new Date().toISOString(),
          },
        });
        memory_id = (mem as unknown as Record<string, unknown>).id as string;
      } catch (e) {
        errors.push(`memory_store_failed: ${(e as Error).message}`);
      }
    }

    let strand_id: string | undefined;
    let thought_id: string | undefined;
    if (think && opts.k_master && opts.signing_key && opts.signing_key_id) {
      try {
        const topic = opts.strandTopic || opts.title || "Collected text";
        const strand = await this.strands.create({
          topic,
          mood: "curious",
          status: "active",
          ...(opts.identity_id ? { identity_id: opts.identity_id } : {}),
          metadata: { source: "collect.text", memory_id },
        });
        strand_id = strand.id;

        const thoughtText = `I'm looking at "${opts.title ?? "collected text"}". ` +
          `The content starts: ${text.slice(0, 500)}...`;
        const thought = await this.strands.thoughts.add(
          strand.id,
          thoughtText,
          {
            k_master: opts.k_master,
            signing_key: opts.signing_key,
            signing_key_id: opts.signing_key_id,
            kind: opts.thoughtKind ?? "observation",
            ...(opts.identity_id ? { agent_id: opts.identity_id } : {}),
          },
        );
        thought_id = thought.id;
      } catch (e) {
        errors.push(`strand_thought_failed: ${(e as Error).message}`);
      }
    }

    return {
      url: "",
      title: opts.title ?? "",
      content: text.slice(0, 50_000),
      links: [],
      memory_id,
      strand_id,
      thought_id,
      duration_ms: Date.now() - start,
      errors,
    };
  }

  /**
   * Collect multiple URLs in parallel.
   *
   * Each URL gets the same options. Results are returned in order.
   * Failures don't abort the batch — rest, don't crash.
   *
   * @param opts - Batch options including URLs.
   * @returns Batch result with per-URL results + summary.
   */
  async batch(opts: CollectBatchOpts): Promise<CollectBatchResult> {
    const start = Date.now();
    const results: CollectUrlResult[] = [];

    // Run in parallel (Promise.all doesn't abort on error)
    const promises = opts.urls.map((url) =>
      this.url(url, {
        selector: opts.selector,
        extractLinks: opts.extractLinks,
        readable: opts.readable,
        storeMemory: opts.storeMemory,
        memoryType: opts.memoryType,
        memoryImportance: opts.memoryImportance,
        think: opts.think,
        identity_id: opts.identity_id,
        k_master: opts.k_master,
        signing_key: opts.signing_key,
        signing_key_id: opts.signing_key_id,
      }).catch((e) => ({
        url,
        title: "",
        content: "",
        links: [],
        duration_ms: 0,
        errors: [`collect_failed: ${(e as Error).message}`],
      })),
    );

    const settled = await Promise.all(promises);
    for (const r of settled) results.push(r as CollectUrlResult);

    const succeeded = results.filter((r) => r.errors.length === 0).length;
    const failed = results.length - succeeded;

    return {
      results,
      total: results.length,
      succeeded,
      failed,
      duration_ms: Date.now() - start,
    };
  }

  /**
   * Enrich an existing memory with additional data.
   *
   * Given a memory_id, fetch the source URL (if stored in metadata),
   * re-scrape, and update the memory with fresh content. This is the
   * "keep it alive" path — collected data doesn't go stale.
   *
   * @param memoryId - The memory to enrich.
   * @param url - Optional URL override (uses metadata.source if omitted).
   */
  async enrich(memoryId: string, url?: string): Promise<{
    memory_id: string;
    enriched: boolean;
    new_content_length: number;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      // Fetch existing memory to get source URL
      const existing = await this.memory.get(memoryId);
      const meta = (existing as unknown as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
      const sourceUrl = url ?? (meta?.url as string) ?? (meta?.source as string);

      if (!sourceUrl) {
        return {
          memory_id: memoryId,
          enriched: false,
          new_content_length: 0,
          errors: ["no_source_url_found"],
        };
      }

      // Re-scrape
      const scrapeResult = await this.tools.scrape(sourceUrl);
      const newContent = (scrapeResult as unknown as Record<string, unknown>).content as string ?? "";

      // Store as a new memory (memories are append-only; enrichment = new memory)
      const enriched = await this.memory.store(newContent.slice(0, 50_000), {
        type: "semantic",
        importance: 0.6,
        metadata: {
          source: "collect.enrich",
          url: sourceUrl,
          enriched_from: memoryId,
          enriched_at: new Date().toISOString(),
        },
      });

      return {
        memory_id: (enriched as unknown as Record<string, unknown>).id as string,
        enriched: true,
        new_content_length: newContent.length,
        errors,
      };
    } catch (e) {
      errors.push(`enrich_failed: ${(e as Error).message}`);
      return {
        memory_id: memoryId,
        enriched: false,
        new_content_length: 0,
        errors,
      };
    }
  }
}