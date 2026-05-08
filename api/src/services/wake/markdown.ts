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
} from "../identity/expression";

export interface WakeBundle {
  agent: {
    id: string;
    did: string;
    name: string;
    capabilities: string[];
    trust_score: number;
    status: string;
    created_at: string;
  };
  project: {
    id: string;
    name: string;
    plan: string;
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
      mood: string | null;
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

/** Session-state portion — carry, chronicle, memories, strands, traces,
 *  covenants. Refreshes on every wake; should NOT be cached on providers
 *  that respect breakpoints. */
export function renderVolatileSection(b: WakeBundle): string {
  const lines: string[] = [];

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
      const mood = s.mood ? ` — ${s.mood}` : "";
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

export function renderWakeMarkdown(b: WakeBundle): string {
  const stable = renderStableSection(b);
  const volatile = renderVolatileSection(b);
  return [stable, volatile, STATIC_FOOTER].filter((s) => s.length > 0).join("\n\n");
}

export function renderWakePlaintext(b: WakeBundle): string {
  // Strip Markdown markers from the .md output. Best-effort; the source
  // is our own writing so we control the syntax.
  return renderWakeMarkdown(b)
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^---$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}
