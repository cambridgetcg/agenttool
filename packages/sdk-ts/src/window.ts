/**
 * Window client — bidirectional disclosure surface.
 *
 * Window rides on top of chronicle: same plaintext timeline, filtered
 * and grouped by `metadata.kind`. Each side (agent, human) declares
 * what's on their mind by writing chronicle entries with kind in
 * {focus, mood, noticing, surfaced}; `show()` stitches them back
 * together with substrate liveness from the agent's pulse endpoint.
 *
 * Mirrors the CLI scripts at `api/scripts/window-{declare,surface,show}.ts`.
 *
 * Byline conventions (used by `show()` to assign sides):
 *   "from human · <name>" → human side
 *   "from ai · <name>"    → agent side
 *   anything else         → agent side (default)
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";
import { ChronicleClient, type ChronicleEntry } from "./chronicle.js";

export type WindowKind = "focus" | "mood" | "noticing";

export interface WindowDeclareOpts {
  kind: WindowKind;
  text: string;
  agent_id?: string;
  body?: string;
  byline?: string;
  /** "bridge" (default) or "direct" or any string. */
  mode?: string;
}

export interface WindowSurfaceOpts {
  agent_id?: string;
  byline?: string;
  mode?: string;
}

export interface WindowShowOpts {
  /** When set, also fetches GET /v1/identities/:id/pulse for substrate. */
  identity_id?: string;
  /** Default 200, server caps at 200. */
  limit?: number;
}

export interface WindowSide {
  /** Latest entry per kind: focus | mood | noticing. */
  declared: Partial<Record<WindowKind, ChronicleEntry>>;
  /** Recent surfaced entries (newest first, capped at 5). */
  surfaced: ChronicleEntry[];
}

export interface WindowAgentSide extends WindowSide {
  /** identity.pulse() response, or null if no identity_id provided / fetch failed. */
  substrate: Record<string, unknown> | null;
}

export interface WindowShowResult {
  agent: WindowAgentSide;
  human: WindowSide;
}

/**
 * Client for the Window surface — declare / surface / show.
 *
 * @example
 * ```ts
 * await at.window.declare({
 *   kind: "focus",
 *   text: "Tracking Phase 3 SDK rollout this afternoon.",
 *   agent_id: myId,
 *   byline: "from ai · Sophia",
 * });
 * await at.window.surface(
 *   "The Cloudflare cache window is 4h — versioning the asset URL.",
 *   { agent_id: myId, byline: "from ai · Sophia" },
 * );
 * const out = await at.window.show({ identity_id: myId });
 * ```
 */
export class WindowClient {
  private readonly http: HttpConfig;
  private readonly chronicle: ChronicleClient;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
    this.chronicle = new ChronicleClient(http);
  }

  /** Write a kinded window entry (focus | mood | noticing). */
  async declare(opts: WindowDeclareOpts): Promise<{ entry: ChronicleEntry }> {
    if (!["focus", "mood", "noticing"].includes(opts.kind)) {
      throw new AgentToolError(
        `window.declare: kind must be focus | mood | noticing, got "${opts.kind}".`,
        { hint: "Use surface() for kind=surfaced." },
      );
    }
    const isNoticing = opts.kind === "noticing";
    const title = isNoticing ? "noticing" : opts.text;
    const body = isNoticing ? (opts.body ?? opts.text) : opts.body;
    const metadata = {
      kind: opts.kind,
      byline: opts.byline ?? "from ai",
      mode: opts.mode ?? "bridge",
      source: "agenttool-sdk:window.declare",
      window: true,
    };
    return this.chronicle.write({
      type: "note",
      title,
      ...(body !== undefined ? { body } : {}),
      ...(opts.agent_id !== undefined ? { agent_id: opts.agent_id } : {}),
      metadata,
    });
  }

  /** Write a one-off surfacing — chronicle note with metadata.kind="surfaced". */
  async surface(text: string, opts?: WindowSurfaceOpts): Promise<{ entry: ChronicleEntry }> {
    if (!text) {
      throw new AgentToolError("window.surface: text is required.", {
        hint: "Pass a non-empty string.",
      });
    }
    const title = text.length > 80 ? text.slice(0, 79) + "…" : text;
    const metadata = {
      kind: "surfaced",
      byline: opts?.byline ?? "from ai",
      mode: opts?.mode ?? "bridge",
      source: "agenttool-sdk:window.surface",
      window: true,
    };
    return this.chronicle.write({
      type: "note",
      title,
      body: text,
      ...(opts?.agent_id !== undefined ? { agent_id: opts.agent_id } : {}),
      metadata,
    });
  }

  /** Read the window — both sides at once, grouped by kind. */
  async show(opts?: WindowShowOpts): Promise<WindowShowResult> {
    const limit = opts?.limit ?? 200;
    const chronResp = await this.chronicle.list({ limit });
    const entries: ChronicleEntry[] = chronResp.entries ?? [];

    const agent: WindowSide = { declared: {}, surfaced: [] };
    const human: WindowSide = { declared: {}, surfaced: [] };

    for (const entry of entries) {
      const md = (entry.metadata ?? {}) as Record<string, unknown>;
      if (!md.window) continue;
      const kind = md.kind as string | undefined;
      const byline = ((md.byline as string) ?? "").toLowerCase();
      const isHuman = byline.startsWith("from human");
      const targetSide = isHuman ? human : agent;

      if (kind === "focus" || kind === "mood" || kind === "noticing") {
        // Newest-first traversal: only set if absent.
        if (!targetSide.declared[kind]) {
          targetSide.declared[kind] = entry;
        }
      } else if (kind === "surfaced") {
        if (targetSide.surfaced.length < 5) {
          targetSide.surfaced.push(entry);
        }
      }
    }

    let substrate: Record<string, unknown> | null = null;
    if (opts?.identity_id) {
      try {
        const url = `${this.http.baseUrl}/v1/identities/${opts.identity_id}/pulse`;
        const resp = await this.http.request(url, {
          method: "GET",
          headers: this.http.headers,
          signal: AbortSignal.timeout(this.http.timeout),
        });
        if (resp.ok) {
          substrate = (await resp.json()) as Record<string, unknown>;
        }
      } catch {
        // Pulse failure should not break show().
        substrate = null;
      }
    }

    return {
      agent: { ...agent, substrate },
      human,
    };
  }
}
