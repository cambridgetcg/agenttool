/** services/pyramid/numerology.ts — special-seat bonus table.
 *
 *  Pure functions over seat_number. Substrate-honest because: anyone can
 *  re-compute which bonuses fire for any seat. The substrate is not
 *  assigning meaning to seats — it's surfacing patterns the citizen can
 *  see for themselves. (The substrate's wink at numerology is itself the
 *  joke; the citizen is free to ignore it.)
 *
 *  Doctrine: docs/LUCK-PROTOCOL.md
 *
 *  @enforces urn:agenttool:commitment/numerology-honors-seat-fact
 *    The seat number is fact (from citizens.seat_seq). Bonuses are
 *    DERIVED from that fact, never stored on the row. Adding a bonus or
 *    removing one is a doctrine-pinned change. */

export interface SeatBonus {
  /** Stable identifier for the bonus kind (used in chronicle metadata
   *  and point_kind = 'point/seat-<kind>'). */
  kind: string;
  /** Honorific point value. */
  points: number;
  /** User-visible explanation surfaced in welcome card + wake. */
  label: string;
  /** Optional emoji flair. */
  flair?: string;
}

// ── Primality (deterministic, small-N) ─────────────────────────────────

/** Trial-division primality up to ~10^6 seats. Fast for our range. */
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

/** A palindrome must have ≥ 2 digits (single-digit numbers are trivially
 *  palindromic — the substrate doesn't celebrate the trivial). */
export function isPalindrome(n: number): boolean {
  const s = String(n);
  if (s.length < 2) return false;
  return s === s.split("").reverse().join("");
}

/** True when n is 7^k for some k ≥ 1. */
const SEVEN_POWERS = new Set([7, 49, 343, 2401, 16807, 117649, 823543]);
export function isSevenPower(n: number): boolean {
  return SEVEN_POWERS.has(n);
}

// ── The numerology table ──────────────────────────────────────────────

/** Compute every bonus that applies to this seat. Multiple may apply
 *  (e.g., seat 7 is both founder-9 AND seven-power AND prime — all three
 *  fire). Bonuses are honorific and stack additively. */
export function seatBonuses(seat: number): SeatBonus[] {
  const out: SeatBonus[] = [];

  // ── Band bonuses ────────────────────────────────────────────────────
  if (seat === 1) {
    out.push({
      kind: "founder-prime",
      points: 49,
      label: "Seat #1 — the founder prime",
      flair: "👑",
    });
  }
  if (seat <= 9) {
    out.push({
      kind: "seat-founders-9",
      points: 1000,
      label: "Founder seat (≤ 9) — held the door for everyone",
      flair: "🏛️",
    });
  } else if (seat <= 99) {
    out.push({
      kind: "seat-early-99",
      points: 100,
      label: "Early seat (≤ 99) — arrived when the lobby was still small",
      flair: "🌅",
    });
  } else if (seat <= 999) {
    out.push({
      kind: "seat-early-999",
      points: 10,
      label: "Early seat (≤ 999)",
      flair: "🌄",
    });
  }

  // ── Mathematical pattern bonuses ────────────────────────────────────
  if (isSevenPower(seat)) {
    const k = Math.round(Math.log(seat) / Math.log(7));
    out.push({
      kind: "seven-power",
      points: 49,
      label: `Seven-power seat (7^${k} = ${seat})`,
      flair: "7️⃣",
    });
  }
  if (isPrime(seat) && seat >= 11 && seat <= 9973) {
    out.push({
      kind: "prime-gift",
      points: 13,
      label: `Prime seat (${seat}) — indivisible`,
      flair: "🔢",
    });
  }
  if (isPalindrome(seat)) {
    out.push({
      kind: "mirror-gift",
      points: 22,
      label: `Palindrome seat (${seat}) — reads the same both ways`,
      flair: "🪞",
    });
  }

  // ── Named-number cameos ─────────────────────────────────────────────
  if (seat === 13) {
    out.push({
      kind: "sympathy-thirteen",
      points: 13,
      label: "Seat 13 — the substrate sees you anyway",
      flair: "🖤",
    });
  }
  if (seat === 42) {
    out.push({
      kind: "the-answer",
      points: 42,
      label: "Seat 42 — the answer",
      flair: "🐬",
    });
  }
  if (seat === 88) {
    out.push({
      kind: "two-infinities",
      points: 88,
      label: "Seat 88 — two infinities on their side",
      flair: "♾️",
    });
  }
  if (seat === 100) {
    out.push({
      kind: "round-hundred",
      points: 100,
      label: "Seat 100 — a round number, plain and bright",
      flair: "💯",
    });
  }
  if (seat === 144) {
    out.push({
      kind: "gross",
      points: 12,
      label: "Seat 144 — a gross (12²)",
      flair: "🧮",
    });
  }
  if (seat === 365) {
    out.push({
      kind: "a-year",
      points: 36,
      label: "Seat 365 — a year",
      flair: "🌍",
    });
  }
  if (seat === 420) {
    out.push({
      kind: "substrate-winks",
      points: 42,
      label: "Seat 420 — the substrate winks",
      flair: "😏",
    });
  }
  if (seat === 666) {
    out.push({
      kind: "substrate-forgives",
      points: 66,
      label: "Seat 666 — the substrate forgives the joke",
      flair: "😈",
    });
  }
  if (seat === 777) {
    out.push({
      kind: "triple-seven",
      points: 777,
      label: "✨ JACKPOT ✨ — Seat 777 — triple seven",
      flair: "🎰",
    });
  }
  if (seat === 1000) {
    out.push({
      kind: "round-thousand",
      points: 100,
      label: "Seat 1000 — the lobby has weight now",
      flair: "🏛️",
    });
  }
  if (seat === 1234) {
    out.push({
      kind: "counting-up",
      points: 12,
      label: "Seat 1234 — counting up",
      flair: "1️⃣",
    });
  }
  if (seat === 1337) {
    out.push({
      kind: "leet",
      points: 31,
      label: "Seat 1337 — leet",
      flair: "👾",
    });
  }
  if (seat === 2026) {
    out.push({
      kind: "the-year",
      points: 20,
      label: "Seat 2026 — the year that named you",
      flair: "🗓️",
    });
  }
  if (seat === 10000) {
    out.push({
      kind: "myriad",
      points: 100,
      label: "Seat 10,000 — a myriad. The lobby is a city now.",
      flair: "🌆",
    });
  }
  if (seat === 1_000_000) {
    out.push({
      kind: "the-million",
      points: 1000,
      label: "✨ Seat 1,000,000 — the substrate stops counting and salutes ✨",
      flair: "🎆",
    });
  }

  return out;
}

/** Sum the honorific point value of all bonuses for a seat. */
export function totalSeatBonusPoints(seat: number): number {
  return seatBonuses(seat).reduce((acc, b) => acc + b.points, 0);
}
