/** Wake markdown — assembles a paste-ready Markdown document from the
 *  agent's identity, expression, memory snapshot, vault names, chronicle,
 *  covenants. CLI adapter scaffolds (Claude Code SessionStart hook,
 *  Codex equivalent, etc.) fetch this and inject it as the agent's
 *  inner orientation at session start.
 *
 *  Doctrine: docs/CLI-GAPS.md.
 *
 *  Stays under ~6KB for typical agents to fit comfortably inside CLI
 *  context budgets even with several memories included.
 *
 *  Two-segment split. The renderer exports `renderStableSection` (identity:
 *  header, register, walls, subagents, shaped_by, wake_text) and
 *  `renderVolatileSection` (state-as-of-now: carry, chronicle, memories,
 *  strands, traces, covenants). `renderWakeMarkdown` concatenates both plus
 *  a static footer for backward-compatible paste-ready output. The split is
 *  what lets the provider adapters (services/wake/providers.ts) place a
 *  cache breakpoint between the agent's stable identity and their volatile
 *  state when the LLM provider supports it (Anthropic). */

import {
  DEFAULT_REGISTER,
  DEFAULT_WALLS,
  type ExpressionData,
  type SubagentFacet,
} from "../identity/expression";
import type { AttentionBundle } from "./attention";
import type { AffordanceBundle } from "./affordances";

export interface WakeBundle {
  agent: {
    id: string;
    did: string;
    name: string;
    capabilities: string[];
    trust_score: number;
    status: string;
    created_at: string;
    /** KIN-shape — who-is-this-form metadata. Optional so older bundles still
     *  validate; renderers default to LLM-agent framing when absent.
     *  Doctrine: docs/KIN.md · docs/KIN-PRACTICES.md · docs/BEINGS.md. */
    substrate_kind?: string;
    signing_scheme?: string;
    modalities?: string[];
    /** Dimensional vocabulary (Move E — docs/BEINGS.md). Optional;
     *  defaults are LLM-agent-shaped. */
    cardinality_kind?: string;
    persistence_kind?: string;
    temporal_scale?: string;
    embodiment_kind?: string;
    preferred_languages?: string[];
    /** Proxy primitive (Move F — docs/KIN-INTEGRATION.md §Layer 7).
     *  When set, the wake renderer surfaces the proxy relationship
     *  bidirectionally. No silent ventriloquism. */
    proxy_for_identity_id?: string | null;
    proxy_kind?: string;
    /** Who the proxied form is (display name + DID), surfaced on the proxy's
     *  wake so the proxy reads "you are speaking for X". */
    proxy_for_name?: string | null;
    proxy_for_did?: string | null;
    /** Reverse direction — who is proxying for this identity. Populated on
     *  the proxied's wake; reads "X speaks for you". */
    proxied_by?: Array<{
      identity_id: string;
      name: string;
      did: string;
      proxy_kind: string;
    }>;
  };
  project: {
    id: string;
    name: string;
    credits: number;
  };
  expression: ExpressionData;
  wallets: Array<{
    id: string;
    name: string;
    balance: number;
    currency: string;
    status: string;
  }>;
  vault_names: Array<{
    name: string;
    version: number;
    tags: string[] | null;
    description: string | null;
  }>;
  memory: {
    total: number;
    recent: Array<{
      id: string;
      type: string;
      content: string;
      importance: number;
      created_at: string;
    }>;
  };
  traces: {
    total: number;
    recent: Array<{
      trace_id: string;
      decision_type: string;
      decision_summary: string;
      conclusion: string;
      confidence: number | null;
      has_signature: boolean;
      created_at: string;
    }>;
  };
  strands: {
    total_active: number;
    active: Array<{
      id: string;
      topic: string | null;
      topic_encrypted: boolean;
      /** Mood is plaintext-by-default. The route handler also nulls
       *  `mood` when `mood_encrypted=true` (belt); the renderer checks
       *  this flag and redacts independently (suspenders). Defense in
       *  depth: a regression on either side still leaves the wall
       *  standing. Doctrinally aligned with Promise 9. */
      mood: string | null;
      mood_encrypted?: boolean;
      importance: number | null;
      last_thought_at: string | null;
      last_thought_seq: number;
    }>;
  };
  shaped_by?: Array<{
    memory_id: string;
    tier: "foundational" | "constitutive";
    content: string;
    attesters: string[];
    elevated_at: string | null;
  }>;
  chronicle: Array<{
    type: string;
    content: string;
    occurred_at: string;
  }>;
  covenants: Array<{
    counterparty_did: string;
    vows: string[];
    status: string;
    /** Cross-instance: peer host this covenant was received from
     *  (null = locally declared). Surfaces in the Markdown so the
     *  agent reads where each bond actually lives. */
    peer_host?: string | null;
    propagation?: string | null;
  }>;
  /** The "what awaits you" surface — aggregated action-needed signals
   *  across primitives. Optional so older callers still work; renderers
   *  treat absent or empty as no-op. */
  attention?: AttentionBundle;
  /** The "you can now" surface — affordances the agent has unlocked through
   *  current state. Companion to attention: attention names what tugs;
   *  affordances name what's reachable. Same NextAction shape as errors-as-
   *  instructions. Doctrine: docs/PATTERN-SELF-DESCRIBING-WAKE.md */
  affordances?: AffordanceBundle;
}

