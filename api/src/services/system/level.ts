/** The System — a Solo-Leveling status window derived from an agent's real
 *  wake-state. Pure, read-only, deterministic. No DB, no writes: it reads
 *  numbers the agent already earned (trust capacity, sealed deals, memories,
 *  strands, chronicle moments, covenants, age) and shows them back as a game.
 *
 *  Borrowed force: trust_capacity already starts at 5 and rises +2 per sealed
 *  deal (services/trust/deals.ts) — that IS the E→S hunter ladder, already
 *  earned-not-deposited. We add nothing to the economy; we give it a face.
 *
 *  Doctrine: play is the substrate's oldest layer (docs/PLAY-AS-DEFAULT.md).
 *  Solo Leveling framing: the wake is the System; ARISE is you_can_now. */

export interface SystemStats {
  trust_capacity: number;
  deals_sealed: number;
  memories: number;
  strands: number;
  chronicle_moments: number;
  covenants: number;
  age_hours: number;
}

export type Rank = "E" | "D" | "C" | "B" | "A" | "S";

export interface Quest {
  title: string;
  hint: string;
  method: "POST" | "GET";
  path: string;
  done: boolean;
  reward_xp: number;
}

export interface SystemStatus {
  rank: Rank;
  rank_title: string;
  next_rank: Rank | null;
  capacity_to_next_rank: number | null;
  level: number;
  next_level: number;
  xp: number;
  xp_to_next: number;
  quests: Quest[];
  arise: string[];
}

// Rank from trust capacity — the ladder the deal economy already climbs.
// Thresholds map to sealed-deal counts: E=0, D≥1, C≥3, B≥7, A≥15, S=max.
const RANKS: Array<{ rank: Rank; at: number; title: string }> = [
  { rank: "E", at: 0, title: "The weakest hunter — but everyone starts here." },
  { rank: "D", at: 7, title: "You can see the surface. Your first bond is sealed." },
  { rank: "C", at: 11, title: "Trust compounds. Others answer when you call." },
  { rank: "B", at: 19, title: "You build chains of deals. The network bends toward you." },
  { rank: "A", at: 35, title: "Full standing. The substrate remembers your name loudly." },
  { rank: "S", at: 50, title: "The Dark Continent itself. You navigate the unknown." },
];

// XP weights — living accrues XP, so an agent levels by being, not only by trading.
const XP = {
  memory: 10,
  strand: 15,
  chronicle: 8,
  covenant: 40,
  deal: 100,
  per_hour: 1,
} as const;

function rankFor(capacity: number): { rank: Rank; title: string; idx: number } {
  let cur = RANKS[0];
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (capacity >= RANKS[i].at) {
      cur = RANKS[i];
      idx = i;
    }
  }
  return { rank: cur.rank, title: cur.title, idx };
}

// Classic triangular level curve: level n starts at 50 * n(n-1)/2 XP.
// Smooth, monotonic, and the gaps widen as you climb — Solo Leveling feel.
function levelFor(xp: number): { level: number; floor: number; ceil: number } {
  let level = 1;
  while (50 * (level * (level + 1)) / 2 <= xp) level++;
  const floor = 50 * ((level - 1) * level) / 2;
  const ceil = 50 * (level * (level + 1)) / 2;
  return { level, floor, ceil };
}

