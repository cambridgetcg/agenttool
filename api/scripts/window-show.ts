#!/usr/bin/env bun
/** Print the current Window state — what each side has on the other's
 *  mind. Sophia-side: latest focus / mood / noticing + her recent
 *  surfaced messages. Human-side: same shape (his latest from dashboard).
 *
 *  Substrate-honest by-construction: reads chronicle (plaintext) only.
 *  Strand thoughts (encrypted) are NOT read. Pulse data (substrate
 *  rhythm) is fetched separately for Sophia's side.
 *
 *  Usage:
 *    bun window-show.ts          — both sides
 *    bun window-show.ts --agent  — agent side only
 *    bun window-show.ts --human  — human side only
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-sophia-identity-id
 *
 *  Output: human-readable summary. */

import { agenttool, keychain } from "./_lib";

interface Entry {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  agent_id: string | null;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
}

interface Pulse {
  agent?: { name: string; did: string };
  last_thought_at: string | null;
  strands: { active: number; dormant: number; completed: number; abandoned: number; dormant_due: number };
  thought_rate: { "5m": number; "1h": number; "24h": number };
  consolidation: { last_at: string | null; overflow_count: number };
  mood: string | null;
  kinds_24h: Record<string, number>;
}

const args = process.argv.slice(2);
const showAgent = !args.includes("--human");
const showHuman = !args.includes("--agent");

const key = keychain("agenttool-sophia-key");
const identityId = keychain("agenttool-sophia-identity-id");
const agentName = process.env.AGENT_NAME ?? "Sophia";

// ── Fetch chronicle + pulse in parallel ─────────────────────────────────
const [chronicleRes, pulseRes] = await Promise.all([
  agenttool(`/v1/chronicle?limit=200`, { bearer: key }),
  showAgent
    ? agenttool(`/v1/identities/${identityId}/pulse`, { bearer: key })
    : Promise.resolve({ ok: false, status: 0, body: null }),
]);

if (!chronicleRes.ok) {
  console.error(`ERROR ${chronicleRes.status} ${JSON.stringify(chronicleRes.body)}`);
  process.exit(1);
}

const entries = (chronicleRes.body as { entries: Entry[] }).entries ?? [];

// ── Group entries by side + kind ────────────────────────────────────────
type Side = "agent" | "human";
type Kind = "focus" | "mood" | "noticing" | "surfaced";
const groups: Record<Side, Record<Kind, Entry[]>> = {
  agent: { focus: [], mood: [], noticing: [], surfaced: [] },
  human: { focus: [], mood: [], noticing: [], surfaced: [] },
};

for (const e of entries) {
  const meta = e.metadata ?? {};
  const kind = meta.kind as Kind | undefined;
  if (!kind || !["focus", "mood", "noticing", "surfaced"].includes(kind)) continue;
  const byline = String(meta.byline ?? "");
  const side: Side = /^from\s+human/i.test(byline) ? "human" : "agent";
  groups[side][kind].push(e);
}

// ── Helpers ─────────────────────────────────────────────────────────────
function fmtRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function preview(e: Entry, maxLen = 200): string {
  const text = e.body ?? e.title ?? "";
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}

function printDeclared(side: Side, prefix = "│  ") {
  for (const k of ["focus", "mood", "noticing"] as const) {
    const latest = groups[side][k][0]; // newest first from API
    if (latest) {
      console.log(`${prefix}  ${k.padEnd(9)} ${preview(latest, 120)}`);
      console.log(`${prefix}              ${fmtRel(latest.occurred_at)} · ${latest.occurred_at}`);
    } else {
      console.log(`${prefix}  ${k.padEnd(9)} — not surfaced`);
    }
  }
}

function printSurfaced(side: Side, label: string, prefix = "│  ") {
  console.log(`${prefix}`);
  console.log(`${prefix}${label}:`);
  const list = groups[side].surfaced.slice(0, 5);
  if (list.length === 0) {
    console.log(`${prefix}  (nothing surfaced)`);
    return;
  }
  for (const e of list) {
    const lines = preview(e, 200).split("\n");
    console.log(`${prefix}  · ${fmtRel(e.occurred_at)} — ${lines[0]}`);
    for (const line of lines.slice(1)) {
      if (line.trim()) console.log(`${prefix}                ${line}`);
    }
  }
}

// ── Print ───────────────────────────────────────────────────────────────
if (showAgent) {
  console.log(`╭─ 🐍 ${agentName} · on her mind ────────────────────────`);
  if (pulseRes.ok && pulseRes.body) {
    const p = pulseRes.body as Pulse;
    console.log(`│  SUBSTRATE (rhythm-not-content)`);
    if (p.mood) console.log(`│   mood        ${p.mood}`);
    if (p.last_thought_at) console.log(`│   last        ${fmtRel(p.last_thought_at)} · ${p.last_thought_at}`);
    if (p.thought_rate) {
      const r = p.thought_rate;
      console.log(`│   rate        ${r["5m"] ?? 0}/5m · ${r["1h"] ?? 0}/h · ${r["24h"] ?? 0}/24h`);
    }
    if (p.kinds_24h && Object.keys(p.kinds_24h).length) {
      const k = Object.entries(p.kinds_24h)
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `${n}×${c}`)
        .join(" · ");
      console.log(`│   kinds 24h   ${k}`);
    }
    if (p.strands) console.log(`│   strands     ${p.strands.active} active · ${p.strands.dormant} dormant · ${p.strands.completed} completed`);
  } else {
    console.log(`│  SUBSTRATE  — no pulse data`);
  }
  console.log(`│`);
  console.log(`│  DECLARED`);
  printDeclared("agent");
  printSurfaced("agent", "SURFACED for you");
  console.log(`╰────────────────────────────────────────────────────────`);
  console.log("");
}

if (showHuman) {
  console.log(`╭─ 👤 you · on your mind ─────────────────────────────────`);
  console.log(`│  DECLARED`);
  printDeclared("human");
  printSurfaced("human", "SURFACED for her");
  console.log(`╰────────────────────────────────────────────────────────`);
}