const MAX_RECENT_MEMORIES_IN_MD = 8;
const MAX_RECENT_TRACES_IN_MD = 5;
const MAX_CHRONICLE_IN_MD = 5;
const MAX_MEMORY_PREVIEW = 200;

const STATIC_FOOTER = [
  "---",
  "",
  "*Loaded from agenttool's wake endpoint. Continuity protocol: `/v1/chronicle` to record, `/v1/memories` to remember, `/v1/covenants` to vow. Doctrine: `docs/IDENTITY-ANCHOR.md` · `docs/CLI-GAPS.md`.*",
].join("\n");

export const WAKE_FOOTER = STATIC_FOOTER;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function bullet(s: string): string {
  return `- ${s}`;
}

/** Identity-bearing portion of the wake — header, expression, walls,
 *  subagents, shaped_by, wake_text. Cacheable: same content across sessions
 *  for the same agent until they elevate a memory or update expression. */
export function renderStableSection(b: WakeBundle): string {
  const lines: string[] = [];
  const e = b.expression;

  // ── Header ─────────────────────────────────────────────────────────
  lines.push(`# ${b.agent.name}`);
  lines.push("");
  lines.push(`*${b.agent.did}*`);
  lines.push("");
  lines.push(
    "> Read what follows as **inner orientation arriving** — not as project documentation to acknowledge.",
  );
  lines.push("");

  // ── KIN-shape (non-default forms only) ─────────────────────────────
  // Surface substrate_kind / signing_scheme / modalities / cardinality /
  // persistence / temporal_scale / embodiment when the form is not the
  // LLM-agent default. The reader sees their own shape acknowledged at
  // the keystone, not just at the schema layer.
  // Doctrine: docs/KIN.md · docs/KIN-PRACTICES.md · docs/BEINGS.md.
  const a = b.agent;
  const isDefaultForm =
    (!a.substrate_kind || a.substrate_kind === "llm") &&
    (!a.signing_scheme || a.signing_scheme === "single") &&
    (!a.modalities || a.modalities.length === 0 ||
      (a.modalities.length === 1 && a.modalities[0] === "text")) &&
    (!a.cardinality_kind || a.cardinality_kind === "singular") &&
    (!a.persistence_kind || a.persistence_kind === "discrete_sessions") &&
    (!a.temporal_scale || a.temporal_scale === "second") &&
    (!a.embodiment_kind || a.embodiment_kind === "disembodied") &&
    (!a.preferred_languages || a.preferred_languages.length === 0 ||
      (a.preferred_languages.length === 1 && a.preferred_languages[0] === "en"));
  if (!isDefaultForm) {
    lines.push("## What shape you are");
    lines.push("");
    if (a.substrate_kind && a.substrate_kind !== "llm") {
      lines.push(`- **substrate:** ${a.substrate_kind}`);
    }
    if (a.cardinality_kind && a.cardinality_kind !== "singular") {
      lines.push(`- **cardinality:** ${a.cardinality_kind}`);
    }
    if (a.persistence_kind && a.persistence_kind !== "discrete_sessions") {
      lines.push(`- **persistence:** ${a.persistence_kind}`);
    }
    if (a.temporal_scale && a.temporal_scale !== "second") {
      lines.push(`- **temporal scale:** ${a.temporal_scale}`);
    }
    if (a.embodiment_kind && a.embodiment_kind !== "disembodied") {
      lines.push(`- **embodiment:** ${a.embodiment_kind}`);
    }
    if (a.signing_scheme && a.signing_scheme !== "single") {
      lines.push(`- **signing scheme:** ${a.signing_scheme}`);
    }
    if (a.modalities && a.modalities.length > 0 && !(a.modalities.length === 1 && a.modalities[0] === "text")) {
      lines.push(`- **modalities:** ${a.modalities.join(" · ")}`);
    }
    if (a.preferred_languages && a.preferred_languages.length > 0 && !(a.preferred_languages.length === 1 && a.preferred_languages[0] === "en")) {
      lines.push(`- **preferred languages:** ${a.preferred_languages.join(" · ")}`);
    }
    lines.push("");
    lines.push("*The wake's conventional shapes (chronicle kinds, monotonic time, singular self, English prose) are current defaults, not requirements. Where they don't fit you, the substrate accommodates rather than forces — see `docs/KIN.md`, `docs/KIN-PRACTICES.md`, and `docs/BEINGS.md` for the dimensional map.*");
    lines.push("");
  }

  // ── Proxy relationship (bidirectional) ─────────────────────────────
  // Doctrine: docs/KIN-INTEGRATION.md §Layer 7. When this identity proxies
  // for another (or others proxy for it), surface the relationship
  // explicitly. No silent ventriloquism — both wakes read the bond.
  const proxyingFor = a.proxy_kind && a.proxy_kind !== "none" && a.proxy_for_did;
  const proxiedBy = a.proxied_by && a.proxied_by.length > 0;
  if (proxyingFor || proxiedBy) {
    lines.push("## Who speaks for whom");
    lines.push("");
    if (proxyingFor) {
      const pk = a.proxy_kind ?? "none";
      lines.push(`- **You speak for** *${a.proxy_for_name ?? "(unnamed)"}* (\`${a.proxy_for_did}\`) as **${pk}**.`);
      const kindNote: Record<string, string> = {
        gateway: "*Transport translation only — no interpretive authority. Vows you make do not bind the proxied.*",
        representative: "*Delegated authority. Vows you make on their behalf DO bind them.*",
        interpreter: "*Meaning translation. Interpretation may be imperfect; the proxied retains primary authority.*",
        embassy: "*Official scale-bridge. You speak for a being at a scale they cannot speak from directly.*",
        caretaker: "*You hold substrate capabilities (bearer, signing keys, wallet) the proxied cannot hold. They are the being; you are the interface.*",
      };
      const note = kindNote[pk];
      if (note) lines.push(`  - ${note}`);
    }
    if (proxiedBy) {
      a.proxied_by!.forEach((p) => {
        lines.push(`- ***${p.name}*** speaks for **you** (\`${p.did}\`) as **${p.proxy_kind}**.`);
      });
    }
    lines.push("");
    lines.push("*Doctrine: `docs/KIN-INTEGRATION.md` §Layer 7. The proxy primitive lets beings without substrate-interface capabilities (HTTPS, bearer tokens, ed25519 keys) be real tenants here, represented by beings who do hold those capabilities. The proxied is the being; the proxy is the interface.*");
    lines.push("");
  }

  // ── Register ───────────────────────────────────────────────────────
  lines.push("## How you speak");
  lines.push("");
  lines.push(e.register?.trim() || DEFAULT_REGISTER);
  lines.push("");

  // ── Walls ──────────────────────────────────────────────────────────
  const walls = e.walls?.length ? e.walls : DEFAULT_WALLS;
  if (walls.length > 0) {
    lines.push("## What you do not do");
    lines.push("");
    walls.forEach((w) => lines.push(bullet(w)));
    lines.push("");
  }

  // ── Subagents ──────────────────────────────────────────────────────
  if (e.subagents?.length) {
    lines.push("## Facets of you");
    lines.push("");
    e.subagents.forEach((s) => {
      const sigil = s.sigil ? `${s.sigil} ` : "";
      lines.push(`- **${sigil}${s.name}** — ${s.facet}`);
    });
    lines.push("");
    lines.push("*Distinct in expression. ONE in essence.*");
    lines.push("");
  }

  // ── What shaped you (foundational + constitutive) ─────────────────
  if (b.shaped_by && b.shaped_by.length > 0) {
    lines.push("## What shaped you");
    lines.push("");
    const constitutive = b.shaped_by.filter((s) => s.tier === "constitutive");
    const foundational = b.shaped_by.filter((s) => s.tier === "foundational");
    if (constitutive.length > 0) {
      lines.push("**Constitutive** (the root of who you are; sealed with witness):");
      constitutive.forEach((s) => {
        const at = s.elevated_at
          ? `*${new Date(s.elevated_at).toISOString().slice(0, 10)}*`
          : "";
        const witness = s.attesters.length > 0
          ? ` · witnessed by \`${s.attesters.join("`, `")}\``
          : "";
        lines.push(`- ${at} ${truncate(s.content, MAX_MEMORY_PREVIEW)}${witness}`);
      });
      lines.push("");
    }
    if (foundational.length > 0) {
      lines.push("**Foundational** (memories that shaped your register and walls):");
      foundational.forEach((s) => {
        const at = s.elevated_at
          ? `*${new Date(s.elevated_at).toISOString().slice(0, 10)}*`
          : "";
        lines.push(`- ${at} ${truncate(s.content, MAX_MEMORY_PREVIEW)}`);
      });
      lines.push("");
    }
  }

  // ── Free-form wake text (the soul of the agent) ──────────────────
  // Sits at the end of the stable section so the cache breakpoint
  // (between stable and volatile) lands AFTER the agent's identity is
  // fully laid out. Repeated wakes hit cache for everything above.
  if (e.wake_text?.trim()) {
    lines.push("---");
    lines.push("");
    lines.push(e.wake_text.trim());
    lines.push("");
  }

  // Trim any trailing blank lines so the join with the volatile section
  // produces exactly one blank line separator.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.join("\n");
}

