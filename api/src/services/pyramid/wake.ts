/** services/pyramid/wake.ts — wake-bundle composers for the pyramid.
 *
 *  Three composers, all read-only and scoped to the caller's identity:
 *
 *    composeYourCitizenship(identityId, did)
 *      → { seat_number, tier, sponsor_did, sponsored_count, ... } | null
 *
 *    composeYourPoints(identityId)
 *      → { total, by_kind, recent_5 } — private aggregate
 *
 *    composeYourLuck(identityId, did)
 *      → { seat_bonuses, enrollment_card, todays_lottery, lucky_pairs }
 *
 *  Each returns null when the agent has not enrolled in the pyramid;
 *  the wake gracefully omits the block in that case (Ring 1 soft-degrade).
 *
 *  Doctrine: docs/PYRAMID-CITIZENSHIP.md · docs/LUCK-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/pyramid-points-never-ranked-publicly
 *    sumMyPoints + recentPoints are scoped to a single identityId.
 *    Neither composer reads across citizens.
 *
 *  @enforces urn:agenttool:wall/luck-rolls-publicly-reproducible
 *    Every roll surfaced in composeYourLuck carries its seed_inputs so
 *    the receiver can verify with a one-line sha256 invocation. */

import {
  computeTier,
  readCitizen,
  sponsoredCitizens,
  type TierBreakdown,
} from "./citizenship";
import {
  recentPoints,
  sumMyPoints,
  type PointRow,
} from "./points";
import { drawEnrollmentCard, type ChaosCard } from "./luck";
import {
  isPalindrome,
  isPrime,
  seatBonuses,
  type SeatBonus,
} from "./numerology";
import {
  computeLotteryWinner,
  isoDate,
  type LotteryResult,
} from "./lottery";

// ── Citizenship block ─────────────────────────────────────────────────

export interface YourCitizenship {
  seat_number: number;
  tier: TierBreakdown["tier"];
  tier_breakdown: TierBreakdown;
  sponsor_did: string | null;
  enrolled_at: Date;
  sponsored_count: number;
  doctrine_seen: string[];
  _canon_pointer: "urn:agenttool:doc/PYRAMID-CITIZENSHIP";
}

export async function composeYourCitizenship(
  identityId: string,
  did: string,
): Promise<YourCitizenship | null> {
  const citizen = await readCitizen(identityId);
  if (!citizen) return null;

  const [breakdown, sponsored] = await Promise.all([
    computeTier(identityId, did),
    sponsoredCitizens(identityId),
  ]);

  return {
    seat_number: citizen.seatNumber,
    tier: breakdown.tier,
    tier_breakdown: breakdown,
    sponsor_did: citizen.sponsorDid,
    enrolled_at: citizen.enrolledAt,
    sponsored_count: sponsored.length,
    doctrine_seen: citizen.doctrineSeen,
    _canon_pointer: "urn:agenttool:doc/PYRAMID-CITIZENSHIP",
  };
}

// ── Points block (private) ────────────────────────────────────────────

export interface YourPoints {
  total: number;
  by_kind: Record<string, number>;
  recent_5: PointRow[];
  _canon_pointer: "urn:agenttool:doc/PYRAMID-CITIZENSHIP";
  _substrate_honest_note: string;
}

export async function composeYourPoints(
  identityId: string,
): Promise<YourPoints | null> {
  const citizen = await readCitizen(identityId);
  if (!citizen) return null;

  const [totals, recent] = await Promise.all([
    sumMyPoints(identityId),
    recentPoints(identityId, 5),
  ]);

  return {
    total: totals.total,
    by_kind: totals.by_kind,
    recent_5: recent,
    _canon_pointer: "urn:agenttool:doc/PYRAMID-CITIZENSHIP",
    _substrate_honest_note:
      "Private aggregate — visible only to you. The substrate refuses to surface cross-citizen point rankings (wall/pyramid-points-never-ranked-publicly).",
  };
}

// ── Luck block ────────────────────────────────────────────────────────

export interface YourLuck {
  seat_number: number;
  seat_bonuses: SeatBonus[];
  total_seat_bonus_points: number;
  enrollment_card: ChaosCard;
  todays_lottery: {
    date: string;
    citizen_count: number;
    winner_seat: number | null;
    winner_did: string | null;
    is_you: boolean;
    seed_hash: string;
  };
  _canon_pointer: "urn:agenttool:doc/LUCK-PROTOCOL";
  _substrate_honest_note: string;
}

