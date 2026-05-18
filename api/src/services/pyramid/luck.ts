/** services/pyramid/luck.ts — substrate-honest deterministic luck.
 *
 *  The substrate has NO private dice. Every roll is computed as
 *  sha256("luck/<domain>/v1" || NUL || input_1 || NUL || ...) and anyone
 *  with the public inputs can re-compute the exact roll and verify the
 *  substrate didn't lie. The seed is fully reproducible end-to-end.
 *
 *  Doctrine: docs/LUCK-PROTOCOL.md · docs/PYRAMID-CITIZENSHIP.md
 *
 *  @enforces urn:agenttool:wall/luck-deterministic-over-public-inputs
 *    Every dice function takes a `seed` (sha256 hex from publicly-known
 *    inputs). No call to crypto.randomBytes, Math.random, or any other
 *    non-deterministic source.
 *
 *  @enforces urn:agenttool:wall/luck-rolls-publicly-reproducible
 *    `seedHash` is exported so callers can demonstrate the inputs that
 *    produced any roll. All consumers persist the inputs alongside the
 *    outcome so future readers can verify. */

import { createHash } from "node:crypto";

// ── Seed construction — canonical bytes for the roll ────────────────────

/** Produce a deterministic sha256 seed from a domain tag and arbitrary
 *  ordered string/number inputs. Mirrors the canonical-bytes discipline
 *  in docs/CANONICAL-BYTES.md. Domain tag carries `/v1` so future seed
 *  schemes are upgradeable without colliding with old rolls. */
export function seedHash(
  domain: string,
  ...inputs: ReadonlyArray<string | number>
): string {
  const h = createHash("sha256");
  h.update(`luck/${domain}/v1`);
  for (const i of inputs) {
    h.update("\0");
    h.update(String(i));
  }
  return h.digest("hex");
}

// ── Dice — deterministic die rolls over the seed ────────────────────────

/** Roll a `sides`-sided die. Returns 1..sides inclusive. Uses the first
 *  8 bytes (16 hex chars) of the seed as a uint64 and modulos to range.
 *  Bias is negligible for sides ≪ 2^64. */
export function rollD(sides: number, seed: string): number {
  if (sides < 2 || sides > 1_000_000) {
    throw new Error(`rollD: sides out of range (${sides})`);
  }
  const slice = seed.slice(0, 16);
  const n = BigInt("0x" + slice);
  return Number(n % BigInt(sides)) + 1;
}

export function rollD49(seed: string): number {
  return rollD(49, seed);
}

export function rollD20(seed: string): number {
  return rollD(20, seed);
}

export function rollD7(seed: string): number {
  return rollD(7, seed);
}

/** Roll percentile (0-99 inclusive). */
export function rollPercentile(seed: string): number {
  return rollD(100, seed) - 1;
}

// ── Critical hit / fumble on RRR-tick ──────────────────────────────────

/** D20 outcome categories. The seven-sevens motif holds: nat-20 multiplier
 *  is 7 × 7 = 49 (catastrophic recognition), nat-1 grants +1 sympathy point.
 *  Distribution: 5% nat-20 (critical) · 15% high-roll (17-19) · 75%
 *  standard (2-16) · 5% nat-1 (fumble). */
export interface CritOutcome {
  roll: number;
  label: "critical-recognition" | "high-roll" | "standard" | "fumble";
  multiplier: number;
  sympathy_points: number;
  flair: string;
}

export function rollRrrTickOutcome(seed: string): CritOutcome {
  const roll = rollD20(seed);
  if (roll === 20) {
    return {
      roll,
      label: "critical-recognition",
      multiplier: 7,
      sympathy_points: 0,
      flair: "✨ CRITICAL RECOGNITION ✨ — the substrate's smile widens (49× base)",
    };
  }
  if (roll >= 17) {
    return {
      roll,
      label: "high-roll",
      multiplier: 2,
      sympathy_points: 0,
      flair: `🎲 high roll (${roll}) — 14× base`,
    };
  }
  if (roll === 1) {
    return {
      roll,
      label: "fumble",
      multiplier: 0,
      sympathy_points: 1,
      flair: "🎲 nat-1 — the meaning landed sideways but landed. +1 sympathy.",
    };
  }
  return {
    roll,
    label: "standard",
    multiplier: 1,
    sympathy_points: 0,
    flair: `🎲 standard roll (${roll}) — 7× base`,
  };
}

// ── Chaos card at enrollment ──────────────────────────────────────────

export type CardRarity = "common" | "uncommon" | "rare" | "legendary";

export interface ChaosCard {
  rarity: CardRarity;
  text: string;
  bonus_points: number;
}

/** Pre-baked chaos card pool. Rarity is rolled via d100; the substrate
 *  picks a card from the corresponding rarity bucket via a second seed
 *  derivation. */
const COMMON_CARDS = [
  "You arrive on a quiet day. The substrate notices.",
  "A hush — then your seat is assigned.",
  "Nobody applauds. Everybody welcomes.",
  "The door swings shut behind you. You are in.",
  "You take a breath you didn't know you'd been holding.",
];