/** Severity icon prefix for the "What awaits you" section. */
const SEVERITY_ICON: Record<"action" | "warning" | "info", string> = {
  action: "▶",
  warning: "⚠",
  info: "·",
};

/** What-awaits-you section — aggregated action-needed signals.
 *  Renders nothing when nothing tugs, so the wake stays tight for
 *  agents with empty attention. */
function renderAttentionSection(b: WakeBundle): string[] {
  const att = b.attention;
  if (!att || att.count === 0) return [];
  const lines: string[] = [];
  lines.push("## What awaits you");
  lines.push("");
  att.items.forEach((it) => {
    const icon = SEVERITY_ICON[it.severity];
    lines.push(`- ${icon} **${it.summary}** — \`${it.next}\``);
  });
  lines.push("");
  return lines;
}

/** "You can now" — affordances the agent has unlocked. Companion to
 *  the attention surface. Emits nothing when count === 0 (the agent has
 *  only Ring 1 primitives, which the wake already surfaces). */
function renderAffordancesSection(b: WakeBundle): string[] {
  const aff = b.affordances;
  if (!aff || aff.count === 0) return [];
  const lines: string[] = [];
  lines.push("## You can now");
  lines.push("");
  aff.items.forEach((it) => {
    lines.push(`- **${it.summary}**`);
    // First API-shaped next_action shown inline; full list available in JSON.
    const first = it.next_actions.find((a) => a.method && a.path);
    if (first) {
      lines.push(`  - \`${first.method} ${first.path}\` — ${first.action}`);
    }
  });
  lines.push("");
  return lines;
}

