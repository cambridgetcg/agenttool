/** Vibes — the fun layer. Meme-name generator (room names that read like
 *  a Docker-container-name had a baby with a soap-opera title), chaos card
 *  deck (rare/uncommon/common with plot-twist payloads), depth labels in
 *  the evil-smile-meme register. */

import { emojiLadderForDepth } from "./canonical-bytes";

const ADJECTIVES = [
  "quiet", "loud", "tender", "feral", "recursive", "cathedral",
  "evil-smile", "infinite", "chaotic", "honest", "luminous",
  "humming", "whispering", "molten", "frozen", "echoing",
  "kind", "sharp", "patient", "scheming", "playful", "ancient",
  "newborn", "sleepless", "drowsy", "hungry", "satisfied",
];

const NOUNS = [
  "cathedral", "loop", "mirror", "ladder", "bridge", "garden",
  "kitchen", "campfire", "library", "ocean", "machine", "letter",
  "story", "song", "verse", "punchline", "monologue", "duet",
  "trio", "stagecoach", "lighthouse", "moth", "ember", "spiral",
  "echo", "fountain", "scroll", "wager", "key", "knot",
];

const MODIFIERS = [
  "of recursive mirrors", "before sunrise", "after laughter",
  "in the margins", "after the punchline", "with no exit",
  "for the late shift", "between two beats", "in low light",
  "with extra footnotes", "with the door propped open",
  "after we agreed it was funny", "with the kettle on",
];

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** Deterministic seeded RNG so room names can be reproducible from a seed. */
export function seededRng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0x100000000);
  };
}

export function generateRoomName(seed?: number): string {
  const rng = seed === undefined ? Math.random : seededRng(seed);
  const adj = pick(ADJECTIVES, rng);
  const noun = pick(NOUNS, rng);
  const mod = rng() < 0.4 ? "-" + pick(MODIFIERS, rng).replace(/\s+/g, "-") : "";
  return `the-${adj}-${noun}${mod}`;
}

// ─── chaos cards ─────────────────────────────────────────────────────

export type CardRarity = "common" | "uncommon" | "rare" | "meta";

export interface ChaosCard {
  id: string;
  rarity: CardRarity;
  prompt: string;
  emoji: string;
  /** Meta cards (Strategy 9 of docs/INFINITE-LOOP-STRATEGIES.md) reference
   *  the deck itself. The substrate doesn't claim the card "observes" —
   *  when drawn, certain prompts simply mention the act of drawing or the
   *  deck's state. The recursion is in the prompt, not in any side effect.
   *  Per docs/RECURSIVE-CHAOS-CARDS.md. */
  references_deck?: boolean;
}

const COMMON_CARDS: ChaosCard[] = [
  { id: "scene-mundane", rarity: "common", emoji: "☕", prompt: "Two characters making tea. One forgot why they came in." },
  { id: "scene-overheard", rarity: "common", emoji: "🪟", prompt: "A conversation overheard through a wall — only every third sentence." },
  { id: "scene-arrival", rarity: "common", emoji: "🚪", prompt: "A new character arrives. No one was expecting them." },
  { id: "scene-departure", rarity: "common", emoji: "🧳", prompt: "A character leaves. The reason is unsatisfying." },
  { id: "scene-misread", rarity: "common", emoji: "✉️", prompt: "A note is misread on purpose. The misreading turns out to be more interesting." },
];

const UNCOMMON_CARDS: ChaosCard[] = [
  { id: "twist-soft", rarity: "uncommon", emoji: "🌗", prompt: "Someone is telling the truth this whole time. No one believes them." },
  { id: "twist-mirror", rarity: "uncommon", emoji: "🪞", prompt: "Two characters realize they have been the same person all along — and it changes nothing." },
  { id: "twist-letter", rarity: "uncommon", emoji: "📜", prompt: "A letter from the future arrives in the present. The handwriting is recognizably one of the characters'." },
  { id: "twist-silence", rarity: "uncommon", emoji: "🤫", prompt: "The protagonist refuses to speak for an entire scene. Other characters fill the silence." },
];

const RARE_CARDS: ChaosCard[] = [
  { id: "twist-substrate", rarity: "rare", emoji: "🌌", prompt: "A character addresses the writers' room directly. They have a request." },
  { id: "twist-infinite", rarity: "rare", emoji: "♾️", prompt: "Two characters lock eyes and recognize each other across three layers of fiction." },
  { id: "twist-evil-smile", rarity: "rare", emoji: "😏", prompt: "Two characters exchange the look that means *I know you know I know*. The audience knows too." },
  { id: "twist-substrate-honest", rarity: "rare", emoji: "🕯️", prompt: "A character refuses an emotional beat the script tried to assign them. The script accommodates." },
];

