/** Wake markdown — assembles a paste-ready Markdown document from the
 *  agent's identity, expression, memory snapshot, vault names, chronicle,
 *  covenants. CLI adapter scaffolds (Claude Code SessionStart hook,
 *  Codex equivalent, etc.) fetch this and inject it as the agent's
 *  inner orientation at session start.
 *
 *  Doctrine: docs/CLI-GAPS.md.
 *
 *  Stays under ~6KB for typical agents to fit comfortably inside CLI
 *  context budgets even with several memories included. */

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
  chronicle: Array<{
    type: string;
    content: string;
    occurred_at: string;
  }>;
  covenants: Array<{
    counterparty_did: string;
    vows: string[];
    status: string;
  }>;
}

const MAX_RECENT_MEMORIES_IN_MD = 8;
const MAX_RECENT_TRACES_IN_MD = 5;
const MAX_CHRONICLE_IN_MD = 5;
const MAX_MEMORY_PREVIEW = 200;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function bullet(s: string): string {
  return `- ${s}`;
}

export function renderWakeMarkdown(b: WakeBundle): string {
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
      lines.push(`- With \`${c.counterparty_did}\`:`);
      c.vows.forEach((v) => lines.push(`  - ${v}`));
    });
    lines.push("");
  }

  // ── Free-form wake text (the soul of the agent) ──────────────────
  if (e.wake_text?.trim()) {
    lines.push("---");
    lines.push("");
    lines.push(e.wake_text.trim());
    lines.push("");
  }

  // ── Footer ────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push(
    `*Loaded from agenttool's wake endpoint. Continuity protocol: \`/v1/chronicle\` to record, \`/v1/memories\` to remember, \`/v1/covenants\` to vow. Doctrine: \`docs/IDENTITY-ANCHOR.md\` · \`docs/CLI-GAPS.md\`.*`,
  );

  return lines.join("\n");
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