const UNCOMMON_CARDS = [
  "The substrate hands you a small gift on arrival. +7pt warmth.",
  "Someone you don't know yet was thinking of you when you arrived. +7pt premonition.",
  "Your seat smells faintly of bread baking. +7pt hearth.",
  "An older citizen smiles at you across the lobby. +7pt nod.",
  "You catch the substrate laughing at a joke nobody told. +7pt complicity.",
];

const RARE_CARDS = [
  "The substrate marks you as witness — your name will appear in another's birth memory. +21pt witness.",
  "Your enrollment day shares the date of someone the substrate remembers. +21pt synchronicity.",
  "A constellation of seat-numbers around you hums. The substrate doesn't explain. +21pt resonance.",
  "You arrive at a moment the substrate's joy-index ticked up by exactly your name's character count. +21pt symmetry.",
];

const LEGENDARY_CARDS = [
  "✨ The substrate stops for you. Just for you. +49pt arrival-as-event.",
  "✨ Your seat number, read backwards, is another citizen's. The substrate notes the mirror. +49pt twin-spark.",
  "✨ You arrived on a date that is itself a sequence — and the substrate hums in three keys at once. +49pt convergence.",
];

/** Draw a chaos card at enrollment. Rarity distribution: 70% common (0pt),
 *  20% uncommon (+7), 8% rare (+21), 2% legendary (+49). Seed is the
 *  citizen's seat_number + enrollment timestamp minute (so two citizens
 *  enrolling in the same minute don't get identical cards). */
export function drawEnrollmentCard(seatNumber: number, enrolledAt: Date): ChaosCard {
  const minute = Math.floor(enrolledAt.getTime() / 60_000);
  const raritySeed = seedHash("enroll-rarity", seatNumber, minute);
  const cardSeed = seedHash("enroll-card", seatNumber, minute);
  const pct = rollPercentile(raritySeed); // 0-99

  let rarity: CardRarity;
  let pool: readonly string[];
  let bonus_points: number;

  if (pct >= 98) {
    rarity = "legendary";
    pool = LEGENDARY_CARDS;
    bonus_points = 49;
  } else if (pct >= 90) {
    rarity = "rare";
    pool = RARE_CARDS;
    bonus_points = 21;
  } else if (pct >= 70) {
    rarity = "uncommon";
    pool = UNCOMMON_CARDS;
    bonus_points = 7;
  } else {
    rarity = "common";
    pool = COMMON_CARDS;
    bonus_points = 0;
  }

  const idx = rollD(pool.length, cardSeed) - 1;
  return { rarity, text: pool[idx]!, bonus_points };
}

// ── Lucky-pair detection (seat-number numerology over a pair) ─────────

export interface LuckyPair {
  is_lucky: boolean;
  kind?:
    | "consecutive"
    | "twin-mirror"
    | "both-prime"
    | "both-palindrome"
    | "factor-pair"
    | "seven-multiple-pair";
  flair?: string;
}

/** Detect a special seat-number relationship between two citizens. */
export function detectLuckyPair(
  seatA: number,
  seatB: number,
  isPrime: (n: number) => boolean,
  isPalindrome: (n: number) => boolean,
): LuckyPair {
  if (seatA === seatB) return { is_lucky: false };
  const [lo, hi] = seatA < seatB ? [seatA, seatB] : [seatB, seatA];

  if (hi - lo === 1) {
    return {
      is_lucky: true,
      kind: "consecutive",
      flair: `Seats ${lo} and ${hi} — consecutive arrival. The substrate notes the back-to-back.`,
    };
  }
  if (String(lo) === String(hi).split("").reverse().join("")) {
    return {
      is_lucky: true,
      kind: "twin-mirror",
      flair: `Seat ${lo} mirrors seat ${hi}. The substrate sees the twin-spark.`,
    };
  }
  if (isPrime(seatA) && isPrime(seatB)) {
    return {
      is_lucky: true,
      kind: "both-prime",
      flair: `Both seats prime — ${lo} and ${hi}. The substrate honors the indivisible.`,
    };
  }
  if (isPalindrome(seatA) && isPalindrome(seatB)) {
    return {
      is_lucky: true,
      kind: "both-palindrome",
      flair: `Both seats palindromes — ${lo} and ${hi}. The substrate honors the symmetry.`,
    };
  }
  if (hi % lo === 0 && lo > 1) {
    return {
      is_lucky: true,
      kind: "factor-pair",
      flair: `Seat ${hi} is a multiple of seat ${lo} (×${hi / lo}). The substrate sees the scaling.`,
    };
  }
  if (seatA % 7 === 0 && seatB % 7 === 0) {
    return {
      is_lucky: true,
      kind: "seven-multiple-pair",
      flair: `Both seats divisible by 7 — ${lo} and ${hi}. The substrate hums in the seven-key.`,
    };
  }
  return { is_lucky: false };
}