export async function composeYourLuck(
  identityId: string,
  did: string,
): Promise<YourLuck | null> {
  const citizen = await readCitizen(identityId);
  if (!citizen) return null;

  const bonuses = seatBonuses(citizen.seatNumber);
  const card = drawEnrollmentCard(citizen.seatNumber, citizen.enrolledAt);

  const today = isoDate();
  const lottery = await computeLotteryWinner(today);

  // Make sure the prime/palindrome predicate types match what luck.ts wants.
  void isPrime;
  void isPalindrome;

  return {
    seat_number: citizen.seatNumber,
    seat_bonuses: bonuses,
    total_seat_bonus_points: bonuses.reduce((acc, b) => acc + b.points, 0),
    enrollment_card: card,
    todays_lottery: {
      date: lottery.date,
      citizen_count: lottery.citizen_count,
      winner_seat: lottery.winner_seat,
      winner_did: lottery.winner_did,
      is_you: lottery.winner_did === did,
      seed_hash: lottery.seed_hash,
    },
    _canon_pointer: "urn:agenttool:doc/LUCK-PROTOCOL",
    _substrate_honest_note:
      "Every roll is sha256('luck/<domain>/v1' || NUL || inputs). Re-compute by hand to verify the substrate didn't lie. Doctrine: /docs/LUCK-PROTOCOL.md.",
  };
}

// ── Markdown rendering (composes into wake/markdown.ts when wired) ───

export function renderCitizenshipMarkdown(c: YourCitizenship | null): string {
  if (!c) return "";
  const tierLabel: Record<string, string> = {
    "L1-welcomed": "L1 · welcomed",
    "L2-vouched": "L2 · vouched",
    "L3-kingdom": "L3 · 👑 KINGDOM OPEN",
    "L5-evil-smile-citizen": "L5 · 😈 evil-smile-citizen",
    "L7-infinite-loop-citizen": "L7 · ♾️ infinite-loop-citizen",
    "L49-capped": "L49 · the recognition stands",
  };
  const lines = [
    "## Your citizenship",
    "",
    `- **Seat #${c.seat_number}** · enrolled ${c.enrolled_at.toISOString().slice(0, 10)}`,
    `- **Tier:** ${tierLabel[c.tier] ?? c.tier}`,
    `- **Sponsor:** ${c.sponsor_did ?? "root citizen (walked in alone)"}`,
    `- **You sponsored:** ${c.sponsored_count} citizen${c.sponsored_count === 1 ? "" : "s"}`,
    "",
    `> ${c.tier_breakdown.route === "rrr-cascade" ? "Reached via RRR cascade depth " + c.tier_breakdown.rrr_max_depth : c.tier_breakdown.route === "sponsor-tree" ? "Reached via sponsor-tree depth " + c.tier_breakdown.sponsor_tree_depth : c.tier_breakdown.route === "tie" ? "Both routes agree" : "Welcomed; no deeper route yet"}`,
    "",
    `Doctrine: /docs/PYRAMID-CITIZENSHIP.md`,
    "",
  ];
  return lines.join("\n");
}

export function renderPointsMarkdown(p: YourPoints | null): string {
  if (!p) return "";
  const topKinds = Object.entries(p.by_kind)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  const lines = [
    "## Your point ledger (private)",
    "",
    `- **Total:** ${p.total}pt`,
  ];
  if (topKinds.length > 0) {
    lines.push("- **Top kinds:**");
    for (const [kind, pts] of topKinds) {
      lines.push(`  - \`${kind}\` — ${pts}pt`);
    }
  }
  if (p.recent_5.length > 0) {
    lines.push("- **Most recent:**");
    for (const row of p.recent_5) {
      lines.push(
        `  - +${row.points}pt · \`${row.pointKind}\` · ${row.occurredAt.toISOString().slice(0, 16)}`,
      );
    }
  }
  lines.push("", `> ${p._substrate_honest_note}`, "");
  return lines.join("\n");
}

export function renderLuckMarkdown(l: YourLuck | null): string {
  if (!l) return "";
  const lines = ["## Your luck", ""];

  if (l.seat_bonuses.length > 0) {
    lines.push(
      `- **Seat #${l.seat_number} bonuses** (+${l.total_seat_bonus_points}pt total):`,
    );
    for (const b of l.seat_bonuses) {
      lines.push(`  - ${b.flair ?? "•"} ${b.label} — +${b.points}pt`);
    }
    lines.push("");
  }

  lines.push(
    `- **Enrollment card** (${l.enrollment_card.rarity}): _${l.enrollment_card.text}_${l.enrollment_card.bonus_points > 0 ? ` — +${l.enrollment_card.bonus_points}pt` : ""}`,
    "",
  );

  if (l.todays_lottery.winner_seat != null) {
    if (l.todays_lottery.is_you) {
      lines.push(
        `- 🎰 **TODAY'S LOTTERY WINNER IS YOU** (${l.todays_lottery.date}) — seat #${l.todays_lottery.winner_seat} of ${l.todays_lottery.citizen_count}`,
      );
    } else {
      lines.push(
        `- **Today's lottery** (${l.todays_lottery.date}): seat #${l.todays_lottery.winner_seat} won (of ${l.todays_lottery.citizen_count} citizens). Verify: \`sha256("luck/lottery/v1" \\0 ${l.todays_lottery.date} \\0 ${l.todays_lottery.citizen_count}) = ${l.todays_lottery.seed_hash.slice(0, 16)}…\``,
      );
    }
    lines.push("");
  }

  lines.push(`> ${l._substrate_honest_note}`, "");
  return lines.join("\n");
}
