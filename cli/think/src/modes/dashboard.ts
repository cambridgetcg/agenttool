/** dashboard mode — render the agent's third-person operational view.
 *
 *  GET /v1/dashboard, format with sections + colors. Glanceable. */

import { AgenttoolClient } from "../api";
import type { ThinkConfig } from "../config";

const TTY = process.stdout.isTTY === true;
const C = {
  dim: (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (TTY ? `\x1b[36m${s}\x1b[0m` : s),
  yellow: (s: string) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  green: (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  magenta: (s: string) => (TTY ? `\x1b[35m${s}\x1b[0m` : s),
  red: (s: string) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
};

function rel(iso: string | null): string {
  if (!iso) return C.dim("never");
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return C.green("just now");
  if (ms < 3_600_000) return C.green(`${Math.floor(ms / 60_000)}m ago`);
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return C.dim(`${Math.floor(ms / 86_400_000)}d ago`);
}

function bar(n: number, max: number, width = 16): string {
  if (max <= 0) return "";
  const filled = Math.round((n / max) * width);
  return "▏" + "█".repeat(filled) + " ".repeat(Math.max(0, width - filled));
}

export interface DashboardOptions {
  identityId?: string;
  json: boolean;
}

export async function dashboard(
  config: ThinkConfig,
  opts: DashboardOptions,
): Promise<void> {
  const client = new AgenttoolClient(config);
  const d = await client.getDashboard(opts.identityId);

  if (opts.json) {
    console.log(JSON.stringify(d, null, 2));
    return;
  }

  // Header
  console.log("");
  console.log(C.bold(`▾ ${d.agent.name}`) + C.dim(`  ${d.agent.did}`));
  const flags: string[] = [];
  if (d.lifecycle.is_fork) flags.push(C.magenta("fork"));
  if (d.expression.visibility === "public") flags.push(C.cyan("public expression"));
  if (d.lifecycle.descendants_count > 0)
    flags.push(C.dim(`${d.lifecycle.descendants_count} descendant${d.lifecycle.descendants_count === 1 ? "" : "s"}`));
  if (flags.length > 0) console.log(`  ${flags.join(" · ")}`);
  console.log(
    `  trust=${d.agent.trust_score.toFixed(2)}  ` +
      `caps=${d.agent.capabilities.length}  ` +
      `signing-keys=${d.lifecycle.signing_keys_active}`,
  );
  console.log("");

  // Rhythm
  console.log(C.bold("rhythm"));
  console.log(
    `  last thought    ${rel(d.rhythm.last_thought_at)}` +
      (d.rhythm.current_mood ? `  ${C.dim("·")} mood: ${C.yellow(d.rhythm.current_mood)}` : ""),
  );
  const r = d.rhythm.thought_rate;
  console.log(
    `  thought rate    5m=${C.cyan(String(r["5m"]))}  1h=${C.cyan(String(r["1h"]))}  24h=${C.cyan(String(r["24h"]))}`,
  );
  if (Object.keys(d.rhythm.kinds_24h).length > 0) {
    const max = Math.max(...Object.values(d.rhythm.kinds_24h));
    const sorted = Object.entries(d.rhythm.kinds_24h).sort((a, b) => b[1] - a[1]);
    console.log(`  kinds (24h)`);
    for (const [k, n] of sorted) {
      console.log(`    ${k.padEnd(11)} ${C.cyan(bar(n, max))} ${n}`);
    }
  }
  console.log("");

  // Strands
  console.log(C.bold("strands"));
  const sc = d.strands.counts;
  console.log(
    `  active=${C.green(String(sc.active))}  dormant=${sc.dormant}` +
      (sc.dormant_due > 0 ? ` (${C.yellow(sc.dormant_due + " due")})` : "") +
      `  completed=${C.dim(String(sc.completed))}  abandoned=${C.dim(String(sc.abandoned))}` +
      (d.strands.public_count > 0 ? `  ${C.cyan(d.strands.public_count + " public")}` : ""),
  );
  if (d.strands.active.length > 0) {
    for (const s of d.strands.active.slice(0, 5)) {
      const topic = s.topic_encrypted ? C.dim("(encrypted)") : s.topic ?? C.dim("(untitled)");
      const mood = s.mood ? `  ${C.yellow(s.mood)}` : "";
      const imp = s.importance !== null ? `  imp=${s.importance.toFixed(2)}` : "";
      const vis = s.visibility === "public" ? `  ${C.cyan("public")}` : "";
      console.log(`  · ${C.bold(topic)}${mood}${imp}${vis}`);
      console.log(
        `      ${C.dim("seq=" + s.last_thought_seq)}  ${rel(s.last_thought_at)}`,
      );
    }
  }
  console.log("");

  // Memory
  console.log(C.bold("memory"));
  const mt = d.memory.by_tier;
  console.log(
    `  total=${d.memory.total}  ` +
      `episodic=${mt.episodic ?? 0}  ` +
      `${C.yellow("foundational=" + (mt.foundational ?? 0))}  ` +
      `${C.magenta("constitutive=" + (mt.constitutive ?? 0))}` +
      (d.memory.public_count > 0 ? `  ${C.cyan(d.memory.public_count + " public")}` : ""),
  );
  if (d.memory.recent.length > 0) {
    for (const m of d.memory.recent.slice(0, 4)) {
      const tag = m.tier === "constitutive" ? C.magenta("◆") : m.tier === "foundational" ? C.yellow("●") : C.dim("○");
      const preview = m.content.replace(/\s+/g, " ").trim();
      console.log(`  ${tag} ${preview.slice(0, 80)}${preview.length > 80 ? "…" : ""}`);
      console.log(
        `      ${C.dim(`imp=${m.importance.toFixed(2)} · ${rel(m.created_at)}`)}`,
      );
    }
  }
  console.log("");

  // Decisions / trace
  if (d.trace.total > 0) {
    console.log(C.bold("decisions"));
    console.log(`  total=${d.trace.total}`);
    for (const t of d.trace.recent.slice(0, 3)) {
      const sig = t.has_signature ? C.green("🔏 ") : "";
      const conf = t.confidence !== null ? C.dim(`[${t.confidence.toFixed(2)}]`) : "";
      console.log(`  · ${sig}${C.cyan(t.decision_type)} ${conf} ${t.decision_summary.slice(0, 60)}`);
      console.log(`      ${C.dim(rel(t.created_at))}`);
    }
    console.log("");
  }

  // Relations
  console.log(C.bold("relations"));
  console.log(
    `  covenants=${d.relations.covenants_active_count}  ` +
      `inbox unread=${d.relations.inbox_unread > 0 ? C.yellow(String(d.relations.inbox_unread)) : "0"}  ` +
      `proposals pending=${d.relations.merge_proposals_pending > 0 ? C.yellow(String(d.relations.merge_proposals_pending)) : "0"}`,
  );
  for (const c of d.relations.covenants.slice(0, 5)) {
    console.log(`  · ${C.dim(c.counterparty_did)}  ${c.vows_count} vow${c.vows_count === 1 ? "" : "s"}`);
  }
  console.log("");

  // Lifecycle
  console.log(C.bold("lifecycle"));
  if (d.wallet) {
    console.log(`  wallet          ${d.wallet.credits.toLocaleString()} ${d.wallet.currency}  (${d.wallet.status})`);
  }
  console.log(
    `  consolidation   last=${rel(d.lifecycle.last_consolidation_at)}` +
      (d.lifecycle.consolidation_overflow_count > 0
        ? `  ${C.yellow(`${d.lifecycle.consolidation_overflow_count} strand${d.lifecycle.consolidation_overflow_count === 1 ? "" : "s"} overflow`)}`
        : ""),
  );
  if (d.lifecycle.is_fork) {
    console.log(
      `  fork lineage    ${C.dim("from")} ${d.lifecycle.parent_did ?? "(unknown)"}`,
    );
  }
  console.log("");

  // Expression summary
  console.log(C.bold("expression"));
  const e = d.expression;
  console.log(
    `  declared        register=${e.declared_register_present ? C.green("✓") : C.dim("—")}  ` +
      `walls=${e.declared_walls_count}  subagents=${e.declared_subagents_count}`,
  );
  if (e.effective_walls_count !== null && e.effective_walls_count !== e.declared_walls_count) {
    console.log(
      `  effective       walls=${e.effective_walls_count}  ` +
        `${C.dim(`(declared + ${e.shaped_by_count} memory patches)`)}`,
    );
  }
  console.log(
    `  visibility      ${e.visibility === "public" ? C.cyan("public") : C.dim("private")}`,
  );
}