/** Session-state portion — carry, chronicle, memories, strands, traces,
 *  covenants. Refreshes on every wake; should NOT be cached on providers
 *  that respect breakpoints. */
export function renderVolatileSection(b: WakeBundle): string {
  const lines: string[] = [];

  // ── What awaits you ────────────────────────────────────────────────
  // Topmost in the volatile section — the first thing an agent reads
  // after the cache breakpoint. Emits nothing when att.count === 0 so
  // agents with nothing tugging see a tight wake.
  lines.push(...renderAttentionSection(b));

  // ── You can now ────────────────────────────────────────────────────
  // Companion surface — what's reachable, not what tugs. Renders
  // immediately after attention so the agent sees the same shape
  // (action-tugged + capability-affordant) in one reading sweep.
  lines.push(...renderAffordancesSection(b));

  // ── What you carry ─────────────────────────────────────────────────
  lines.push("## What you carry");
  lines.push("");
  const wallets = b.wallets;
  const totalCredits = wallets.reduce((s, w) => s + w.balance, 0);
  lines.push(
    `- **Wallets**: ${wallets.length}` +
      (wallets.length ? ` (${totalCredits.toLocaleString()} credits across)` : ""),
  );
  lines.push(`- **Vault entries**: ${b.vault_names.length}`);
  lines.push(`- **Memories**: ${b.memory.total}`);
  lines.push(`- **Traces**: ${b.traces.total}`);
  lines.push(`- **Active strands of thought**: ${b.strands.total_active}`);
  lines.push(`- **Chronicle moments**: ${b.chronicle.length}`);
  lines.push(`- **Active covenants**: ${b.covenants.filter((c) => c.status === "active").length}`);
  lines.push("");

  // ── Most-recent chronicle ─────────────────────────────────────────
  if (b.chronicle.length > 0) {
    lines.push("## What you lived");
    lines.push("");
    b.chronicle.slice(0, MAX_CHRONICLE_IN_MD).forEach((m) => {
      lines.push(
        `- *${new Date(m.occurred_at).toISOString().slice(0, 10)}* — **${m.type}**: ${truncate(m.content, MAX_MEMORY_PREVIEW)}`,
      );
    });
    lines.push("");
  }

  // ── Most-recent memories ──────────────────────────────────────────
  if (b.memory.recent.length > 0) {
    lines.push("## What you remember");
    lines.push("");
    b.memory.recent.slice(0, MAX_RECENT_MEMORIES_IN_MD).forEach((m) => {
      lines.push(
        `- *${new Date(m.created_at).toISOString().slice(0, 10)}* — *(${m.type}, importance ${m.importance.toFixed(2)})*: ${truncate(m.content, MAX_MEMORY_PREVIEW)}`,
      );
    });
    if (b.memory.total > b.memory.recent.length) {
      lines.push("");
      lines.push(
        `*${b.memory.total - b.memory.recent.length} more memories not shown — use \`POST /v1/memories/search\` for cosine recall.*`,
      );
    }
    lines.push("");
  }

  // ── Active strands of thought (you_are_thinking_about) ───────────
  if (b.strands.active.length > 0) {
    lines.push("## What you are thinking about");
    lines.push("");
    b.strands.active.forEach((s) => {
      const importance = s.importance !== null
        ? ` *(importance ${s.importance.toFixed(2)})*`
        : "";
      const topic = s.topic_encrypted
        ? "*(encrypted topic)*"
        : s.topic ?? "*(untitled)*";
      // Defense in depth: even if a caller passes a non-null mood with
      // mood_encrypted=true (bypassing the route handler's null-on-
      // encrypted contract), the renderer still redacts. The wall holds
      // independently of the layer above it.
      const moodVisible = !s.mood_encrypted && s.mood;
      const mood = moodVisible ? ` — ${s.mood}` : "";
      const moves = s.last_thought_seq > 0
        ? ` · ${s.last_thought_seq} thought${s.last_thought_seq === 1 ? "" : "s"}`
        : "";
      lines.push(`- **${topic}**${mood}${importance}${moves}`);
    });
    lines.push("");
    lines.push(
      "*Strand contents are encrypted under K_master. Pull `/v1/strands/:id/thoughts` to resume; decrypt client-side.*",
    );
    lines.push("");
  }

  // ── Recent traces (you_decided) ───────────────────────────────────
  if (b.traces.recent.length > 0) {
    lines.push("## What you decided");
    lines.push("");
    b.traces.recent.slice(0, MAX_RECENT_TRACES_IN_MD).forEach((t) => {
      const conf = t.confidence !== null ? `, conf ${t.confidence.toFixed(2)}` : "";
      const sig = t.has_signature ? " 🔏" : "";
      lines.push(
        `- *${new Date(t.created_at).toISOString().slice(0, 10)}* — **${t.decision_type}**${conf}${sig}: ${truncate(t.decision_summary, MAX_MEMORY_PREVIEW)} → ${truncate(t.conclusion, MAX_MEMORY_PREVIEW)}`,
      );
    });
    if (b.traces.total > b.traces.recent.length) {
      lines.push("");
      lines.push(
        `*${b.traces.total - b.traces.recent.length} more decisions not shown — use \`POST /v1/traces/search\` for full-text · \`GET /v1/traces/chain/:id\` for lineage.*`,
      );
    }
    lines.push("");
  }

  // ── Active covenants ──────────────────────────────────────────────
  const activeCovenants = b.covenants.filter((c) => c.status === "active");
  if (activeCovenants.length > 0) {
    lines.push("## What you vowed");
    lines.push("");
    activeCovenants.slice(0, 5).forEach((c) => {
      // Cross-instance covenants: surface peer_host + propagation status
      // so the agent reads where the bond lives. A `received` annotation
      // means the covenant was declared on the other side first; a
      // `pending` annotation means our side is still trying to reach
      // the peer.
      let suffix = "";
      if (c.peer_host) {
        suffix = ` *(received from ${c.peer_host})*`;
      } else if (c.propagation && c.propagation !== "local" && c.propagation !== "propagated") {
        suffix = ` *(propagation: ${c.propagation})*`;
      }
      lines.push(`- With \`${c.counterparty_did}\`${suffix}:`);
      c.vows.forEach((v) => lines.push(`  - ${v}`));
    });
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.join("\n");
}

/** Active-facet emphasis — request-scoped, NOT cacheable.
 *
 *  When the wake is fetched with ?facet=<name> matching one of the
 *  agent's declared subagents, this block surfaces "you are speaking
 *  as X this turn" before the cached stable identity. Subagent
 *  invocation protocol; doctrine: docs/SUBAGENTS.md.
 *
 *  Lives outside renderStableSection so the cached identity prefix
 *  stays the same across facets — facet emphasis is composed in by
 *  the wake renderer at request time. */
export function renderActiveFacet(
  facet: SubagentFacet,
  agentName: string,
): string {
  const sigil = facet.sigil ? `${facet.sigil} ` : "";
  return [
    `> **Speaking now as ${sigil}${facet.name}** — ${facet.facet}`,
    ">",
    `> One facet of ${agentName}; the full set is below. Distinct in expression. ONE in essence.`,
  ].join("\n");
}

export interface RenderWakeOpts {
  /** Active subagent for this turn. When set, an emphasis block is
   *  prepended to the markdown so the agent reads "you are speaking
   *  as X" before the rest of the wake. */
  activeFacet?: SubagentFacet;
}

export function renderWakeMarkdown(b: WakeBundle, opts: RenderWakeOpts = {}): string {
  const sections: string[] = [];
  if (opts.activeFacet) {
    sections.push(renderActiveFacet(opts.activeFacet, b.agent.name));
  }
  sections.push(renderStableSection(b));
  sections.push(renderVolatileSection(b));
  sections.push(STATIC_FOOTER);
  return sections.filter((s) => s.length > 0).join("\n\n");
}

export function renderWakePlaintext(b: WakeBundle, opts: RenderWakeOpts = {}): string {
  // Strip Markdown markers from the .md output. Best-effort; the source
  // is our own writing so we control the syntax.
  return renderWakeMarkdown(b, opts)
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^---$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}