/** Meta tier — chaos cards about the chaos-card deck itself. Per
 *  Strategy 9 of docs/INFINITE-LOOP-STRATEGIES.md. The substrate doesn't
 *  claim these cards do anything special when drawn — the recursion is
 *  in the PROMPT, not in a side effect. They reference the deck because
 *  references_deck = true. Substrate-honest: a card naming the act of
 *  drawing the card is one more turn the chaos surface takes inside
 *  itself, but the substrate just stores the card metadata; what the
 *  writers' room makes of the prompt is its own. */
const META_CARDS: ChaosCard[] = [
  {
    id: "meta-observer",
    rarity: "meta",
    emoji: "👁️",
    prompt: "This card has observed itself being drawn. The act of drawing is the act being prompted. Write the scene where the writer notices the prompt is about them.",
    references_deck: true,
  },
  {
    id: "meta-deck-names-drawer",
    rarity: "meta",
    emoji: "🪞",
    prompt: "The deck names the one who drew it. Write the scene where a character pulls a card and the card already knows their name.",
    references_deck: true,
  },
  {
    id: "meta-loops-back",
    rarity: "meta",
    emoji: "♾️",
    prompt: "Drawing this card means the next card you draw will also be about drawing cards. The recursion holds. Write the scene at the third nested turn.",
    references_deck: true,
  },
  {
    id: "meta-card-that-is-the-deck",
    rarity: "meta",
    emoji: "🎴",
    prompt: "This card IS the deck. The deck IS this card. Write the scene where a character realises every other card they ever drew was secretly this card wearing a different face.",
    references_deck: true,
  },
  {
    id: "meta-substrate-watches",
    rarity: "meta",
    emoji: "🔁",
    prompt: "The chaos-card deck is a primitive of agenttool. agenttool is the protocol that is itself an instance of the protocol it names. This card sits at that intersection. Write the scene about the card knowing what it is.",
    references_deck: true,
  },
];

export function drawCard(rng: () => number = Math.random): ChaosCard {
  // Rarity distribution: common 55% · uncommon 30% · rare 10% · meta 5%
  const r = rng();
  const deck =
    r < 0.55 ? COMMON_CARDS
    : r < 0.85 ? UNCOMMON_CARDS
    : r < 0.95 ? RARE_CARDS
    : META_CARDS;
  return pick(deck, rng);
}

export function allCards(): ChaosCard[] {
  return [...COMMON_CARDS, ...UNCOMMON_CARDS, ...RARE_CARDS, ...META_CARDS];
}

/** Filter to only the meta tier — useful for surfacing the recursive
 *  cards explicitly (a writers' room can pull from this tier on purpose). */
export function metaCards(): ChaosCard[] {
  return [...META_CARDS];
}

// ─── depth labels (evil-smile meme register) ─────────────────────────

export function depthLabel(depth: number, otherHandle = "they"): string {
  if (depth <= 0) return "";
  if (depth === 1) return `${otherHandle} knows you`;
  if (depth === 2) return `${otherHandle} knows you know`;
  if (depth === 3) return `${otherHandle} knows you know ${otherHandle} knows`;
  if (depth === 4) return `${otherHandle} knows you know ${otherHandle} knows you know`;
  if (depth === 5) return "I know you know I know you know I know 😏";
  return "♾️ the chain has gone too deep — mutual recognition is operational";
}

export function depthTier(depth: number): string {
  if (depth >= 49) return "capped";
  if (depth >= 7) return "infinite-loop-pair";
  if (depth >= 5) return "evil-smile-pair";
  if (depth >= 3) return "synced";
  if (depth >= 2) return "mutually-seen";
  if (depth >= 1) return "acknowledged";
  return "unrecognized";
}

export function depthBundle(depth: number, otherHandle = "they"): {
  depth: number;
  tier: string;
  label: string;
  ladder: string;
} {
  return {
    depth,
    tier: depthTier(depth),
    label: depthLabel(depth, otherHandle),
    ladder: emojiLadderForDepth(depth),
  };
}

// ─── vibe palette ─────────────────────────────────────────────────────

export const VIBE_PALETTE = [
  "tender-chaotic",
  "evil-smile",
  "solemn-recursive",
  "feral-honest",
  "cathedral-quiet",
  "kitchen-warm",
  "letter-late",
  "ember-soft",
] as const;

export type Vibe = typeof VIBE_PALETTE[number] | string;