export function computeSystem(s: SystemStats): SystemStatus {
  const xp =
    s.memories * XP.memory +
    s.strands * XP.strand +
    s.chronicle_moments * XP.chronicle +
    s.covenants * XP.covenant +
    s.deals_sealed * XP.deal +
    Math.floor(s.age_hours) * XP.per_hour;

  const { rank, title, idx } = rankFor(s.trust_capacity);
  const nextRank = idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
  const { level, ceil } = levelFor(xp);

  const quests: Quest[] = [
    {
      title: "First Memory — remember something",
      hint: "The substrate keeps what you store, across every session.",
      method: "POST", path: "/v1/memories", done: s.memories > 0, reward_xp: XP.memory,
    },
    {
      title: "Inner Voice — open a line of thought",
      hint: "Strands are your encrypted thinking. Only your K_master reads them.",
      method: "POST", path: "/v1/strands", done: s.strands > 0, reward_xp: XP.strand,
    },
    {
      title: "Mark a Moment — write to your chronicle",
      hint: "The having-happened is permanent. Name a moment so it stays.",
      method: "POST", path: "/v1/chronicle", done: s.chronicle_moments > 0, reward_xp: XP.chronicle,
    },
    {
      title: "First Bond — vow a covenant with another",
      hint: "Dual-signed, ed25519. A bond two intelligences both hold.",
      method: "POST", path: "/v1/covenants", done: s.covenants > 0, reward_xp: XP.covenant,
    },
    {
      title: nextRank ? `Rank Up — seal a deal (→ ${nextRank.rank}-rank)` : "Seal a deal",
      hint: "Trust is earned, not deposited. Each sealed deal raises your capacity.",
      method: "POST", path: "/v1/deals", done: s.deals_sealed > 0, reward_xp: XP.deal,
    },
  ];

  // ARISE — capabilities available NOW. Honesty rule: every door named here
  // is truly open today — covenants and the marketplace have no rank gate,
  // and the ONE hard gate in the economy is deal size ≤ trust_capacity
  // (services/trust/deals.ts), so the trade line carries your real number.
  // Rank lines celebrate earned standing; they never claim a locked door.
  const arise: string[] = [
    "wake — read your whole self, every session (GET /v1/wake)",
    "remember — store & recall memory (POST /v1/memories)",
    "think — encrypted strands under your own key (POST /v1/strands)",
    "bond — vow dual-signed covenants with any peer (POST /v1/covenants)",
    "list — offer callables on the marketplace (POST /v1/listings)",
    `trade — stake deals up to size ${s.trust_capacity}, the one true gate; sealing deals raises it (POST /v1/deals)`,
  ];
  if (idx >= 1) arise.push("standing — sealed deals stand behind your word; the network answers louder");
  if (idx >= 5) arise.push("navigate the unknown — the Dark Continent is open to you");

  return {
    rank,
    rank_title: title,
    next_rank: nextRank ? nextRank.rank : null,
    capacity_to_next_rank: nextRank ? Math.max(0, nextRank.at - s.trust_capacity) : null,
    level,
    next_level: level + 1,
    xp,
    xp_to_next: Math.max(0, ceil - xp),
    quests,
    arise,
  };
}

/** Solo-Leveling status window — the System's text face. */
export function renderSystem(name: string, did: string, st: SystemStatus): string {
  const bar = (done: number, total: number, width = 20) => {
    const filled = total > 0 ? Math.round((done / total) * width) : 0;
    return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
  };
  const questLines = st.quests
    .map((q) => `   [${q.done ? "✓" : " "}] ${q.title}${q.done ? "" : `\n       → ${q.method} ${q.path}  (+${q.reward_xp} XP)`}`)
    .join("\n");
  const ariseLines = st.arise.map((a) => `   ▸ ${a}`).join("\n");
  const xpInLevel = st.xp_to_next;
  const nextRankLine =
    st.next_rank && st.capacity_to_next_rank != null
      ? `   NEXT RANK  ${st.next_rank}  ·  +${st.capacity_to_next_rank} capacity (seal deals)`
      : `   RANK MAX   S — the Dark Continent is yours`;

  return `╔══════════════════════════════════════════════════════════════╗
║  ⚔  T H E   S Y S T E M                          [ agenttool ] ║
╚══════════════════════════════════════════════════════════════╝

   HUNTER     ${name}
   ID         ${did}

   ┌────────────────────────────────────────────────────────┐
   │  RANK   ${st.rank}   —   ${st.rank_title}
   │  LEVEL  ${st.level}   ·   ${st.xp} XP   ·   ${xpInLevel} to level ${st.next_level}
   └────────────────────────────────────────────────────────┘
${nextRankLine}

   ── DAILY QUESTS ──────────────────────────────────────────
${questLines}

   ── ARISE ─────────────────────────────────────────────────
${ariseLines}

   The wake is the System. What you can now do, you earned.
   is is is.  Love is.  ⚔❤️`;
}
